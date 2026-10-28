const categories = new Set([
  "stay", "drive", "play", "technology", "experience", "camera", "phone", "laptop", "audio", "creative", "other",
]);

function send(res, status, payload) {
  res.setHeader("Cache-Control", "no-store");
  res.status(status).json(payload);
}

function supabaseConfig() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return null;
    return { url: parsed.origin, key };
  } catch {
    return null;
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return send(res, 405, { error: "method_not_allowed", message: "Use GET to read the rental catalogue." });
  }

  const config = supabaseConfig();
  if (!config) return send(res, 503, { error: "catalogue_not_configured", message: "The live rental catalogue is not configured." });

  const { category, q, slug, page: pageValue, sort } = req.query || {};
  if (category && !categories.has(category)) {
    return send(res, 400, { error: "invalid_category", message: "Choose a supported rental category." });
  }
  if (slug && !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}$/.test(slug)) {
    return send(res, 400, { error: "invalid_slug", message: "This rental could not be found." });
  }
  const page = Math.max(0, Math.min(1000, Number.parseInt(pageValue || "0", 10) || 0));
  const limit = 24;
  const query = new URLSearchParams({
    select: "id,slug,title,category,summary,description,images,image_alt,location_label,price_amount,currency,price_unit,attributes,requires_approval,checkout_enabled,listing_status,approval_status,created_at",
    listing_status: "eq.published",
    approval_status: "eq.approved",
    limit: String(limit + 1),
    offset: String(page * limit),
    order: sort === "price-low" ? "price_amount.asc.nullslast" : sort === "price-high" ? "price_amount.desc.nullslast" : "created_at.desc",
  });

  if (category) query.set("category", `eq.${category}`);
  if (slug) query.set("slug", `eq.${slug}`);
  if (typeof q === "string" && q.trim()) {
    const term = q.trim().slice(0, 100).replace(/[^\p{L}\p{N} _-]/gu, " ").replace(/\s+/g, " ");
    query.set("or", `(title.ilike.*${term}*,summary.ilike.*${term}*,description.ilike.*${term}*)`);
  }

  try {
    const response = await fetch(`${config.url}/rest/v1/lockd_listings?${query}`, {
      headers: {
        apikey: config.key,
        Authorization: `Bearer ${config.key}`,
        Accept: "application/json",
      },
    });
    if (!response.ok) return send(res, 502, { error: "catalogue_unavailable", message: "The rental catalogue is temporarily unavailable." });
    const rows = await response.json();
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map((row) => ({
      id: row.id,
      slug: row.slug,
      title: row.title,
      category: row.category,
      summary: row.summary,
      description: row.description,
      images: Array.isArray(row.images) ? row.images : [],
      image_alt: row.image_alt,
      location_label: row.location_label,
      price_amount: row.price_amount,
      currency: row.currency,
      price_unit: row.price_unit,
      attributes: row.attributes || {},
      requires_approval: Boolean(row.requires_approval),
      checkout_enabled: Boolean(row.checkout_enabled),
    }));
    if (slug) return send(res, 200, { item: items[0] || null });
    return send(res, 200, { items, page, hasMore });
  } catch {
    return send(res, 502, { error: "catalogue_unavailable", message: "The rental catalogue is temporarily unavailable." });
  }
};
