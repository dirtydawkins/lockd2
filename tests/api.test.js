const test = require("node:test");
const assert = require("node:assert/strict");

const listings = require("../api/listings.js");
const availability = require("../api/availability.js");
const config = require("../api/config.js");
const sitemap = require("../api/sitemap.js");
const listingImages = require("../api/listing-images.js");

function mockResponse() {
  return {
    headers: {},
    statusCode: 200,
    body: undefined,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    send(value) { this.body = value; return this; },
  };
}

async function invoke(handler, { method = "GET", query = {}, body = undefined } = {}) {
  const res = mockResponse();
  await handler({ method, query, body }, res);
  return res;
}

function configure(t) {
  const oldUrl = process.env.SUPABASE_URL;
  const oldKey = process.env.SUPABASE_ANON_KEY;
  process.env.SUPABASE_URL = "https://example-project.supabase.co";
  process.env.SUPABASE_ANON_KEY = "public-test-key";
  t.after(() => {
    if (oldUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SUPABASE_ANON_KEY;
    else process.env.SUPABASE_ANON_KEY = oldKey;
  });
}

function mockFetch(t, implementation) {
  const oldFetch = global.fetch;
  global.fetch = implementation;
  t.after(() => { global.fetch = oldFetch; });
}

function httpResponse(status, data) {
  return { ok: status >= 200 && status < 300, status, json: async () => data };
}

test("catalogue fails closed when Supabase is not configured", async (t) => {
  const oldUrl = process.env.SUPABASE_URL;
  const oldKey = process.env.SUPABASE_ANON_KEY;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_ANON_KEY;
  t.after(() => {
    if (oldUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SUPABASE_ANON_KEY;
    else process.env.SUPABASE_ANON_KEY = oldKey;
  });
  const res = await invoke(listings);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error, "catalogue_not_configured");
});

test("publishable and legacy public Supabase environment names are accepted by the serverless handlers", async (t) => {
  const names = [
    "SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL",
    "SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  ];
  const oldValues = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  t.after(() => names.forEach((name) => {
    if (oldValues[name] === undefined) delete process.env[name];
    else process.env[name] = oldValues[name];
  }));
  const configurations = [
    ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "sb_publishable_server_test"],
    ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_next_test"],
    ["SUPABASE_URL", "SUPABASE_ANON_KEY", "legacy_server_test"],
    ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "legacy_next_test"],
  ];
  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const nextDay = new Date(tomorrow);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const format = (date) => date.toISOString().slice(0, 10);
  let expectedKey = "";
  mockFetch(t, async (url, options) => {
    assert.equal(options.headers.apikey, expectedKey);
    if (expectedKey.startsWith("sb_publishable_")) assert.equal(options.headers.Authorization, undefined);
    else assert.equal(options.headers.Authorization, `Bearer ${expectedKey}`);
    return httpResponse(200, new URL(url).pathname.endsWith("/rpc/check_lockd_listing_availability") ? true : []);
  });

  for (const [urlName, keyName, keyValue] of configurations) {
    names.forEach((name) => delete process.env[name]);
    process.env[urlName] = "https://example-project.supabase.co";
    process.env[keyName] = keyValue;
    expectedKey = keyValue;
    const catalog = await invoke(listings);
    assert.equal(catalog.statusCode, 200);
    assert.deepEqual(catalog.body.items, []);
    const check = await invoke(availability, { method: "POST", body: {
      listingId: "b97f0876-a29a-4b6a-b8ca-a11111111111",
      startDate: format(tomorrow), endDate: format(nextDay), quantity: 1,
    } });
    assert.deepEqual(check.body, { available: true });
  }
});

test("catalogue rejects unsupported methods and categories", async (t) => {
  configure(t);
  mockFetch(t, async () => { throw new Error("fetch should not run for invalid requests"); });
  const method = await invoke(listings, { method: "POST" });
  assert.equal(method.statusCode, 405);
  assert.equal(method.headers.allow, "GET");
  const category = await invoke(listings, { query: { category: "private" } });
  assert.equal(category.statusCode, 400);
  assert.equal(category.body.error, "invalid_category");
});

