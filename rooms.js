(() => {
  const form = document.querySelector("#room-search-form");
  const status = document.querySelector("#room-results-status");
  const grid = document.querySelector("#room-results-grid");
  const count = document.querySelector("#room-result-count");
  const loadMoreButton = document.querySelector("#room-load-more");
  const fields = {
    location: document.querySelector("#room-location"),
    startDate: document.querySelector("#room-checkin"),
    endDate: document.querySelector("#room-checkout"),
    adults: document.querySelector("#room-adults"),
    children: document.querySelector("#room-children"),
    rooms: document.querySelector("#room-count"),
    propertyType: document.querySelector("#room-property-type"),
    amenity: document.querySelector("#room-amenity"),
    minPrice: document.querySelector("#room-min-price"),
    maxPrice: document.querySelector("#room-max-price"),
  };
  const initial = new URLSearchParams(location.search);
  let activeFilters = {};
  let page = 0;
  let loadedCount = 0;
  let hasMore = false;
  Object.entries(fields).forEach(([key, field]) => { if (initial.has(key)) field.value = initial.get(key); });
  const quantity = initial.get("quantity");
  if (quantity) fields.rooms.value = quantity;
  const today = new Date();
  const todayText = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  fields.startDate.min = todayText;
  fields.endDate.min = fields.startDate.value || todayText;
  fields.startDate.addEventListener("change", () => { fields.endDate.min = fields.startDate.value || todayText; });

  function validRange() {
    return /^\d{4}-\d{2}-\d{2}$/.test(fields.startDate.value)
      && /^\d{4}-\d{2}-\d{2}$/.test(fields.endDate.value)
      && fields.endDate.value > fields.startDate.value
      && Number(fields.adults.value) >= 1
      && Number(fields.children.value) >= 0
      && Number(fields.adults.value) + Number(fields.children.value) <= 20
      && Number(fields.rooms.value) >= 1
      && Number(fields.rooms.value) <= 20
      && (!fields.minPrice.value || (Number.isFinite(Number(fields.minPrice.value)) && Number(fields.minPrice.value) >= 0 && Number(fields.minPrice.value) <= 100000000))
      && (!fields.maxPrice.value || (Number.isFinite(Number(fields.maxPrice.value)) && Number(fields.maxPrice.value) >= 0 && Number(fields.maxPrice.value) <= 100000000))
      && (!fields.minPrice.value || !fields.maxPrice.value || Number(fields.minPrice.value) <= Number(fields.maxPrice.value));
  }

  function money(value, currency) {
    try { return new Intl.NumberFormat("en-KE", { style: "currency", currency, maximumFractionDigits: 0 }).format(value); }
    catch { return `${currency} ${Number(value).toLocaleString("en-KE")}`; }
  }

  function listingUrl(listing, filters) {
    const url = new URL("rental.html", window.location.href);
    url.searchParams.set("slug", listing.slug);
    url.searchParams.set("from", "stay");
    if (filters.startDate) url.searchParams.set("startDate", filters.startDate);
    if (filters.endDate) url.searchParams.set("endDate", filters.endDate);
    if (filters.rooms) url.searchParams.set("quantity", filters.rooms);
    if (filters.adults) url.searchParams.set("adults", filters.adults);
    if (filters.children) url.searchParams.set("children", filters.children);
    url.searchParams.set("returnTo", `${window.location.pathname}${window.location.search}`);
    return url.href;
  }

  function makeCard(listing, filters) {
    const card = document.createElement("article");
    card.className = "room-result-card";
    const link = document.createElement("a");
    link.className = "room-result-image";
    link.href = listingUrl(listing, filters);
    const ownerImage = Array.isArray(listing.images) && listing.images.length ? listing.images[0] : listing.cover_image;
    const fallback = !ownerImage ? window.LockdPhotoFallbacks?.forListing(listing) : null;
    if (ownerImage || fallback) {
      const image = document.createElement("img");
      image.src = ownerImage || fallback.src;
      image.alt = ownerImage ? (listing.image_alt || listing.title) : fallback.alt;
      image.loading = "lazy";
      link.append(image);
      if (!ownerImage && fallback.note) {
        const note = document.createElement("span");
        note.className = "room-result-image-note";
        note.textContent = fallback.note;
        link.append(note);
      }
    }
    card.append(link);
    const saveButton = window.LockdAccount?.createFavoriteButton(listing, { className: "listing-save" });
    if (saveButton) card.append(saveButton);
    const meta = document.createElement("div");
    meta.className = "room-result-meta";
    const attrs = listing.attributes && typeof listing.attributes === "object" ? listing.attributes : {};
    const type = String(attrs.property_type || "Stay").replaceAll("_", " ");
    meta.innerHTML = "";
    const typeLabel = document.createElement("span"); typeLabel.textContent = type;
    const availabilityLabel = document.createElement("span"); availabilityLabel.textContent = filters.startDate ? "Dates checked" : "Select dates";
    meta.append(typeLabel, availabilityLabel); card.append(meta);
    const title = document.createElement("h3"); title.textContent = listing.title; card.append(title);
    const place = document.createElement("p"); place.className = "room-result-location"; place.textContent = listing.location_label || "Location to be confirmed"; card.append(place);
    const facts = document.createElement("p"); facts.className = "room-result-facts";
    const guests = Number(attrs.max_guests || 0);
    const bedroomCount = Number(attrs.bedrooms || 0);
    const bathrooms = Number(attrs.bathrooms || 0);
    [guests ? `Up to ${guests} guests` : "Guest capacity on listing", bedroomCount ? `${bedroomCount} bedrooms` : "", bathrooms ? `${bathrooms} bathrooms` : ""].filter(Boolean).forEach((text) => { const span = document.createElement("span"); span.textContent = text; facts.append(span); });
    card.append(facts);
    const price = document.createElement("p"); price.className = "room-result-price";
    const amount = Number(listing.price_amount);
    if (Number.isFinite(amount) && amount > 0 && listing.currency && listing.price_unit === "night") {
      price.append(document.createTextNode(`${money(amount, listing.currency)} / night`));
      const basis = attrs.price_basis || attrs.pricing_basis;
      if (filters.startDate && filters.endDate > filters.startDate && (basis === "per_room_per_night" || (basis === "per_property_per_night" && Number(filters.rooms || 1) === 1))) {
        const nights = (Date.parse(`${filters.endDate}T00:00:00Z`) - Date.parse(`${filters.startDate}T00:00:00Z`)) / 86400000;
        const total = amount * nights * (basis === "per_room_per_night" ? Number(filters.rooms || 1) : 1);
        const sub = document.createElement("span"); sub.className = "room-result-total";
        sub.textContent = `Estimated ${nights} ${nights === 1 ? "night" : "nights"}${basis === "per_room_per_night" && Number(filters.rooms || 1) > 1 ? ` · ${filters.rooms} rooms` : ""} · ${money(total, listing.currency)} before additional fees`;
        price.append(sub);
      } else {
        const note = document.createElement("span"); note.className = "room-result-total";
        note.textContent = basis === "per_property_per_night" && Number(filters.rooms || 1) > 1
          ? "Rate is per property; confirm multi-room pricing with the host."
          : "Total depends on the listing’s confirmed room or property pricing basis.";
        price.append(note);
      }
    } else if (Number.isFinite(amount) && amount > 0 && listing.currency) {
      price.textContent = `${money(amount, listing.currency)} / ${listing.price_unit || "rental period"}`;
    } else price.textContent = "Price to be confirmed";
    card.append(price);
    const view = document.createElement("a"); view.className = "text-button"; view.href = listingUrl(listing, filters); view.textContent = "View room"; card.append(view);
    return card;
  }

  async function load(filters, requireDates, append = false) {
    status.dataset.kind = "loading";
    status.textContent = append ? "Loading more published stays…" : "Searching published stays…";
    if (!append) {
      page = 0;
      loadedCount = 0;
      grid.replaceChildren();
    } else page += 1;
    if (requireDates && !validRange()) {
      status.dataset.kind = "error";
      status.textContent = "Choose a valid date range, 1–20 guests, 1–20 rooms, and a valid KES price range.";
      if (!fields.startDate.value || !fields.endDate.value || fields.endDate.value <= fields.startDate.value) fields.endDate.focus();
      else if (fields.minPrice.value && fields.maxPrice.value && Number(fields.minPrice.value) > Number(fields.maxPrice.value)) fields.maxPrice.focus();
      return;
    }
    const url = new URL("/api/listings", window.location.origin);
    url.searchParams.set("category", "stay");
    url.searchParams.set("page", String(page));
    if (filters.location) url.searchParams.set("location", filters.location);
    if (filters.startDate && filters.endDate) {
      url.searchParams.set("startDate", filters.startDate);
      url.searchParams.set("endDate", filters.endDate);
      url.searchParams.set("quantity", filters.rooms || "1");
    }
    const guestCount = Number(filters.adults || 0) + Number(filters.children || 0);
    if (guestCount) url.searchParams.set("guests", String(guestCount));
    if (filters.rooms) url.searchParams.set("rooms", filters.rooms);
    if (filters.propertyType) url.searchParams.set("propertyType", filters.propertyType);
    if (filters.amenity) url.searchParams.set("amenity", filters.amenity);
    if (filters.minPrice || filters.maxPrice) {
      url.searchParams.set("currency", "KES");
      if (filters.minPrice) url.searchParams.set("minPrice", filters.minPrice);
      if (filters.maxPrice) url.searchParams.set("maxPrice", filters.maxPrice);
    }
    try {
      const response = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Published stays could not be loaded. Please try again.");
      const listings = Array.isArray(data.items) ? data.items : [];
      hasMore = data.hasMore === true;
      loadMoreButton.hidden = !hasMore;
      if (!listings.length) {
        count.textContent = `${loadedCount} published ${loadedCount === 1 ? "stay" : "stays"}`;
        if (append && loadedCount) {
          status.dataset.kind = "loaded";
          status.textContent = "You’ve reached the end of the published stays.";
          return;
        }
        status.dataset.kind = "empty";
        status.textContent = filters.startDate
          ? "No published stays match this location and date search. Try different dates or another area."
          : "There are no published stays to show yet. Check back after owners publish approved room listings.";
        return;
      }
      listings.forEach((listing) => grid.append(makeCard(listing, filters)));
      loadedCount += listings.length;
      count.textContent = `${loadedCount}${hasMore ? "+" : ""} published ${loadedCount === 1 ? "stay" : "stays"}`;
      status.dataset.kind = "loaded";
      status.textContent = filters.startDate
        ? "These published stays passed the calendar check for your selected dates. This check is not a reservation."
        : "Choose dates to check the listing calendars before viewing a stay.";
    } catch (error) {
      if (!append) count.textContent = "";
      status.dataset.kind = "error";
      status.textContent = error.message || "Published stays could not be loaded.";
      loadMoreButton.hidden = true;
    }
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!validRange()) {
      status.dataset.kind = "error";
      status.textContent = "Choose a valid date range, 1–20 guests, 1–20 rooms, and a valid KES price range.";
      fields.endDate.focus();
      return;
    }
    const next = new URL(window.location.href);
    next.search = "";
    Object.entries(fields).forEach(([key, field]) => { if (field.value) next.searchParams.set(key, field.value); });
    window.history.replaceState({}, "", next);
    activeFilters = Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, field.value]));
    load(activeFilters, true);
  });

  loadMoreButton.addEventListener("click", () => load(activeFilters, false, true));

  activeFilters = Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, field.value]));
  load(activeFilters, Boolean(initial.has("startDate") || initial.has("endDate")));
})();
