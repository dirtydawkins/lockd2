(() => {
  const status = document.querySelector("#callback-status");
  const returnLink = document.querySelector("#callback-return");
  const heading = document.querySelector("#callback-heading");
  (async () => {
    try {
      const result = await window.LockdAccount.completeCallback();
      if (result.type === "error") throw new Error(result.message);
      const destination = result.type === "recovery"
        ? "/account.html?reset=1"
        : result.type === "verified"
          ? "/account.html?verified=1"
          : "/account.html?auth=success";
      status.textContent = result.type === "recovery" ? "Email confirmed. Opening the password reset form…" : "Sign-in confirmed. Opening your LOCKD account…";
      window.setTimeout(() => window.location.replace(destination), 250);
    } catch (error) {
      heading.textContent = "We couldn’t finish sign-in.";
      status.textContent = error.message || "This link is invalid or expired. Return to LOCKD and try again.";
      status.dataset.kind = "error";
      returnLink.hidden = false;
      history.replaceState(null, "", window.location.pathname);
    }
  })();
})();