test("catalogue query returns only explicitly selected public listing fields", async (t) => {
  configure(t);
  let requestedUrl;
  let searchRequest;
  const id = "b97f0876-a29a-4b6a-b8ca-a11111111111";
  mockFetch(t, async (url, options) => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith("/rpc/search_lockd_listings")) {
      searchRequest = { parsed, options };
      return httpResponse(200, [{ listing_id: id, search_rank: 100, total_count: 1 }]);
    }
    requestedUrl = parsed;
    assert.equal(options.headers.apikey, "public-test-key");
    return httpResponse(200, [{
      id, slug: "camera-one", title: "Camera", category: "camera",
      price_amount: 100, currency: "KES", price_unit: "day", images: [],
      listing_status: "published", approval_status: "approved", owner_id: "must-not-leak",
    }]);
  });
  const res = await invoke(listings, { query: { category: "camera", q: "camera;select=*", sort: "price-low" } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.items.length, 1);
  assert.equal(res.body.items[0].title, "Camera");
  assert.equal("owner_id" in res.body.items[0], false);
  assert.equal(requestedUrl.searchParams.get("listing_status"), "eq.published");
  assert.equal(requestedUrl.searchParams.get("approval_status"), "eq.approved");
  assert.equal(requestedUrl.searchParams.get("category"), "eq.camera");
  assert.equal(requestedUrl.searchParams.get("id"), `in.(${id})`);
  assert.equal(requestedUrl.searchParams.get("order"), "price_amount.asc.nullslast");
  assert.equal(requestedUrl.searchParams.get("currency"), "eq.KES");
  assert.equal(requestedUrl.searchParams.get("or"), null);
  assert.equal(JSON.parse(searchRequest.options.body).p_query, "camera select");
  assert.equal(JSON.parse(searchRequest.options.body).p_filters.category, "camera");
  assert.equal(JSON.stringify(searchRequest).includes("select=*"), false);
});

test("private listing images are signed only for trusted same-project storage paths", async (t) => {
  configure(t);
  const id = "b97f0876-a29a-4b6a-b8ca-a11111111111";
  const path = `b97f0876-a29a-4b6a-b8ca-a11111111112/${id}/b97f0876-a29a-4b6a-b8ca-a11111111113.jpg`;
  const calls = [];
  mockFetch(t, async (url, options) => {
    const parsed = new URL(url);
    calls.push({ parsed, options });
    if (parsed.pathname.includes("/storage/v1/object/sign/")) {
      return httpResponse(200, { signedURL: `/object/sign/lockd-listings/${path}?token=signed` });
    }
    return httpResponse(200, [{ id, slug: "published-camera", title: "Published camera", category: "camera", images: [path], listing_status: "published", approval_status: "approved" }]);
  });
  const result = await invoke(listings, { query: { slug: "published-camera" } });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.item.images[0], `https://example-project.supabase.co/storage/v1/object/sign/lockd-listings/${path}?token=signed`);
  assert.equal(calls.length, 2);
  assert.match(calls[1].parsed.pathname, /\/storage\/v1\/object\/sign\/lockd-listings\//);
  assert.equal(JSON.parse(calls[1].options.body).expiresIn, 3600);

  const config = { url: "https://example-project.supabase.co", key: "sb_publishable_test", headers: { apikey: "sb_publishable_test" } };
  await listingImages.signOne(config, path);
  assert.equal(calls[2].options.headers.Authorization, undefined);
  assert.equal(listingImages.storagePath(`https://attacker.example/image.jpg`, config), null);
  assert.equal(listingImages.storagePath("https://example-project.supabase.co/storage/v1/object/public/lockd-listings/unscoped/image.jpg", config), null);
});

