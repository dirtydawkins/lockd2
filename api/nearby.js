const supabaseConfig = require("./supabase-config.js");
const { signImages } = require("./listing-images.js");

const categories = new Set(["stay", "drive", "play", "technology", "experience", "camera", "phone", "laptop", "audio", "creative", "other"]);
const techCategories = ["technology", "play", "camera", "phone", "laptop", "audio", "creative"];
const uuidPattern = /^[0-9a-f-]{36}$/i;

function send(res, status, payload) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  return res.status(status).json(payload);
}

function isDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function dateDiff(start, end) {
  return (Date.parse(`${end}T00:00:00.000Z`) - Date.parse(`${start}T00:00:00.000Z`)) / 86400000;
}

module.exports = async function handler(req, res) {
  res.setHeader("Allow", "POST");
  if (req.method !== "POST") return send(res, 405, { error: "method_not_allowed", message: "Use POST to check approximate nearby inventory." });
  const config = supabaseConfig();
  if (!config) return send(res, 503, { error: "catalogue_not_configured", message: "Nearby listings are not connected yet." });

  const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : null;
  if (!body) return send(res, 400, { error: "invalid_request", message: "Choose a valid nearby search." });
  const latitude = body.latitude;
  const longitude = body.longitude;
  const radiusKm = body.radiusKm === undefined ? 10 : Number(body.radiusKm);
  const page = body.page === undefined ? 0 : Number(body.page);
  const category = body.category || "";
  const market = body.market || "";
  const minPrice = body.minPrice === undefined || body.minPrice === "" ? null : Number(body.minPrice);
  const maxPrice = body.maxPrice === undefined || body.maxPrice === "" ? null : Number(body.maxPrice);
  const guests = body.guests === undefined || body.guests === "" ? null : Number(body.guests);
  const startDate = body.startDate || "";
  const endDate = body.endDate || "";
  const quantity = body.quantity === undefined || body.quantity === "" ? 1 : Number(body.quantity);
  const currency = body.currency || "";

  if (typeof latitude !== "number" || !Number.isFinite(latitude) || latitude < -90 || latitude > 90
      || typeof longitude !== "number" || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    return send(res, 400, { error: "invalid_location", message: "The approximate location is not valid." });
  }
  if (!Number.isFinite(radiusKm) || radiusKm < 1 || radiusKm > 100) return send(res, 400, { error: "invalid_radius", message: "Choose a search radius between 1 and 100 km." });
  if (!Number.isInteger(page) || page < 0 || page > 1000) return send(res, 400, { error: "invalid_page", message: "Choose a valid results page." });
  if (category && !categories.has(category)) return send(res, 400, { error: "invalid_category", message: "Choose a supported rental category." });
  if (market && market !== "tech") return send(res, 400, { error: "invalid_market", message: "Choose a supported rental market." });
  if (market === "tech" && category && !techCategories.includes(category)) return send(res, 400, { error: "invalid_category", message: "Choose a technology category." });
  if (minPrice !== null && (!Number.isFinite(minPrice) || minPrice < 0 || minPrice > 100000000)) return send(res, 400, { error: "invalid_price", message: "Enter a valid minimum price." });
  if (maxPrice !== null && (!Number.isFinite(maxPrice) || maxPrice < 0 || maxPrice > 100000000)) return send(res, 400, { error: "invalid_price", message: "Enter a valid maximum price." });
  if (minPrice !== null && maxPrice !== null && minPrice > maxPrice) return send(res, 400, { error: "invalid_price_range", message: "Minimum price cannot be greater than maximum price." });
  if (currency && !["KES", "USD", "EUR"].includes(currency)) return send(res, 400, { error: "invalid_currency", message: "Choose a supported currency." });
  if (guests !== null && (!Number.isInteger(guests) || guests < 1 || guests > 20)) return send(res, 400, { error: "invalid_guests", message: "Guest count must be between 1 and 20." });
  if ((startDate || endDate) && (!isDate(startDate) || !isDate(endDate) || endDate <= startDate || !Number.isInteger(quantity) || quantity < 1 || quantity > 20 || dateDiff(startDate, endDate) > 366)) {
    return send(res, 400, { error: "invalid_availability_filter", message: "Choose a valid start date, return date and quantity." });
  }
  if (startDate && startDate < new Date().toISOString().slice(0, 10)) return send(res, 400, { error: "invalid_date", message: "The start date must be today or later." });

  let availableIds = null;
  if (startDate) {
    try {
      const response = await fetch(`${config.url}/rest/v1/rpc/search_lockd_available_listings`, {
        method: "POST",
        headers: { ...config.headers, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ p_start_date: startDate, p_end_date: endDate, p_quantity: quantity }),
      });
      if (!response.ok) return send(res, 502, { error: "availability_unavailable", message: "Date-specific availability could not be confirmed." });
      const rows = await response.json();
      availableIds = Array.isArray(rows) ? rows.map((row) => row?.listing_id).filter((id) => typeof id === "string" && uuidPattern.test(id)) : [];
      if (!availableIds.length) return send(res, 200, { items: [], page, hasMore: false, total: 0 });
    } catch {
      return send(res, 502, { error: "availability_unavailable", message: "Date-specific availability could not be confirmed." });
    }
  }

  const pageSize = 12;
  try {
    const nearbyResponse = await fetch(`${config.url}/rest/v1/rpc/search_lockd_nearby_listings`, {
      method: "POST",
      headers: { ...config.headers, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        p_latitude: latitude,
        p_longitude: longitude,
        p_radius_km: radiusKm,
        p_category: category || null,
        p_market: market || null,
        p_available_ids: availableIds,
        p_min_price: minPrice,
        p_max_price: maxPrice,
        p_currency: currency || null,
        p_guests: guests,
        p_page: page,
        p_page_size: pageSize,
      }),
    });
    if (!nearbyResponse.ok) {
      const failure = await nearbyResponse.json().catch(() => ({}));
      if (nearbyResponse.status === 404 || failure?.code === "PGRST202" || failure?.code === "42883") {
        return send(res, 503, { error: "nearby_search_not_configured", message: "Approximate nearby search needs the LOCKD location migration before it can show distances." });
      }
      return send(res, 502, { error: "nearby_search_unavailable", message: "Nearby listings could not be loaded right now." });
    }
    const matches = await nearbyResponse.json();
    if (!Array.isArray(matches)) return send(res, 502, { error: "nearby_search_unavailable", message: "Nearby search returned an unexpected response." });
    const ranked = matches.filter((row) => typeof row?.listing_id === "string" && uuidPattern.test(row.listing_id));
    const ids = ranked.map((row) => row.listing_id);
    const total = Number(ranked[0]?.total_count || 0);
    if (!Number.isSafeInteger(total) || total < 0) return send(res, 502, { error: "nearby_search_unavailable", message: "Nearby search returned an unexpected result count." });
    if (!ids.length) return send(res, 200, { items: [], page, hasMore: false, total: 0, radiusKm });

    const query = new URLSearchParams({
      select: "id,slug,title,category,market_category,summary,description,images,image_alt,location_label,price_amount,currency,price_unit,attributes,requires_approval,checkout_enabled,published_at,listing_status,approval_status",
      id: `in.(${ids.join(",")})`,
      listing_status: "eq.published",
      approval_status: "eq.approved",
      limit: String(pageSize),
    });
    const listingResponse = await fetch(`${config.url}/rest/v1/lockd_listings?${query}`, { headers: { ...config.headers, Accept: "application/json" } });
    if (!listingResponse.ok) return send(res, 502, { error: "catalogue_unavailable", message: "Nearby listing details could not be loaded right now." });
    const records = await listingResponse.json();
    if (!Array.isArray(records)) return send(res, 502, { error: "catalogue_unavailable", message: "Nearby listing details returned an unexpected response." });
    const items = await Promise.all(ranked.map(async (match) => {
      const row = records.find((record) => record.id === match.listing_id);
      if (!row || row.listing_status !== "published" || row.approval_status !== "approved") return null;
      return {
        id: row.id,
        slug: row.slug,
        title: row.title,
        category: row.category,
        market_category: row.market_category,
        summary: row.summary,
        description: row.description,
        images: (await signImages(config, Array.isArray(row.images) ? row.images : [], { limit: 1 })).filter(Boolean),
        image_alt: row.image_alt,
        location_label: row.location_label,
        price_amount: row.price_amount,
        currency: row.currency,
        price_unit: row.price_unit,
        attributes: row.attributes || {},
        requires_approval: Boolean(row.requires_approval),
        checkout_enabled: Boolean(row.checkout_enabled),
        published_at: row.published_at || null,
        distance_km: Math.max(0, Number(match.distance_km)),
      };
    }));
    const safeItems = items.filter((item) => item && Number.isFinite(item.distance_km));
    return send(res, 200, { items: safeItems, page, hasMore: (page + 1) * pageSize < total, total, radiusKm });
  } catch {
    return send(res, 502, { error: "nearby_search_unavailable", message: "Nearby listings could not be loaded right now." });
  }
};
