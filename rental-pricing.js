(function (root, factory) {
  const pricing = factory();
  if (typeof module === "object" && module.exports) module.exports = pricing;
  else root.LockdRentalPricing = pricing;
})(typeof globalThis === "object" ? globalThis : this, function () {
  function validDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }

  function estimateRentalSubtotal({ amount, currency, unit, quantity = 1, startDate, endDate } = {}) {
    const rate = Number(amount);
    const units = Number(quantity);
    if (!validDate(startDate) || !validDate(endDate) || endDate <= startDate
      || !Number.isFinite(rate) || rate <= 0
      || typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency)
      || !Number.isInteger(units) || units < 1 || units > 20) return null;

    const dayCount = (Date.parse(`${endDate}T00:00:00.000Z`) - Date.parse(`${startDate}T00:00:00.000Z`)) / 86400000;
    let multiplier;
    let period;
    if (unit === "day" || unit === "night") {
      multiplier = dayCount;
      period = `${dayCount} ${unit}${dayCount === 1 ? "" : "s"}`;
    } else if (unit === "week" && dayCount % 7 === 0) {
      multiplier = dayCount / 7;
      period = `${multiplier} ${multiplier === 1 ? "week" : "weeks"}`;
    } else if (unit === "month") {
      const [year, month, day] = startDate.split("-").map(Number);
      const [endYear, endMonth] = endDate.split("-").map(Number);
      const monthCount = (endYear - year) * 12 + endMonth - month;
      const anchor = new Date(Date.UTC(year, month - 1 + monthCount, day)).toISOString().slice(0, 10);
      if (monthCount > 0 && anchor === endDate) {
        multiplier = monthCount;
        period = `${monthCount} ${monthCount === 1 ? "month" : "months"}`;
      }
    } else if (unit === "trip") {
      multiplier = 1;
      period = "1 trip";
    }

    if (!Number.isFinite(multiplier)) return null;
    return { amount: rate * multiplier * units, currency, unit, period, quantity: units };
  }

  return { estimateRentalSubtotal };
});
