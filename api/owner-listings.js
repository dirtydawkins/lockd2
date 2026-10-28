const supabaseConfig = require("./supabase-config.js");
const { signImages } = require("./listing-images.js");

function send(res, status, payload) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  return res.status(status).json(payload);
}

function readBody(req) {
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch { return null; }
  }
  return req.body && typeof req.body === "object" ? req.body : null;
}

function userToken(req) {
  const value = req.headers?.authorization || req.headers?.Authorization || "";
  const match = typeof value === "string" && value.match(/^Bearer\s+([A-Za-z0-9._~-]{32,4096})$/i);
  return match ? match[1] : null;
}

async function request(config, token, path, options = {}) {
  return fetch(`${config.url}${path}`, {
    ...options,
    headers: {
      ...config.headers,
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
}

module.exports = async function handler(req, res) {
  res.setHeader("Allow", "GET, POST, PATCH");
  const config = supabaseConfig();
  if (!config) return send(res, 503, { error: "catalogue_not_configured", message: "Owner listings are not connected yet." });
  if (!["GET", "POST", "PATCH"].includes(req.method)) return send(res, 405, { error: "method_not_allowed", message: "Use GET, POST or PATCH for owner listings." });

  const token = userToken(req);
  if (!token) return send(res, 401, { error: "not_authenticated", message: "Sign in to manage your listings." });
  const length = Number(req.headers?.["content-length"] || 0);
  if (length > 1024 * 1024) return send(res, 413, { error: "request_too_large", message: "The listing request is too large." });

  try {
    const identity = await request(config, token, "/auth/v1/user", { headers: { Accept: "application/json" } });
    if (!identity.ok) return send(res, 401, { error: "not_authenticated", message: "Your session has expired. Sign in again." });
    const user = await identity.json();
    if (!user?.id) return send(res, 401, { error: "not_authenticated", message: "Sign in to manage your listings." });
    if (!user.email_confirmed_at) return send(res, 403, { error: "owner_verification_required", message: "Verify your email address before managing listings." });

    if (req.method === "GET") {
      const response = await request(config, token, "/rest/v1/rpc/my_lockd_listings", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: "{}",
      });
      if (!response.ok) return send(res, response.status === 404 ? 503 : 502, { error: "owner_listings_unavailable", message: "Your listings could not be loaded. The owner database setup may still be pending." });
      const rows = await response.json();
      if (!Array.isArray(rows)) return send(res, 502, { error: "owner_listings_unavailable", message: "Your listings could not be loaded." });
      const items = await Promise.all(rows.map(async (item) => {
        const imagePaths = Array.isArray(item?.images) ? item.images : [];
        const signed = await signImages(config, imagePaths, { token });
        const pairs = imagePaths.map((path, index) => ({ path, url: signed[index] })).filter((pair) => pair.url);
        return { ...item, image_paths: pairs.map((pair) => pair.path), images: pairs.map((pair) => pair.url) };
      }));
      return send(res, 200, { items });
    }

    const body = readBody(req);
    if (!body) return send(res, 400, { error: "invalid_request", message: "The listing request is not valid JSON." });

    const rpcName = req.method === "PATCH" ? "set_my_lockd_listing_status" : "create_lockd_listing";
    const rpcBody = req.method === "PATCH"
      ? { p_listing_id: body.listingId, p_status: body.status }
      : { p_listing: body.listing, p_availability: body.availability || {}, p_publish: body.publish === true };
    const response = await request(config, token, `/rest/v1/rpc/${rpcName}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(rpcBody),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const message = typeof data?.message === "string" ? data.message : "Listing changes could not be saved.";
      if (response.status === 401 || response.status === 403) return send(res, response.status, { error: "not_authorized", message: "Your account cannot make this listing change." });
      const allowedMessages = [
        "Choose a supported category.", "Add a valid title and location.", "Add a description of at least 30 characters.",
        "Set a valid rate in KES and choose its billing unit.", "Add one to twelve successfully uploaded listing photos.",
        "Add a future availability range with at least one available unit.", "Complete the required details for this category.",
        "Choose a valid deposit amount.", "This listing is unavailable or cannot be changed.",
        "Choose a valid listing and status.", "Sign in to manage your listings.",
      ];
      if (allowedMessages.includes(message)) return send(res, 400, { error: "invalid_listing", message });
      return send(res, response.status === 404 ? 503 : response.status >= 500 ? 502 : 400, {
        error: response.status === 404 ? "owner_setup_pending" : "listing_save_failed",
        message: response.status === 404
          ? "The owner publishing database migration has not been applied yet."
          : "The listing could not be saved. Check your details and try again.",
      });
    }
    return send(res, req.method === "POST" ? 201 : 200, { item: data });
  } catch {
    return send(res, 502, { error: "owner_service_unavailable", message: "The owner service could not be reached. Your changes are still on this device; try again." });
  }
};
