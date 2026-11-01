// Uses the existing Supabase identity and caller JWT. No service-role credential.
const configFor = require("./supabase-config");
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const safe = new Set([
  "Administrator access required.",
  "A different reviewer is required.",
  "Reservation not found.",
  "This reservation change is not permitted.",
  "Invalid policy.",
  "Invalid policy field.",
  "Policy enabled state is required.",
  "A review decision and reason are required.",
  "Invalid verification validity.",
  "Verification, conditions and both required approvals must be current.",
  "Invalid replacement value.",
  "This handover change is not permitted.",
  "A condition summary is required.",
  "A dispute description is required.",
  "Dispute not found.",
  "A resolution and reason are required.",
  "An appeal reason is required.",
]);
module.exports = async (req, res) => {
  if(req.query?.module==='reviews')return require('../lib/reviews-api')(req,res);
  const send = (status, data) => {
    res.setHeader("Cache-Control", "no-store");
    return res.status(status).json(data);
  };
  if (!["GET", "POST"].includes(req.method)) {
    res.setHeader("Allow", "GET, POST");
    return send(405, { message: "Method not allowed." });
  }
  const config = configFor();
  if (!config)
    return send(503, { message: "Account checks are unavailable right now." });
  const token = (req.headers?.authorization || "").match(
    /^Bearer ([A-Za-z0-9._~-]{32,4096})$/i,
  )?.[1];
  if (!token) return send(401, { message: "Sign in to continue." });
  let body = req.body || {};
  if (Number(req.headers?.["content-length"]) > 8192)
    return send(413, { message: "Request too large." });
  if (typeof body === "string") {
    if (Buffer.byteLength(body) > 8192)
      return send(413, { message: "Request too large." });
    try {
      body = JSON.parse(body);
    } catch {
      return send(400, { message: "Invalid request." });
    }
  }
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Buffer.byteLength(JSON.stringify(body)) > 8192
  )
    return send(400, { message: "Invalid request." });
  let rpc,
    args = {};
  if (req.method === "GET") {
    if (req.query?.view === "admin") rpc = "lockd_trust_admin_overview";
    else if (req.query?.view === "operations")
      rpc = "lockd_operations_overview";
    else if (req.query?.view === "disputes") rpc = "my_lockd_disputes";
    else if (req.query?.view === "notifications")
      rpc = "my_lockd_notifications";
    else if (
      ["handover", "context"].includes(req.query?.view) &&
      uuid.test(req.query?.bookingId || "")
    ) {
      rpc =
        req.query.view === "context"
          ? "my_lockd_rental_checks"
          : "my_lockd_handover";
      args = { p_booking_id: req.query.bookingId };
    } else if (req.query?.view && req.query.view !== "passport")
      return send(400, { message: "Invalid view." });
    else rpc = "my_lockd_verification";
  } else {
    switch (body.action) {
      case "booking":
        if (
          !uuid.test(body.bookingId || "") ||
          !["accept", "accept_conditions", "continue"].includes(
            body.bookingAction,
          )
        )
          break;
        rpc = "transition_lockd_booking";
        args = { p_booking_id: body.bookingId, p_action: body.bookingAction };
        break;
      case "read_notification":
        if (!Number.isSafeInteger(body.id) || body.id < 1) break;
        rpc = "read_lockd_notification";
        args = { p_id: body.id };
        break;
      case "policy":
        if (
          !body.policy ||
          typeof body.policy !== "object" ||
          Array.isArray(body.policy)
        )
          break;
        rpc = "configure_lockd_verification_policy";
        args = { p_policy: body.policy };
        break;
      case "review":
        if (
          !uuid.test(body.bookingId || "") ||
          !["approved", "rejected"].includes(body.decision) ||
          typeof body.reason !== "string" ||
          body.reason.trim().length < 5 ||
          body.reason.length > 1000
        )
          break;
        rpc = "review_lockd_booking";
        args = {
          p_booking_id: body.bookingId,
          p_decision: body.decision,
          p_reason: body.reason,
        };
        break;
      case "value":
        if (
          !uuid.test(body.listingId || "") ||
          typeof body.value !== "string" ||
          !/^\d{1,12}(\.\d{1,2})?$/.test(body.value)
        )
          break;
        rpc = "record_lockd_listing_trust_value";
        args = { p_listing_id: body.listingId, p_value: body.value };
        break;
      case "verification":
        if (
          !uuid.test(body.userId || "") ||
          !["identity", "address"].includes(body.kind) ||
          !["verified", "review_required", "revoked"].includes(body.outcome) ||
          typeof body.reference !== "string" ||
          !body.reference.trim() ||
          body.reference.length > 200 ||
          !Number.isInteger(body.validDays) ||
          body.validDays < 1 ||
          body.validDays > 365 ||
          !["sandbox", "production"].includes(body.environment)
        )
          break;
        rpc = "record_lockd_manual_verification";
        args = {
          p_user_id: body.userId,
          p_kind: body.kind,
          p_outcome: body.outcome,
          p_reference: body.reference,
          p_valid_days: body.validDays,
          p_environment: body.environment,
        };
        break;
      case "handover":
        if (
          !uuid.test(body.bookingId || "") ||
          !["out", "return"].includes(body.phase) ||
          typeof body.summary !== "string" ||
          body.summary.trim().length < 5 ||
          body.summary.length > 2000 ||
          !Number.isInteger(body.expectedVersion) ||
          body.expectedVersion < 0
        )
          break;
        rpc = "acknowledge_lockd_handover";
        args = {
          p_booking_id: body.bookingId,
          p_phase: body.phase,
          p_summary: body.summary,
          p_expected_version: body.expectedVersion,
        };
        break;
      case "dispute":
        if (
          !uuid.test(body.bookingId || "") ||
          typeof body.description !== "string" ||
          body.description.trim().length < 10 ||
          body.description.length > 2000
        )
          break;
        rpc = "open_lockd_dispute";
        args = {
          p_booking_id: body.bookingId,
          p_description: body.description,
        };
        break;
      case "resolve_dispute":
        if (
          !uuid.test(body.disputeId || "") ||
          typeof body.reason !== "string" ||
          body.reason.trim().length < 10 ||
          body.reason.length > 2000 ||
          !["resolved", "dismissed"].includes(body.resolution)
        )
          break;
        rpc = "resolve_lockd_dispute";
        args = {
          p_dispute_id: body.disputeId,
          p_resolution: body.resolution,
          p_reason: body.reason,
        };
        break;
      case "appeal":
        if (
          !uuid.test(body.disputeId || "") ||
          typeof body.reason !== "string" ||
          body.reason.trim().length < 10 ||
          body.reason.length > 2000
        )
          break;
        rpc = "appeal_lockd_dispute";
        args = { p_dispute_id: body.disputeId, p_reason: body.reason };
        break;
      case "finalize_return":
        if (
          !uuid.test(body.bookingId || "") ||
          typeof body.reason !== "string" ||
          body.reason.trim().length < 10 ||
          body.reason.length > 2000
        )
          break;
        rpc = "finalize_lockd_disputed_return";
        args = { p_booking_id: body.bookingId, p_reason: body.reason };
        break;
    }
  }
  if (!rpc) return send(400, { message: "Choose valid verification details." });
  try {
    const headers = {
      ...config.headers,
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    };
    const identity = await fetch(`${config.url}/auth/v1/user`, {
      headers,
      signal: AbortSignal.timeout(8000),
    });
    if (!identity.ok)
      return send(401, { message: "Your session has expired. Sign in again." });
    const response = await fetch(`${config.url}/rest/v1/rpc/${rpc}`, {
      method: "POST",
      headers,
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(10000),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok)
      return send(
        response.status === 404 ? 503 : response.status >= 500 ? 502 : 400,
        {
          message: safe.has(result?.message)
            ? result.message
            : "Verification tools are unavailable. Please try again later.",
        },
      );
    return send(200, { item: result });
  } catch {
    return send(502, {
      message: "Verification tools could not be reached. Please retry.",
    });
  }
};
