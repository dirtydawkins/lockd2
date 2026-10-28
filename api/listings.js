const categories = new Set([
  "stay", "drive", "play", "technology", "experience", "camera", "phone", "laptop", "audio", "creative", "other",
]);
const supabaseConfig = require("./supabase-config.js");
const technologyCategories = ["technology", "play", "camera", "phone", "laptop", "audio", "creative"];
const groups = {
  gaming: ["play"], phones: ["phone"], computers: ["laptop"],
  creator: ["camera", "creative"], audio: ["audio"], work: ["laptop"],
};
const productTypes = new Set(["gaming", "phone", "computer", "tablet", "camera", "lens", "audio", "creator", "projector"]);
const conditions = new Set(["new", "excellent", "good", "fair", "refurbished"]);
const useCases = new Set(["gaming", "content_creation", "photography", "temporary_work", "presentation", "mobile_productivity", "streaming"]);
const billingUnits = new Set(["hour", "day", "night", "week", "month", "trip"]);

function send(res, status, payload) {
  res.setHeader("Cache-Control", "no-store");
  res.status(status).json(payload);
}

function isDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function filterText(value, maxLength = 60) {
  if (typeof value !== "string" || !value.trim()) return "";
  const normalized = value.trim().slice(0, maxLength);
  return /^[\p{L}\p{N} .&_-]+$/u.test(normalized) ? normalized : null;
}

function numericFilter(value) {
  if (value === undefined || value === "") return null;
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 && amount <= 100000000 ? amount : NaN;
}

