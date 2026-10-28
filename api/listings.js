const categories = new Set([
  "stay", "drive", "play", "technology", "experience", "camera", "phone", "laptop", "audio", "creative", "other",
]);
const supabaseConfig = require("./supabase-config.js");
const { signImages } = require("./listing-images.js");
const technologyCategories = ["technology", "play", "camera", "phone", "laptop", "audio", "creative"];
const groups = {
  gaming: ["play"], phones: ["phone"], computers: ["laptop"],
  creator: ["camera", "creative"], audio: ["audio"], work: ["laptop"],
};
const productTypes = new Set(["gaming", "phone", "computer", "tablet", "camera", "lens", "audio", "creator", "projector"]);
const conditions = new Set(["new", "excellent", "good", "fair", "refurbished"]);
const useCases = new Set(["gaming", "content_creation", "photography", "temporary_work", "presentation", "mobile_productivity", "streaming"]);
const billingUnits = new Set(["hour", "day", "night", "week", "month", "trip"]);
const vehicleTypes = new Set(["car", "suv", "sedan", "coupe", "hatchback", "van", "pickup", "motorcycle", "4x4", "other"]);
const transmissions = new Set(["automatic", "manual", "not_applicable"]);
const fuelTypes = new Set(["petrol", "diesel", "hybrid", "plug_in_hybrid", "electric", "other"]);
const serviceModes = new Set(["self_drive", "chauffeur"]);

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
  const idsValue = req.query?.ids;
  let requestedIds = [];
  if (idsValue !== undefined) {
    if (typeof idsValue !== "string" || idsValue.length > 3699) return send(res, 400, { error: "invalid_listing_ids", message: "Choose valid saved listings." });
    requestedIds = [...new Set(idsValue.split(",").filter(Boolean))];
    if (!requestedIds.length || requestedIds.length > 100 || requestedIds.some((id) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))) {
      return send(res, 400, { error: "invalid_listing_ids", message: "Choose up to 100 valid saved listings." });
    }
    const otherFilters = Object.keys(req.query || {}).filter((key) => key !== "ids");
    if (otherFilters.length) return send(res, 400, { error: "conflicting_listing_ids", message: "Load saved listings without catalogue search filters." });
  }
  if (category && !categories.has(category)) {
    return send(res, 400, { error: "invalid_category", message: "Choose a supported rental category." });
  }
  if (sort && !["relevance", "newest", "price-low", "price-high"].includes(sort)) return send(res, 400, { error: "invalid_sort", message: "Choose a supported sort order." });
  if (q !== undefined && typeof q !== "string") return send(res, 400, { error: "invalid_query", message: "Search text must be plain text." });
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
  const propertyType = filterText(req.query?.propertyType, 40);
  const amenity = filterText(req.query?.amenity, 40);
  const vehicleType = req.query?.vehicleType || "";
  const transmission = req.query?.transmission || "";
  const fuelType = req.query?.fuelType || "";
  const serviceMode = req.query?.serviceMode || "";
  const seats = req.query?.seats === undefined || req.query?.seats === "" ? null : Number(req.query.seats);
  const driverAge = req.query?.driverAge === undefined || req.query?.driverAge === "" ? null : Number(req.query.driverAge);
  const guestCount = req.query?.guests === undefined || req.query?.guests === "" ? null : Number(req.query.guests);
  const roomCount = req.query?.rooms === undefined || req.query?.rooms === "" ? null : Number(req.query.rooms);
  const allowedPropertyTypes = new Set(["hotel", "guesthouse", "apartment", "holiday_home", "lodge", "hostel"]);
  const allowedAmenities = new Set(["wifi", "kitchen", "parking", "pool", "breakfast", "workspace", "air_conditioning"]);
  const productType = req.query?.type;
  const condition = req.query?.condition;
  const duration = req.query?.duration;
  if (brand === null || location === null || accessory === null || propertyType === null || amenity === null) return send(res, 400, { error: "invalid_filter", message: "Use plain words and numbers in catalogue filters." });
  const hasVehicleFilters = Boolean(vehicleType || transmission || fuelType || serviceMode || seats !== null || driverAge !== null);
  if (hasVehicleFilters && category && category !== "drive") return send(res, 400, { error: "conflicting_category", message: "Vehicle filters can only be used with Cars & Mobility." });
  if (vehicleType && !vehicleTypes.has(vehicleType)) return send(res, 400, { error: "invalid_vehicle_type", message: "Choose a supported vehicle type." });
  if (transmission && !transmissions.has(transmission)) return send(res, 400, { error: "invalid_transmission", message: "Choose a supported transmission type." });
  if (fuelType && !fuelTypes.has(fuelType)) return send(res, 400, { error: "invalid_fuel_type", message: "Choose a supported fuel type." });
  if (serviceMode && !serviceModes.has(serviceMode)) return send(res, 400, { error: "invalid_service_mode", message: "Choose self-drive or chauffeur-driven vehicles." });
  if (seats !== null && (!Number.isInteger(seats) || seats < 1 || seats > 40)) return send(res, 400, { error: "invalid_seats", message: "Seat count must be between 1 and 40." });
  if (driverAge !== null && (!Number.isInteger(driverAge) || driverAge < 18 || driverAge > 100)) return send(res, 400, { error: "invalid_driver_age", message: "Driver age must be between 18 and 100." });
  if (propertyType && !allowedPropertyTypes.has(propertyType)) return send(res, 400, { error: "invalid_property_type", message: "Choose a supported property type." });
  if (amenity && !allowedAmenities.has(amenity)) return send(res, 400, { error: "invalid_amenity", message: "Choose a supported stay amenity." });
  if (guestCount !== null && (!Number.isInteger(guestCount) || guestCount < 1 || guestCount > 20)) return send(res, 400, { error: "invalid_guests", message: "Guest count must be between 1 and 20." });
  if (roomCount !== null && (!Number.isInteger(roomCount) || roomCount < 1 || roomCount > 20)) return send(res, 400, { error: "invalid_rooms", message: "Room count must be between 1 and 20." });
  if (req.query?.type && !productTypes.has(productType)) return send(res, 400, { error: "invalid_type", message: "Choose a supported product type." });
  if (condition && !conditions.has(condition)) return send(res, 400, { error: "invalid_condition", message: "Choose a supported item condition." });
  if (duration && !billingUnits.has(duration)) return send(res, 400, { error: "invalid_duration", message: "Choose a supported rental duration." });
  if (req.query?.useCase && !useCases.has(req.query.useCase)) return send(res, 400, { error: "invalid_use_case", message: "Choose a supported use case." });

  const minPrice = numericFilter(req.query?.minPrice);
  const maxPrice = numericFilter(req.query?.maxPrice);
  let currency = req.query?.currency === undefined || req.query?.currency === "" ? "" : req.query.currency;
  if (!currency && (minPrice !== null || maxPrice !== null || sort === "price-low" || sort === "price-high")) currency = "KES";
  if (Number.isNaN(minPrice) || Number.isNaN(maxPrice) || (minPrice !== null && maxPrice !== null && minPrice > maxPrice)) {
    return send(res, 400, { error: "invalid_price_range", message: "Choose a valid minimum and maximum price." });
  }
  if (currency && (typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency))) return send(res, 400, { error: "invalid_currency", message: "Choose a three-letter currency code." });

  const { startDate, endDate } = req.query || {};
  const term = typeof q === "string" ? q.trim().slice(0, 100).replace(/[^\p{L}\p{N} _-]/gu, " ").replace(/\s+/g, " ").trim() : "";
  if (typeof q === "string" && q.trim() && !term) return send(res, 400, { error: "invalid_query", message: "Add a search term using letters or numbers." });
  const parsedPage = pageValue === undefined || pageValue === "" ? 0 : Number(pageValue);
  if (!Number.isInteger(parsedPage) || parsedPage < 0 || parsedPage > 1000) return send(res, 400, { error: "invalid_page", message: "Choose a valid catalogue page." });
  const page = parsedPage;
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

  const limit = requestedIds.length || 24;
  const query = new URLSearchParams({
    select: "id,slug,title,category,market_category,summary,description,images,image_alt,location_label,price_amount,currency,price_unit,deposit_amount,deposit_currency,rental_durations,collection_available,delivery_available,attributes,requires_approval,checkout_enabled,listing_status,approval_status,created_at,published_at",
    listing_status: "eq.published",
    approval_status: "eq.approved",
    limit: String(limit + 1),
    offset: String(page * limit),
    order: sort === "price-low" ? "price_amount.asc.nullslast" : sort === "price-high" ? "price_amount.desc.nullslast" : sort === "newest" ? "published_at.desc.nullslast" : "created_at.desc",
  });
  if (sort === "newest") query.set("published_at", "not.is.null");
  const andFilters = [];
  if (category) query.set("category", `eq.${category}`);
  else if (hasVehicleFilters) query.set("category", "eq.drive");
  else if (group) andFilters.push(`or(market_category.eq.${group},category.in.(${groups[group].join(",")}))`);
  else if (market === "tech") query.set("category", `in.(${technologyCategories.join(",")})`);
  if (slug) query.set("slug", `eq.${slug}`);
  if (requestedIds.length) query.set("id", `in.(${requestedIds.join(",")})`);
  if (brand) query.set("attributes->>brand", `ilike.*${brand}*`);
  if (productType) query.set("attributes->>product_type", `eq.${productType}`);
  if (condition) query.set("attributes->>condition", `eq.${condition}`);
  if (duration) query.set("rental_durations", `cs.{${duration}}`);
  if (accessory) query.set("attributes->included_accessories", `cs.["${accessory}"]`);
  if (location) query.set("location_label", `ilike.*${location}*`);
  // Compare the JSON number itself so guest capacities such as 12 are not
  // treated as lexicographically smaller than 3. The calendar RPC receives
  // the requested room quantity separately and remains the source of truth.
  if (guestCount !== null) query.set("attributes->max_guests", `gte.${guestCount}`);
  if (propertyType) query.set("attributes->>property_type", `eq.${propertyType}`);
  if (amenity) query.set("attributes->amenities", `cs.["${amenity}"]`);
  if (vehicleType) query.set("attributes->>vehicle_type", `eq.${vehicleType}`);
  if (transmission) query.set("attributes->>transmission", `eq.${transmission}`);
  if (fuelType) query.set("attributes->>fuel_type", `eq.${fuelType}`);
  if (seats !== null) query.set("attributes->seating_capacity", `gte.${seats}`);
  if (driverAge !== null) query.set("attributes->minimum_driver_age", `lte.${driverAge}`);
  if (serviceMode) andFilters.push(`or(attributes->>service_mode.eq.${serviceMode},attributes->>service_mode.eq.both)`);
  if (minPrice !== null) andFilters.push(`price_amount.gte.${minPrice}`);
  if (maxPrice !== null) andFilters.push(`price_amount.lte.${maxPrice}`);
  if (currency) query.set("currency", `eq.${currency}`);
  if (req.query?.collection === "yes") query.set("collection_available", "eq.true");
  if (req.query?.delivery === "yes") query.set("delivery_available", "eq.true");
  if (req.query?.useCase) query.set("attributes->use_cases", `cs.["${req.query.useCase}"]`);
  if (availabilityIds) query.set("id", `in.(${availabilityIds.join(",")})`);
  if (andFilters.length) query.set("and", `(${andFilters.join(",")})`);

  try {
    let rankedIds = null;
    let rankedTotal = null;
    let substringFallback = false;
    if (term) {
      const searchFilters = {
        category: category || (hasVehicleFilters ? "drive" : ""),
        market: market || "",
        group: group || "",
        location: location || "",
        minPrice: minPrice === null ? "" : String(minPrice),
        maxPrice: maxPrice === null ? "" : String(maxPrice),
        currency: currency || "",
        brand: brand || "",
        type: productType || "",
        condition: condition || "",
        duration: duration || "",
        accessory: accessory || "",
        propertyType: propertyType || "",
        amenity: amenity || "",
        guests: guestCount === null ? "" : String(guestCount),
        vehicleType,
        transmission,
        fuelType,
        seats: seats === null ? "" : String(seats),
        driverAge: driverAge === null ? "" : String(driverAge),
        serviceMode,
        collection: req.query?.collection === "yes",
        delivery: req.query?.delivery === "yes",
        useCase: req.query?.useCase || "",
      };
      const searchResponse = await fetch(`${config.url}/rest/v1/rpc/search_lockd_listings`, {
        method: "POST",
        headers: { ...config.headers, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          p_query: term,
          p_filters: searchFilters,
          p_available_ids: availabilityIds,
          p_sort: sort || "relevance",
          p_page: page,
          p_page_size: limit,
        }),
      });
      if (!searchResponse.ok) {
        const failure = await searchResponse.json().catch(() => ({}));
        // Keep the existing catalogue usable while the additive ranking migration
        // is pending. Other database failures remain visible as errors.
        substringFallback = searchResponse.status === 404 && failure?.code === "PGRST202";
        if (!substringFallback) return send(res, 502, { error: "search_unavailable", message: "Text search is temporarily unavailable. Please try again." });
      }
      if (!substringFallback) {
        const matches = await searchResponse.json();
        if (!Array.isArray(matches)) return send(res, 502, { error: "search_unavailable", message: "Text search returned an unexpected response. Please try again." });
        rankedIds = matches.map((match) => match?.listing_id).filter((id) => typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id));
        rankedTotal = Number(matches?.[0]?.total_count || 0);
        if (!Number.isFinite(rankedTotal) || rankedTotal < 0) return send(res, 502, { error: "search_unavailable", message: "Text search returned an unexpected response. Please try again." });
        if (!rankedIds.length) return send(res, 200, { items: [], page, hasMore: false, total: 0 });
        query.set("id", `in.(${rankedIds.join(",")})`);
        query.set("offset", "0");
        query.set("limit", String(Math.min(limit, rankedIds.length)));
      }
      if (substringFallback) {
        const fields = ["title", "summary", "description", "category", "market_category", "location_label", "attributes->>brand", "attributes->>model", "attributes->>configuration", "attributes->>specifications", "attributes->>property_type", "attributes->>room_type", "attributes->>product_type", "attributes->>vehicle_type", "attributes->>fuel_type", "attributes->>transmission", "attributes->>destination", "attributes->>duration", "attributes->>included_accessories", "attributes->>amenities", "attributes->>tags"];
        const stopWords = new Set(["a", "an", "and", "for", "in", "near", "of", "the", "to", "with"]);
        const tokens = [...new Set(term.split(" ").filter((token) => token.length > 1 && !stopWords.has(token.toLowerCase())))].slice(0, 6);
        if (tokens.length > 1) tokens.forEach((token) => andFilters.push(`or(${fields.map((field) => `${field}.ilike.*${token}*`).join(",")})`));
        else query.set("or", `(${fields.map((field) => `${field}.ilike.*${term}*`).join(",")})`);
        if (andFilters.length) query.set("and", `(${andFilters.join(",")})`);
      }
    }
    let publicationTimestampReliable = true;
    let response = await fetch(`${config.url}/rest/v1/lockd_listings?${query}`, {
      headers: {
        ...config.headers,
        Accept: "application/json",
      },
    });
    if (!response.ok) {
      const failure = await response.json().catch(() => ({}));
      const missingPublishedAt = failure?.code === "42703"
        || (failure?.code === "PGRST204" && /published_at/i.test(failure?.message || ""))
        || (/published_at/i.test(failure?.message || "") && /does not exist|schema cache/i.test(failure?.message || ""));
      if (missingPublishedAt) {
        publicationTimestampReliable = false;
        query.set("select", query.get("select").replace(",published_at", ""));
        query.delete("published_at");
        if (sort === "newest") query.set("order", "created_at.desc");
        response = await fetch(`${config.url}/rest/v1/lockd_listings?${query}`, {
          headers: { ...config.headers, Accept: "application/json" },
        });
      } else return send(res, 502, { error: "catalogue_unavailable", message: "The rental catalogue is temporarily unavailable." });
    }
    if (!response.ok) return send(res, 502, { error: "catalogue_unavailable", message: "The rental catalogue is temporarily unavailable." });
    const rows = await response.json();
    const hasMore = requestedIds.length ? false : rankedIds ? (page + 1) * limit < rankedTotal : rows.length > limit;
    const orderedRows = rankedIds
      ? rankedIds.map((id) => rows.find((row) => row.id === id)).filter(Boolean)
      : rows.slice(0, limit);
    const items = await Promise.all(orderedRows.map(async (row) => ({
      id: row.id,
      slug: row.slug,
      title: row.title,
      category: row.category,
      market_category: row.market_category,
      summary: row.summary,
      description: row.description,
      images: (await signImages(config, Array.isArray(row.images) ? row.images : [], { limit: slug ? 12 : 1 })).filter(Boolean),
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
      published_at: row.published_at || null,
    })));
    if (slug) return send(res, 200, { item: items[0] || null });
    return send(res, 200, { items, page, hasMore, publicationTimestampReliable, ...(rankedTotal === null ? {} : { total: rankedTotal }) });
  } catch {
    return send(res, 502, { error: "catalogue_unavailable", message: "The rental catalogue is temporarily unavailable." });
  }
};
