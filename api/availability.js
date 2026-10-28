function send(res, status, payload) {
  res.setHeader("Cache-Control", "no-store");
  res.status(status).json(payload);
}

function isDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return send(res, 405, { error: "method_not_allowed", message: "Use POST to check rental dates." });
  }

  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  let origin;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || !key) throw new Error("config");
    origin = parsed.origin;
  } catch {
    return send(res, 503, { error: "catalogue_not_configured", message: "Live availability is not configured." });
  }

  const body = typeof req.body === "string" ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })() : (req.body || {});
  const { listingId, startDate, endDate, quantity } = body;
  const validId = typeof listingId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(listingId);
  const units = Number(quantity);
  if (!validId || !isDate(startDate) || !isDate(endDate) || endDate <= startDate || !Number.isInteger(units) || units < 1 || units > 20) {
    return send(res, 400, { error: "invalid_request", message: "Choose a valid listing, date range and quantity." });
  }
  if (startDate < new Date().toISOString().slice(0, 10)) {
    return send(res, 400, { error: "invalid_date", message: "The start date must be today or later." });
  }

  try {
    const response = await fetch(`${origin}/rest/v1/rpc/check_lockd_listing_availability`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        p_listing_id: listingId,
        p_start_date: startDate,
        p_end_date: endDate,
        p_quantity: units,
      }),
    });
    if (!response.ok) return send(res, 502, { error: "availability_unavailable", message: "Availability could not be checked right now." });
    const result = await response.json();
    return send(res, 200, { available: result === true });
  } catch {
    return send(res, 502, { error: "availability_unavailable", message: "Availability could not be checked right now." });
  }
};
