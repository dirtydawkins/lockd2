(() => {
  const savedKey = "lockd:tech:saved:v1";
  const recentKey = "lockd:tech:recent:v1";
  const compareKey = "lockd:tech:compare:v1";
  const savedSearchKey = "lockd:tech:searches:v1";
  const bundleKey = "lockd:bundle:v3";
  const params = new URLSearchParams(window.location.search);
  const groupLabels = {
    all: "All technology", gaming: "Gaming", phones: "Phones", computers: "Computers & tablets",
    creator: "Cameras & creator gear", audio: "Audio & events", work: "Work & productivity",
  };
  const requestedGroup = params.get("group") || "all";
  let initialGroup = Object.hasOwn(groupLabels, requestedGroup) ? requestedGroup : "all";
  const typeLabels = {
    gaming: "Gaming", phone: "Phones", computer: "Computers", tablet: "Tablets", camera: "Cameras",
    lens: "Lenses", audio: "Audio", creator: "Creator gear", projector: "Projectors",
    phones: "Phones", computers: "Computers & tablets", work: "Work & productivity",
  };
  const useCaseLabels = {
    gaming: "Gaming night", content_creation: "Content creation", photography: "Photography session",
    temporary_work: "Temporary work setup", presentation: "Presentation or event",
    mobile_productivity: "Travel and mobile productivity", streaming: "Streaming and podcast recording",
  };
  const form = document.querySelector("#tech-filter-form");
  const filterToggle = document.querySelector("#tech-filter-toggle");
  const filterDrawer = document.querySelector("#tech-filter-drawer");
  const grid = document.querySelector("#tech-listing-grid");
  const status = document.querySelector("#tech-status");
  const loadMore = document.querySelector("#tech-load-more");
  const count = document.querySelector("#tech-result-count");
  const activeFilters = document.querySelector("#tech-active-filters");
  const filterFields = {
    q: document.querySelector("#tech-search"), brand: document.querySelector("#tech-brand"),
    type: document.querySelector("#tech-type"), condition: document.querySelector("#tech-condition"), duration: document.querySelector("#tech-duration"),
    accessory: document.querySelector("#tech-accessory"),
    location: document.querySelector("#tech-location"), minPrice: document.querySelector("#tech-min-price"),
    maxPrice: document.querySelector("#tech-max-price"), startDate: document.querySelector("#tech-start-date"),
    endDate: document.querySelector("#tech-end-date"), quantity: document.querySelector("#tech-quantity"),
    collection: document.querySelector("#tech-collection"), delivery: document.querySelector("#tech-delivery"),
    sort: document.querySelector("#tech-sort"),
  };
  let page = 0;
  let hasMore = false;
  let loadedListings = [];
  let controller = null;
  let searchTimer = null;
  let saved = readStringList(savedKey);
  let recent = readStringList(recentKey);
  let compared = readStringList(compareKey).slice(0, 3);
  let savedSearches = readSavedSearches();
  let selectedUseCase = params.get("useCase") || "";

  function readStringList(key) {
    try {
      const list = JSON.parse(localStorage.getItem(key) || "[]");
      return Array.isArray(list) ? list.filter((value) => typeof value === "string").slice(0, 40) : [];
    } catch { return []; }
  }

  function readSavedSearches() {
    try {
      const rows = JSON.parse(localStorage.getItem(savedSearchKey) || "[]");
      return Array.isArray(rows) ? rows.filter((row) => row && typeof row.label === "string" && typeof row.href === "string").slice(0, 10) : [];
    } catch { return []; }
  }

  function writeList(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Browsing still works with storage disabled. */ }
  }

  function validImage(value) {
    if (typeof value !== "string" || !value.trim()) return "";
    try {
      const url = new URL(value, window.location.origin);
      return url.protocol === "https:" || url.origin === window.location.origin ? url.href : "";
    } catch { return ""; }
  }

  function priceText(amount, currency, unit) {
    const price = Number(amount);
    if (!Number.isFinite(price) || price <= 0 || typeof currency !== "string") return "Price to be confirmed";
    let value;
    try { value = new Intl.NumberFormat("en-KE", { style: "currency", currency, maximumFractionDigits: 0 }).format(price); }
    catch { value = `${currency} ${price.toLocaleString("en-KE")}`; }
    const units = { hour: "hour", day: "day", night: "night", week: "week", month: "month", trip: "trip" };
    return `${value}${units[unit] ? ` / ${units[unit]}` : ""}`;
  }

  function textOr(value, fallback = "") {
    return typeof value === "string" && value.trim() ? value.trim() : fallback;
  }

  function listingUrl(listing) {
    const url = new URL("rental.html", window.location.href);
    url.searchParams.set("slug", listing.slug);
    url.searchParams.set("from", "technology");
    const current = new URL(window.location.href);
    url.searchParams.set("returnTo", `${current.pathname}${current.search}#published-rentals`);
    if (filterFields.startDate.value) url.searchParams.set("startDate", filterFields.startDate.value);
    if (filterFields.endDate.value) url.searchParams.set("endDate", filterFields.endDate.value);
    if (Number(filterFields.quantity.value) > 1) url.searchParams.set("quantity", filterFields.quantity.value);
    return url.href;
  }

  function updateRecent(slug) {
    if (!slug) return;
    recent = [slug, ...recent.filter((entry) => entry !== slug)].slice(0, 12);
    writeList(recentKey, recent);
    renderPersonal();
  }

  function imageFor(listing, cover) {
    const raw = Array.isArray(listing.images) ? listing.images[0] : "";
    const url = validImage(raw || listing.cover_image);
    if (!url) {
      const photo = window.LockdPhotoFallbacks?.forListing(listing);
      if (photo) {
        const image = document.createElement("img");
        image.src = photo.src;
        image.alt = cover ? photo.alt : "";
        image.loading = "lazy";
        image.decoding = "async";
        return image;
      }
      const placeholder = document.createElement("span");
      placeholder.className = "tech-placeholder";
      placeholder.setAttribute("aria-hidden", "true");
      placeholder.textContent = (listing.title || "T").slice(0, 1).toUpperCase();
      return placeholder;
    }
    const image = document.createElement("img");
    image.src = url;
    image.alt = cover ? textOr(listing.image_alt, listing.title) : "";
    image.loading = "lazy";
    image.decoding = "async";
    return image;
  }

  function brandOf(listing) {
    const attrs = listing.attributes && typeof listing.attributes === "object" ? listing.attributes : {};
    return textOr(attrs.brand, "");
  }

  function specsOf(listing) {
    const attrs = listing.attributes && typeof listing.attributes === "object" ? listing.attributes : {};
    const values = [attrs.model, attrs.configuration, attrs.specifications, attrs.condition].filter((value) => typeof value === "string" && value.trim());
    return values.slice(0, 2).join(" · ");
  }

  function addToBundle(listing, button) {
    let bundle;
    try { bundle = JSON.parse(localStorage.getItem(bundleKey) || "{}"); } catch { bundle = {}; }
    if (!Array.isArray(bundle.items)) bundle.items = [];
    const existing = bundle.items.find((item) => item.id === listing.id);
    if (existing) existing.quantity = Math.min(20, Number(existing.quantity || 1) + 1);
    else bundle.items.push({ id: listing.id, slug: listing.slug, title: listing.title, quantity: 1,
      priceAmount: listing.price_amount, currency: listing.currency, priceUnit: listing.price_unit });
    try { localStorage.setItem(bundleKey, JSON.stringify(bundle)); } catch { /* Optional saved state. */ }
    if (button) {
      button.textContent = "Added to bundle";
      button.setAttribute("aria-pressed", "true");
      button.classList.add("is-feedback");
      window.clearTimeout(Number(button.dataset.feedbackTimer));
      button.dataset.feedbackTimer = String(window.setTimeout(() => {
        button.classList.remove("is-feedback");
        button.textContent = "In your bundle";
      }, 240));
    }
  }

  function toggleSaved(listing, button) {
    saved = saved.includes(listing.slug) ? saved.filter((slug) => slug !== listing.slug) : [listing.slug, ...saved].slice(0, 40);
    writeList(savedKey, saved);
    if (button) {
      const isSaved = saved.includes(listing.slug);
      button.setAttribute("aria-pressed", String(isSaved));
      button.setAttribute("aria-label", `${isSaved ? "Remove" : "Save"} ${listing.title}`);
      button.textContent = isSaved ? "♥" : "♡";
    }
    renderPersonal();
  }

  function toggleCompare(listing, button) {
    if (compared.includes(listing.slug)) compared = compared.filter((slug) => slug !== listing.slug);
    else if (compared.length < 3) compared = [...compared, listing.slug];
    else {
      status.dataset.kind = "info";
      status.textContent = "Compare up to three rentals at a time.";
      return;
    }
    writeList(compareKey, compared);
    button.textContent = compared.includes(listing.slug) ? "Compared" : "Compare";
    button.setAttribute("aria-pressed", String(compared.includes(listing.slug)));
    renderCompare();
  }

  function makeCard(listing, index, compact = false) {
    const card = document.createElement("article");
    card.className = "tech-card";
    card.style.setProperty("--motion-delay", `${Math.min(index % 6, 5) * 32}ms`);
    if (compact) card.classList.add("tech-mini-card");
    const url = listingUrl(listing);
    const imageLink = document.createElement("a");
    imageLink.className = "tech-card-image";
    imageLink.href = url;
    imageLink.setAttribute("aria-label", `View ${listing.title}`);
    imageLink.append(imageFor(listing, true));
    const hasListingPhoto = Boolean(validImage(Array.isArray(listing.images) ? listing.images[0] : listing.cover_image));
    const fallbackPhoto = hasListingPhoto ? null : window.LockdPhotoFallbacks?.forListing(listing);
    if (fallbackPhoto && !compact) {
      const note = document.createElement("span");
      note.className = "listing-image-note";
      note.textContent = fallbackPhoto.note;
      imageLink.append(note);
    }
    imageLink.addEventListener("click", () => updateRecent(listing.slug));
    if (!compact) card.append(imageLink);

    if (compact) {
      const content = document.createElement("div");
      const title = document.createElement("h3");
      const link = document.createElement("a");
      link.href = url;
      link.textContent = listing.title;
      link.addEventListener("click", () => updateRecent(listing.slug));
      title.append(link);
      const price = document.createElement("p");
      price.textContent = priceText(listing.price_amount, listing.currency, listing.price_unit);
      content.append(title, price);
      card.append(imageFor(listing, false), content);
      return card;
    }

    const favorite = document.createElement("button");
    favorite.className = "tech-favourite";
    favorite.type = "button";
    favorite.textContent = saved.includes(listing.slug) ? "♥" : "♡";
    favorite.setAttribute("aria-pressed", String(saved.includes(listing.slug)));
    favorite.setAttribute("aria-label", `${saved.includes(listing.slug) ? "Remove" : "Save"} ${listing.title}`);
    favorite.addEventListener("click", () => toggleSaved(listing, favorite));
    card.append(imageLink, favorite);

    const topLine = document.createElement("div");
    topLine.className = "tech-card-topline";
    const category = document.createElement("span");
    const listingCategory = listing.market_category || listing.category;
    const categoryKey = listingCategory === "play" ? "gaming" : listingCategory;
    category.textContent = typeLabels[categoryKey] || (categoryKey === "technology" ? "Technology" : categoryKey || "Technology");
    const badge = document.createElement("span");
    badge.textContent = "LOCKD listing";
    topLine.append(category, badge);

    const title = document.createElement("h3");
    const link = document.createElement("a");
    link.href = url;
    link.textContent = listing.title;
    link.addEventListener("click", () => updateRecent(listing.slug));
    title.append(link);
    const specs = document.createElement("p");
    specs.className = "tech-card-specs";
    specs.textContent = specsOf(listing) || textOr(listing.summary, "Owner details are listed on the rental page.");
    const price = document.createElement("p");
    price.className = "tech-card-price";
    price.textContent = priceText(listing.price_amount, listing.currency, listing.price_unit);
    const location = document.createElement("p");
    location.className = "tech-card-location";
    location.textContent = textOr(listing.location_label, "Location to be confirmed");
    const actions = document.createElement("div");
    actions.className = "tech-card-actions";
    const view = document.createElement("a");
    view.href = url;
    view.textContent = listing.requires_approval ? "Enquire about this rental" : "View rental";
    view.addEventListener("click", () => updateRecent(listing.slug));
    const bundle = document.createElement("button");
    bundle.type = "button";
    bundle.textContent = "Add to bundle";
    bundle.addEventListener("click", () => addToBundle(listing, bundle));
    const compare = document.createElement("button");
    compare.type = "button";
    compare.textContent = compared.includes(listing.slug) ? "Compared" : "Compare";
    compare.setAttribute("aria-pressed", String(compared.includes(listing.slug)));
    compare.addEventListener("click", () => toggleCompare(listing, compare));
    actions.append(view, bundle, compare);
    card.append(topLine, title, specs, price, location, actions);
    return card;
  }

  function activeParams() {
    const values = {};
    for (const [name, field] of Object.entries(filterFields)) {
      const value = field?.value?.trim?.() || "";
      if (value) values[name] = value;
    }
    if (initialGroup !== "all") values.group = initialGroup;
    if (["gaming", "content_creation", "photography", "temporary_work", "presentation", "mobile_productivity", "streaming"].includes(selectedUseCase)) values.useCase = selectedUseCase;
    return values;
  }

  function filterLabel(name, value) {
    const labels = { q: "Search", brand: "Brand", type: "Type", condition: "Condition", duration: "Duration", accessory: "Included", location: "Location", minPrice: "From KSh", maxPrice: "To KSh", startDate: "From", endDate: "Return by", delivery: "Delivery", collection: "Collection", useCase: "Use case" };
    return `${labels[name] || name}: ${typeLabels[value] || value}`;
  }

  function renderFilterSummary(filters) {
    const entries = Object.entries(filters).filter(([key]) => key !== "sort" && key !== "quantity");
    activeFilters.textContent = entries.map(([key, value]) => filterLabel(key, value)).join(" · ");
  }

  async function loadListings({ append = false } = {}) {
    if (controller) controller.abort();
    controller = new AbortController();
    status.dataset.kind = "loading";
    status.textContent = "Loading published LOCKD rentals…";
    loadMore.hidden = true;
    const dateFrom = filterFields.startDate.value;
    const dateTo = filterFields.endDate.value;
    if (Boolean(dateFrom) !== Boolean(dateTo)) {
      grid.replaceChildren();
      loadedListings = [];
      count.textContent = "";
      renderUseCases([]);
      renderCompare();
      status.dataset.kind = "info";
      status.textContent = "Choose both dates to filter by availability.";
      return;
    }
    const nextPage = append ? page + 1 : 0;
    const filters = activeParams();
    renderFilterSummary(filters);
    const url = new URL("/api/listings", window.location.origin);
    url.searchParams.set("market", "tech");
    url.searchParams.set("page", String(nextPage));
    for (const [key, value] of Object.entries(filters)) url.searchParams.set(key, value);
    if (filters.group) {
      url.searchParams.set("group", filters.group);
    }
    try {
      const response = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store", signal: controller.signal });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 503 || data.error === "catalogue_not_configured") {
          throw new Error("The live LOCKD catalogue is not connected yet. Please check back later.");
        }
        throw new Error(data.message || "LOCKD rentals could not be loaded. Please try again shortly.");
      }
      const rows = Array.isArray(data.items) ? data.items : [];
      loadedListings = append ? [...loadedListings, ...rows] : rows;
      if (!append) grid.replaceChildren();
      rows.forEach((listing, index) => grid.append(makeCard(listing, index)));
      page = nextPage;
      hasMore = data.hasMore === true;
      const totalLabel = Number.isInteger(data.total) ? data.total : loadedListings.length;
      const countSuffix = Number.isInteger(data.total) ? "" : hasMore ? "+" : "";
      count.textContent = `${totalLabel}${countSuffix} published LOCKD ${totalLabel === 1 ? "rental" : "rentals"}`;
      if (!loadedListings.length) {
        status.dataset.kind = "empty";
        status.textContent = Object.keys(filters).some((key) => !["sort", "quantity"].includes(key))
          ? "No published LOCKD technology rentals match these filters yet. Clear a filter or try another category."
          : "No published LOCKD technology rentals are available to show yet. Check back after owners publish approved listings.";
      } else {
        status.dataset.kind = "loaded";
        status.textContent = "Published, approved LOCKD listings only. Check each listing’s terms and availability.";
      }
      loadMore.hidden = !hasMore;
      await renderPersonal();
      renderBrands();
      renderUseCases(loadedListings);
      renderCompare();
    } catch (error) {
      if (error.name === "AbortError") return;
      if (!append) {
        grid.replaceChildren();
        loadedListings = [];
      }
      status.dataset.kind = "error";
      status.textContent = error.message || "The LOCKD catalogue is temporarily unavailable.";
      count.textContent = "";
      await renderPersonal();
      renderUseCases([]);
      renderCompare();
    }
  }

  function renderBrands() {
    const brands = [...new Set(loadedListings.map(brandOf).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    const list = document.querySelector("#tech-brands");
    list.replaceChildren(...brands.map((brand) => {
      const option = document.createElement("option");
      option.value = brand;
      return option;
    }));
  }

  async function fetchListingBySlug(slug) {
    const present = loadedListings.find((listing) => listing.slug === slug);
    if (present) return present;
    try {
      const url = new URL("/api/listings", window.location.origin);
      url.searchParams.set("slug", slug);
      const response = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      return response.ok && data.item ? data.item : null;
    } catch { return null; }
  }

  async function renderPersonal() {
    const savedPanel = document.querySelector("#saved-panel");
    const recentPanel = document.querySelector("#recent-panel");
    const savedGrid = document.querySelector("#saved-grid");
    const recentGrid = document.querySelector("#recent-grid");
    renderSavedSearches();
    savedPanel.hidden = saved.length === 0;
    recentPanel.hidden = recent.length === 0;
    const [savedRows, recentRows] = await Promise.all([
      Promise.all(saved.slice(0, 4).map(fetchListingBySlug)),
      Promise.all(recent.slice(0, 4).map(fetchListingBySlug)),
    ]);
    savedGrid.replaceChildren(...savedRows.filter(Boolean).map((listing, index) => makeCard(listing, index, true)));
    recentGrid.replaceChildren(...recentRows.filter(Boolean).map((listing, index) => makeCard(listing, index, true)));
    if (!savedRows.filter(Boolean).length) savedPanel.hidden = true;
    if (!recentRows.filter(Boolean).length) recentPanel.hidden = true;
  }

  function renderSavedSearches() {
    const section = document.querySelector("#saved-searches");
    const links = document.querySelector("#saved-search-links");
    if (!section || !links) return;
    section.hidden = savedSearches.length === 0;
    links.replaceChildren(...savedSearches.map((search) => {
      const anchor = document.createElement("a");
      let url;
      try { url = new URL(search.href, window.location.origin); } catch { return null; }
      if (url.origin !== window.location.origin || url.pathname !== "/tech.html") return null;
      anchor.href = url.href;
      anchor.textContent = search.label;
      return anchor;
    }).filter(Boolean));
  }

  function renderUseCases(listings) {
    const labels = new Map();
    listings.forEach((listing) => {
      const values = listing.attributes?.use_cases;
      const items = Array.isArray(values) ? values : typeof values === "string" ? values.split(",") : [];
      items.forEach((entry) => {
        const key = String(entry).trim().toLowerCase().replace(/[ -]+/g, "_");
        if (useCaseLabels[key]) labels.set(key, useCaseLabels[key]);
      });
    });
    const section = document.querySelector("#use-case-section");
    const links = document.querySelector("#use-case-links");
    section.hidden = labels.size === 0;
    links.replaceChildren(...[...labels].map(([key, label]) => {
      const link = document.createElement("a");
      link.href = `tech.html?useCase=${encodeURIComponent(key)}`;
      link.textContent = label;
      return link;
    }));
  }

  function compareValue(listing, key) {
    const attrs = listing.attributes && typeof listing.attributes === "object" ? listing.attributes : {};
    const values = {
      Rental: priceText(listing.price_amount, listing.currency, listing.price_unit),
      Brand: attrs.brand || "Not stated",
      Model: attrs.model || "Not stated",
      Condition: attrs.condition || "Not stated",
      Configuration: attrs.configuration || attrs.specifications || "Not stated",
      Included: Array.isArray(attrs.included_accessories) ? attrs.included_accessories.join(", ") : attrs.included_accessories || "Not stated",
      Location: listing.location_label || "Not stated",
      Collection: listing.collection_available === true ? "Yes" : listing.collection_available === false ? "No" : "Confirm with owner",
      Delivery: listing.delivery_available === true ? "Yes" : listing.delivery_available === false ? "No" : "Confirm with owner",
    };
    return String(values[key] ?? "Not stated");
  }

  async function renderCompare() {
    const section = document.querySelector("#tech-compare");
    const head = document.querySelector("#compare-head");
    const body = document.querySelector("#compare-body");
    const rows = (await Promise.all(compared.map(fetchListingBySlug))).filter(Boolean);
    compared = rows.map((listing) => listing.slug);
    writeList(compareKey, compared);
    section.hidden = rows.length === 0;
    if (!rows.length) return;
    const heading = document.createElement("tr");
    const first = document.createElement("th");
    first.scope = "col";
    first.textContent = "Details";
    heading.append(first);
    rows.forEach((listing) => {
      const cell = document.createElement("th");
      cell.scope = "col";
      const link = document.createElement("a");
      link.href = listingUrl(listing);
      link.textContent = listing.title;
      cell.append(link);
      heading.append(cell);
    });
    head.replaceChildren(heading);
    const keys = ["Rental", "Brand", "Model", "Condition", "Configuration", "Included", "Location", "Collection", "Delivery"];
    body.replaceChildren(...keys.map((key) => {
      const row = document.createElement("tr");
      const label = document.createElement("th");
      label.scope = "row";
      label.textContent = key;
      row.append(label);
      rows.forEach((listing) => {
        const cell = document.createElement("td");
        cell.textContent = compareValue(listing, key);
        row.append(cell);
      });
      return row;
    }));
  }

  function setUrlFromFilters() {
    const url = new URL(window.location.href);
    const filters = activeParams();
    url.search = "";
    if (filters.group) url.searchParams.set("group", filters.group);
    for (const [key, value] of Object.entries(filters)) {
      if (key !== "group" && key !== "sort" && !(key === "quantity" && value === "1")) url.searchParams.set(key, value);
    }
    if (filters.sort && filters.sort !== (filters.q ? "relevance" : "newest")) url.searchParams.set("sort", filters.sort);
    window.history.replaceState({}, "", url);
    updateFilterToggle();
  }

  function updateFilterToggle() {
    Object.values(filterFields).forEach((field) => field?.closest("label")?.classList.toggle("has-value", Boolean(field.value)));
    if (!filterToggle) return;
    const selected = Object.entries(activeParams()).filter(([key, value]) => key !== "sort" && !(key === "quantity" && value === "1"));
    filterToggle.textContent = selected.length ? `Filters (${selected.length})` : "Filters";
  }

  function setFilterDrawerOpen(open) {
    if (!form || !filterToggle || !filterDrawer) return;
    if (!open && form.contains(document.activeElement)) filterToggle.focus();
    filterDrawer.classList.toggle("is-open", open);
    filterToggle.setAttribute("aria-expanded", String(open));
    form.inert = !open;
    form.setAttribute("aria-hidden", String(!open));
  }

  const mobileFilters = window.matchMedia("(max-width: 760px)");
  function syncFilterDrawer() {
    if (!filterToggle || !filterDrawer) return;
    const mobile = mobileFilters.matches;
    filterToggle.hidden = !mobile;
    filterDrawer.classList.toggle("is-collapsible", mobile);
    const hasActiveSelection = Object.entries(activeParams()).some(([key, value]) => key !== "sort" && !(key === "quantity" && value === "1"));
    setFilterDrawerOpen(!mobile || hasActiveSelection);
    updateFilterToggle();
  }

  let group = initialGroup;
  document.querySelectorAll("[data-group]").forEach((link) => {
    if (link.dataset.group === group) link.setAttribute("aria-current", "page");
  });
  if (params.has("q")) filterFields.q.value = params.get("q");
  if (params.has("brand")) filterFields.brand.value = params.get("brand");
  if (params.has("type")) filterFields.type.value = params.get("type");
  if (params.has("condition")) filterFields.condition.value = params.get("condition");
  if (params.has("duration")) filterFields.duration.value = params.get("duration");
  if (params.has("accessory")) filterFields.accessory.value = params.get("accessory");
  if (params.has("location")) filterFields.location.value = params.get("location");
  if (params.has("minPrice")) filterFields.minPrice.value = params.get("minPrice");
  if (params.has("maxPrice")) filterFields.maxPrice.value = params.get("maxPrice");
  if (params.has("startDate")) filterFields.startDate.value = params.get("startDate");
  if (params.has("endDate")) filterFields.endDate.value = params.get("endDate");
  if (params.has("quantity")) filterFields.quantity.value = params.get("quantity");
  if (params.has("collection")) filterFields.collection.value = params.get("collection");
  if (params.has("delivery")) filterFields.delivery.value = params.get("delivery");
  filterFields.sort.value = params.get("sort") || (params.has("q") ? "relevance" : "newest");
  const today = new Date();
  const localDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  filterFields.startDate.min = localDate;
  filterFields.endDate.min = filterFields.startDate.value || localDate;
  filterFields.startDate.addEventListener("change", () => { filterFields.endDate.min = filterFields.startDate.value || localDate; });
  if (group !== "all") document.querySelector(".tech-hero-copy .eyebrow").textContent = `LOCKD / THE TECH EDIT · ${groupLabels[group].toUpperCase()}`;

  filterToggle?.addEventListener("click", () => {
    const open = filterToggle.getAttribute("aria-expanded") !== "true";
    setFilterDrawerOpen(open);
  });
  syncFilterDrawer();
  mobileFilters.addEventListener("change", syncFilterDrawer);

  form.addEventListener("submit", (event) => { event.preventDefault(); setUrlFromFilters(); loadListings(); });
  form.addEventListener("change", (event) => {
    if (event.target.name !== "q" && event.target.name !== "brand" && event.target.name !== "location") {
      setUrlFromFilters();
      loadListings();
    }
  });
  [filterFields.q, filterFields.brand, filterFields.accessory, filterFields.location, filterFields.minPrice, filterFields.maxPrice].forEach((field) => {
    field.addEventListener("input", () => {
      if (field === filterFields.q && field.value.trim() && !new URLSearchParams(window.location.search).has("sort") && filterFields.sort.value === "newest") {
        filterFields.sort.value = "relevance";
      }
      window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(() => { setUrlFromFilters(); loadListings(); }, 350);
    });
  });
  form.addEventListener("reset", () => window.setTimeout(() => {
    initialGroup = "all";
    group = "all";
    selectedUseCase = "";
    document.querySelectorAll("[data-group]").forEach((link) => link.setAttribute("aria-current", String(link.dataset.group === "all")));
    document.querySelector(".tech-hero-copy .eyebrow").textContent = "LOCKD / THE TECH EDIT";
    setUrlFromFilters();
    syncFilterDrawer();
    loadListings();
  }, 0));
  loadMore.addEventListener("click", () => loadListings({ append: true }));
  document.querySelector("#save-tech-search").addEventListener("click", () => {
    setUrlFromFilters();
    const url = new URL(window.location.href);
    const filters = activeParams();
    const label = filters.q || groupLabels[filters.group] || typeLabels[filters.type] || "All tech rentals";
    const href = `${url.pathname}${url.search}`;
    savedSearches = [{ label, href }, ...savedSearches.filter((entry) => entry.href !== href)].slice(0, 10);
    try { localStorage.setItem(savedSearchKey, JSON.stringify(savedSearches)); } catch { /* Saved searches are optional. */ }
    renderSavedSearches();
  });
  document.querySelector("#clear-saved-searches").addEventListener("click", () => {
    savedSearches = [];
    try { localStorage.removeItem(savedSearchKey); } catch { /* Storage may be disabled. */ }
    renderSavedSearches();
  });
  document.querySelector("#clear-compare").addEventListener("click", () => {
    compared = [];
    writeList(compareKey, compared);
    renderCompare();
    grid.querySelectorAll(".tech-card-actions button[aria-pressed]").forEach((button) => {
      if (button.textContent === "Compared") {
        button.textContent = "Compare";
        button.setAttribute("aria-pressed", "false");
      }
    });
  });

  renderPersonal();
  loadListings();
})();
