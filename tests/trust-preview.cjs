// Isolated browser QA server. Synthetic identities/data; never included in Vercel.
// Run: node tests/trust-preview.cjs. No external network, production credentials or real payments.
const http = require("node:http"),
  fs = require("node:fs/promises"),
  path = require("node:path");
const { PGlite } = require("@electric-sql/pglite");
const handler = require("../api/trust");
const root = path.resolve(__dirname, "..");
const db = new PGlite();
const ids = {
  owner: "11111111-1111-4111-8111-111111111111",
  customer: "22222222-2222-4222-8222-222222222222",
  admin: "33333333-3333-4333-8333-333333333333",
};
const listing = "44444444-4444-4444-8444-444444444444";
const tokenFor = (role) => `fixture_${role}_${"x".repeat(40)}`;
process.env.SUPABASE_URL = "https://fixture.supabase.co";
process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_fixture";
let queue = Promise.resolve();
global.fetch = async (url, options) => {
  if (!url.startsWith("https://fixture.supabase.co/"))
    throw Error("External network disabled in QA");
  const role = Object.keys(ids).find(
    (r) => options.headers.Authorization === `Bearer ${tokenFor(r)}`,
  );
  if (!role)
    return {
      ok: false,
      status: 401,
      json: async () => ({ message: "Unauthorized fixture" }),
    };
  if (url.endsWith("/auth/v1/user"))
    return {
      ok: true,
      json: async () => ({
        id: ids[role],
        app_metadata: { role: role === "admin" ? "admin" : "customer" },
      }),
    };
  const rpc = url.split("/rpc/")[1];
  const allowed = new Set([
    "my_lockd_verification",
    "lockd_trust_admin_overview",
    "lockd_operations_overview",
    "my_lockd_notifications",
    "read_lockd_notification",
    "my_lockd_disputes",
    "my_lockd_handover",
    "my_lockd_rental_checks",
    "transition_lockd_booking",
    "configure_lockd_verification_policy",
    "record_lockd_manual_verification",
    "review_lockd_booking",
    "record_lockd_listing_trust_value",
    "acknowledge_lockd_handover",
    "open_lockd_dispute",
    "resolve_lockd_dispute",
    "appeal_lockd_dispute",
    "finalize_lockd_disputed_return",
  ]);
  if (!allowed.has(rpc)) throw Error("Unsupported fixture RPC");
  const run = async () => {
    await db.exec("reset role");
    await db.query(
      "select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",
      [
        ids[role],
        JSON.stringify({
          app_metadata: { role: role === "admin" ? "admin" : "customer" },
        }),
      ],
    );
    await db.exec("set role authenticated");
    try {
      const entries = Object.entries(JSON.parse(options.body));
      const sql = `select ${rpc}(${entries.map(([k], i) => `${k}=>$${i + 1}`).join(",")}) item`;
      const result = await db.query(
        sql,
        entries.map(([, v]) => v),
      );
      return { ok: true, status: 200, json: async () => result.rows[0].item };
    } catch (e) {
      return {
        ok: false,
        status: 400,
        json: async () => ({ message: e.message }),
      };
    }
  };
  const result = queue.then(run);
  queue = result.catch(() => {});
  return result;
};
(async () => {
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email_confirmed_at timestamptz);
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
 grant usage on schema auth to authenticated,anon;
 insert into auth.users values('${ids.owner}',now()),('${ids.customer}',now()),('${ids.admin}',now());`);
  await db.exec(
    await fs.readFile(
      path.join(root, "supabase/migrations/20261028_0001_lockd_catalogue.sql"),
      "utf8",
    ),
  );
  await db.exec(
    "alter table lockd_listings add column deposit_amount numeric(12,2),add column deposit_currency text;",
  );
  for (const file of [
    "20261031_0008_lockd_reservations.sql",
    "20261101_0009_lockd_trust.sql",
    "20261101_0010_lockd_operations.sql",
    "20261101_0011_lockd_identity_jobs.sql",
  ])
    await db.exec(
      await fs.readFile(path.join(root, "supabase/migrations", file), "utf8"),
    );
  await db.exec(`update lockd_booking_settings set requests_enabled=true;insert into lockd_listings(id,owner_id,slug,title,category,price_amount,currency,price_unit,listing_status,approval_status,deposit_amount,deposit_currency)
 values('${listing}','${ids.owner}','qa-only','LOCAL TEST rental','drive',100,'KES','day','published','approved',50,'KES');insert into lockd_listing_availability select '${listing}',current_date+i,2,now() from generate_series(0,30)i;`);
  await db.query(
    "select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",
    [ids.admin, JSON.stringify({ app_metadata: { role: "admin" } })],
  );
  await db.query("select configure_lockd_verification_policy($1)", [
    {
      category: "drive",
      enabled: true,
      identity_required: true,
      owner_approval_required: true,
      platform_approval_required: true,
      conditions: "Return at the agreed pickup location.",
    },
  ]);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    ids.customer,
  ]);
  await db.query(
    "select request_lockd_booking($1,current_date+1,current_date+3,1,$2,250,'KES')",
    [listing, "55555555-5555-4555-8555-555555555555"],
  );
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1:8771");
    if(/^\/native-qa\/(setup|connection-a|connection-b|cleanup)\.sql$/.test(url.pathname)){
      const file=path.join(__dirname,url.pathname.slice(1));try{res.writeHead(200,{'Content-Type':'text/plain','Cache-Control':'no-store'});res.end(await fs.readFile(file));}catch{res.writeHead(404);res.end();}return;
    }
    if (url.pathname === "/api/trust") {
      let body = "";
      for await (const part of req) {
        body += part;
        if (Buffer.byteLength(body) > 8192) {
          res.writeHead(413);
          return res.end();
        }
      }
      req.body = body || undefined;
      req.query = Object.fromEntries(url.searchParams);
      res.status = (n) => {
        res.statusCode = n;
        return res;
      };
      res.json = (data) => {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(data));
        return res;
      };
      return handler(req, res);
    }
    if (url.pathname === "/account-service.js") {
      res.writeHead(200, { "Content-Type": "application/javascript" });
      return res.end(
        `(()=>{const role=new URLSearchParams(location.search).get('as')||'customer';const ids=${JSON.stringify(ids)};window.LockdAccount={getSession:async()=>({access_token:'fixture_'+role+'_'+'x'.repeat(40),user:{id:ids[role],app_metadata:{role:role==='admin'?'admin':'customer'}}}),authLink:()=>'/trust.html'};})();`,
      );
    }
    const rel = url.pathname === "/" ? "trust.html" : url.pathname.slice(1),
      file = path.resolve(root, rel);
    if (
      !file.startsWith(root + path.sep) ||
      rel.startsWith("tests/") ||
      ![".html", ".css", ".js", ".svg"].includes(path.extname(file))
    ) {
      res.writeHead(404);
      return res.end();
    }
    try {
      let content = await fs.readFile(file);
      if (path.extname(file) === ".html")
        content = Buffer.from(
          content
            .toString()
            .replace(
              "<main ",
              '<aside role="note">LOCAL QA — SYNTHETIC ACCOUNTS AND RECORDS. NO REAL BOOKINGS OR PAYMENTS.</aside><main ',
            ),
        );
      res.writeHead(200, {
        "Content-Type": {
          ".html": "text/html",
          ".css": "text/css",
          ".js": "application/javascript",
          ".svg": "image/svg+xml",
        }[path.extname(file)],
        "Cache-Control": "no-store",
      });
      res.end(content);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  server.listen(8771, "127.0.0.1", () =>
    console.log("Isolated QA: http://127.0.0.1:8771/trust.html?as=admin"),
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => {
      server.close();
      db.close().finally(() => process.exit(0));
    });
})().catch(() => {
  console.error("QA setup failed");
  process.exit(1);
});
