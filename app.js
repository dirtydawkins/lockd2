(() => {
  const menu = document.querySelector(".menu-toggle");
  const nav = document.querySelector("#primary-nav");

  if (menu && nav) {
    const closeMenu = () => {
      menu.setAttribute("aria-expanded", "false");
      menu.setAttribute("aria-label", "Open menu");
      nav.classList.remove("is-open");
    };

    menu.addEventListener("click", () => {
      const expanded = menu.getAttribute("aria-expanded") === "true";
      menu.setAttribute("aria-expanded", String(!expanded));
      menu.setAttribute("aria-label", expanded ? "Open menu" : "Close menu");
      nav.classList.toggle("is-open", !expanded);
    });

    nav.addEventListener("click", (event) => {
      if (event.target.closest("a")) closeMenu();
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeMenu();
    });
  }

  window.addEventListener("lockd:auth-change",event=>{document.querySelectorAll(".owner-nav-link").forEach(link=>{link.textContent=event.detail?.user?"Lister dashboard":"Become a lister";});});
  const year = document.querySelector("#year");
  if (year) year.textContent = String(new Date().getFullYear());

  const searchForm = document.querySelector("#idea-search-form");
  const searchInput = document.querySelector("#idea-search");
  const searchCategory = document.querySelector("#idea-category");
  const searchLocation = document.querySelector("#idea-location");
  const searchSuggestions = document.querySelector("#idea-suggestions");
  if (searchForm && searchInput) {
    const preview = document.querySelector("#home-search-preview");
    const status = preview.querySelector("[role=status]");
    const matches = preview.querySelector("ul");
    const browse = preview.querySelector("a");
    let pending;
    function resetPreview() {
      pending?.abort();
      preview.hidden = true;
      matches.replaceChildren();
    }
    function resultsUrl(fields) {
      const url = new URL("rentals.html", window.location.href);
      for (const [key, value] of Object.entries(fields)) if (value) url.searchParams.set(key, value);
      return url;
    }
    searchForm.addEventListener("input", resetPreview);
    searchForm.addEventListener("change", resetPreview);
    searchForm.addEventListener("submit", async event => {
      event.preventDefault();
      resetPreview();
      const term = searchInput.value.trim();
      const category = searchCategory?.value || "";
      const place = searchLocation?.value.trim() || "";
      const direct = resultsUrl({ q: term, category, location: place, kind: term && !category && !place ? "all" : "" });
      const natural = window.LockdRentalSearch.natural(term);
      if (/\b(near me|nearby|around me)\b/i.test(term) && !place && searchLocation) {
        searchLocation.focus();
        searchLocation.click();
        return;
      }
      if (!natural) { window.location.assign(direct.href); return; }
      const controller = new AbortController();
      pending = controller;
      const timeout = setTimeout(() => controller.abort(), 16000);
      preview.hidden = false;
      status.textContent = "Searching rentals...";
      browse.href = direct.href;
      browse.textContent = "Open rental search";
      try {
        const response = await fetch("/api/listings?view=assist", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: term, category, location: place }), signal: controller.signal
        });
        if (!response.ok) throw new Error("Search unavailable");
        const result = await response.json();
        if (controller !== pending || preview.hidden) return;
        const items = result.matches || [];
        status.textContent = items.length ? "Rentals for your search" : result.summary;
        for (const item of items) {
          const row = document.createElement("li");
          const link = document.createElement("a");
          link.href = "rental.html?" + new URLSearchParams({ slug: item.slug });
          link.textContent = [item.title, item.location].filter(Boolean).join(" / ");
          row.append(link);
          matches.append(row);
        }
        browse.href = resultsUrl(result.filters).href;
        browse.textContent = items.length ? "See all matches" : "Adjust filters";
      } catch {
        if (controller === pending && !preview.hidden) status.textContent = "Continue with regular search.";
      } finally {
        clearTimeout(timeout);
      }
    });

    let suggestionTimer = 0;
    let suggestionRequest = null;
    searchInput.addEventListener("input", () => {
      window.clearTimeout(suggestionTimer);
      suggestionRequest?.abort();
      const term = searchInput.value.trim();
      if (!searchSuggestions || term.length < 2) {
        searchSuggestions?.replaceChildren();
        return;
      }
      suggestionTimer = window.setTimeout(async () => {
        const controller = new AbortController();
        suggestionRequest = controller;
        const url = new URL("/api/listings", window.location.origin);
        url.searchParams.set("q", term);
        url.searchParams.set("page", "0");
        if (searchCategory?.value) url.searchParams.set("category", searchCategory.value);
        try {
          const response = await fetch(url, { headers: { Accept: "application/json" }, signal: controller.signal, cache: "no-store" });
          if (!response.ok) return;
          const data = await response.json();
          const titles = [...new Set((Array.isArray(data.items) ? data.items : []).map((item) => item.title).filter((title) => typeof title === "string"))].slice(0, 8);
          searchSuggestions.replaceChildren(...titles.map((title) => Object.assign(document.createElement("option"), { value: title })));
        } catch { /* Suggestions are optional; the submitted search remains available. */ }
      }, 320);
    });
    searchCategory?.addEventListener("change", () => searchInput.dispatchEvent(new Event("input")));
  }
})();
