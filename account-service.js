(() => {
  "use strict";

  const sessionKey = "lockd:owner-session:v1";
  const pkceKey = "lockd:auth-pkce:v1";
  const pendingKey = "lockd:auth-return:v1";
  const savedIds = new Set();
  let config = null;
  let configPromise = null;
  let session = null;
  let sessionPromise = null;
  let savedLoaded = false;
  let savedPromise = null;
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  function emit(name, detail = {}) {
    window.dispatchEvent(new CustomEvent(name, { detail }));
    if (name === "lockd:saved-change") syncFavoriteButtons();
  }

  function showNotice(message, kind = "info") {
    let notice = document.querySelector("#lockd-account-notice");
    if (!notice) {
      notice = document.createElement("div");
      notice.id = "lockd-account-notice";
      notice.className = "lockd-account-notice";
      notice.setAttribute("role", "status");
      notice.setAttribute("aria-live", "polite");
      document.body.append(notice);
    }
    notice.textContent = message;
    notice.dataset.kind = kind;
    notice.classList.add("is-visible");
    window.clearTimeout(Number(notice.dataset.timer));
    notice.dataset.timer = String(window.setTimeout(() => notice.classList.remove("is-visible"), 3600));
  }

  function syncFavoriteButtons() {
    document.querySelectorAll("[data-lockd-save-id]").forEach((button) => {
      const isSaved = savedIds.has(button.dataset.lockdSaveId);
      const title = button.dataset.lockdSaveTitle || "this rental";
      button.setAttribute("aria-pressed", String(isSaved));
      button.setAttribute("aria-label", `${isSaved ? "Remove" : "Save"} ${title}`);
      button.textContent = isSaved ? "♥" : "♡";
    });
  }

  function createFavoriteButton(listing, { className = "listing-save" } = {}) {
    const listingId = typeof listing === "string" ? listing : listing?.id;
    const title = typeof listing === "object" ? listing.title : "this rental";
    if (!uuidPattern.test(listingId || "")) return null;
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.dataset.lockdSaveId = listingId;
    button.dataset.lockdSaveTitle = typeof title === "string" ? title : "this rental";
    button.setAttribute("aria-pressed", String(savedIds.has(listingId)));
    button.setAttribute("aria-label", `${savedIds.has(listingId) ? "Remove" : "Save"} ${button.dataset.lockdSaveTitle}`);
    button.textContent = savedIds.has(listingId) ? "♥" : "♡";
    button.addEventListener("click", async () => {
      if (button.disabled) return;
      button.disabled = true;
      try {
        const active = await getSession();
        await ensureFavoriteIds(active);
        if (!active) {
          window.location.assign(authLink({ saveId: listingId }));
          return;
        }
        if (savedIds.has(listingId)) {
          await removeFavorite(listingId);
          showNotice("Removed from your saved rentals.", "success");
        } else {
          await saveFavorite(listingId);
          showNotice("Saved to your LOCKD account.", "success");
        }
      } catch (error) {
        showNotice(error.message || "This rental could not be saved right now.", "error");
      } finally {
        button.disabled = false;
      }
    });
    void ensureFavoriteIds().catch(() => {});
    return button;
  }

  function readStoredSession() {
    try {
      const value = JSON.parse(localStorage.getItem(sessionKey) || "null");
      return value && typeof value.access_token === "string" && typeof value.refresh_token === "string" ? value : null;
    } catch { return null; }
  }

  function storeSession(value) {
    if (!value?.access_token || !value?.refresh_token) throw new Error("LOCKD did not receive a complete sign-in session.");
    const previousUserId = session?.user?.id || null;
    session = {
      access_token: value.access_token,
      refresh_token: value.refresh_token,
      expires_at: Number(value.expires_at || (Date.now() / 1000 + Number(value.expires_in || 3600))),
      user: value.user || session?.user || null,
    };
    localStorage.setItem(sessionKey, JSON.stringify(session));
    if (previousUserId !== (session.user?.id || null)) emit("lockd:auth-change", { user: session.user });
    return session;
  }

  function clearSession() {
    session = null;
    try { localStorage.removeItem(sessionKey); } catch { /* The remote session can still be ended. */ }
    savedIds.clear();
    savedLoaded = true;
    savedPromise = null;
    emit("lockd:auth-change", { user: null });
    emit("lockd:saved-change", { ids: [] });
  }

  async function init() {
    if (config) return config;
    if (configPromise) return configPromise;
    configPromise = (async () => {
      const response = await fetch("/api/config", { headers: { Accept: "application/json" }, cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.supabase?.url || !data.supabase?.publishableKey) {
        throw new Error("LOCKD account services are not configured for this deployment yet.");
      }
      const parsed = new URL(data.supabase.url);
      if (parsed.protocol !== "https:") throw new Error("LOCKD account services require a secure Supabase connection.");
      config = { ...data, supabase: { url: parsed.origin, publishableKey: data.supabase.publishableKey } };
      return config;
    })();
    try { return await configPromise; }
    catch (error) { configPromise = null; throw error; }
  }

  function headers(token, extra = {}) {
    if (!config?.supabase) throw new Error("LOCKD account services are not connected.");
    return {
      apikey: config.supabase.publishableKey,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...extra,
    };
  }

  async function readJson(response) {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const raw = [data.msg, data.message, data.error_description, data.error].find((value) => typeof value === "string") || "The request could not be completed.";
      const normalized = raw.toLowerCase();
      let message = raw;
      if (normalized.includes("invalid login credentials") || normalized.includes("invalid email or password")) message = "That email or password does not match. Check your details or reset your password.";
      else if (normalized.includes("email not confirmed") || normalized.includes("email_not_confirmed")) message = "Verify your email before signing in. You can request another verification email below.";
      else if (normalized.includes("already registered") || normalized.includes("user already exists")) message = "Try signing in or request a password reset for this email.";
      else if (response.status === 429 || normalized.includes("rate limit")) message = "Too many attempts. Please wait a little before trying again.";
      else if (normalized.includes("provider is not enabled") || normalized.includes("unsupported provider")) message = "This sign-in provider is not enabled in the LOCKD Supabase project yet.";
      else if (/schema cache|does not exist|could not find the table|could not find the function/.test(normalized)) message = "LOCKD account storage is still being configured. Please try again later.";
      else if (response.status >= 500) message = "The account service is temporarily unavailable. Please try again shortly.";
      throw new Error(String(message).slice(0, 300));
    }
    return data;
  }

  async function authRequest(path, { method = "POST", body, token, query = "" } = {}) {
    await init();
    const response = await fetch(`${config.supabase.url}/auth/v1/${path}${query}`, {
      method,
      headers: headers(token, body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: "no-store",
    });
    return readJson(response);
  }

  async function ensureFreshSession() {
    if (!session) session = readStoredSession();
    if (!session) return null;
    if (Number(session.expires_at) <= Date.now() / 1000 + 75) {
      try {
        const refreshed = await authRequest("token", { body: { refresh_token: session.refresh_token }, query: "?grant_type=refresh_token" });
        storeSession(refreshed);
      } catch (error) {
        clearSession();
        if (/temporarily unavailable|too many attempts/i.test(error.message)) throw error;
        return null;
      }
    }
    return session;
  }

  async function getSession() {
    if (sessionPromise) return sessionPromise;
    sessionPromise = (async () => {
      await init();
      const active = await ensureFreshSession();
      if (!active) return null;
      const response = await fetch(`${config.supabase.url}/auth/v1/user`, {
        headers: headers(active.access_token), cache: "no-store",
      });
      if (response.status === 401 || response.status === 403) {
        clearSession();
        return null;
      }
      const user = await readJson(response);
      session.user = user;
      storeSession(session);
      return { ...session, user };
    })();
    try { return await sessionPromise; }
    finally { sessionPromise = null; }
  }

  function callbackUrl() {
    return new URL("/auth-callback.html", window.location.origin).href;
  }

  async function signUp({ email, password, name }) {
    const url = new URL(`${(await init()).supabase.url}/auth/v1/signup`);
    url.searchParams.set("redirect_to", callbackUrl());
    const response = await fetch(url, {
      method: "POST",
      headers: headers(null, { "Content-Type": "application/json" }),
      body: JSON.stringify({ email: email.trim(), password, data: { full_name: name.trim() } }),
      cache: "no-store",
    });
    const data = await readJson(response);
    if (data.access_token && data.refresh_token) storeSession(data);
    return { ...data, authenticated: Boolean(data.access_token && data.refresh_token) };
  }

  async function signIn({ email, password }) {
    const data = await authRequest("token", { body: { email: email.trim(), password }, query: "?grant_type=password" });
    storeSession(data);
    return data;
  }

  async function resendVerification(email) {
    const url = new URL(`${(await init()).supabase.url}/auth/v1/resend`);
    url.searchParams.set("redirect_to", callbackUrl());
    const response = await fetch(url, {
      method: "POST",
      headers: headers(null, { "Content-Type": "application/json" }),
      body: JSON.stringify({ type: "signup", email: email.trim() }),
      cache: "no-store",
    });
    return readJson(response);
  }

  async function requestPasswordReset(email) {
    const url = new URL(`${(await init()).supabase.url}/auth/v1/recover`);
    url.searchParams.set("redirect_to", callbackUrl());
    const response = await fetch(url, {
      method: "POST",
      headers: headers(null, { "Content-Type": "application/json" }),
      body: JSON.stringify({ email: email.trim() }),
      cache: "no-store",
    });
    if (!response.ok) await readJson(response);
    return true;
  }

  async function reauthenticate(email, password) {
    const data = await authRequest("token", { body: { email: email.trim(), password }, query: "?grant_type=password" });
    storeSession(data);
    return data;
  }

  async function updatePassword(password, currentPassword = "") {
    const active = await getSession();
    if (!active?.user?.email) throw new Error("Sign in again before changing your password.");
    const token = currentPassword
      ? (await reauthenticate(active.user.email, currentPassword)).access_token
      : active.access_token;
    const response = await fetch(`${config.supabase.url}/auth/v1/user`, {
      method: "PUT",
      headers: headers(token, { "Content-Type": "application/json" }),
      body: JSON.stringify({ password }),
      cache: "no-store",
    });
    const user = await readJson(response);
    if (session) { session.user = user; storeSession(session); }
    return user;
  }

  function safeReturnTo(value) {
    if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return "/account.html#overview";
    try {
      const url = new URL(value, window.location.origin);
      if (url.origin !== window.location.origin || ["/auth-callback.html", "/privacy.html"].includes(url.pathname)) return "/account.html#overview";
      return `${url.pathname}${url.search}${url.hash}`;
    } catch { return "/account.html#overview"; }
  }

  function setPendingAuth({ returnTo = "/account.html#overview", saveId = "" } = {}) {
    const safeSave = uuidPattern.test(saveId) ? saveId : "";
    localStorage.setItem("lockd:auth-return:v1", JSON.stringify({ returnTo: safeReturnTo(returnTo), saveId: safeSave, expiresAt: Date.now() + 30 * 60 * 1000 }));
  }

  function getPendingAuth() {
    try {
      const item = JSON.parse(localStorage.getItem(pendingKey) || "null");
      if (!item || !Number.isFinite(item.expiresAt) || item.expiresAt < Date.now()) {
        localStorage.removeItem(pendingKey);
        return null;
      }
      return { returnTo: safeReturnTo(item.returnTo), saveId: uuidPattern.test(item.saveId || "") ? item.saveId : "" };
    } catch { return null; }
  }

  function clearPendingAuth() {
    try { localStorage.removeItem(pendingKey); } catch { /* Optional continuation state. */ }
  }

  function profileNeedsDisplayName(user, profile) {
    const metadata = user?.user_metadata || {};
    const name = profile?.display_name || metadata.full_name || metadata.name || "";
    return !String(name).trim();
  }

  function authLink({ returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`, saveId = "" } = {}) {
    setPendingAuth({ returnTo, saveId });
    const url = new URL("/account.html", window.location.origin);
    url.searchParams.set("returnTo", safeReturnTo(returnTo));
    if (uuidPattern.test(saveId)) url.searchParams.set("save", saveId);
    return url.href;
  }

  function base64Url(bytes) {
    let binary = "";
    bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  async function startOAuth(provider) {
    if (!new Set(["google", "apple"]).has(provider)) throw new Error("Choose a supported sign-in provider.");
    await init();
    const random = new Uint8Array(48);
    crypto.getRandomValues(random);
    const verifier = base64Url(random);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    const challenge = base64Url(new Uint8Array(digest));
    sessionStorage.setItem(pkceKey, JSON.stringify({ verifier, provider, createdAt: Date.now() }));
    const authorize = new URL(`${config.supabase.url}/auth/v1/authorize`);
    authorize.searchParams.set("provider", provider);
    authorize.searchParams.set("apikey", config.supabase.publishableKey);
    authorize.searchParams.set("redirect_to", callbackUrl());
    authorize.searchParams.set("code_challenge", challenge);
    authorize.searchParams.set("code_challenge_method", "s256");
    window.location.assign(authorize.href);
  }

  async function completeCallback() {
    await init();
    const url = new URL(window.location.href);
    const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
    const errorMessage = url.searchParams.get("error_description") || hash.get("error_description") || "";
    const errorCode = url.searchParams.get("error") || hash.get("error") || "";
    if (errorCode || errorMessage) {
      try { sessionStorage.removeItem(pkceKey); } catch { /* Optional flow state. */ }
      const cancelled = errorCode.toLowerCase() === "access_denied"
        || /access_denied|user_cancelled_authorize|cancelled/i.test(errorMessage);
      return {
        type: "error",
        message: cancelled
          ? "Sign-in was cancelled. Choose another sign-in method whenever you’re ready."
          : "Sign-in could not be completed. Try again or use email and password. If the problem continues, check the provider settings in Supabase.",
      };
    }

    const code = url.searchParams.get("code");
    if (code) {
      let pkce;
      try { pkce = JSON.parse(sessionStorage.getItem(pkceKey) || "null"); } catch { pkce = null; }
      const startedAt = Number(pkce?.createdAt);
      if (!pkce?.verifier || !["google", "apple"].includes(pkce.provider)
        || !Number.isFinite(startedAt) || startedAt > Date.now() + 60_000 || Date.now() - startedAt > 10 * 60 * 1000) {
        try { sessionStorage.removeItem(pkceKey); } catch { /* Optional flow state. */ }
        return { type: "error", message: "This sign-in link expired or started in another browser. Start again from LOCKD." };
      }
      let data;
      try {
        data = await authRequest("token", {
          body: { auth_code: code, code_verifier: pkce.verifier },
          query: "?grant_type=pkce",
        });
      } catch (error) {
        try { sessionStorage.removeItem(pkceKey); } catch { /* Optional flow state. */ }
        const knownMessage = /provider is not enabled|too many attempts|temporarily unavailable/i.test(error.message || "");
        throw new Error(knownMessage
          ? error.message
          : "Sign-in could not be completed. Start again from LOCKD, or check that this provider is configured in Supabase.");
      }
      storeSession(data);
      sessionStorage.removeItem(pkceKey);
      history.replaceState(null, "", `${url.pathname}`);
      return { type: "signed-in" };
    }

    const accessToken = hash.get("access_token");
    const refreshToken = hash.get("refresh_token");
    const type = hash.get("type") || "";
    if (accessToken && refreshToken) {
      storeSession({
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_at: Number(hash.get("expires_at") || (Date.now() / 1000 + Number(hash.get("expires_in") || 3600))),
      });
      history.replaceState(null, "", `${url.pathname}`);
      return { type: type === "recovery" ? "recovery" : type === "signup" ? "verified" : "signed-in" };
    }
    return { type: "error", message: "This sign-in link is incomplete or has already been used. Start again from LOCKD." };
  }

  async function signOut() {
    const active = await ensureFreshSession();
    try {
      if (active) await authRequest("logout?scope=local", { token: active.access_token });
    } finally { clearSession(); }
  }

  async function supabaseRequest(path, { method = "GET", body, prefer, token } = {}) {
    await init();
    const active = token ? { access_token: token } : await ensureFreshSession();
    if (!active?.access_token) throw new Error("Sign in to continue.");
    const response = await fetch(`${config.supabase.url}/rest/v1/${path}`, {
      method,
      headers: headers(active.access_token, {
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(prefer ? { Prefer: prefer } : {}),
      }),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: "no-store",
    });
    if (response.status === 204) return null;
    return readJson(response);
  }

  async function ensureProfile(user) {
    if (!user?.id || !uuidPattern.test(user.id)) throw new Error("Your LOCKD account could not be verified.");
    const providerName = String(user.user_metadata?.full_name || user.user_metadata?.name || "").trim().slice(0, 100);
    await supabaseRequest("lockd_user_profiles?on_conflict=user_id", {
      method: "POST",
      body: { user_id: user.id, display_name: user.user_metadata?.full_name || user.user_metadata?.name || null, avatar_url: user.user_metadata?.avatar_url || null },
      prefer: "resolution=ignore-duplicates,return=minimal",
    });
    if (providerName) {
      const query = new URLSearchParams({ user_id: `eq.${user.id}`, display_name: "is.null" });
      await supabaseRequest(`lockd_user_profiles?${query}`, {
        method: "PATCH",
        body: { display_name: providerName },
        prefer: "return=minimal",
      });
    }
  }

  async function getProfile(user) {
    const active = user ? { user } : await getSession();
    if (!active?.user?.id) throw new Error("Sign in to view your profile.");
    await ensureProfile(active.user);
    const query = new URLSearchParams({ user_id: `eq.${active.user.id}`, select: "user_id,display_name,avatar_url,preferred_currency,preferred_language,discovery_location,created_at,updated_at", limit: "1" });
    const rows = await supabaseRequest(`lockd_user_profiles?${query}`);
    if (!Array.isArray(rows) || !rows[0]) throw new Error("Your profile could not be loaded.");
    return rows[0];
  }

  async function saveProfile(profile) {
    const active = await getSession();
    if (!active?.user?.id) throw new Error("Sign in to update your profile.");
    const payload = {
      display_name: typeof profile.display_name === "string" ? profile.display_name.trim().slice(0, 100) || null : null,
      preferred_currency: ["KES", "USD", "EUR", "GBP"].includes(profile.preferred_currency) ? profile.preferred_currency : "KES",
      preferred_language: ["en", "sw"].includes(profile.preferred_language) ? profile.preferred_language : "en",
      discovery_location: typeof profile.discovery_location === "string" ? profile.discovery_location.trim().replace(/\s+/g, " ").slice(0, 120) || null : null,
    };
    await supabaseRequest(`lockd_user_profiles?user_id=eq.${active.user.id}`, { method: "PATCH", body: payload, prefer: "return=minimal" });
    return getProfile(active.user);
  }

  async function listSavedListings() {
    const active = await getSession();
    if (!active?.user?.id) throw new Error("Sign in to view saved listings.");
    const query = new URLSearchParams({ select: "listing_id,listing_snapshot,created_at", order: "created_at.desc", limit: "100" });
    const rows = await supabaseRequest(`lockd_saved_listings?${query}`);
    const validRows = Array.isArray(rows) ? rows.filter((row) => uuidPattern.test(row.listing_id || "")) : [];
    savedIds.clear();
    validRows.forEach((row) => savedIds.add(row.listing_id));
    savedLoaded = true;
    emit("lockd:saved-change", { ids: [...savedIds] });
    return validRows;
  }

  async function ensureFavoriteIds(activeSession = null) {
    if (savedLoaded) return [...savedIds];
    if (savedPromise) return savedPromise;
    savedPromise = (async () => {
      const active = activeSession || await getSession();
      if (!active) {
        savedIds.clear();
        savedLoaded = true;
        emit("lockd:saved-change", { ids: [] });
        return [];
      }
      return (await listSavedListings()).map((row) => row.listing_id);
    })();
    try { return await savedPromise; }
    finally { savedPromise = null; }
  }

  async function saveFavorite(listingId) {
    if (!uuidPattern.test(listingId || "")) throw new Error("This item cannot be saved from its current page.");
    const active = await getSession();
    if (!active) {
      window.location.assign(authLink({ saveId: listingId }));
      return false;
    }
    await supabaseRequest("rpc/save_lockd_listing", { method: "POST", body: { p_listing_id: listingId } });
    savedIds.add(listingId);
    savedLoaded = true;
    emit("lockd:saved-change", { ids: [...savedIds] });
    return true;
  }

  async function removeFavorite(listingId) {
    if (!uuidPattern.test(listingId || "")) throw new Error("This saved item could not be removed.");
    const active = await getSession();
    if (!active) throw new Error("Sign in to manage saved listings.");
    await supabaseRequest("rpc/remove_lockd_saved_listing", { method: "POST", body: { p_listing_id: listingId } });
    savedIds.delete(listingId);
    savedLoaded = true;
    emit("lockd:saved-change", { ids: [...savedIds] });
    return true;
  }

  async function refreshFavoriteIds() {
    await listSavedListings();
    return [...savedIds];
  }

  async function listDeletionRequests() {
    const query = new URLSearchParams({ select: "id,status,created_at,processed_at", order: "created_at.desc", limit: "10" });
    return supabaseRequest(`lockd_account_deletion_requests?${query}`);
  }

  async function requestDeletion(reason = "") {
    const active = await getSession();
    if (!active?.user?.id) throw new Error("Sign in to request account deletion.");
    const rows = await supabaseRequest("lockd_account_deletion_requests", {
      method: "POST",
      body: { user_id: active.user.id, reason: reason.trim().slice(0, 1000) || null },
      prefer: "return=representation",
    });
    return Array.isArray(rows) ? rows[0] : rows;
  }

  window.addEventListener("storage", (event) => {
    if (event.key !== sessionKey) return;
    session = readStoredSession();
    savedIds.clear();
    savedLoaded = !session;
    savedPromise = null;
    emit("lockd:auth-change", { user: session?.user || null });
    if (session) void ensureFavoriteIds().catch(() => {});
  });

  window.addEventListener("lockd:auth-change", (event) => {
    savedIds.clear();
    savedLoaded = !event.detail?.user;
    savedPromise = null;
    syncFavoriteButtons();
    if (event.detail?.user) void ensureFavoriteIds().catch(() => {});
  });

  window.LockdAccount = {
    init, getConfig: () => init(), getSession, signUp, signIn, signOut, resendVerification,
    requestPasswordReset, updatePassword, startOAuth, completeCallback, getProfile, saveProfile,
    listSavedListings, saveFavorite, removeFavorite, refreshFavoriteIds, ensureFavoriteIds,
    createFavoriteButton, listDeletionRequests,
    requestDeletion, safeReturnTo, setPendingAuth, getPendingAuth, clearPendingAuth, authLink,
    profileNeedsDisplayName,
    isSaved: (listingId) => savedIds.has(listingId), getSavedIds: () => [...savedIds],
  };
})();
