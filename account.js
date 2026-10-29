(() => {
  "use strict";
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const account = window.LockdAccount;
  const status = $("#account-status");
  const authPanel = $("#account-auth");
  const dashboard = $("#account-dashboard");
  const forgotPanel = $("#account-forgot");
  const resetPanel = $("#account-reset");
  let authMode = "signin";
  let busy = false;
  let activeUser = null;
  let profile = null;
  let needsProfileName = false;

  function setStatus(message = "", kind = "info") {
    status.textContent = message;
    status.dataset.kind = kind;
  }

  function setBusy(value, button = $("#account-submit")) {
    busy = value;
    if (button) button.disabled = value;
  }

  function showAuth(message = "", kind = "info") {
    authPanel.hidden = false;
    dashboard.hidden = true;
    forgotPanel.hidden = true;
    resetPanel.hidden = true;
    $("#account-intro").hidden = false;
    setStatus(message, kind);
  }

  function setAuthMode(mode) {
    authMode = mode === "signup" ? "signup" : "signin";
    const signup = authMode === "signup";
    $$("[data-auth-mode]").forEach((button) => {
      const selected = button.dataset.authMode === authMode;
      button.classList.toggle("is-active", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    $("#account-mode-eyebrow").textContent = signup ? "NEW TO LOCKD" : "WELCOME BACK";
    $("#account-auth-heading").textContent = signup ? "Create your account." : "Sign in to LOCKD.";
    $("#account-auth-copy").textContent = signup
      ? "Save rentals and keep your LOCKD details in one place."
      : "Your saved rentals and account details live here.";
    $("#account-name-field").hidden = !signup;
    $("#account-name").required = signup;
    $("#account-confirm-field").hidden = !signup;
    $("#account-confirm-password").required = signup;
    $("#account-consent").hidden = !signup;
    $("#account-privacy-consent").required = signup;
    $("#account-signin-links").hidden = signup;
    $("#account-password").autocomplete = signup ? "new-password" : "current-password";
    $("#account-submit").textContent = signup ? "Create account" : "Sign in";
  }

  function showSection(name) {
    const selected = ["overview", "saved", "personal", "security", "preferences"].includes(name) ? name : "overview";
    $$("[data-account-section]").forEach((button) => {
      if (button.dataset.accountSection === selected) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
    $$("[data-account-panel]").forEach((section) => { section.hidden = section.dataset.accountPanel !== selected; });
    if (selected === "saved") loadSavedListings();
    if (selected === "security") loadDeletionRequestState();
    window.history.replaceState(null, "", `account.html#${selected}`);
  }

  function showDashboard(user) {
    activeUser = user;
    profile = null;
    authPanel.hidden = true;
    dashboard.hidden = false;
    forgotPanel.hidden = true;
    resetPanel.hidden = true;
    $("#account-intro").hidden = true;
    const displayName = user.user_metadata?.full_name || user.user_metadata?.name || "";
    $("#account-dashboard-title").textContent = `Welcome${displayName ? `, ${displayName.trim().split(/\s+/)[0]}` : " back"}.`;
    $("#account-email-label").textContent = user.email || "Signed in with LOCKD";
  }

  async function finishAuthentication(user, message = "You’re signed in.") {
    if (!user) user = (await account.getSession())?.user || null;
    if (!user) throw new Error("LOCKD could not restore the signed-in account. Please sign in again.");
    setStatus(message, "success");
    showDashboard(user);
    const accountState = await loadDashboardData();
    if (accountState.needsProfileName) return;
    await continuePendingAuthentication();
  }

  async function continuePendingAuthentication() {
    const pending = account.getPendingAuth();
    if (!pending) return;
    try {
      if (pending.saveId) {
        await account.saveFavorite(pending.saveId);
        setStatus("Rental saved to your account.", "success");
      }
      account.clearPendingAuth();
      const destination = account.safeReturnTo(pending.returnTo);
      if (destination !== "/account.html#overview" || pending.saveId) {
        window.setTimeout(() => window.location.replace(destination), 350);
      }
    } catch (error) {
      setStatus(error.message || "Your account is ready, but the saved rental could not be added.", "error");
    }
  }

  async function loadDashboardData() {
    let profileLoaded = false;
    try {
      profile = await account.getProfile(activeUser);
      profileLoaded = true;
      const metadata = activeUser.user_metadata || {};
      const displayName = profile.display_name || metadata.full_name || metadata.name || "";
      $("#profile-name").value = displayName;
      $("#account-dashboard-title").textContent = `Welcome${displayName ? `, ${displayName.trim().split(/\s+/)[0]}` : " back"}.`;
      needsProfileName = account.profileNeedsDisplayName(activeUser, profile);
      $("#profile-name").required = needsProfileName;
      $("#profile-onboarding-note").hidden = !needsProfileName;
      $("#profile-email").value = activeUser.email || "";
      $("#profile-currency").value = profile.preferred_currency || "KES";
      $("#profile-language").value = profile.preferred_language || "en";
      $("#profile-location").value = profile.discovery_location || "";
      if (needsProfileName) {
        showSection("personal");
        setStatus("Add a display name to finish setting up your LOCKD account.", "info");
      } else {
        setStatus("Your LOCKD profile is up to date.", "success");
      }
    } catch (error) {
      needsProfileName = false;
      $("#profile-name").required = false;
      $("#profile-onboarding-note").hidden = true;
      setStatus(error.message || "Your profile could not be loaded.", "error");
    }
    try {
      const rows = await account.listSavedListings();
      updateSavedCount(rows.length);
    } catch { updateSavedCount(0); }
    await loadDeletionRequestState();
    return { profileLoaded, needsProfileName };
  }

  function updateSavedCount(count) {
    $("#saved-overview-count").textContent = count ? `${count} saved ${count === 1 ? "rental" : "rentals"}.` : "Save published rentals to find them here again.";
  }

  async function loadSavedListings() {
    const grid = $("#account-saved-grid");
    grid.replaceChildren(Object.assign(document.createElement("p"), { textContent: "Loading your saved rentals…" }));
    try {
      const saved = await account.listSavedListings();
      updateSavedCount(saved.length);
      if (!saved.length) {
        const empty = document.createElement("p");
        empty.className = "account-empty-state";
        empty.textContent = "You haven’t saved a rental yet. Save a published listing and it will be waiting here.";
        grid.replaceChildren(empty);
        return;
      }
      const ids = saved.map((row) => row.listing_id);
      let liveItems = [];
      const response = await fetch(`/api/listings?ids=${encodeURIComponent(ids.join(","))}`, { headers: { Accept: "application/json" }, cache: "no-store" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !Array.isArray(result.items)) throw new Error(result.message || "The current saved rental details could not be refreshed.");
      liveItems = result.items;
      const liveById = new Map(liveItems.map((item) => [item.id, item]));
      grid.replaceChildren(...saved.map((row) => makeSavedCard(row, liveById.get(row.listing_id) || null)));
    } catch (error) {
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "account-link";
      retry.textContent = "Try loading saved rentals again";
      retry.addEventListener("click", loadSavedListings);
      const message = document.createElement("p");
      message.className = "account-empty-state";
      message.textContent = error.message || "Saved rentals could not be loaded.";
      grid.replaceChildren(message, retry);
    }
  }

  function makeSavedCard(row, listing) {
    const snapshot = row.listing_snapshot && typeof row.listing_snapshot === "object" ? row.listing_snapshot : {};
    const item = listing || snapshot;
    const card = document.createElement("article");
    card.className = `account-saved-card${listing ? "" : " is-unavailable"}`;
    if (item.images?.[0]) {
      try {
        const imageUrl = new URL(item.images[0], window.location.origin);
        if (imageUrl.protocol === "https:" || imageUrl.origin === window.location.origin) {
          const image = document.createElement("img");
          image.src = imageUrl.href;
          image.alt = typeof item.title === "string" ? item.title : "Saved rental";
          image.loading = "lazy";
          card.append(image);
        }
      } catch { /* Text information is still available if an image URL is invalid. */ }
    }
    const body = document.createElement("div");
    body.className = "account-saved-copy";
    const eyebrow = document.createElement("p");
    eyebrow.className = "eyebrow";
    eyebrow.textContent = listing ? `${item.category || "Rental"} · ${item.location_label || "Location not stated"}` : "No longer listed";
    const title = document.createElement(listing ? "a" : "h4");
    title.textContent = item.title || "Saved rental";
    if (listing) {
      title.href = `rental.html?slug=${encodeURIComponent(item.slug)}`;
      title.className = "account-saved-title";
    }
    const price = document.createElement("p");
    price.className = "account-saved-price";
    price.textContent = listing && item.price_amount != null && item.currency
      ? formatPrice(item.price_amount, item.currency, item.price_unit)
      : listing ? "Price to be confirmed" : "This private saved reference is not bookable.";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "account-link account-saved-remove";
    remove.textContent = "Remove from saved";
    remove.addEventListener("click", async () => {
      remove.disabled = true;
      try {
        await account.removeFavorite(row.listing_id);
        card.remove();
        const remaining = Math.max(0, Number(account.getSavedIds().length));
        updateSavedCount(remaining);
        if (!gridHasCards()) {
          const empty = document.createElement("p");
          empty.className = "account-empty-state";
          empty.textContent = "You haven’t saved a rental yet. Save a published listing and it will be waiting here.";
          $("#account-saved-grid").replaceChildren(empty);
        }
      } catch (error) {
        remove.disabled = false;
        setStatus(error.message || "This saved rental could not be removed.", "error");
      }
    });
    body.append(eyebrow, title, price, remove);
    card.append(body);
    return card;
  }

  function gridHasCards() { return Boolean($("#account-saved-grid .account-saved-card")); }

  function formatPrice(amount, currency, unit) {
    const price = Number(amount);
    if (!Number.isFinite(price) || price < 0) return "Price to be confirmed";
    try {
      const formatted = new Intl.NumberFormat("en-KE", { style: "currency", currency, maximumFractionDigits: 0 }).format(price);
      const units = { hour: "hour", day: "day", night: "night", week: "week", month: "month", trip: "trip" };
      return `${formatted}${units[unit] ? ` / ${units[unit]}` : ""}`;
    } catch { return `${currency} ${price.toLocaleString("en-KE")}`; }
  }

  async function loadDeletionRequestState() {
    if (!activeUser) return;
    try {
      const rows = await account.listDeletionRequests();
      const latest = Array.isArray(rows) ? rows[0] : null;
      $("#delete-request-state").textContent = latest
        ? `Latest request: ${latest.status.replaceAll("_", " ")} · ${new Date(latest.created_at).toLocaleDateString("en-KE")}`
        : "No deletion request has been submitted.";
      $("#delete-request-form button[type=submit]").disabled = latest?.status === "pending" || latest?.status === "processing";
    } catch (error) {
      $("#delete-request-state").textContent = error.message || "Request status could not be loaded.";
    }
  }

  function showRecoveryPanel(panel) {
    authPanel.hidden = panel !== "auth";
    dashboard.hidden = true;
    forgotPanel.hidden = panel !== "forgot";
    resetPanel.hidden = panel !== "reset";
    $("#account-intro").hidden = panel === "dashboard";
  }

  async function restoreAccount() {
    const url = new URL(window.location.href);
    const returnTo = url.searchParams.get("returnTo");
    const saveId = url.searchParams.get("save") || "";
    if (returnTo || saveId) account.setPendingAuth({ returnTo: returnTo || "/account.html#overview", saveId });
    try {
      await account.init();
      const session = await account.getSession();
      if (url.searchParams.get("reset") === "1") {
        if (!session) {
          showAuth("This password reset link is no longer valid. Request a new link to continue.", "error");
        } else {
          showRecoveryPanel("reset");
          setStatus("Choose a new password for your account.", "info");
        }
        return;
      }
      if (session?.user) {
        await finishAuthentication(session.user, url.searchParams.has("verified") ? "Email verified. Your account is ready." : url.searchParams.has("auth") ? "Sign-in complete." : "Welcome back.");
      } else {
        showAuth(url.searchParams.has("verified") ? "Email verified. Sign in to continue." : "", "success");
      }
    } catch (error) {
      showAuth(error.message || "The account service could not be reached. You can continue browsing LOCKD while it is unavailable.", "error");
    }
  }

  $("#account-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy) return;
    if (!event.currentTarget.reportValidity()) return;
    const email = $("#account-email").value.trim();
    const password = $("#account-password").value;
    if (authMode === "signup") {
      if (password !== $("#account-confirm-password").value) { setStatus("The passwords do not match.", "error"); return; }
      if (!$("#account-privacy-consent").checked) { setStatus("Please read and accept the Privacy Notice to create an account.", "error"); return; }
    }
    setBusy(true);
    $("#account-submit").textContent = authMode === "signup" ? "Creating account…" : "Signing in…";
    try {
      if (authMode === "signup") {
        const result = await account.signUp({ email, password, name: $("#account-name").value });
        if (result.authenticated) await finishAuthentication(result.user || (await account.getSession())?.user, "Your account is ready.");
        else setStatus("Account created. Check your email for the verification link before signing in.", "success");
      } else {
        const result = await account.signIn({ email, password });
        await finishAuthentication(result.user, "You’re signed in.");
      }
    } catch (error) {
      setStatus(error.message || "Your account request could not be completed.", "error");
    } finally {
      setBusy(false);
      $("#account-submit").textContent = authMode === "signup" ? "Create account" : "Sign in";
    }
  });

  $("#forgot-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      await account.requestPasswordReset($("#forgot-email").value.trim());
      setStatus("If an account is associated with that address, a reset link will arrive shortly.", "success");
    } catch (error) { setStatus(error.message || "A reset link could not be requested.", "error"); }
    finally { button.disabled = false; }
  });

  $("#reset-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const password = $("#reset-password").value;
    const confirm = $("#reset-confirm-password").value;
    if (password !== confirm) { setStatus("The passwords do not match.", "error"); return; }
    const button = event.currentTarget.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      await account.updatePassword(password);
      event.currentTarget.reset();
      const session = await account.getSession();
      if (session?.user) await finishAuthentication(session.user, "Your password was updated.");
      else showAuth("Your password was updated. Sign in with your new password.", "success");
    } catch (error) { setStatus(error.message || "Your password could not be updated.", "error"); }
    finally { button.disabled = false; }
  });

  $("#profile-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector("button[type=submit]");
    const displayName = $("#profile-name").value.trim();
    if (needsProfileName && !displayName) {
      setStatus("Enter a display name to finish setting up your LOCKD account.", "error");
      $("#profile-name").focus();
      return;
    }
    button.disabled = true;
    try {
      profile = await account.saveProfile({ display_name: displayName });
      const completedOnboarding = needsProfileName;
      needsProfileName = false;
      $("#profile-name").required = false;
      $("#profile-onboarding-note").hidden = true;
      setStatus("Your name was saved to your LOCKD profile.", "success");
      if (completedOnboarding) await continuePendingAuthentication();
    } catch (error) { setStatus(error.message || "Your profile could not be saved.", "error"); }
    finally { button.disabled = false; }
  });

  $("#preferences-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (needsProfileName) {
      showSection("personal");
      setStatus("Add a display name before saving your preferences.", "info");
      $("#profile-name").focus();
      return;
    }
    const button = event.currentTarget.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      await account.saveProfile({
        preferred_currency: $("#profile-currency").value,
        preferred_language: $("#profile-language").value,
        discovery_location: $("#profile-location").value,
        display_name: $("#profile-name").value || profile?.display_name || "",
      });
      setStatus("Your preferences were saved.", "success");
    } catch (error) { setStatus(error.message || "Your preferences could not be saved.", "error"); }
    finally { button.disabled = false; }
  });

  $("#password-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector("button[type=submit]");
    const newPassword = $("#new-password").value;
    if (newPassword !== $("#new-password-confirm").value) { setStatus("The new passwords do not match.", "error"); return; }
    button.disabled = true;
    try {
      await account.updatePassword(newPassword, $("#current-password").value);
      event.currentTarget.reset();
      setStatus("Your password was changed.", "success");
    } catch (error) { setStatus(error.message || "Your password could not be changed.", "error"); }
    finally { button.disabled = false; }
  });

  $("#delete-request-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!$("#delete-confirm").checked) { setStatus("Confirm that you understand this is a deletion request.", "error"); return; }
    if (!window.confirm("Submit an account deletion request for LOCKD review? This will not delete your account immediately.")) return;
    const button = event.currentTarget.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      await account.requestDeletion($("#delete-reason").value);
      event.currentTarget.reset();
      setStatus("Your deletion request was recorded for review.", "success");
      await loadDeletionRequestState();
    } catch (error) { setStatus(error.message || "The deletion request could not be recorded.", "error"); button.disabled = false; }
  });

  $("#account-signout").addEventListener("click", async () => {
    const button = $("#account-signout");
    button.disabled = true;
    try { await account.signOut(); showAuth("You have signed out.", "success"); }
    catch (error) { setStatus(error.message || "Sign out could not reach the account service.", "error"); showAuth(status.textContent, "error"); }
    finally { button.disabled = false; }
  });

  $("#forgot-password-open").addEventListener("click", () => {
    $("#forgot-email").value = $("#account-email").value.trim();
    showRecoveryPanel("forgot");
    setStatus("");
  });
  $("#resend-verification-open").addEventListener("click", async () => {
    const email = $("#account-email").value.trim();
    if (!email) { setStatus("Enter your email address first.", "error"); $("#account-email").focus(); return; }
    const button = $("#resend-verification-open");
    button.disabled = true;
    try {
      await account.resendVerification(email);
      setStatus("If verification is still needed, Supabase will send a new email shortly.", "success");
    } catch (error) { setStatus(error.message || "A verification email could not be requested.", "error"); }
    finally { window.setTimeout(() => { button.disabled = false; }, 3500); }
  });

  $$('[data-show-auth]').forEach((button) => button.addEventListener("click", () => {
    showAuth();
    setAuthMode("signin");
  }));
  $$('[data-auth-mode]').forEach((button) => button.addEventListener("click", () => {
    setAuthMode(button.dataset.authMode);
    setStatus("");
  }));
  $$('[data-provider]').forEach((button) => button.addEventListener("click", async () => {
    if (busy) return;
    setBusy(true, button);
    setStatus("Opening Google sign-in…");
    try { await account.startOAuth(button.dataset.provider); }
    catch (error) {
      setStatus(error.message || "Google sign-in could not be started. Check its Supabase provider settings.", "error");
      setBusy(false, button);
    }
  }));
  $$('[data-account-section]').forEach((button) => button.addEventListener("click", () => showSection(button.dataset.accountSection)));
  $$('[data-go-section]').forEach((button) => button.addEventListener("click", () => showSection(button.dataset.goSection)));

  window.addEventListener("lockd:auth-change", (event) => {
    if (dashboard.hidden) return;
    if (!event.detail?.user) showAuth("Your LOCKD session ended. Sign in again to continue.", "info");
  });
  window.addEventListener("lockd:saved-change", (event) => updateSavedCount(event.detail?.ids?.length || 0));
  window.addEventListener("hashchange", () => showSection(window.location.hash.slice(1)));

  setAuthMode("signin");
  restoreAccount();
})();
