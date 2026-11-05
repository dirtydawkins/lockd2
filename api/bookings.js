const getConfig = require("./supabase-config.js");
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const actions = new Set([
  "accept",
  "reject",
  "cancel",
  "check_out",
  "check_in",
  "dispute",
  "accept_conditions",
  "continue",
]);
const safeErrors = new Set([
  "Reservations are not enabled yet.",
  "These dates are unavailable.",
  "This listing cannot be reserved online.",
  "This billing period needs owner confirmation.",
  "This stay needs owner confirmation.",
  "This listing needs owner confirmation.",
  "Sign in with a verified account.",
  "This request reference was already used.",
  "Please wait before sending another request.",
  "This listing cannot be reserved by this account.",
  "Reservation not found.",
  "This reservation change is not permitted.",
  "This listing is no longer published.",
  "Verification, conditions and both required approvals must be current.",
  "This rental exceeds the verification policy duration limit.",
  "The listing deposit does not meet the rental policy. Contact support.",
  "Record both handover acknowledgements first.",
  "Record both return acknowledgements first.",
  "A dispute description is required.",
]);
function date(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
safeErrors.add("The price changed. Review the current total.");
module.exports = async (req, res) => {
  if (req.query?.view === "checkout") return require("../lib/checkout-api")(req,res);
  const send = (code, data) => {
    res.setHeader("Cache-Control", "no-store");
    return res.status(code).json(data);
  };
  if (!["GET", "POST", "PATCH"].includes(req.method)) {
    res.setHeader("Allow", "GET, POST, PATCH");
    return send(405, { message: "Method not allowed." });
  }
  const enabled = process.env.LOCKD_BOOKING_REQUESTS_ENABLED === "true";
  if (req.method === "GET" && req.query?.capabilities === "1")
    return send(200, { requestsEnabled: enabled, paymentsEnabled: false });
  const config = getConfig();
  if (!config)
    return send(503, { message: "Reservations are unavailable right now." });
  let body = req.body || {};
  if (typeof body === "string") {
    if (Buffer.byteLength(body) > 8192)
      return send(413, { message: "Request too large." });
    try {
      body = JSON.parse(body);
    } catch {
      return send(400, { message: "Invalid request." });
    }
  }
  if (Number(req.headers?.["content-length"]) > 8192)
    return send(413, { message: "Request too large." });
  if (!body || typeof body !== "object" || Array.isArray(body))
    return send(400, { message: "Invalid request." });
  if (Buffer.byteLength(JSON.stringify(body)) > 8192)
    return send(413, { message: "Request too large." });
  let rpc, args;
  if (req.method === "GET") {
    rpc = "my_lockd_bookings";
    args = { p_owner: req.query?.owner === "1" };
  } else if (req.method === "PATCH") {
    if (!uuid.test(body.bookingId || "") || !actions.has(body.action))
      return send(400, { message: "Choose a valid reservation action." });
    rpc = "transition_lockd_booking";
    args = { p_booking_id: body.bookingId, p_action: body.action };
  } else {
    if (!enabled)
      return send(503, {
        message: "Online reservation requests are not enabled yet.",
      });
    if (
      !uuid.test(body.listingId || "") ||
      !date(body.startDate) ||
      !date(body.endDate) ||
      body.startDate < new Date().toISOString().slice(0, 10) ||
      body.endDate <= body.startDate ||
      !Number.isInteger(body.quantity) ||
      body.quantity < 1 ||
      body.quantity > 20 ||
      !["quote", "request"].includes(body.action)
    )
      return send(400, { message: "Choose valid rental dates and quantity." });
    rpc =
      body.action === "quote" ? "quote_lockd_booking" : "request_lockd_booking";
    args = {
      p_listing_id: body.listingId,
      p_start_date: body.startDate,
      p_end_date: body.endDate,
      p_quantity: body.quantity,
    };
    if (body.action === "request") {
      if (!uuid.test(body.idempotencyKey || ""))
        return send(400, { message: "A valid request reference is required." });
      if (
        typeof body.expectedTotal !== "string" ||
        !/^\d{1,12}(\.\d{1,2})?$/.test(body.expectedTotal) ||
        body.expectedCurrency !== "KES"
      )
        return send(400, {
          message: "Review the current total before sending a request.",
        });
      args.p_idempotency_key = body.idempotencyKey;
      args.p_expected_total = body.expectedTotal;
      args.p_expected_currency = body.expectedCurrency;
    }
  }
  const token = (req.headers?.authorization || "").match(
    /^Bearer ([A-Za-z0-9._~-]{32,4096})$/i,
  )?.[1];
  if (rpc !== "quote_lockd_booking" && !token)
    return send(401, { message: "Sign in to manage reservations." });
  try {
    const headers = {
      ...config.headers,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
    if (token) {
      const identity = await fetch(`${config.url}/auth/v1/user`, {
        headers,
        signal: AbortSignal.timeout(8000),
      });
      if (!identity.ok && ![401,403].includes(identity.status))
        return send(503, { message: "Your account could not be checked right now. Please try again." });
      if (!identity.ok)
        return send(401, {
          message: "Your session has expired. Sign in again.",
        });
    }
    const response = await fetch(`${config.url}/rest/v1/rpc/${rpc}`, {
      method: "POST",
      headers,
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(10000),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) {
      const message = result?.message;
      return send(
        response.status === 404 ? 503 : response.status >= 500 ? 502 : 400,
        {
          message: safeErrors.has(message)
            ? message
            : "Reservations are temporarily unavailable. Please try again.",
        },
      );
    }
    return send(200, { [req.method === "GET" ? "items" : "item"]: result });
  } catch {
    return send(502, {
      message:
        "Reservations could not be reached. Retry with the same request reference.",
    });
  }
};
