(() => {
  const categories = {
    stay: "Stay",
    drive: "Drive",
    play: "Play",
    technology: "Technology",
    experience: "Experiences",
    camera: "Cameras",
    phone: "Phones",
    laptop: "Laptops",
    audio: "Audio",
    creative: "Creative equipment",
  };
  const storageKey = "lockd:bundle:v3";
  const params = new URLSearchParams(window.location.search);
  const category = params.get("category") || "";
  const query = params.get("q") || "";
  const bundleMode = params.get("bundle") === "1";
  const grid = document.querySelector("#listing-grid");
  const status = document.querySelector("#catalogue-status");
  const panel = document.querySelector("#bundle-panel");
  const loadMoreButton = document.querySelector("#load-more");
  const searchForm = document.querySelector("#catalogue-search-form");
  const searchInput = document.querySelector("#catalogue-search");
  const sortSelect = document.querySelector("#catalogue-sort");
  const pageSize = 24;
  let page = 0;
  let hasMore = false;
  let items = [];

  function readBundle() {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || "{}");
      return {
        items: Array.isArray(saved.items) ? saved.items : [],
        startDate: typeof saved.startDate === "string" ? saved.startDate : "",
        endDate: typeof saved.endDate === "string" ? saved.endDate : "",
        delivery: typeof saved.delivery === "string" ? saved.delivery : "",
        extras: typeof saved.extras === "string" ? saved.extras : "",
      };
    } catch {
      return { items: [], startDate: "", endDate: "", delivery: "", extras: "" };
    }
  }

  let bundle = readBundle();

  function saveBundle() {
    try { localStorage.setItem(storageKey, JSON.stringify(bundle)); } catch { /* Storage can be disabled. */ }
    renderBundle();
  }

  function priceText(amount, currency, unit) {
    if (amount === null || amount === undefined || amount === "") return "Price to be confirmed";
    const price = Number(amount);
    if (!Number.isFinite(price) || price < 0 || !currency) return "Price to be confirmed";
    let formatted;
    try {
      formatted = new Intl.NumberFormat("en-KE", { style: "currency", currency, maximumFractionDigits: 0 }).format(price);
    } catch {
      formatted = `${currency} ${price.toLocaleString("en-KE")}`;
    }
    const unitLabels = { hour: "hour", day: "day", night: "night", week: "week", month: "month", trip: "trip" };
    const suffix = unitLabels[unit] ? ` / ${unitLabels[unit]}` : "";
    return `${formatted}${suffix}`;
  }

  function safeImageUrl(value) {
    if (typeof value !== "string" || !value.trim()) return "";
    try {
      const url = new URL(value, window.location.origin);
      return url.protocol === "https:" || url.origin === window.location.origin ? url.href : "";
    } catch { return ""; }
  }

  function linkToListing(listing) {
    const url = new URL("rental.html", window.location.href);
    url.searchParams.set("slug", listing.slug);
    if (category) url.searchParams.set("from", category);
    return url.toString();
  }

  function makeCard(listing, index) {
    const article = document.createElement("article");
    article.className = "listing-card";
    article.dataset.listingId = listing.id;
    article.style.animationDelay = `${Math.min(index, 8) * 35}ms`;
    const detailsUrl = linkToListing(listing);
    const imageLink = document.createElement("a");
    imageLink.className = "listing-card-image";
    imageLink.href = detailsUrl;
    imageLink.setAttribute("aria-label", `View ${listing.title}`);
    const imageUrl = safeImageUrl(Array.isArray(listing.images) ? listing.images[0] : listing.cover_image);
    if (imageUrl) {
      const image = document.createElement("img");
      image.src = imageUrl;
      image.alt = typeof listing.image_alt === "string" ? listing.image_alt : listing.title;
      image.loading = "lazy";
      imageLink.append(image);
    } else {
      const placeholder = document.createElement("span");
      placeholder.className = "listing-image-placeholder";
      placeholder.setAttribute("aria-hidden", "true");
      placeholder.textContent = (listing.title || "L").slice(0, 1).toUpperCase();
      imageLink.append(placeholder);
    }
    article.append(imageLink);

    const meta = document.createElement("div");
    meta.className = "listing-card-meta";
    const categoryLabel = categories[listing.category] || listing.category || "Rental";
    const categoryText = document.createElement("span");
    categoryText.textContent = categoryLabel;
    const statusText = document.createElement("span");
    statusText.textContent = listing.requires_approval ? "Enquiry required" : "Published rental";
    meta.append(categoryText, statusText);
    article.append(meta);

    const title = document.createElement("h2");
    const titleLink = document.createElement("a");
    titleLink.href = detailsUrl;
    titleLink.textContent = listing.title;
    title.append(titleLink);
    article.append(title);

    if (listing.location_label) {
      const location = document.createElement("p");
      location.className = "listing-location";
      location.textContent = listing.location_label;
      article.append(location);
    }

    const price = document.createElement("p");
    price.className = "listing-price";
    price.textContent = priceText(listing.price_amount, listing.currency, listing.price_unit);
    article.append(price);

    const actions = document.createElement("div");
    actions.className = "listing-card-actions";
    const viewLink = document.createElement("a");
    viewLink.className = "text-button";
    viewLink.href = detailsUrl;
    viewLink.textContent = "View rental";
    const add = document.createElement("button");
    add.type = "button";
    add.className = "bundle-add";
    add.textContent = bundle.items.some((item) => item.id === listing.id) ? "In your bundle" : "Add to bundle";
    add.setAttribute("aria-pressed", String(bundle.items.some((item) => item.id === listing.id)));
    add.addEventListener("click", (event) => addToBundle(listing, event.currentTarget));
    actions.append(viewLink, add);
    article.append(actions);
    return article;
  }

  function addToBundle(listing, button) {
    const existing = bundle.items.find((item) => item.id === listing.id);
    if (existing) existing.quantity = Math.min(20, Number(existing.quantity || 1) + 1);
    else {
      bundle.items.push({
        id: listing.id,
        slug: listing.slug,
        title: listing.title,
        quantity: 1,
        priceAmount: listing.price_amount,
        currency: listing.currency,
        priceUnit: listing.price_unit,
      });
    }
    saveBundle();
    if (button) {
      button.textContent = "In your bundle";
      button.setAttribute("aria-pressed", "true");
    }
  }

  function renderBundle() {
    const lines = document.querySelector("#bundle-lines");
    if (!panel || !lines) return;
    panel.hidden = !bundleMode && bundle.items.length === 0;
    lines.replaceChildren();
    if (!bundle.items.length) {
      const empty = document.createElement("p");
      empty.className = "bundle-empty-state";
      empty.textContent = "Choose a published rental and add it here to start your bundle.";
      lines.append(empty);
    }
    bundle.items.forEach((item) => {
      const row = document.createElement("div");
      row.className = "bundle-line";
      const name = document.createElement("div");
      name.className = "bundle-line-name";
      name.textContent = item.title;
      const price = document.createElement("div");
      price.className = "bundle-line-price";
      price.textContent = priceText(item.priceAmount, item.currency, item.priceUnit);
      const controls = document.createElement("div");
      controls.className = "bundle-line-controls";
      const decrease = document.createElement("button");
      decrease.type = "button";
      decrease.textContent = "−";
      decrease.setAttribute("aria-label", `Reduce ${item.title} quantity`);
      decrease.addEventListener("click", () => {
        item.quantity -= 1;
        if (item.quantity < 1) bundle.items = bundle.items.filter((entry) => entry.id !== item.id);
        saveBundle();
      });
      const quantity = document.createElement("output");
      quantity.textContent = String(item.quantity || 1);
      const increase = document.createElement("button");
      increase.type = "button";
      increase.textContent = "+";
      increase.setAttribute("aria-label", `Increase ${item.title} quantity`);
      increase.addEventListener("click", () => {
        item.quantity = Math.min(20, Number(item.quantity || 1) + 1);
        saveBundle();
      });
      controls.append(decrease, quantity, increase);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "bundle-remove";
      remove.textContent = "Remove";
      remove.addEventListener("click", () => {
        bundle.items = bundle.items.filter((entry) => entry.id !== item.id);
        saveBundle();
      });
      row.append(name, controls, price, remove);
      lines.append(row);
    });

    const count = document.querySelector("#bundle-count");
    const price = document.querySelector("#bundle-price");
    if (count) count.textContent = String(bundle.items.reduce((sum, item) => sum + Number(item.quantity || 1), 0));
    if (price) price.textContent = bundle.items.length ? "Rates shown per rental" : "No rentals selected";
    grid?.querySelectorAll(".bundle-add").forEach((button) => {
      const listingId = button.closest(".listing-card")?.dataset.listingId;
      const selected = bundle.items.some((item) => item.id === listingId);
      button.textContent = selected ? "In your bundle" : "Add to bundle";
      button.setAttribute("aria-pressed", String(selected));
    });
    const dates = [
      ["#bundle-start", "startDate"],
      ["#bundle-end", "endDate"],
      ["#bundle-delivery", "delivery"],
      ["#bundle-extras", "extras"],
    ];
    dates.forEach(([selector, key]) => {
      const field = document.querySelector(selector);
      if (field) {
        field.value = bundle[key] || "";
        field.onchange = () => { bundle[key] = field.value; saveBundle(); };
      }
    });
  }

  async function loadListings({ append = false } = {}) {
    status.dataset.kind = "loading";
    status.textContent = "Loading published rentals…";
    loadMoreButton.hidden = true;
    const nextPage = append ? page + 1 : 0;
    const apiUrl = new URL("/api/listings", window.location.origin);
    if (category) apiUrl.searchParams.set("category", category);
    if (query) apiUrl.searchParams.set("q", query);
    apiUrl.searchParams.set("page", String(nextPage));
    apiUrl.searchParams.set("sort", sortSelect?.value || "newest");
    try {
      const response = await fetch(apiUrl, { headers: { Accept: "application/json" }, cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 503 || data.error === "catalogue_not_configured") {
          throw new Error("The live catalogue is not connected yet. Add the Supabase project URL and anon key to the Vercel environment, then apply the catalogue migration.");
        }
        throw new Error(data.message || "The rental catalogue could not be loaded. Please try again shortly.");
      }
      const loadedItems = Array.isArray(data.items) ? data.items : [];
      if (!append) {
        items = loadedItems;
        grid.replaceChildren();
      } else {
        items.push(...loadedItems);
      }
      loadedItems.forEach((listing, index) => grid.append(makeCard(listing, index)));
      page = nextPage;
      hasMore = data.hasMore === true;
      const resultCount = document.querySelector("#result-count");
      if (resultCount) resultCount.textContent = `${items.length}${hasMore ? "+" : ""} published ${items.length === 1 ? "rental" : "rentals"}`;
      if (items.length === 0) {
        status.dataset.kind = "empty";
        status.textContent = query
          ? "No published rentals match that search yet. Try a different term or browse all categories."
          : `There are no published ${category && categories[category] ? categories[category].toLowerCase() : "rentals"} to show yet.`;
      } else {
        status.dataset.kind = "loaded";
        status.textContent = "Only published, approved rentals appear here.";
      }
      loadMoreButton.hidden = !hasMore;
    } catch (error) {
      if (!append) grid.replaceChildren();
      status.dataset.kind = "error";
      status.textContent = error.message || "The rental catalogue is temporarily unavailable.";
      const resultCount = document.querySelector("#result-count");
      if (resultCount) resultCount.textContent = "";
    }
  }

  if (category && categories[category]) {
    const categoryLink = document.querySelector(`[data-filter="${category}"]`);
    if (categoryLink) categoryLink.setAttribute("aria-current", "page");
    const title = document.querySelector("#catalogue-title");
    const description = document.querySelector("#catalogue-description");
    if (title) title.innerHTML = `${categories[category]}<br><em>rentals.</em>`;
    if (description) description.textContent = `Browse published ${categories[category].toLowerCase()} rentals and check their details.`;
  } else {
    document.querySelector('[data-filter="all"]')?.setAttribute("aria-current", "page");
  }
  if (query && searchInput) searchInput.value = query;
  if (searchForm && searchInput) {
    searchForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const url = new URL("rentals.html", window.location.href);
      const nextQuery = searchInput.value.trim();
      if (category) url.searchParams.set("category", category);
      if (nextQuery) url.searchParams.set("q", nextQuery);
      if (bundleMode) url.searchParams.set("bundle", "1");
      window.location.assign(url.href);
    });
  }
  if (sortSelect) sortSelect.addEventListener("change", () => { page = 0; loadListings(); });
  if (loadMoreButton) loadMoreButton.addEventListener("click", () => loadListings({ append: true }));
  document.querySelector("#clear-bundle")?.addEventListener("click", () => {
    bundle = { items: [], startDate: "", endDate: "", delivery: "", extras: "" };
    saveBundle();
    grid.querySelectorAll(".bundle-add").forEach((button) => {
      button.textContent = "Add to bundle";
      button.setAttribute("aria-pressed", "false");
    });
  });

  renderBundle();
  loadListings();
})();
