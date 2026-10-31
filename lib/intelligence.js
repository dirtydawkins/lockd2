// Trusted backend use only. An unavailable advisory service never authorizes a booking.
const unavailable = () => ({ available: false, advisoryOnly: true, retryAfterSeconds: 60 });
module.exports = async function assessIntelligence(kind, facts, { fetchImpl = fetch } = {}) {
  const paths = { risk: '/v1/risk/assess', eligibility: '/v1/rentals/eligibility' };
  if (!Object.hasOwn(paths, kind)) throw new Error('Unsupported intelligence assessment.');
  const secret = process.env.LOCKD_INTELLIGENCE_SECRET;
  const base = process.env.LOCKD_INTELLIGENCE_URL;
  if (!base || !secret || secret.length < 32) return unavailable();
  let url;
  try {
    url = new URL(base);
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.onrender.com') || url.username || url.password || url.search || url.hash) return unavailable();
    url = new URL(paths[kind], url.origin);
  } catch { return unavailable(); }
  // A cold start can exceed the backend request budget. Report unavailable promptly;
  // the user may retry later. No polling, keep-alive traffic, or unbounded retries.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetchImpl(url.href, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(1500),
        headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(facts),
      });
      if (res.ok) {
        const data = await res.json();
        if (data?.advisory_only !== true || typeof data.assessment_id !== 'string') return unavailable();
        return { available: true, advisoryOnly: true, assessment: data };
      }
      if (![502, 503, 504].includes(res.status)) return unavailable();
    } catch { /* One bounded retry; no secret or request-body logging. */ }
  }
  return unavailable();
};
