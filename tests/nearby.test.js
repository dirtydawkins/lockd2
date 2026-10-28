const test = require("node:test");
const assert = require("node:assert/strict");
const handler = require("../api/nearby.js");

function response(status, value) {
  return { ok: status >= 200 && status < 300, status, json: async () => value };
}

function mockResponse() {
  return {
    headers: {}, statusCode: 200, body: undefined,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  };
}

async function invoke({ method = "POST", body } = {}) {
  const res = mockResponse();
  await handler({ method, body }, res);
  return res;
}

function setup(t) {
  const names = ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY"];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  names.forEach((name) => delete process.env[name]);
  process.env.SUPABASE_URL = "https://lockd-test.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_lockd_test";
  const oldFetch = global.fetch;
  t.after(() => {
    names.forEach((name) => previous[name] === undefined ? delete process.env[name] : process.env[name] = previous[name]);
    global.fetch = oldFetch;
  });
}

test("nearby API rejects missing, null and out-of-range coordinates before querying Supabase", async (t) => {
  setup(t);
  global.fetch = async () => { throw new Error("Invalid location should not query Supabase."); };
  for (const body of [{}, { latitude: null, longitude: null }, { latitude: 91, longitude: 36.8 }]) {
    const result = await invoke({ body });
    assert.equal(result.statusCode, 400);
    assert.equal(result.body.error, "invalid_location");
  }
});

test("nearby API returns only published public fields and checks actual availability first", async (t) => {
  setup(t);
  const id = "b97f0876-a29a-4b6a-b8ca-a11111111111";
  const start = new Date();
  start.setUTCDate(start.getUTCDate() + 3);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 2);
  const date = (value) => value.toISOString().slice(0, 10);
  const calls = [];
  global.fetch = async (url, options = {}) => {
    const parsed = new URL(url);
    calls.push({ parsed, options });
    if (parsed.pathname.endsWith("/rpc/search_lockd_available_listings")) return response(200, [{ listing_id: id }]);
    if (parsed.pathname.endsWith("/rpc/search_lockd_nearby_listings")) return response(200, [{ listing_id: id, distance_km: 3, total_count: 1 }]);
    assert.equal(parsed.searchParams.get("listing_status"), "eq.published");
    assert.equal(parsed.searchParams.get("approval_status"), "eq.approved");
    assert.equal(parsed.searchParams.get("location_latitude"), null);
    assert.equal(parsed.searchParams.get("location_longitude"), null);
    return response(200, [{
      id, slug: "nairobi-car", title: "Nairobi car", category: "drive", location_label: "Nairobi",
      price_amount: 5000, currency: "KES", price_unit: "day", images: [], attributes: { vehicle_type: "suv" },
      listing_status: "published", approval_status: "approved", owner_id: "private-owner-id",
    }]);
  };
  const result = await invoke({ body: {
    latitude: -1.28, longitude: 36.82, radiusKm: 25, category: "drive", minPrice: 1000, maxPrice: 9000,
    currency: "KES", startDate: date(start), endDate: date(end), quantity: 1,
  } });
  assert.equal(result.statusCode, 200);
  assert.equal(calls.length, 3);
  assert.match(calls[0].parsed.pathname, /rpc\/search_lockd_available_listings$/);
  assert.match(calls[1].parsed.pathname, /rpc\/search_lockd_nearby_listings$/);
  const args = JSON.parse(calls[1].options.body);
  assert.deepEqual(args.p_available_ids, [id]);
  assert.equal(args.p_category, "drive");
  assert.equal(args.p_radius_km, 25);
  assert.equal(result.body.items[0].title, "Nairobi car");
  assert.equal(result.body.items[0].distance_km, 3);
  assert.equal("owner_id" in result.body.items[0], false);
  assert.equal("location_latitude" in result.body.items[0], false);
  assert.equal("latitude" in result.body, false);
  assert.equal(result.headers["cache-control"], "no-store");
});

test("nearby API returns no results without calling distance search when dates have no available inventory", async (t) => {
  setup(t);
  const calls = [];
  global.fetch = async (url) => {
    const parsed = new URL(url);
    calls.push(parsed);
    return response(200, []);
  };
  const start = new Date();
  start.setUTCDate(start.getUTCDate() + 2);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  const result = await invoke({ body: {
    latitude: -1.28, longitude: 36.82, startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10),
  } });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.body.items, []);
  assert.equal(calls.length, 1);
  assert.match(calls[0].pathname, /rpc\/search_lockd_available_listings$/);
});

test("nearby API reports missing migration as setup pending and restricts methods", async (t) => {
  setup(t);
  global.fetch = async () => response(404, { code: "PGRST202", message: "function not found" });
  const result = await invoke({ body: { latitude: -1.28, longitude: 36.82 } });
  assert.equal(result.statusCode, 503);
  assert.equal(result.body.error, "nearby_search_not_configured");
  const method = await invoke({ method: "GET" });
  assert.equal(method.statusCode, 405);
  assert.equal(method.headers.allow, "POST");
});
