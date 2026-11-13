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

async function invoke({ method = "GET", headers = {}, body, query } = {}) {
  const res = mockResponse();
  await handler({ method, headers, body, query }, res);
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

test("wording uses verified identity and public facts only, never the publishing RPC", async t => {
  setup(t);
  const oldKey = process.env.NVIDIA_API_KEY;
  process.env.NVIDIA_API_KEY = 'isolated-provider-test';
  t.after(() => { if (oldKey === undefined) delete process.env.NVIDIA_API_KEY; else process.env.NVIDIA_API_KEY = oldKey; });
  const req = { method: 'POST', query: { view: 'wording' }, headers: { authorization: 'Bearer ' + 'a'.repeat(40) },
    body: { category: 'drive', title: 'Car', summary: '', description: '', facts: { transmission: 'automatic', pickup_instructions: 'gate code 4321' },
      private_address: 'private street', publish: true } };
  let verified = false, modelCalls = 0, reply = { summary: 'Automatic car', description: 'This car has an automatic transmission.' };
  global.fetch = async (url, options) => {
    if (url.endsWith('/auth/v1/user')) return response(200, { id: 'writer', email_confirmed_at: verified });
    assert.equal(url, 'https://integrate.api.nvidia.com/v1/chat/completions'); modelCalls++;
    const data = JSON.parse(JSON.parse(options.body).messages[1].content);
    assert.deepEqual(data, { category: 'drive', title: 'Car', notes: '', intro: '', facts: { transmission: 'automatic' } });
    return response(200, { choices: [{ message: { content: JSON.stringify(reply) } }] });
  };
  assert.equal((await invoke({...req, headers:{}})).statusCode, 401);
  assert.equal((await invoke(req)).statusCode, 403);
  verified = true;
  assert.equal((await invoke({...req, method:'PATCH'})).statusCode, 405);
  assert.equal((await invoke({...req, body:{...req.body, facts:{}}})).statusCode, 400);
  assert.equal(modelCalls, 0);
  assert.deepEqual((await invoke(req)).body, reply);
  reply = { summary:'x', description:'broken' };
  assert.equal((await invoke(req)).statusCode, 503);
  for (let i=0; i<3; i++) await invoke(req);
  assert.equal((await invoke(req)).statusCode, 429);
  assert.equal(modelCalls, 5);
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

test("owner approximate map pins are stored through the authenticated location RPC", async (t) => {
  setup(t);
  const token = "f".repeat(40);
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith("/auth/v1/user")) return response(200, { id: "owner-1", email_confirmed_at: "2026-10-01T00:00:00Z" });
    return response(200, { id: "listing-1", slug: "studio-1", listing_status: "published" });
  };
  const payload = {
    listing: { id: "listing-1", title: "Studio", category: "stay", location_latitude: -1.28345, location_longitude: 36.82195 },
    availability: {}, publish: false,
  };
  const result = await invoke({ method: "POST", headers: { authorization: `Bearer ${token}` }, body: payload });
  assert.equal(result.statusCode, 201);
  assert.match(calls[1].url, /rpc\/create_lockd_listing_with_location$/);
  assert.equal(calls[1].options.headers.Authorization, `Bearer ${token}`);
  const args = JSON.parse(calls[1].options.body);
  assert.equal(args.p_location_latitude, -1.28);
  assert.equal(args.p_location_longitude, 36.82);
  assert.equal(args.p_clear_location, false);
  assert.equal("location_latitude" in args.p_listing, false);
  assert.equal("location_longitude" in args.p_listing, false);
});

test("owner API rejects null map coordinates and allows an explicit saved-pin removal", async (t) => {
  setup(t);
  let requestBody;
  global.fetch = async (url, options) => {
    if (String(url).endsWith("/auth/v1/user")) return response(200, { id: "owner-1", email_confirmed_at: "2026-10-01T00:00:00Z" });
    requestBody = JSON.parse(options.body);
    return response(200, { id: "listing-1" });
  };
  const headers = { authorization: `Bearer ${"g".repeat(40)}` };
  const invalid = await invoke({ method: "POST", headers, body: { listing: { location_latitude: null, location_longitude: null } } });
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.body.error, "invalid_location_pin");
  const result = await invoke({ method: "POST", headers, body: { listing: { location_latitude: -1.28, location_longitude: 36.82, clear_location_pin: true } } });
  assert.equal(result.statusCode, 201);
  assert.equal(requestBody.p_location_latitude, null);
  assert.equal(requestBody.p_location_longitude, null);
  assert.equal(requestBody.p_clear_location, true);
});

test("owner list uses the authenticated database function and returns no cached response", async (t) => {
  setup(t);
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return String(url).endsWith("/auth/v1/user")
      ? response(200, { id: "owner-1", email_confirmed_at: "2026-10-01T00:00:00Z" })
      : response(200, [{ id: "listing-1", listing_status: "draft", location_latitude: -1.28, location_longitude: 36.82 }]);
  };
  const result = await invoke({ headers: { authorization: `Bearer ${"b".repeat(40)}` } });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.body.items, [{ id: "listing-1", listing_status: "draft", location_latitude: -1.28, location_longitude: 36.82, image_paths: [], images: [] }]);
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
    assert.deepEqual(JSON.parse(options.body).paths, [path]);
    return response(200, [{ path, signedURL: `/object/sign/lockd-listings/${path}?token=signed` }]);
  };
  const result = await invoke({ headers: { authorization: `Bearer ${token}` } });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.body.items[0].image_paths, [path]);
  assert.deepEqual(result.body.items[0].images, [`https://lockd-test.supabase.co/storage/v1/object/sign/lockd-listings/${path}?token=signed`]);
  assert.equal(calls.length, 3);
  assert.equal(calls[2].options.headers.Authorization, `Bearer ${token}`);
});

test("a missing preview keeps the original photo on the lister's edit form", async (t) => {
  setup(t);
  const path = "b97f0876-a29a-4b6a-b8ca-a11111111112/b97f0876-a29a-4b6a-b8ca-a11111111111/b97f0876-a29a-4b6a-b8ca-a11111111113.webp";
  global.fetch = async (url) => {
    if (String(url).endsWith("/auth/v1/user")) return response(200, { id: "owner-1", email_confirmed_at: "2026-10-01" });
    if (String(url).endsWith("/rpc/my_lockd_listings")) return response(200, [{images:[path]}]);
    return response(503, {});
  };
  const result = await invoke({headers:{authorization:"Bearer " + "e".repeat(40)}});
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.body.items[0].image_paths, [path]);
  assert.deepEqual(result.body.items[0].images, [null]);
});

test("owner API does not claim a write when the database setup is missing", async (t) => {
  setup(t);
  global.fetch = async (url) => String(url).endsWith("/auth/v1/user")
    ? response(200, { id: "owner-1", email_confirmed_at: "2026-10-01T00:00:00Z" })
    : response(404, { code: "PGRST202", message: "function not found" });
  const result = await invoke({ method: "POST", headers: { authorization: `Bearer ${"c".repeat(40)}` }, body: { listing: {}, publish: false } });
  assert.equal(result.statusCode, 503);
  assert.equal(result.body.error, "owner_setup_pending");
  assert.match(result.body.message, /could not be saved/);
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
