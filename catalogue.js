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
  const locationQuery = params.get("location") || "";
  const bundleMode = params.get("bundle") === "1";
  const grid = document.querySelector("#listing-grid");
  const status = document.querySelector("#catalogue-status");
  const panel = document.querySelector("#bundle-panel");
  const loadMoreButton = document.querySelector("#load-more");
  const searchForm = document.querySelector("#catalogue-search-form");
  const searchInput = document.querySelector("#catalogue-search");
  const locationInput = document.querySelector("#catalogue-location");
  const sortSelect = document.querySelector("#catalogue-sort");
  const pageSize = 24;
  let page = 0;
  let hasMore = false;
  let items = [];
  let availabilityResults = {};
  let availabilityRun = 0;

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
    return url.toString();
  }

  function makeCard(listing, index) {
    const article = document.createElement("article");
    article.className = "listing-card";
    article.dataset.listingId = listing.id;
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
      button.classList.add("is-feedback");
      window.setTimeout(() => button.classList.remove("is-feedback"), 260);
    }
  }

  function renderBundle() {
    const lines = document.querySelector("#bundle-lines");
    if (!panel || !lines) return;
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
      row.append(name, controls, price, availability, remove);
      lines.append(row);
    });

    const count = document.querySelector("#bundle-count");
    const price = document.querySelector("#bundle-price");
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
    status.dataset.kind = "loading";
    status.textContent = "Loading published rentals…";
    loadMoreButton.hidden = true;
    const nextPage = append ? page + 1 : 0;
    const apiUrl = new URL("/api/listings", window.location.origin);
    if (category) apiUrl.searchParams.set("category", category);
    if (query) apiUrl.searchParams.set("q", query);
    if (locationQuery) apiUrl.searchParams.set("location", locationQuery);
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
        status.textContent = locationQuery
          ? `No published rentals are listed for ${locationQuery} yet. Try another location or browse all rentals.`
          : query
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
  if (locationQuery && locationInput) locationInput.value = locationQuery;
  const destinationNote = document.querySelector("#destination-filter-note");
  if (locationQuery && destinationNote) {
    destinationNote.hidden = false;
    destinationNote.textContent = `Showing published LOCKD rentals near ${locationQuery}. Destination photos are editorial references, not bookable listings.`;
  }
  const vehicleGuide = document.querySelector("#vehicle-photo-guide");
  if (vehicleGuide) vehicleGuide.hidden = category !== "drive";
  document.querySelectorAll("[data-filter]").forEach((link) => {
    const nextUrl = new URL(link.href, window.location.href);
    if (query) nextUrl.searchParams.set("q", query);
    if (locationQuery) nextUrl.searchParams.set("location", locationQuery);
    if (bundleMode) nextUrl.searchParams.set("bundle", "1");
    link.href = nextUrl.href;
  });
  if (searchForm && searchInput) {
    searchForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const url = new URL("rentals.html", window.location.href);
      const nextQuery = searchInput.value.trim();
      if (category) url.searchParams.set("category", category);
      if (nextQuery) url.searchParams.set("q", nextQuery);
      const nextLocation = locationInput?.value.trim() || "";
      if (nextLocation) url.searchParams.set("location", nextLocation);
      if (bundleMode) url.searchParams.set("bundle", "1");
      window.location.assign(url.href);
    });
  }
  if (sortSelect) sortSelect.addEventListener("change", () => { page = 0; loadListings(); });
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
  loadListings();
})();
