const test = require("node:test");
const assert = require("node:assert/strict");

const listings = require("../api/listings.js");
const availability = require("../api/availability.js");
const config = require("../api/config.js");
const sitemap = require("../api/sitemap.js");

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
  mockFetch(t, async (url, options) => {
    requestedUrl = new URL(url);
    assert.equal(options.headers.apikey, "public-test-key");
    return httpResponse(200, [{
      id: "listing-1", slug: "camera-one", title: "Camera", category: "camera",
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
  assert.equal(requestedUrl.searchParams.get("order"), "price_amount.asc.nullslast");
  assert.equal(requestedUrl.searchParams.get("or").includes("select"), true);
  assert.equal(requestedUrl.searchParams.get("or").includes(";"), false);
  assert.equal(requestedUrl.searchParams.get("or").includes("select="), false);
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

test("public config exposes only a valid support email, never other environment values", async (t) => {
  const oldEmail = process.env.LOCKD_SUPPORT_EMAIL;
  process.env.LOCKD_SUPPORT_EMAIL = "support@example.com";
  t.after(() => {
    if (oldEmail === undefined) delete process.env.LOCKD_SUPPORT_EMAIL;
    else process.env.LOCKD_SUPPORT_EMAIL = oldEmail;
  });
  const res = await invoke(config);
  assert.deepEqual(res.body, { supportEmail: "support@example.com" });
  assert.equal(JSON.stringify(res.body).includes("public-test-key"), false);
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
  assert.doesNotMatch(res.body, /rental\.html\?slug=/);
});
