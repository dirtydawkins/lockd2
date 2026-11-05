// Reuses the caller's Supabase identity. No elevated client credential.
const configuration = require('../api/supabase-config');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const text = (x, max, min=0) => typeof x === 'string' && x.trim().length >= min && x.length <= max;
function endpoint(route, maxBytes=8192, transform=null) {
  return async (req,res) => {
    const send = (status,data) => { res.setHeader('Cache-Control','private, no-store'); return res.status(status).json(data); };
    if (!['GET','POST'].includes(req.method)) { res.setHeader('Allow','GET, POST'); return send(405,{message:'Method not allowed.'}); }
    const config = configuration();
    if (!config) return send(503,{message:'Account services are unavailable.'});
    const token = req.headers?.authorization?.match(/^Bearer ([A-Za-z0-9._~-]{32,4096})$/i)?.[1];
    if (!token) return send(401,{message:'Sign in to continue.'});
    if (Number(req.headers?.['content-length']) > maxBytes) return send(413,{message:'Request too large.'});
    let body = req.body || {};
    try { if (typeof body === 'string') { if (Buffer.byteLength(body)>maxBytes) return send(413,{message:'Request too large.'}); body=JSON.parse(body); }
      if (!body || Array.isArray(body) || typeof body !== 'object' || Buffer.byteLength(JSON.stringify(body))>maxBytes) return send(400,{message:'Invalid request.'});
    } catch { return send(400,{message:'Invalid request.'}); }
    const action = route(req.method,req.query || {},body);
    if (!action) return send(400,{message:'Choose valid details.'});
    const headers={...config.headers,'Content-Type':'application/json',Authorization:`Bearer ${token}`};
    try {
      const identity = await fetch(`${config.url}/auth/v1/user`,{headers,signal:AbortSignal.timeout(8000)});
      if (!identity.ok) return send(401,{message:'Your session has expired. Sign in again.'});
      const response = await fetch(`${config.url}/rest/v1/rpc/${action.rpc}`,{method:'POST',headers,body:JSON.stringify(action.args || {}),signal:AbortSignal.timeout(10000)});
      const result = await response.json().catch(()=>null);
      if (!response.ok) return send(response.status === 404 ? 503 : 400,{message:'This action could not be completed. Refresh and check your access or try again later.'});
      return send(200,{item:transform?await transform(result,{config,token,action}):result});
    } catch { return send(502,{message:'Account services could not be reached. Please retry.'}); }
  };
}
module.exports={endpoint,uuid,text};