test("technology catalogue filters use published records and validated listing fields", async (t) => {
  configure(t);
  let requestedUrl;
  const id = "b97f0876-a29a-4b6a-b8ca-a11111111112";
  let searchRequest;
  mockFetch(t, async (url, options) => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith("/rpc/search_lockd_listings")) {
      searchRequest = JSON.parse(options.body);
      return httpResponse(200, [{ listing_id: id, search_rank: 90, total_count: 1 }]);
    }
    requestedUrl = parsed;
    return httpResponse(200, [{
      id, slug: "camera-two", title: "Camera two", category: "camera", market_category: "creator",
      price_amount: 5000, currency: "KES", price_unit: "day", attributes: { brand: "Sony", model: "A7" },
      listing_status: "published", approval_status: "approved", owner_id: "must-not-leak",
    }]);
  });
  const res = await invoke(listings, { query: {
    market: "tech", group: "creator", brand: "Sony", type: "camera", condition: "good", duration: "day", accessory: "Sony lens",
    location: "Nairobi", minPrice: "500", maxPrice: "5000", delivery: "yes",
    collection: "yes", useCase: "content_creation", q: "camera", sort: "price-low",
  } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.items[0].market_category, "creator");
  assert.equal("owner_id" in res.body.items[0], false);
  assert.equal(requestedUrl.searchParams.get("listing_status"), "eq.published");
  assert.equal(requestedUrl.searchParams.get("approval_status"), "eq.approved");
  assert.equal(requestedUrl.searchParams.get("market_category"), null);
  assert.equal(requestedUrl.searchParams.get("id"), `in.(${id})`);
  assert.equal(requestedUrl.searchParams.get("and"), "(or(market_category.eq.creator,category.in.(camera,creative)),price_amount.gte.500,price_amount.lte.5000)");
  assert.equal(requestedUrl.searchParams.get("attributes->>brand"), "ilike.*Sony*");
  assert.equal(requestedUrl.searchParams.get("attributes->>product_type"), "eq.camera");
  assert.equal(requestedUrl.searchParams.get("attributes->>condition"), "eq.good");
  assert.equal(requestedUrl.searchParams.get("rental_durations"), "cs.{day}");
  assert.equal(requestedUrl.searchParams.get("attributes->included_accessories"), 'cs.["Sony lens"]');
  assert.equal(requestedUrl.searchParams.get("location_label"), "ilike.*Nairobi*");
  assert.equal(requestedUrl.searchParams.get("price_amount"), null);
  assert.equal(requestedUrl.searchParams.get("delivery_available"), "eq.true");
  assert.equal(requestedUrl.searchParams.get("collection_available"), "eq.true");
  assert.equal(requestedUrl.searchParams.get("attributes->use_cases"), 'cs.["content_creation"]');
  assert.equal(searchRequest.p_filters.market, "tech");
  assert.equal(searchRequest.p_filters.group, "creator");
  assert.equal(searchRequest.p_filters.location, "Nairobi");
  assert.equal(searchRequest.p_filters.minPrice, "500");
  assert.equal(searchRequest.p_query, "camera");
});

test("technology filters reject unsafe values and invalid price ranges before database access", async (t) => {
  configure(t);
  mockFetch(t, async () => { throw new Error("fetch should not run for invalid requests"); });
  const unsafe = await invoke(listings, { query: { market: "tech", brand: "Sony,select=*" } });
  assert.equal(unsafe.statusCode, 400);
  const reversed = await invoke(listings, { query: { market: "tech", minPrice: "5000", maxPrice: "10" } });
  assert.equal(reversed.statusCode, 400);
  assert.equal(reversed.body.error, "invalid_price_range");
  const duration = await invoke(listings, { query: { market: "tech", duration: "forever" } });
  assert.equal(duration.statusCode, 400);
  assert.equal(duration.body.error, "invalid_duration");
});

test("room catalogue accepts the supported accommodation filters", async (t) => {
  configure(t);
  let requestedUrl;
  mockFetch(t, async (url) => {
    requestedUrl = new URL(url);
    return httpResponse(200, []);
  });
  const res = await invoke(listings, { query: {
    category: "stay", location: "Nairobi", guests: "12", rooms: "2", propertyType: "apartment", amenity: "wifi", minPrice: "1000", maxPrice: "8000", currency: "KES",
  } });
  assert.equal(res.statusCode, 200);
  assert.equal(requestedUrl.searchParams.get("category"), "eq.stay");
  assert.equal(requestedUrl.searchParams.get("location_label"), "ilike.*Nairobi*");
  assert.equal(requestedUrl.searchParams.get("attributes->max_guests"), "gte.12");
  assert.equal(requestedUrl.searchParams.get("attributes->>property_type"), "eq.apartment");
  assert.equal(requestedUrl.searchParams.get("attributes->amenities"), 'cs.["wifi"]');
  assert.equal(requestedUrl.searchParams.get("currency"), "eq.KES");
  assert.equal(requestedUrl.searchParams.get("and"), "(price_amount.gte.1000,price_amount.lte.8000)");
  assert.equal(requestedUrl.searchParams.get("attributes->>room_count"), null);
});

