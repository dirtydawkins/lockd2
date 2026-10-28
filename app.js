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

  const year = document.querySelector("#year");
  if (year) year.textContent = String(new Date().getFullYear());

  const searchForm = document.querySelector("#idea-search-form");
  const searchInput = document.querySelector("#idea-search");
  const searchCategory = document.querySelector("#idea-category");
  const searchLocation = document.querySelector("#idea-location");
  const searchSuggestions = document.querySelector("#idea-suggestions");
  if (searchForm && searchInput) {
    searchForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const target = new URL("rentals.html", window.location.href);
      const query = searchInput.value.trim();
      if (query) target.searchParams.set("q", query);
      if (searchCategory?.value) target.searchParams.set("category", searchCategory.value);
      const location = searchLocation?.value.trim() || "";
      if (location) target.searchParams.set("location", location);
      window.location.assign(target.href);
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
