(() => {
  const categories = {
    stay: "Stay",
    drive: "Cars & Mobility",
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
  let category = params.get("category") || "";
  let query = params.get("q") || "";
  let locationQuery = params.get("location") || "";
  const bundleMode = params.get("bundle") === "1";
  const grid = document.querySelector("#listing-grid");
  const status = document.querySelector("#catalogue-status");
  const panel = document.querySelector("#bundle-panel");
  const loadMoreButton = document.querySelector("#load-more");
  const searchForm = document.querySelector("#catalogue-search-form");
  const categorySelect = document.querySelector("#catalogue-category");
  const searchInput = document.querySelector("#catalogue-search");
  const locationInput = document.querySelector("#catalogue-location");
  const sortSelect = document.querySelector("#catalogue-sort");
  const filterIds = ["catalogue-min-price", "catalogue-max-price", "catalogue-currency", "catalogue-start-date", "catalogue-end-date", "catalogue-quantity", "vehicle-type", "vehicle-transmission", "vehicle-fuel", "vehicle-seats", "vehicle-driver-age", "vehicle-service-mode"];
  const filterKeys = ["minPrice", "maxPrice", "currency", "startDate", "endDate", "quantity", "vehicleType", "transmission", "fuelType", "seats", "driverAge", "serviceMode"];
  const pageSize = 24;
  let page = 0;
  let hasMore = false;
  let items = [];
  let availabilityResults = {};
  let availabilityRun = 0;
  let requestRun = 0;
  let listController = null;
  let suggestionTimer = 0;
  let suggestionController = null;
  const filterState = Object.fromEntries(filterKeys.map((key) => [key, params.get(key) || ""]));
  filterState.sort = params.get("sort") || (query ? "relevance" : "newest");

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
    availabilityRun += 1;
    availabilityResults = {};
    const checkButton = document.querySelector("#check-bundle-availability");
    if (checkButton) checkButton.disabled = false;
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

  function subtotalFor(item, startDate, endDate) {
    return window.LockdRentalPricing?.estimateRentalSubtotal({
      amount: item.priceAmount,
      currency: item.currency,
      unit: item.priceUnit,
      quantity: Number(item.quantity || 1),
      startDate,
      endDate,
    }) || null;
  }

  async function checkBundleAvailability() {
    const button = document.querySelector("#check-bundle-availability");
    const output = document.querySelector("#bundle-availability-status");
    const startDate = document.querySelector("#bundle-start")?.value || "";
    const endDate = document.querySelector("#bundle-end")?.value || "";
    if (!bundle.items.length) {
      output.textContent = "Add at least one published rental to check availability.";
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || endDate <= startDate) {
      output.textContent = "Choose a valid start and end date before checking the bundle.";
      return;
    }

    const run = ++availabilityRun;
    button.disabled = true;
    output.textContent = "Checking the availability calendar for each rental…";
    availabilityResults = Object.fromEntries(bundle.items.map((item) => [item.id, "Checking…"]));
    renderBundle();
    const checked = await Promise.all(bundle.items.map(async (item) => {
      try {
        const response = await fetch("/api/availability", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ listingId: item.id, startDate, endDate, quantity: Number(item.quantity || 1) }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) return { id: item.id, result: "Could not confirm" };
        return { id: item.id, result: result.available === true ? "Available for selected dates" : "Not available for selected dates" };
      } catch {
        return { id: item.id, result: "Could not confirm" };
      }
    }));
    if (run !== availabilityRun) return;
    availabilityResults = Object.fromEntries(checked.map(({ id, result }) => [id, result]));
    const available = checked.filter(({ result }) => result === "Available for selected dates").length;
    const failed = checked.filter(({ result }) => result === "Could not confirm").length;
    output.textContent = failed
      ? `Availability could not be confirmed for ${failed} ${failed === 1 ? "rental" : "rentals"}. Nothing has been reserved.`
      : available === checked.length
        ? "The calendar shows every selected rental as available. Nothing has been reserved."
        : `${checked.length - available} ${checked.length - available === 1 ? "rental is" : "rentals are"} unavailable for these dates. Nothing has been reserved.`;
    button.disabled = false;
    renderBundle();
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
    const returnUrl = new URL(window.location.href);
    returnUrl.hash = "listing-grid";
    url.searchParams.set("returnTo", `${returnUrl.pathname}${returnUrl.search}${returnUrl.hash}`);
    if (filterState.startDate) url.searchParams.set("startDate", filterState.startDate);
    if (filterState.endDate) url.searchParams.set("endDate", filterState.endDate);
    if (Number(filterState.quantity || 1) > 1) url.searchParams.set("quantity", filterState.quantity);
    return url.toString();
  }

  function makeCard(listing, index) {
    const article = document.createElement("article");
    article.className = "listing-card";
    article.dataset.listingId = listing.id;
    article.dataset.category = typeof listing.category === "string" ? listing.category : "";
    article.style.setProperty("--motion-delay", `${Math.min(index % 6, 5) * 32}ms`);
    const detailsUrl = linkToListing(listing);
    const imageLink = document.createElement("a");
    imageLink.className = "listing-card-image";
    imageLink.href = detailsUrl;
    imageLink.setAttribute("aria-label", `View ${listing.title}`);
    const imageUrl = safeImageUrl(Array.isArray(listing.images) ? listing.images[0] : listing.cover_image);
    const fallback = !imageUrl ? window.LockdPhotoFallbacks?.forListing(listing) : null;
    if (imageUrl || fallback) {
      const image = document.createElement("img");
      image.src = imageUrl || fallback.src;
      image.alt = imageUrl ? (typeof listing.image_alt === "string" ? listing.image_alt : listing.title) : fallback.alt;
      image.loading = "lazy";
      imageLink.append(image);
      if (!imageUrl && fallback.note) {
        const note = document.createElement("span");
        note.className = "listing-image-note";
        note.textContent = fallback.note;
        imageLink.append(note);
      }
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
    const dateChecked = Boolean(filterState.startDate && filterState.endDate);
    statusText.textContent = listing.requires_approval ? "Enquiry required" : dateChecked ? "Available for selected dates" : "Check dates";
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

    if (listing.category === "drive") {
      const attributes = listing.attributes && typeof listing.attributes === "object" ? listing.attributes : {};
      const facts = document.createElement("div");
      facts.className = "listing-card-facts";
      const specs = [
        [attributes.seating_capacity, "seats"],
        [attributes.transmission && attributes.transmission.replaceAll("_", " "), ""],
        [attributes.fuel_type && attributes.fuel_type.replaceAll("_", " "), ""],
        [attributes.service_mode && attributes.service_mode.replaceAll("_", " "), ""],
      ].filter(([value]) => value !== undefined && value !== null && value !== "").map(([value, suffix]) => `${value}${suffix ? ` ${suffix}` : ""}`);
      specs.slice(0, 4).forEach((spec) => {
        const item = document.createElement("span"); item.textContent = spec; facts.append(item);
      });
      if (specs.length) article.append(facts);
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
    viewLink.textContent = listing.category === "drive" ? "View vehicle" : "View rental";
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
        deliveryAvailable: listing.delivery_available,
        collectionAvailable: listing.collection_available,
      });
    }
    const selected = bundle.items.find((item) => item.id === listing.id);
    if (selected) {
      selected.priceAmount = listing.price_amount;
      selected.currency = listing.currency;
      selected.priceUnit = listing.price_unit;
      selected.deliveryAvailable = listing.delivery_available;
      selected.collectionAvailable = listing.collection_available;
    }
    saveBundle();
    if (button) {
      button.textContent = "In your bundle";
      button.setAttribute("aria-pressed", "true");
      animateClass(button, "is-feedback", 260);
    }
  }

  function animateClass(element, className, duration = 240) {
    if (!element) return;
    element.classList.remove(className);
    requestAnimationFrame(() => element.classList.add(className));
    window.setTimeout(() => element.classList.remove(className), duration);
  }

  function removeBundleItem(itemId, row) {
    const remove = () => {
      bundle.items = bundle.items.filter((item) => item.id !== itemId);
      saveBundle();
    };
    if (!row || window.matchMedia("(prefers-reduced-motion: reduce)").matches || row.classList.contains("is-removing")) {
      remove();
      return;
    }
    row.classList.add("is-removing");
    row.setAttribute("aria-busy", "true");
    let removed = false;
    const finish = () => {
      if (removed) return;
      removed = true;
      remove();
    };
    row.addEventListener("transitionend", finish, { once: true });
    window.setTimeout(finish, 240);
  }

  function renderBundle() {
    const lines = document.querySelector("#bundle-lines");
    if (!panel || !lines) return;
    const previousRows = new Map([...lines.querySelectorAll(".bundle-line")].map((row) => [row.dataset.itemId, Number(row.dataset.quantity || 1)]));
    const summaryCount = document.querySelector("#bundle-count");
    const summaryPrice = document.querySelector("#bundle-price");
    const previousCount = summaryCount?.textContent || "";
    const previousPrice = summaryPrice?.textContent || "";
    const wasHidden = panel.hidden;
    panel.hidden = !bundleMode && bundle.items.length === 0;
    if (wasHidden && !panel.hidden) {
      panel.classList.remove("is-entering");
      requestAnimationFrame(() => panel.classList.add("is-entering"));
      window.setTimeout(() => panel.classList.remove("is-entering"), 280);
    }
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
      row.dataset.itemId = item.id;
      row.dataset.quantity = String(Number(item.quantity || 1));
      const priorQuantity = previousRows.get(item.id);
      if (priorQuantity === undefined) row.dataset.motion = "added";
      else if (priorQuantity !== Number(item.quantity || 1)) row.dataset.motion = "changed";
      const name = document.createElement("div");
      name.className = "bundle-line-name";
      name.textContent = item.title;
      const price = document.createElement("div");
      price.className = "bundle-line-price";
      const estimate = bundle.startDate && bundle.endDate && bundle.endDate > bundle.startDate
        ? subtotalFor(item, bundle.startDate, bundle.endDate)
        : null;
      price.textContent = estimate
        ? `${priceText(item.priceAmount, item.currency, item.priceUnit)} · ${priceText(estimate.amount, estimate.currency, "")} estimated`
        : priceText(item.priceAmount, item.currency, item.priceUnit);
      const availability = document.createElement("p");
      availability.className = "bundle-line-availability";
      availability.textContent = availabilityResults[item.id] || "Availability not checked";
      const controls = document.createElement("div");
      controls.className = "bundle-line-controls";
      const decrease = document.createElement("button");
      decrease.type = "button";
      decrease.textContent = "−";
      decrease.setAttribute("aria-label", `Reduce ${item.title} quantity`);
      decrease.addEventListener("click", () => {
        if (Number(item.quantity || 1) <= 1) {
          removeBundleItem(item.id, row);
          return;
        }
        item.quantity = Number(item.quantity) - 1;
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
      remove.addEventListener("click", () => removeBundleItem(item.id, row));
      row.append(name, controls, price, availability, remove);
      lines.append(row);
    });

    const count = summaryCount;
    const price = summaryPrice;
    if (count) count.textContent = String(bundle.items.reduce((sum, item) => sum + Number(item.quantity || 1), 0));
    if (price) {
      const datesValid = /^\d{4}-\d{2}-\d{2}$/.test(bundle.startDate) && /^\d{4}-\d{2}-\d{2}$/.test(bundle.endDate) && bundle.endDate > bundle.startDate;
      if (!bundle.items.length) price.textContent = "No rentals selected";
      else if (!datesValid) price.textContent = "Choose dates for an estimate";
      else {
        const totals = new Map();
        let unpriced = 0;
        bundle.items.forEach((item) => {
          const estimate = subtotalFor(item, bundle.startDate, bundle.endDate);
          if (!estimate) { unpriced += 1; return; }
          totals.set(estimate.currency, (totals.get(estimate.currency) || 0) + estimate.amount);
        });
        const summary = [...totals].map(([currency, amount]) => `${priceText(amount, currency, "")} estimated`).join(" + ");
        const unpricedLabel = unpriced ? `${unpriced} ${unpriced === 1 ? "rental needs" : "rentals need"} owner pricing/term confirmation` : "";
        price.textContent = [summary, unpricedLabel].filter(Boolean).join(" · ") || "Rates need confirmation";
      }
    }
    if (count && previousCount !== count.textContent) animateClass(count, "is-updating");
    if (price && previousPrice !== price.textContent) animateClass(price, "is-updating");
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
        field.value = bundle[key] || "";
        field.oninput = () => { bundle[key] = field.value; saveBundle(); };
      }
    });
    const start = document.querySelector("#bundle-start");
    const end = document.querySelector("#bundle-end");
    if (start && end) {
      const today = new Date();
      const localToday = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
      start.min = localToday;
      end.min = start.value || localToday;
      start.oninput = () => { end.min = start.value || localToday; bundle.startDate = start.value; saveBundle(); };
      end.oninput = () => { bundle.endDate = end.value; saveBundle(); };
    }
    const delivery = document.querySelector("#bundle-delivery")?.value;
    const deliveryStatus = document.querySelector("#bundle-delivery-note");
    if (delivery && bundle.items.some((item) => item[delivery === "delivery" ? "deliveryAvailable" : "collectionAvailable"] === false)) {
      deliveryStatus.textContent = `One or more rentals do not offer ${delivery}. Choose another option or confirm with the owner.`;
    } else if (delivery && bundle.items.some((item) => item[delivery === "delivery" ? "deliveryAvailable" : "collectionAvailable"] !== true)) {
      deliveryStatus.textContent = `Confirm ${delivery} with the owner for any rental without a published service setting.`;
    } else {
      deliveryStatus.textContent = "";
    }
    const availabilityStatus = document.querySelector("#bundle-availability-status");
    if (!bundle.items.some((item) => availabilityResults[item.id])) availabilityStatus.textContent = "";
  }

  async function loadListings({ append = false } = {}) {
    if (!append) {
      listController?.abort();
      listController = new AbortController();
    }
    const run = ++requestRun;
    status.dataset.kind = "loading";
    status.textContent = "Loading published rentals…";
    loadMoreButton.hidden = true;
    const retryButton = document.querySelector("#catalogue-retry");
    if (retryButton) retryButton.hidden = true;
    if (!append) renderLoadingSkeletons();
    const nextPage = append ? page + 1 : 0;
    const apiUrl = new URL("/api/listings", window.location.origin);
    if (category) apiUrl.searchParams.set("category", category);
    if (query) apiUrl.searchParams.set("q", query);
    if (locationQuery) apiUrl.searchParams.set("location", locationQuery);
    filterKeys.forEach((key) => { if (filterState[key]) apiUrl.searchParams.set(key, filterState[key]); });
    apiUrl.searchParams.set("page", String(nextPage));
    apiUrl.searchParams.set("sort", filterState.sort || (query ? "relevance" : "newest"));
    try {
      const response = await fetch(apiUrl, { headers: { Accept: "application/json" }, cache: "no-store", signal: listController?.signal });
      const data = await response.json().catch(() => ({}));
      if (run !== requestRun) return;
      if (!response.ok) {
        if (response.status === 503 || data.error === "catalogue_not_configured") {
          throw new Error("The live catalogue is not connected yet. Add the Supabase project URL and anon key to the Vercel environment, then apply the catalogue migration.");
        }
        throw new Error(data.message || "The rental catalogue could not be loaded. Please try again shortly.");
      }
      const loadedItems = Array.isArray(data.items) ? data.items : [];
      if (retryButton) retryButton.hidden = true;
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
      const totalLabel = Number.isInteger(data.total) ? data.total : items.length;
      const countSuffix = Number.isInteger(data.total) ? "" : hasMore ? "+" : "";
      if (resultCount) resultCount.textContent = `${totalLabel}${countSuffix} published ${totalLabel === 1 ? "rental" : "rentals"}`;
      const vehicleCount = document.querySelector("#vehicle-result-count");
      if (vehicleCount) vehicleCount.textContent = category === "drive" ? (items.length ? `${totalLabel}${countSuffix} published ${totalLabel === 1 ? "vehicle" : "vehicles"}` : "") : "";
      if (items.length === 0) {
        status.dataset.kind = "empty";
        status.textContent = `No listings matched your search. Try a different location, category, date, or price range${category === "drive" ? ", or browse the drive edit below" : ""}.`;
      } else {
        status.dataset.kind = "loaded";
        status.textContent = filterState.startDate && filterState.endDate
          ? "Published listings with calendar capacity for the selected dates. Check availability again before contacting the owner."
          : "Only published, approved listings appear here. Choose dates to check calendar capacity.";
      }
      loadMoreButton.hidden = !hasMore;
    } catch (error) {
      if (error.name === "AbortError" || run !== requestRun) return;
      if (!append) grid.replaceChildren();
      status.dataset.kind = "error";
      status.textContent = error.message || "The rental catalogue is temporarily unavailable.";
      if (retryButton) retryButton.hidden = false;
      const resultCount = document.querySelector("#result-count");
      if (resultCount) resultCount.textContent = "";
    }
  }

  function renderLoadingSkeletons() {
    if (!grid) return;
    const fragments = Array.from({ length: 6 }, () => {
      const card = document.createElement("article");
      card.className = "listing-skeleton";
      card.setAttribute("aria-hidden", "true");
      card.innerHTML = "<span class=\"skeleton-image\"></span><span class=\"skeleton-line skeleton-short\"></span><span class=\"skeleton-line\"></span><span class=\"skeleton-line skeleton-price\"></span>";
      return card;
    });
    grid.replaceChildren(...fragments);
  }

  function syncSearchUi() {
    const current = new URLSearchParams(window.location.search);
    category = current.get("category") || "";
    query = current.get("q") || "";
    locationQuery = current.get("location") || "";
    filterKeys.forEach((key) => { filterState[key] = current.get(key) || ""; });
    filterState.sort = current.get("sort") || (query ? "relevance" : "newest");
    if (categorySelect) categorySelect.value = category;
    if (searchInput) searchInput.value = query;
    if (locationInput) locationInput.value = locationQuery;
    filterIds.forEach((id, index) => {
      const field = document.getElementById(id);
      if (field) field.value = filterState[filterKeys[index]] || (filterKeys[index] === "quantity" ? "1" : "");
    });
    if (sortSelect) sortSelect.value = filterState.sort;
    const isDrive = category === "drive";
    document.querySelector("#vehicle-hero").hidden = !isDrive;
    document.querySelector("#catalogue-intro").hidden = isDrive;
    document.querySelector("#vehicle-filters").hidden = !isDrive;
    document.querySelector("#vehicle-photo-guide").hidden = !isDrive;
    document.querySelector("#catalogue-breadcrumb").textContent = isDrive ? "Cars & Mobility" : "Rentals";
    const destinationNote = document.querySelector("#destination-filter-note");
    if (destinationNote) {
      destinationNote.hidden = !locationQuery || isDrive;
      destinationNote.textContent = locationQuery ? `Showing published LOCKD listings in ${locationQuery}.` : "";
    }
    document.querySelectorAll("[data-filter]").forEach((link) => {
      const isCurrent = (link.dataset.filter === "all" && !category) || link.dataset.filter === category;
      if (isCurrent) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
      const nextUrl = new URL(link.getAttribute("href"), window.location.href);
      if (query) nextUrl.searchParams.set("q", query);
      if (locationQuery) nextUrl.searchParams.set("location", locationQuery);
      if (bundleMode) nextUrl.searchParams.set("bundle", "1");
      link.href = nextUrl.href;
    });
  }

  function readFormState({ querySortDefault = false } = {}) {
    category = categorySelect?.value || "";
    query = searchInput?.value.trim() || "";
    locationQuery = locationInput?.value.trim() || "";
    filterIds.forEach((id, index) => {
      const field = document.getElementById(id);
      filterState[filterKeys[index]] = field?.value.trim() || "";
    });
    const selectedSort = sortSelect?.value || "newest";
    if ((filterState.minPrice || filterState.maxPrice || selectedSort === "price-low" || selectedSort === "price-high") && !filterState.currency) {
      filterState.currency = "KES";
      const currency = document.querySelector("#catalogue-currency");
      if (currency) currency.value = "KES";
    }
    const defaultSearchSort = querySortDefault && query && !new URLSearchParams(window.location.search).has("sort") && selectedSort === "newest";
    filterState.sort = defaultSearchSort ? "relevance" : selectedSort;
    if (defaultSearchSort && sortSelect) sortSelect.value = "relevance";
  }

  function saveSearchState({ replace = false } = {}) {
    const next = new URL("rentals.html", window.location.href);
    if (category) next.searchParams.set("category", category);
    if (query) next.searchParams.set("q", query);
    if (locationQuery) next.searchParams.set("location", locationQuery);
    filterKeys.forEach((key) => { if (filterState[key] && !(key === "quantity" && filterState[key] === "1")) next.searchParams.set(key, filterState[key]); });
    if (filterState.sort && filterState.sort !== (query ? "relevance" : "newest")) next.searchParams.set("sort", filterState.sort);
    if (bundleMode) next.searchParams.set("bundle", "1");
    window.history[replace ? "replaceState" : "pushState"]({}, "", next.href);
    syncSearchUi();
    page = 0;
    loadListings();
  }

  if (searchForm) searchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    readFormState({ querySortDefault: true });
    if ((filterState.startDate && !filterState.endDate) || (!filterState.startDate && filterState.endDate) || (filterState.startDate && filterState.endDate && filterState.endDate <= filterState.startDate)) {
      document.querySelector("#catalogue-end-date")?.setCustomValidity("Choose an end date after the start date.");
      document.querySelector("#catalogue-end-date")?.reportValidity();
      document.querySelector("#catalogue-end-date")?.addEventListener("input", (event) => event.currentTarget.setCustomValidity(""), { once: true });
      return;
    }
    document.querySelector("#catalogue-end-date")?.setCustomValidity("");
    saveSearchState();
  });
  if (sortSelect) sortSelect.addEventListener("change", () => { readFormState(); saveSearchState(); });
  document.querySelector("#catalogue-retry")?.addEventListener("click", () => { page = 0; loadListings(); });
  document.querySelector("#catalogue-clear")?.addEventListener("click", () => {
    category = ""; query = ""; locationQuery = "";
    filterKeys.forEach((key) => { filterState[key] = ""; });
    filterState.quantity = "1"; filterState.sort = "newest";
    if (searchForm) searchForm.reset();
    if (sortSelect) sortSelect.value = "newest";
    saveSearchState();
  });
  document.querySelectorAll("[data-filter]").forEach((link) => link.addEventListener("click", (event) => {
    event.preventDefault();
    if (link.dataset.filter === "stay") {
      const target = new URL("rooms.html", window.location.href);
      if (query) target.searchParams.set("q", query);
      if (locationQuery) target.searchParams.set("location", locationQuery);
      window.location.assign(target.href);
      return;
    }
    category = link.dataset.filter === "all" ? "" : link.dataset.filter;
    if (category !== "drive") ["vehicleType", "transmission", "fuelType", "seats", "driverAge", "serviceMode"].forEach((key) => { filterState[key] = ""; });
    if (categorySelect) categorySelect.value = category;
    saveSearchState();
  }));
  window.addEventListener("popstate", () => { syncSearchUi(); page = 0; loadListings(); });
  if (searchInput) searchInput.addEventListener("input", () => {
    window.clearTimeout(suggestionTimer);
    suggestionController?.abort();
    const term = searchInput.value.trim();
    const list = document.querySelector("#catalogue-suggestions");
    if (!list || term.length < 2) { list?.replaceChildren(); return; }
    suggestionTimer = window.setTimeout(async () => {
      const controller = new AbortController();
      suggestionController = controller;
      const url = new URL("/api/listings", window.location.origin);
      url.searchParams.set("q", term);
      if (categorySelect?.value) url.searchParams.set("category", categorySelect.value);
      try {
        const response = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store", signal: controller.signal });
        if (!response.ok) return;
        const data = await response.json();
        const titles = [...new Set((Array.isArray(data.items) ? data.items : []).map((item) => item.title).filter((title) => typeof title === "string"))].slice(0, 8);
        list.replaceChildren(...titles.map((title) => Object.assign(document.createElement("option"), { value: title })));
      } catch { /* Suggestions are optional; exact catalogue search remains available. */ }
    }, 320);
  });
  if (loadMoreButton) loadMoreButton.addEventListener("click", () => loadListings({ append: true }));
  document.querySelector("#clear-bundle")?.addEventListener("click", () => {
    bundle = { items: [], startDate: "", endDate: "", delivery: "", extras: "" };
    document.querySelector("#bundle-availability-status").textContent = "";
    saveBundle();
    grid.querySelectorAll(".bundle-add").forEach((button) => {
      button.textContent = "Add to bundle";
      button.setAttribute("aria-pressed", "false");
    });
  });

  document.querySelector("#check-bundle-availability")?.addEventListener("click", checkBundleAvailability);

  renderBundle();
  syncSearchUi();
  loadListings();
})();
