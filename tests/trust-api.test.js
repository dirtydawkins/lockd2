const { test } = require("node:test");
const assert = require("node:assert/strict");
const handler = require("../api/trust");
function setup(t) {
  const env = { ...process.env },
    fetch = global.fetch;
  t.after(() => {
    process.env = env;
    global.fetch = fetch;
  });
  process.env.SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
}
async function invoke(method, body, query = {}, token = true) {
  const res = {
    headers: {},
    setHeader(k, v) {
      this.headers[k] = v;
    },
    status(n) {
      this.code = n;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
  };
  await handler(
    {
      method,
      body,
      query,
      headers: token ? { authorization: `Bearer ${"a".repeat(40)}` } : {},
    },
    res,
  );
  return res;
}
const bookingId = "44444444-4444-4444-8444-444444444444";
test("trust APIs require real authentication before accessing records", async (t) => {
  setup(t);
  global.fetch = () => {
    throw Error("unexpected");
  };
  assert.equal((await invoke("GET", null, {}, false)).code, 401);
  assert.equal(
    (
      await invoke(
        "POST",
        {
          action: "review",
          bookingId,
          decision: "approved",
          reason: "Reviewed",
        },
        {},
        false,
      )
    ).code,
    401,
  );
});
test("RPC calls whitelist arguments and retain caller authorization", async (t) => {
  setup(t);
  let request;
  global.fetch = async (url, options) => {
    if (url.endsWith("/user")) return { ok: true };
    request = { url, options };
    return {
      ok: true,
      json: async () => ({
        platform_approval: "approved",
        payment_status: "unpaid",
      }),
    };
  };
  const r = await invoke("POST", {
    action: "review",
    bookingId,
    decision: "approved",
    reason: "Reviewed evidence",
    role: "admin",
    customerId: "forged",
    payment_status: "paid",
  });
  assert.equal(r.code, 200);
  assert.deepEqual(JSON.parse(request.options.body), {
    p_booking_id: bookingId,
    p_decision: "approved",
    p_reason: "Reviewed evidence",
  });
  assert.match(request.options.headers.Authorization, /Bearer a+/);
  assert.equal(r.body.item.payment_status, "unpaid");
  assert.equal(r.headers["Cache-Control"], "no-store");
});
test("trust validation rejects oversized, malformed and unsupported actions", async (t) => {
  setup(t);
  global.fetch = () => {
    throw Error("unexpected");
  };
  for (const body of [
    { action: "grant_admin" },
    [],
    { action: "review", bookingId, decision: "confirmed", reason: "Reviewed" },
    "{bad",
    {
      action: "handover",
      bookingId,
      phase: "out",
      summary: "Condition",
      expectedVersion: -1,
    },
  ])
    assert.equal((await invoke("POST", body)).code, 400);
  assert.equal((await invoke("POST", "x".repeat(9000))).code, 413);
  assert.equal(
    (await invoke("GET", null, { view: "private-documents" })).code,
    400,
  );
});
test("expired identity and private database errors are not leaked", async (t) => {
  setup(t);
  global.fetch = async () => ({ ok: false });
  assert.equal((await invoke("GET", null)).code, 401);
  global.fetch = async (url) =>
    url.endsWith("/user")
      ? { ok: true }
      : {
          ok: false,
          status: 400,
          json: async () => ({ message: "secret database internals" }),
        };
  const r = await invoke("GET", null, { view: "admin" });
  assert.equal(r.code, 400);
  assert.doesNotMatch(JSON.stringify(r.body), /secret database/);
});
test("missing migrations and network failures remain errors, not empty verification histories", async (t) => {
  setup(t);
  global.fetch = async (url) =>
    url.endsWith("/user")
      ? { ok: true }
      : { ok: false, status: 404, json: async () => ({}) };
  assert.equal((await invoke("GET", null)).code, 503);
  global.fetch = async () => {
    throw Error("secret token in provider error");
  };
  const r = await invoke("GET", null);
  assert.equal(r.code, 502);
  assert.doesNotMatch(JSON.stringify(r.body), /secret token/);
});
