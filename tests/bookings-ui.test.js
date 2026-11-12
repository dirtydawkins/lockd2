const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
test("lost reservation responses retry the same request without quoting against their own hold", async () => {
  let click;
  const button = {
    dataset: {},
    addEventListener(_, fn) {
      click = fn;
    },
  };
  const message = { textContent: "" };
  const form = {
    dataset: { listingId: "test-listing" },
    reportValidity: () => true,
    startDate: { value: "2090-01-01" },
    endDate: { value: "2090-01-03" },
    quantity: { value: "1" },
  };
  const box = {
    hidden: true,
    querySelector: (s) => (s === "button" ? button : message),
  };
  const calls = [];
  let failed = false;
  let target;
  const fetch = async (url, options) => {
    if (url.includes("capabilities"))
      return { json: async () => ({ requestsEnabled: true }) };
    const body = JSON.parse(options.body);
    calls.push(body);
    if (body.action === "quote")
      return {
        ok: true,
        json: async () => ({
          item: { currency: "KES", totalAmount: 25.5, depositAmount: 5 },
        }),
      };
    if (!failed) {
      failed = true;
      throw Error("Lost response");
    }
    return {
      ok: true,
      json: async () => ({
        item: {
          id: "persisted-reservation",
          status: "pending_owner",
          expires_at: "2090-01-01T00:00:00Z",
        },
      }),
    };
  };
  vm.runInNewContext(fs.readFileSync("bookings.js", "utf8"), {
    window: {
      LockdAccount: {
        getSession: async () => ({ access_token: "test-token" }),
      },
    },
    document: {
      querySelectorAll: () => [],
      querySelector: (s) =>
        s === "#reservation-request"
          ? box
          : s === "#availability-form"
            ? form
            : null,
    },
    AbortSignal,
    crypto: { randomUUID: () => "stable-reference" },
    fetch,
    URL,
    location: { href: "https://lockd.test/rental.html", assign(url) { target = url; } },
    Date,
  });
  await click({ currentTarget: button });
  assert.equal(button.textContent, "Send booking request");
  await click({ currentTarget: button });
  assert.equal(message.textContent, "Lost response");
  await click({ currentTarget: button });
  assert.equal(button.dataset.sent, "true");
  assert.deepEqual(
    calls.map((c) => c.action),
    ["quote", "quote", "request", "request"],
  );
  assert.deepEqual(calls[2], calls[3]);
  assert.match(message.textContent, /persisted-reservation/);
  assert.equal(target, "checkout.html?booking=persisted-reservation");
});
