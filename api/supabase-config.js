module.exports = function supabaseConfig() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY
    || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    || process.env.SUPABASE_ANON_KEY
    || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  // These public read endpoints must never run with an elevated secret or service-role key.
  if (key.startsWith("sb_secret_")) return null;
  if (key.startsWith("eyJ")) {
    try {
      const payload = key.split(".")[1];
      if (!payload) return null;
      const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
      if (claims.role === "service_role") return null;
    } catch {
      return null;
    }
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return null;
    const headers = { apikey: key };
    // New publishable keys are not JWTs and must not be sent as Bearer tokens.
    if (!key.startsWith("sb_publishable_")) headers.Authorization = `Bearer ${key}`;
    return { url: parsed.origin, key, headers };
  } catch {
    return null;
  }
};
