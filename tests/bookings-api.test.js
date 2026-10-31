const { test } = require("node:test");
const assert = require("node:assert/strict");
const handler = require("../api/bookings");
function setup(t) {
  const old = { ...process.env },
    fetch = global.fetch;
  t.after(() => {
    process.env = old;
    global.fetch = fetch;
  });
  process.env.SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
  process.env.LOCKD_BOOKING_REQUESTS_ENABLED = "true";
}
async function invoke(method, body, token = true, query = {}) {
  const res = {
    statusCode: 200,
    headers: {},
    setHeader(k, v) {
      this.headers[k] = v;
    },
    status(n) {
      this.statusCode = n;
      return this;
    },
    json(v) {
      this.body = v;
      return this;
    },
  };
  await handler(
    {
      method,
      body,
      headers: token ? { authorization: `Bearer ${"x".repeat(40)}` } : {},
      query,
    },
    res,
  );
  return res;
}
const payload = {
  action: "request",
  listingId: "44444444-4444-4444-8444-444444444444",
  startDate: "2090-01-01",
  endDate: "2090-01-03",
  quantity: 1,
  idempotencyKey: "55555555-5555-4555-8555-555555555555",
  expectedTotal: "25.50",
  expectedCurrency: "KES",
};
test("booking writes and history require authentication", async (t) => {
  setup(t);
  global.fetch = () => {
    throw Error("No database call permitted");
  };
  assert.equal((await invoke("POST", payload, false)).statusCode, 401);
  assert.equal((await invoke("GET", null, false)).statusCode, 401);
});
test("disabled requests fail closed while history remains independent", async (t) => {
  setup(t);
  process.env.LOCKD_BOOKING_REQUESTS_ENABLED = "false";
  assert.equal((await invoke("POST", payload)).statusCode, 503);
  assert.equal(
    (await invoke("GET", null, false, { capabilities: "1" })).body
      .paymentsEnabled,
    false,
  );
});
test("booking RPC ignores client prices, roles, identity and payment claims", async (t) => {
  setup(t);
  let sent;
  global.fetch = async (url, options) => {
    if (url.endsWith("/auth/v1/user"))
      return { ok: true, json: async () => ({ id: "trusted-user" }) };
    sent = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({ id: "reservation", payment_status: "unpaid" }),
    };
  };
  const res = await invoke("POST", {
    ...payload,
    customerId: "attacker",
    ownerId: "attacker",
    payment_status: "paid",
    total_amount: 0,
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(Object.keys(sent).sort(), [
    "p_end_date",
    "p_expected_currency",
    "p_expected_total",
    "p_idempotency_key",
    "p_listing_id",
    "p_quantity",
    "p_start_date",
  ]);
  assert.equal(res.body.item.payment_status, "unpaid");
});
test("invalid input, unsupported state changes and oversized requests fail before database access", async (t) => {
  setup(t);
  global.fetch = () => {
    throw Error("Unexpected call");
  };
  assert.equal(
    (await invoke("POST", { ...payload, startDate: "2090-02-30" })).statusCode,
    400,
  );
  assert.equal(
    (
      await invoke("PATCH", {
        bookingId: payload.listingId,
        action: "mark_paid",
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (await invoke("POST", { ...payload, extra: "x".repeat(9000) })).statusCode,
    413,
  );
});
