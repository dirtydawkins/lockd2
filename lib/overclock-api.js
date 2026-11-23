const supabaseConfig = require('../api/supabase-config');

module.exports = async function overclock(req, res) {
  const reply = (status, body) => res.status(status).json(body);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Allow', 'GET, POST, DELETE');
  if (!['GET', 'POST', 'DELETE'].includes(req.method)) return reply(405, { message: 'This action is unavailable.' });
  const token = /^Bearer ([\w.-]{32,4096})$/i.exec(req.headers?.authorization || '')?.[1];
  if (!token) return reply(401, { message: 'Sign in with your LOCKD account.' });

  const config = supabaseConfig();
  const unavailable = () => reply(503, { message: 'Pilot requests are unavailable right now. Try again later.' });
  if (!config) return unavailable();

  try {
    const request = (path, options = {}) => fetch(config.url + path, {
      ...options,
      signal: AbortSignal.timeout(6000),
      headers: { ...config.headers, Authorization: 'Bearer ' + token, ...options.headers }
    });
    const identity = await request('/auth/v1/user');
    if ([401, 403].includes(identity.status)) return reply(401, { message: 'Your session has expired. Sign in again.' });
    if (!identity.ok) return unavailable();
    const user = await identity.json();
    if (!user.id || user.is_anonymous || !user.email_confirmed_at) {
      return reply(403, { message: 'Verify your email before managing a pilot request.' });
    }

    const ownRequest = '/rest/v1/lockd_overclock_pilot?select=track&user_id=eq.' + encodeURIComponent(user.id);
    if (req.method === 'DELETE') {
      const result = await request(ownRequest, { method: 'DELETE' });
      return result.ok ? reply(200, { item: null }) : unavailable();
    }

    let result;
    if (req.method === 'POST') {
      const received = typeof req.body === 'string' ? parseBody(req.body) : req.body;
      const track = received?.track;
      if (!['play', 'studio', 'ai'].includes(track)) return reply(400, { message: 'Choose how you want to use OVERCLOCK.' });
      result = await request('/rest/v1/rpc/set_lockd_overclock_interest', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_track: track })
      });
    } else {
      result = await request(ownRequest);
    }
    if (!result.ok) return unavailable();
    const rows = await result.json();
    if (!Array.isArray(rows) || (req.method === 'POST' && rows.length !== 1)) return unavailable();
    return reply(200, { item: rows[0] || null });
  } catch {
    return unavailable();
  }
};

function parseBody(value) {
  try { return JSON.parse(value); } catch { return null; }
}
