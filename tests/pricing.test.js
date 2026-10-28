const test = require("node:test");
const assert = require("node:assert/strict");
const { estimateRentalSubtotal } = require("../rental-pricing");

test("daily and nightly listing estimates use the requested day count and quantity", () => {
  assert.deepEqual(estimateRentalSubtotal({ amount: 1200, currency: "KES", unit: "day", quantity: 2, startDate: "2026-11-01", endDate: "2026-11-04" }), {
    amount: 7200, currency: "KES", unit: "day", period: "3 days", quantity: 2,
  });
  assert.equal(estimateRentalSubtotal({ amount: 800, currency: "KES", unit: "night", startDate: "2026-11-01", endDate: "2026-11-02" }).amount, 800);
});

test("weekly and monthly estimates require exact billing periods", () => {
  assert.equal(estimateRentalSubtotal({ amount: 7000, currency: "KES", unit: "week", startDate: "2026-11-01", endDate: "2026-11-15" }).amount, 14000);
  assert.equal(estimateRentalSubtotal({ amount: 7000, currency: "KES", unit: "week", startDate: "2026-11-01", endDate: "2026-11-09" }), null);
  assert.equal(estimateRentalSubtotal({ amount: 30000, currency: "KES", unit: "month", startDate: "2026-11-01", endDate: "2027-01-01" }).amount, 60000);
  assert.equal(estimateRentalSubtotal({ amount: 30000, currency: "KES", unit: "month", startDate: "2026-11-01", endDate: "2026-12-15" }), null);
});

test("trip rates are supported and hourly rates are not guessed from date-only inputs", () => {
  assert.equal(estimateRentalSubtotal({ amount: 5000, currency: "KES", unit: "trip", quantity: 2, startDate: "2026-11-01", endDate: "2026-11-05" }).amount, 10000);
  assert.equal(estimateRentalSubtotal({ amount: 500, currency: "KES", unit: "hour", startDate: "2026-11-01", endDate: "2026-11-02" }), null);
});

test("invalid dates, currency, price and quantity cannot produce an estimate", () => {
  const base = { amount: 100, currency: "KES", unit: "day", startDate: "2026-11-01", endDate: "2026-11-02" };
  assert.equal(estimateRentalSubtotal({ ...base, startDate: "2026-02-30" }), null);
  assert.equal(estimateRentalSubtotal({ ...base, endDate: "2026-11-01" }), null);
  assert.equal(estimateRentalSubtotal({ ...base, currency: "K$" }), null);
  assert.equal(estimateRentalSubtotal({ ...base, amount: 0 }), null);
  assert.equal(estimateRentalSubtotal({ ...base, quantity: 21 }), null);
});
