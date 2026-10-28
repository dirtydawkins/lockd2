const snapshot = require("../data/tech-market-benchmarks.json");
const supabaseConfig = require("./supabase-config.js");

function send(res, status, payload) {
  res.setHeader("Cache-Control", "public, max-age=900, stale-while-revalidate=1800");
  res.status(status).json(payload);
}

function snapshotResponse(notice = "Curated, source-linked research snapshot; this is not live LOCKD inventory.") {
  return { source: "snapshot", notice, researchDate: snapshot.researchDate, records: snapshot.records, researchNotes: snapshot.researchNotes };
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return send(res, 405, { error: "method_not_allowed", message: "Use GET to read market references." });
  }

  const supabase = supabaseConfig();
  if (!supabase) return send(res, 200, snapshotResponse());

  try {
    const select = "id,product_category,product_name,provider_name,source_url,displayed_price,currency,billing_unit,research_date,service_area,included_equipment,mandatory_fees,availability_note,limitations,source_type";
    const query = new URLSearchParams({ select, status: "eq.published", order: "product_category.asc,research_date.desc,product_name.asc", limit: "500" });
    const response = await fetch(`${supabase.url}/rest/v1/lockd_market_price_benchmarks?${query}`, {
      headers: { ...supabase.headers, Accept: "application/json" },
    });
    if (!response.ok) return send(res, 200, snapshotResponse("Curated research snapshot shown because the benchmark table is not available. It remains separate from LOCKD inventory."));
    const rows = await response.json();
    if (!Array.isArray(rows) || !rows.length) return send(res, 200, snapshotResponse("Curated research snapshot shown while no published database benchmark records are available."));
    const records = rows.map((row) => ({
      id: row.id,
      category: row.product_category,
      product: row.product_name,
      provider: row.provider_name,
      sourceUrl: row.source_url,
      price: Number(row.displayed_price),
      currency: row.currency,
      unit: row.billing_unit,
      location: row.service_area,
      included: row.included_equipment,
      fees: row.mandatory_fees,
      availability: row.availability_note,
      limitations: row.limitations,
      researchedOn: row.research_date,
      sourceType: row.source_type,
    }));
    return send(res, 200, { source: "database", researchDate: null, records, researchNotes: snapshot.researchNotes });
  } catch {
    return send(res, 200, snapshotResponse("Curated research snapshot shown because live benchmark records could not be reached."));
  }
};
