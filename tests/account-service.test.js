const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

const source = fs.readFileSync(path.join(__dirname, "../account-service.js"), "utf8");

function createService({ href, fetchImpl } = {}) {
  const values = new Map();
  const sessionValues = new Map();
  const listeners = new Map();
  let browserLocation = new URL(href || "https://lockd2.vercel.app/tech.html?group=gaming#listings");
  let assignedUrl = "";
  const historyWrites = [];
  const storageFor = (target) => ({
    getItem: (key) => target.get(key) || null,
    setItem: (key, value) => target.set(key, String(value)),
    removeItem: (key) => target.delete(key),
  });
  const storage = storageFor(values);
  const sessionStorage = storageFor(sessionValues);
  const window = {
    location: { get origin() { return browserLocation.origin; }, get pathname() { return browserLocation.pathname; }, get search() { return browserLocation.search; }, get hash() { return browserLocation.hash; }, get href() { return browserLocation.href; }, assign(url) { assignedUrl = String(url); } },
    localStorage: storage,
    sessionStorage,
    dispatchEvent() {},
    addEventListener(name, listener) { listeners.set(name, [...(listeners.get(name) || []), listener]); },
  };
  const context = {
    window,
    document: { querySelector: () => null },
    localStorage: storage,
    sessionStorage,
    URL,
    URLSearchParams,
    crypto: webcrypto,
    btoa: (value) => Buffer.from(value, "binary").toString("base64"),
    TextEncoder,
    CustomEvent: class CustomEvent { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
    history: { replaceState(_state, _title, url) { historyWrites.push(String(url)); } },
    fetch: async (url, init = {}) => {
      if (String(url) === "/api/config") {
        return { ok: true, json: async () => ({ supabase: { url: "https://project.supabase.co", publishableKey: "sb_publishable_public_test" } }) };
      }
      if (!fetchImpl) throw new Error(`Unexpected request: ${String(url)}`);
      return fetchImpl(url, init);
    },
    setTimeout,
    clearTimeout,
    Date,
  };
  vm.runInNewContext(source, context, { filename: "account-service.js" });
  return { account: window.LockdAccount, values, sessionValues, browserLocation, historyWrites, get assignedUrl() { return assignedUrl; } };
}

test("account return paths stay on LOCKD and keep valid search state", () => {
  const { account } = createService();
  assert.equal(account.safeReturnTo("/tech.html?group=gaming#listings"), "/tech.html?group=gaming#listings");
  assert.equal(account.safeReturnTo("https://attacker.example/"), "/account.html#overview");
  assert.equal(account.safeReturnTo("//attacker.example/path"), "/account.html#overview");
  assert.equal(account.safeReturnTo("/auth-callback.html?code=secret"), "/account.html#overview");
  assert.equal(account.safeReturnTo("/privacy.html"), "/account.html#overview");
});

test("sign-in continuation stores only a valid listing ID and expires", () => {
  const { account, values } = createService();
  const validId = "8a7b5db5-59ea-4f97-a4ad-5483c6cd4a41";
  const destination = account.authLink({ returnTo: "/rental.html?slug=tripod", saveId: validId });
  const url = new URL(destination);
  assert.equal(url.pathname, "/account.html");
  assert.equal(url.searchParams.get("returnTo"), "/rental.html?slug=tripod");
  assert.deepEqual(JSON.parse(values.get("lockd:auth-return:v1")), {
    returnTo: "/rental.html?slug=tripod",
    saveId: validId,
    expiresAt: JSON.parse(values.get("lockd:auth-return:v1")).expiresAt,
  });
  assert.equal(account.getPendingAuth().saveId, validId);
  account.setPendingAuth({ returnTo: "/tech.html", saveId: "not-a-uuid" });
  assert.equal(account.getPendingAuth().saveId, "");
});

test("profile onboarding requests a name only when neither the saved profile nor provider supplies one", () => {
  const { account } = createService();
  assert.equal(account.profileNeedsDisplayName({ user_metadata: {} }, null), true);
  assert.equal(account.profileNeedsDisplayName({ user_metadata: { full_name: "Amina K." } }, null), false);
  assert.equal(account.profileNeedsDisplayName({ user_metadata: {} }, { display_name: "Amina K." }), false);
  assert.equal(account.profileNeedsDisplayName({ user_metadata: { name: "  " } }, { display_name: "   " }), true);
});

for (const provider of ["google", "apple"]) {
  test(`${provider} sign-in starts a PKCE authorization and saves its verifier per tab`, async () => {
    const service = createService();
    await service.account.startOAuth(provider);
    const authorize = new URL(service.assignedUrl);
    assert.equal(authorize.origin, "https://project.supabase.co");
    assert.equal(authorize.pathname, "/auth/v1/authorize");
    assert.equal(authorize.searchParams.get("provider"), provider);
    assert.equal(authorize.searchParams.get("redirect_to"), "https://lockd2.vercel.app/auth-callback.html");
    assert.equal(authorize.searchParams.get("code_challenge_method"), "s256");
    assert.match(authorize.searchParams.get("code_challenge"), /^[\w-]{43}$/);
    const pkce = JSON.parse(service.sessionValues.get("lockd:auth-pkce:v1"));
    assert.match(pkce.verifier, /^[\w-]{64}$/);
    assert.equal(pkce.provider, provider);
  });
}

test("OAuth callback exchanges its authorization code, stores the shared session and strips callback data", async () => {
  const requests = [];
  const service = createService({
    href: "https://lockd2.vercel.app/auth-callback.html?code=temporary-code",
    fetchImpl: async (url, init) => {
      requests.push({ url: String(url), init });
      return { ok: true, json: async () => ({ access_token: "access-test", refresh_token: "refresh-test", expires_in: 3600, user: { id: "8a7b5db5-59ea-4f97-a4ad-5483c6cd4a41", email: "person@example.test" } }) };
    },
  });
  service.sessionValues.set("lockd:auth-pkce:v1", JSON.stringify({ verifier: "test-verifier", provider: "google", createdAt: Date.now() }));

  const result = await service.account.completeCallback();
  assert.equal(result.type, "signed-in");
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /\/auth\/v1\/token\?grant_type=pkce$/);
  assert.deepEqual(JSON.parse(requests[0].init.body), { auth_code: "temporary-code", code_verifier: "test-verifier" });
  const session = JSON.parse(service.values.get("lockd:owner-session:v1"));
  assert.equal(session.access_token, "access-test");
  assert.equal(session.refresh_token, "refresh-test");
  assert.deepEqual(service.historyWrites, ["/auth-callback.html"]);
  assert.equal(service.sessionValues.has("lockd:auth-pkce:v1"), false);
});

test("OAuth callback reports cancellations without exposing provider error details", async () => {
  const service = createService({ href: "https://lockd2.vercel.app/auth-callback.html?error=access_denied&error_description=private-provider-detail" });
  service.sessionValues.set("lockd:auth-pkce:v1", JSON.stringify({ verifier: "test-verifier", createdAt: Date.now() }));
  const result = await service.account.completeCallback();
  assert.equal(result.type, "error");
  assert.match(result.message, /cancelled/i);
  assert.doesNotMatch(result.message, /private-provider-detail/);
  assert.equal(service.sessionValues.has("lockd:auth-pkce:v1"), false);
});