test("Cars & Mobility search filters only real published drive listings and checks date capacity", async (t) => {
  configure(t);
  const id = "b97f0876-a29a-4b6a-b8ca-a11111111111";
  const start = new Date();
  start.setUTCDate(start.getUTCDate() + 3);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 2);
  const fmt = (date) => date.toISOString().slice(0, 10);
  const seen = [];
  mockFetch(t, async (url, options) => {
    const parsed = new URL(url);
    seen.push({ parsed, options });
    if (parsed.pathname.endsWith("/rpc/search_lockd_available_listings")) return httpResponse(200, [{ listing_id: id }]);
    if (parsed.pathname.endsWith("/rpc/search_lockd_listings")) return httpResponse(200, [{ listing_id: id, search_rank: 100, total_count: 1 }]);
    return httpResponse(200, [{
      id, slug: "bmw-x3", title: "BMW X3", category: "drive", location_label: "Nairobi",
      price_amount: 8000, currency: "KES", price_unit: "day",
      attributes: { brand: "BMW", model: "X3", vehicle_type: "suv", transmission: "automatic", fuel_type: "petrol", seating_capacity: 5, minimum_driver_age: 23, service_mode: "both" },
    }]);
  });
  const res = await invoke(listings, { query: {
    category: "drive", q: "BMW X3", location: "Nairobi", vehicleType: "suv", transmission: "automatic",
    fuelType: "petrol", seats: "5", driverAge: "25", serviceMode: "self_drive",
    minPrice: "5000", maxPrice: "10000", startDate: fmt(start), endDate: fmt(end), sort: "price-low",
  } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.items[0].title, "BMW X3");
  assert.match(seen[0].parsed.pathname, /rpc\/search_lockd_available_listings$/);
  const query = seen[2].parsed.searchParams;
  assert.equal(query.get("category"), "eq.drive");
  assert.equal(query.get("location_label"), "ilike.*Nairobi*");
  assert.equal(query.get("attributes->>vehicle_type"), "eq.suv");
  assert.equal(query.get("attributes->>transmission"), "eq.automatic");
  assert.equal(query.get("attributes->>fuel_type"), "eq.petrol");
  assert.equal(query.get("attributes->seating_capacity"), "gte.5");
  assert.equal(query.get("attributes->minimum_driver_age"), "lte.25");
  const search = JSON.parse(seen[1].options.body);
  assert.equal(search.p_filters.serviceMode, "self_drive");
  assert.equal(search.p_filters.minPrice, "5000");
  assert.deepEqual(search.p_available_ids, [id]);
  assert.equal(search.p_query, "BMW X3");
  assert.match(query.get("and"), /attributes->>service_mode\.eq\.self_drive/);
  assert.match(query.get("and"), /price_amount\.gte\.5000/);
  assert.equal(query.get("currency"), "eq.KES");
  assert.equal(query.get("or"), null);
});

test("unified text search uses all meaningful words across listing fields and category words", async (t) => {
  configure(t);
  let searchRequest;
  mockFetch(t, async (url, options) => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith("/rpc/search_lockd_listings")) searchRequest = JSON.parse(options.body);
    return httpResponse(200, []);
  });
  const res = await invoke(listings, { query: { q: "gaming PC in Nairobi" } });
  assert.equal(res.statusCode, 200);
  assert.equal(searchRequest.p_query, "gaming PC in Nairobi");
  assert.equal(searchRequest.p_filters.market, "");
  assert.equal(searchRequest.p_filters.location, "");
  assert.equal(searchRequest.p_sort, "relevance");
});

test("catalogue keeps substring search available while the ranked-search migration is pending", async (t) => {
  configure(t);
  const requests = [];
  mockFetch(t, async (url) => {
    const parsed = new URL(url);
    requests.push(parsed);
    if (parsed.pathname.endsWith("/rpc/search_lockd_listings")) {
      return { ...httpResponse(404, { code: "PGRST202", message: "function not found" }), status: 404 };
    }
    return httpResponse(200, []);
  });
  const res = await invoke(listings, { query: { q: "gaming PC in Nairobi" } });
  assert.equal(res.statusCode, 200);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].searchParams.get("listing_status"), "eq.published");
  assert.match(requests[1].searchParams.get("and"), /title\.ilike\.\*gaming\*/);
  assert.match(requests[1].searchParams.get("and"), /location_label\.ilike\.\*Nairobi\*/);
});

test("catalogue rejects invalid paging, sorting and vehicle filters before database access", async (t) => {
  configure(t);
  mockFetch(t, async () => { throw new Error("fetch should not run for invalid requests"); });
  const page = await invoke(listings, { query: { page: "-1" } });
  const sort = await invoke(listings, { query: { sort: "popularity" } });
  const vehicle = await invoke(listings, { query: { category: "drive", vehicleType: "spaceship" } });
  const conflict = await invoke(listings, { query: { category: "stay", seats: "4" } });
  assert.equal(page.body.error, "invalid_page");
  assert.equal(sort.body.error, "invalid_sort");
  assert.equal(vehicle.body.error, "invalid_vehicle_type");
  assert.equal(conflict.body.error, "conflicting_category");
});

