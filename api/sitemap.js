const siteOrigin = "https://lockd2.vercel.app";

function escapeXml(value) {
  return String(value).replace(/[<>&'\"]/g, (character) => ({
    "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", "\"": "&quot;",
  })[character]);
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).send("Method not allowed");
  }

  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=300, stale-while-revalidate=600");
  const paths = ["/", "/rentals.html", "/tech.html", "/owners.html"];
  const projectUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (projectUrl && anonKey) {
    try {
      const parsed = new URL(projectUrl);
      if (parsed.protocol === "https:") {
        const params = new URLSearchParams({
          select: "slug",
          listing_status: "eq.published",
          approval_status: "eq.approved",
          order: "created_at.desc",
          limit: "1000",
        });
        const response = await fetch(`${parsed.origin}/rest/v1/lockd_listings?${params}`, {
          headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, Accept: "application/json" },
        });
        if (response.ok) {
          const rows = await response.json();
          for (const row of rows) {
            if (typeof row.slug === "string" && /^[a-z0-9][a-z0-9_-]{0,119}$/.test(row.slug)) {
              paths.push(`/rental.html?slug=${encodeURIComponent(row.slug)}`);
            }
          }
        }
      }
    } catch {
      // Keep the sitemap limited to public shell pages if the catalogue is unavailable.
    }
  }

  const urls = [...new Set(paths)].map((path) => `  <url><loc>${escapeXml(`${siteOrigin}${path}`)}</loc></url>`).join("\n");
  return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`);
};
