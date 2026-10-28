const test = require("node:test");
const assert = require("node:assert/strict");
const handler = require("../api/owner-listings.js");

function mockResponse() {
  return {
    headers: {}, statusCode: 200, body: undefined,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  };
}

async function invoke({ method = "GET", headers = {}, body } = {}) {
  const res = mockResponse();
  await handler({ method, headers, body }, res);
  return res;
}

function setup(t) {
  const names = ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY"];
  const old = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  names.forEach((name) => delete process.env[name]);
  process.env.SUPABASE_URL = "https://lockd-test.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_lockd_test";
  const oldFetch = global.fetch;
  t.after(() => {
    names.forEach((name) => old[name] === undefined ? delete process.env[name] : process.env[name] = old[name]);
    global.fetch = oldFetch;
  });
}

function response(status, value) {
  return { ok: status >= 200 && status < 300, status, json: async () => value };
}

test("owner API requires a signed-in user before reading or writing", async (t) => {
  setup(t);
  global.fetch = async () => { throw new Error("Unauthenticated request must not call Supabase."); };
  const result = await invoke();
  assert.equal(result.statusCode, 401);
  assert.equal(result.body.error, "not_authenticated");
  assert.equal(result.headers["cache-control"], "no-store");
});

test("owner publish uses the caller's user token and the database RPC", async (t) => {
  setup(t);
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith("/auth/v1/user")) return response(200, { id: "owner-1", email_confirmed_at: "2026-10-01T00:00:00Z" });
    return response(200, { id: "listing-1", slug: "studio-1", listing_status: "published", approval_status: "approved" });
  };
  const payload = {
    listing: { id: "listing-1", title: "Studio", category: "stay" },
    availability: { startDate: "2026-11-01", endDate: "2026-11-10", units: 1 },
    publish: true,
  };
  const result = await invoke({ method: "POST", headers: { authorization: `Bearer ${"a".repeat(40)}` }, body: payload });
  assert.equal(result.statusCode, 201);
  assert.equal(result.body.item.listing_status, "published");
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url, "https://lockd-test.supabase.co/rest/v1/rpc/create_lockd_listing");
  assert.equal(calls[1].options.headers.apikey, "sb_publishable_lockd_test");
  assert.equal(calls[1].options.headers.Authorization, `Bearer ${"a".repeat(40)}`);
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    p_listing: payload.listing,
    p_availability: payload.availability,
    p_publish: true,
  });
});

test("owner list uses the authenticated database function and returns no cached response", async (t) => {
  setup(t);
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return String(url).endsWith("/auth/v1/user")
      ? response(200, { id: "owner-1", email_confirmed_at: "2026-10-01T00:00:00Z" })
      : response(200, [{ id: "listing-1", listing_status: "draft" }]);
  };
  const result = await invoke({ headers: { authorization: `Bearer ${"b".repeat(40)}` } });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.body.items, [{ id: "listing-1", listing_status: "draft", image_paths: [], images: [] }]);
  assert.match(calls[1].url, /rpc\/my_lockd_listings$/);
  assert.equal(calls[1].options.headers.Authorization, `Bearer ${"b".repeat(40)}`);
  assert.equal(result.headers["cache-control"], "no-store");
});

test("owner listing photos are signed with the authenticated owner's session", async (t) => {
  setup(t);
  const token = "e".repeat(40);
  const path = "b97f0876-a29a-4b6a-b8ca-a11111111112/b97f0876-a29a-4b6a-b8ca-a11111111111/b97f0876-a29a-4b6a-b8ca-a11111111113.webp";
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith("/auth/v1/user")) return response(200, { id: "owner-1", email_confirmed_at: "2026-10-01T00:00:00Z" });
    if (String(url).endsWith("/rpc/my_lockd_listings")) return response(200, [{ id: "listing-1", listing_status: "draft", images: [path] }]);
    return response(200, { signedURL: `/object/sign/lockd-listings/${path}?token=signed` });
  };
  const result = await invoke({ headers: { authorization: `Bearer ${token}` } });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.body.items[0].image_paths, [path]);
  assert.deepEqual(result.body.items[0].images, [`https://lockd-test.supabase.co/storage/v1/object/sign/lockd-listings/${path}?token=signed`]);
  assert.equal(calls.length, 3);
  assert.equal(calls[2].options.headers.Authorization, `Bearer ${token}`);
});

test("owner API does not claim a write when the database setup is missing", async (t) => {
  setup(t);
  global.fetch = async (url) => String(url).endsWith("/auth/v1/user")
    ? response(200, { id: "owner-1", email_confirmed_at: "2026-10-01T00:00:00Z" })
    : response(404, { code: "PGRST202", message: "function not found" });
  const result = await invoke({ method: "POST", headers: { authorization: `Bearer ${"c".repeat(40)}` }, body: { listing: {}, publish: false } });
  assert.equal(result.statusCode, 503);
  assert.equal(result.body.error, "owner_setup_pending");
  assert.match(result.body.message, /migration has not been applied/);
});

test("owner API rejects unsupported operations and expired sessions", async (t) => {
  setup(t);
  const method = await invoke({ method: "DELETE" });
  assert.equal(method.statusCode, 405);
  global.fetch = async () => response(401, { message: "expired" });
  const expired = await invoke({ method: "PATCH", headers: { authorization: `Bearer ${"d".repeat(40)}` }, body: { listingId: "id", status: "paused" } });
  assert.equal(expired.statusCode, 401);
  assert.equal(expired.body.error, "not_authenticated");
});