test("date-filtered technology catalogue calls the approved-listing availability search", async (t) => {
  configure(t);
  const id = "b97f0876-a29a-4b6a-b8ca-a11111111111";
  const start = new Date();
  start.setUTCDate(start.getUTCDate() + 2);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 2);
  const format = (date) => date.toISOString().slice(0, 10);
  const seen = [];
  mockFetch(t, async (url, options) => {
    const parsed = new URL(url);
    seen.push({ parsed, options });
    if (parsed.pathname.endsWith("/rpc/search_lockd_available_listings")) return httpResponse(200, [{ listing_id: id }]);
    return httpResponse(200, [{ id, slug: "available-camera", title: "Available camera", category: "camera", price_amount: 2000, currency: "KES", price_unit: "day" }]);
  });
  const res = await invoke(listings, { query: { market: "tech", group: "creator", startDate: format(start), endDate: format(end), quantity: "2" } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.items.length, 1);
  assert.match(seen[0].parsed.pathname, /rpc\/search_lockd_available_listings$/);
  assert.equal(JSON.parse(seen[0].options.body).p_quantity, 2);
  assert.equal(seen[1].parsed.searchParams.get("id"), `in.(${id})`);
  assert.equal(seen[1].parsed.searchParams.get("listing_status"), "eq.published");
});

test("availability rejects invalid, reversed and past date ranges without calling Supabase", async (t) => {
  configure(t);
  mockFetch(t, async () => { throw new Error("fetch should not run for invalid requests"); });
  const id = "b97f0876-a29a-4b6a-b8ca-a11111111111";
  const invalid = await invoke(availability, { method: "POST", body: { listingId: id, startDate: "2026-02-30", endDate: "2026-03-01", quantity: 1 } });
  assert.equal(invalid.statusCode, 400);
  const reversed = await invoke(availability, { method: "POST", body: { listingId: id, startDate: "2027-01-02", endDate: "2027-01-01", quantity: 1 } });
  assert.equal(reversed.statusCode, 400);
  const past = await invoke(availability, { method: "POST", body: { listingId: id, startDate: "2020-01-01", endDate: "2020-01-02", quantity: 1 } });
  assert.equal(past.statusCode, 400);
});

test("availability calls the server-side calendar RPC and returns its result", async (t) => {
  configure(t);
  const oldFetch = global.fetch;
  let request;
  global.fetch = async (url, options) => {
    request = { url: new URL(url), options };
    return httpResponse(200, true);
  };
  t.after(() => { global.fetch = oldFetch; });
  const start = new Date();
  start.setUTCDate(start.getUTCDate() + 1);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 2);
  const format = (date) => date.toISOString().slice(0, 10);
  const res = await invoke(availability, { method: "POST", body: {
    listingId: "b97f0876-a29a-4b6a-b8ca-a11111111111",
    startDate: format(start), endDate: format(end), quantity: 2,
  } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { available: true });
  assert.match(request.url.pathname, /\/rpc\/check_lockd_listing_availability$/);
  assert.equal(JSON.parse(request.options.body).p_quantity, 2);
});

test("public config exposes the public Supabase client config but never other environment values", async (t) => {
  const oldEmail = process.env.LOCKD_SUPPORT_EMAIL;
  const oldUrl = process.env.SUPABASE_URL;
  const oldKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  process.env.LOCKD_SUPPORT_EMAIL = "support@example.com";
  process.env.SUPABASE_URL = "https://example-project.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "public-test-key";
  t.after(() => {
    if (oldEmail === undefined) delete process.env.LOCKD_SUPPORT_EMAIL;
    else process.env.LOCKD_SUPPORT_EMAIL = oldEmail;
    if (oldUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SUPABASE_PUBLISHABLE_KEY;
    else process.env.SUPABASE_PUBLISHABLE_KEY = oldKey;
  });
  const res = await invoke(config);
  assert.deepEqual(res.body, {
    supportEmail: "support@example.com",
    supabase: { url: "https://example-project.supabase.co", publishableKey: "public-test-key" },
  });
  assert.equal(JSON.stringify(res.body).includes("service_role"), false);
});

test("sitemap emits only public shell pages when Supabase is unavailable", async (t) => {
  const oldUrl = process.env.SUPABASE_URL;
  const oldKey = process.env.SUPABASE_ANON_KEY;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_ANON_KEY;
  t.after(() => {
    if (oldUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SUPABASE_ANON_KEY;
    else process.env.SUPABASE_ANON_KEY = oldKey;
  });
  const res = await invoke(sitemap);
  assert.equal(res.statusCode, 200);
  assert.match(res.headers["content-type"], /application\/xml/);
  assert.match(res.body, /https:\/\/lockd2\.vercel\.app\/rentals\.html/);
  assert.match(res.body, /https:\/\/lockd2\.vercel\.app\/rooms\.html/);
  assert.match(res.body, /https:\/\/lockd2\.vercel\.app\/tech\.html/);
  assert.doesNotMatch(res.body, /rental\.html\?slug=/);
});