async function availableIds(config, startDate, endDate, quantity) {
  const response = await fetch(`${config.url}/rest/v1/rpc/search_lockd_available_listings`, {
    method: "POST",
    headers: {
      ...config.headers,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ p_start_date: startDate, p_end_date: endDate, p_quantity: quantity }),
  });
  if (!response.ok) throw new Error("availability search failed");
  const result = await response.json();
  return Array.isArray(result) ? result.map((row) => row.listing_id).filter((id) => typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id)) : [];
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return send(res, 405, { error: "method_not_allowed", message: "Use GET to read the rental catalogue." });
  }

  const config = supabaseConfig();
  if (!config) return send(res, 503, { error: "catalogue_not_configured", message: "The live rental catalogue is not configured." });

  const { category, q, slug, page: pageValue, sort, market, group } = req.query || {};
  if (category && !categories.has(category)) {
    return send(res, 400, { error: "invalid_category", message: "Choose a supported rental category." });
  }
  if (market && market !== "tech") return send(res, 400, { error: "invalid_market", message: "Choose a supported rental market." });
  if (group && !groups[group]) return send(res, 400, { error: "invalid_group", message: "Choose a supported technology category." });
  if (category && group) return send(res, 400, { error: "conflicting_category", message: "Use a category or technology group, not both." });
  if (market === "tech" && category && !technologyCategories.includes(category)) {
    return send(res, 400, { error: "invalid_technology_category", message: "Choose a supported technology category." });
  }
  if (slug && !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}$/.test(slug)) {
    return send(res, 400, { error: "invalid_slug", message: "This rental could not be found." });
  }
  const brand = filterText(req.query?.brand);
  const location = filterText(req.query?.location);
  const accessory = filterText(req.query?.accessory);
  const productType = req.query?.type;
  const condition = req.query?.condition;
  const duration = req.query?.duration;
  if (brand === null || location === null || accessory === null) return send(res, 400, { error: "invalid_filter", message: "Use plain words and numbers in catalogue filters." });
  if (req.query?.type && !productTypes.has(productType)) return send(res, 400, { error: "invalid_type", message: "Choose a supported product type." });
  if (condition && !conditions.has(condition)) return send(res, 400, { error: "invalid_condition", message: "Choose a supported item condition." });
  if (duration && !billingUnits.has(duration)) return send(res, 400, { error: "invalid_duration", message: "Choose a supported rental duration." });
  if (req.query?.useCase && !useCases.has(req.query.useCase)) return send(res, 400, { error: "invalid_use_case", message: "Choose a supported use case." });

  const minPrice = numericFilter(req.query?.minPrice);
  const maxPrice = numericFilter(req.query?.maxPrice);
  if (Number.isNaN(minPrice) || Number.isNaN(maxPrice) || (minPrice !== null && maxPrice !== null && minPrice > maxPrice)) {
    return send(res, 400, { error: "invalid_price_range", message: "Choose a valid minimum and maximum price." });
  }

  const { startDate, endDate } = req.query || {};
  let quantity = 1;
  let availabilityIds = null;
  if (startDate || endDate) {
    quantity = Number(req.query?.quantity || 1);
    if (!isDate(startDate) || !isDate(endDate) || endDate <= startDate || !Number.isInteger(quantity) || quantity < 1 || quantity > 20 || (Date.parse(`${endDate}T00:00:00.000Z`) - Date.parse(`${startDate}T00:00:00.000Z`)) / 86400000 > 366) {
      return send(res, 400, { error: "invalid_availability_filter", message: "Choose a valid start date, return date and quantity." });
    }
    if (startDate < new Date().toISOString().slice(0, 10)) return send(res, 400, { error: "invalid_date", message: "The start date must be today or later." });
    try { availabilityIds = await availableIds(config, startDate, endDate, quantity); }
    catch { return send(res, 502, { error: "availability_unavailable", message: "Date-filtered rentals could not be loaded right now." }); }
    if (!availabilityIds.length) return send(res, 200, { items: [], page: 0, hasMore: false });
  }

  const page = Math.max(0, Math.min(1000, Number.parseInt(pageValue || "0", 10) || 0));
  const limit = 24;
  const query = new URLSearchParams({
    select: "id,slug,title,category,market_category,summary,description,images,image_alt,location_label,price_amount,currency,price_unit,deposit_amount,deposit_currency,rental_durations,collection_available,delivery_available,attributes,requires_approval,checkout_enabled,listing_status,approval_status,created_at",
    listing_status: "eq.published",
    approval_status: "eq.approved",
    limit: String(limit + 1),
    offset: String(page * limit),
    order: sort === "price-low" ? "price_amount.asc.nullslast" : sort === "price-high" ? "price_amount.desc.nullslast" : "created_at.desc",
  });
  const andFilters = [];
  if (category) query.set("category", `eq.${category}`);
  else if (group) andFilters.push(`or(market_category.eq.${group},category.in.(${groups[group].join(",")}))`);
  else if (market === "tech") query.set("category", `in.(${technologyCategories.join(",")})`);
  if (slug) query.set("slug", `eq.${slug}`);
  if (brand) query.set("attributes->>brand", `ilike.*${brand}*`);
  if (productType) query.set("attributes->>product_type", `eq.${productType}`);
  if (condition) query.set("attributes->>condition", `eq.${condition}`);
  if (duration) query.set("rental_durations", `cs.{${duration}}`);
  if (accessory) query.set("attributes->included_accessories", `cs.["${accessory}"]`);
  if (location) query.set("location_label", `ilike.*${location}*`);
  if (minPrice !== null) andFilters.push(`price_amount.gte.${minPrice}`);
  if (maxPrice !== null) andFilters.push(`price_amount.lte.${maxPrice}`);
  if (andFilters.length) query.set("and", `(${andFilters.join(",")})`);
  if (req.query?.collection === "yes") query.set("collection_available", "eq.true");
  if (req.query?.delivery === "yes") query.set("delivery_available", "eq.true");
  if (req.query?.useCase) query.set("attributes->use_cases", `cs.["${req.query.useCase}"]`);
  if (availabilityIds) query.set("id", `in.(${availabilityIds.join(",")})`);
  if (typeof q === "string" && q.trim()) {
    const term = q.trim().slice(0, 100).replace(/[^\p{L}\p{N} _-]/gu, " ").replace(/\s+/g, " ");
    query.set("or", `(title.ilike.*${term}*,summary.ilike.*${term}*,description.ilike.*${term}*,attributes->>brand.ilike.*${term}*,attributes->>model.ilike.*${term}*,attributes->>configuration.ilike.*${term}*,attributes->>specifications.ilike.*${term}*)`);
  }

  try {
    const response = await fetch(`${config.url}/rest/v1/lockd_listings?${query}`, {
      headers: {
        ...config.headers,
        Accept: "application/json",
      },
    });
    if (!response.ok) return send(res, 502, { error: "catalogue_unavailable", message: "The rental catalogue is temporarily unavailable." });
    const rows = await response.json();
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map((row) => ({
      id: row.id,
      slug: row.slug,
      title: row.title,
      category: row.category,
      market_category: row.market_category,
      summary: row.summary,
      description: row.description,
      images: Array.isArray(row.images) ? row.images : [],
      image_alt: row.image_alt,
      location_label: row.location_label,
      price_amount: row.price_amount,
      currency: row.currency,
      price_unit: row.price_unit,
      deposit_amount: row.deposit_amount,
      deposit_currency: row.deposit_currency,
      rental_durations: Array.isArray(row.rental_durations) ? row.rental_durations : [],
      collection_available: row.collection_available,
      delivery_available: row.delivery_available,
      attributes: row.attributes || {},
      requires_approval: Boolean(row.requires_approval),
      checkout_enabled: Boolean(row.checkout_enabled),
    }));
    if (slug) return send(res, 200, { item: items[0] || null });
    return send(res, 200, { items, page, hasMore });
  } catch {
    return send(res, 502, { error: "catalogue_unavailable", message: "The rental catalogue is temporarily unavailable." });
  }
};
