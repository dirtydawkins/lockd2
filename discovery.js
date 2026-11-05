(() => {
  const feed = document.querySelector("#discover-feed");
  if (!feed) return;

  const categories = {
    stay: "Accommodation", drive: "Cars & Mobility", play: "Gaming", technology: "Technology",
    experience: "Experiences", camera: "Cameras", phone: "Phones", laptop: "Computers",
    audio: "Audio", creative: "Creator equipment", other: "Other rentals",
  };
  const manualLocationKey = "lockd:preferred-locality:v1";
  const radiusOptions = [10, 25, 50, 100];
  const marketGroups = [
    { key: "drive", title: "Cars nearby", category: "drive" },
    { key: "stay", title: "Places to stay", category: "stay" },
    { key: "technology", title: "Tech & gaming nearby", market: "tech" },
    { key: "experience", title: "Experiences to explore", category: "experience" },
  ];
  const $ = (selector) => document.querySelector(selector);
  const dialog = $("#location-dialog");
  const status = $("#discovery-feed-status");
  const filters = $("#discovery-filters");
  const locationLabel = $("#discovery-location-label");
  const locationDialogStatus = $("#location-dialog-status");
  const manualForm = $("#manual-location-form");
  const manualInput = $("#manual-location-input");
  const startDate = $("#discovery-start-date");
  const endDate = $("#discovery-end-date");
  let pageRun = 0;
  let radiusIndex = 0;
  let location = null;
  let approximateArea = null;
  let locationCleared = readAreaCookie()?.anywhere===true;
  const isPointLocation = (area=location) => area && Number.isFinite(area.latitude) && Number.isFinite(area.longitude);
  let activeController = null;
  const mapIsActive = () => feed.dataset.discoveryView === "map" || (!feed.dataset.discoveryView && new URLSearchParams(window.location.search).get("discoveryView") === "map");
  const boundedSignal = signal => signal ? AbortSignal.any([signal, AbortSignal.timeout(12000)]) : AbortSignal.timeout(12000);
  let lastFeed = null;
  let pageState = {};
  const pageButtons = { nearby: "#load-more-nearby", available: "#load-more-available", recent: "#load-more-recent" };
  const busyPages = new Set();

  function readAreaCookie(){try{const value=document.cookie.split('; ').find(part=>part.startsWith('lockd_area='));if(!value)return null;const area=JSON.parse(decodeURIComponent(value.slice(11)));return area?.anywhere===true?{anywhere:true}:area&&/^[0-9a-f-]{36}$/i.test(area.id||'')&&typeof area.label==='string'&&area.label.length<=160?area:null;}catch{return null;}}
  function writeAreaCookie(area){try{const value=encodeURIComponent(JSON.stringify(area?.id&&area?.label?{id:area.id,label:area.label}:{anywhere:true}));document.cookie='lockd_area='+value+'; Path=/; SameSite=Lax; Max-Age=7776000'+(window.location.protocol==='https:'?'; Secure':'');}catch{/* Current discovery remains available when cookies are blocked. */}}
  function readManualLocation() {
    try {
      const area=readAreaCookie();if(area?.label)return area.label;if(area?.anywhere)return '';
      const value = localStorage.getItem(manualLocationKey);
      return typeof value === "string" && value.trim() ? value.trim().slice(0, 80) : "";
    } catch { return ""; }
  }

  let areaRestoreRun=0;
  function readSelectedPlaceId(){try{return readAreaCookie()?.id||localStorage.getItem("lockd:selected-place:v1")||"";}catch{return "";}}
  async function restoreSelectedPlace(id){const run=++areaRestoreRun;try{const response=await fetch("/api/listings?view=places&id="+encodeURIComponent(id),{cache:"no-store"});const data=await response.json();if(run===areaRestoreRun&&response.ok&&data.item){applyLocation({mode:"selected",...data.item});loadFeed();}}catch{/* Existing manual area remains usable. */}}

  function setStatus(message, kind = "") {
    status.textContent = message;
    if (kind) status.dataset.kind = kind;
    else delete status.dataset.kind;
  }

  function showManualFallback(message) {
    manualForm.hidden = false;
    locationDialogStatus.textContent = message;
    window.setTimeout(() => manualInput.focus(), 0);
  }

  function applyLocation(nextLocation, { save = false } = {}) {
    location = nextLocation;
    const clearButton = $("#clear-location");
    if (!nextLocation) {
      locationLabel.textContent = "Anywhere";
      clearButton.hidden = true;
    } else {
      locationLabel.textContent = ["manual","selected"].includes(nextLocation.mode)
        ? `${nextLocation.label} · selected area`
        : nextLocation.mode === "approximate" ? `${nextLocation.label} · nearby` : nextLocation.label || "Your current area";
      clearButton.hidden = false;
    }
    if (save) {
      writeAreaCookie(nextLocation);
      try {
        localStorage.removeItem(manualLocationKey);localStorage.removeItem('lockd:selected-place:v1');
        if(nextLocation?.id){let recent=[];try{recent=JSON.parse(localStorage.getItem("lockd:recent-places:v1")||'[]');}catch{}if(!Array.isArray(recent))recent=[];localStorage.setItem("lockd:recent-places:v1",JSON.stringify([{id:nextLocation.id,label:nextLocation.label},...recent.filter(item=>item?.id!==nextLocation.id)].slice(0,4)));}else localStorage.removeItem('lockd:recent-places:v1');
      } catch { /* The selected area still works for this page when storage is unavailable. */ }
    }
    const globalLocation = $("#idea-location");
    if (globalLocation) globalLocation.value = nextLocation?.label || "";
    document.querySelectorAll('[data-location-label]').forEach(el=>el.textContent=nextLocation?.label?.split(',')[0]||'Anywhere');
  }

  function filtersState({ includeDates = false } = {}) {
    return {
      category: $("#discovery-category").value,
      minPrice: $("#discovery-min-price").value,
      maxPrice: $("#discovery-max-price").value,
      startDate: includeDates ? startDate.value : "",
      endDate: includeDates ? endDate.value : "",
      quantity: $("#discovery-quantity").value || "1",
      guests: $("#discovery-guests").value,
    };
  }

  function paramsForList(values, { newest = false, page = 0 } = {}) {
    const params = new URLSearchParams({ page: String(page) });
    if (values.category) params.set("category", values.category);
    if (location?.mode === "manual") params.set("location", location.label);
    if (newest) params.set("sort", "newest");
    if (values.minPrice) params.set("minPrice", values.minPrice);
    if (values.maxPrice) params.set("maxPrice", values.maxPrice);
    if (values.startDate && values.endDate) {
      params.set("startDate", values.startDate);
      params.set("endDate", values.endDate);
      params.set("quantity", values.quantity);
    }
    if (values.guests && values.category === "stay") params.set("guests", values.guests);
    return params;
  }

  async function requestList(values, { category, market, dates = false, newest = false, page = 0, signal } = {}) {
    const listFilters = { ...values, category: category === undefined ? values.category : category };
    const params = paramsForList({ ...listFilters, ...(dates ? { startDate: values.startDate, endDate: values.endDate } : { startDate: "", endDate: "" }) }, { newest, page });
    params.delete("category");
    if (listFilters.category) params.set("category", listFilters.category);
    if (market) params.set("market", market);
    const response = await fetch(`/api/listings?${params}`, { headers: { Accept: "application/json" }, cache: "no-store", signal: boundedSignal(signal) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || "Listings could not be loaded right now.");
    return { items: Array.isArray(data.items) ? data.items : [], hasMore: data.hasMore === true, publicationTimestampReliable: data.publicationTimestampReliable === true };
  }

  async function requestNearby(values, { category, market, dates = false, radiusKm = 10, page = 0, signal } = {}) {
    const selected = { ...values, category: category === undefined ? values.category : category };
    const payload = {
      latitude: location.latitude,
      longitude: location.longitude,
      radiusKm,
      page,
      category: selected.category || "",
      market: market || "",
      minPrice: selected.minPrice || "",
      maxPrice: selected.maxPrice || "",
      currency: selected.minPrice || selected.maxPrice ? "KES" : "",
      guests: selected.guests && selected.category === "stay" ? selected.guests : "",
      ...(dates && selected.startDate && selected.endDate ? {
        startDate: selected.startDate,
        endDate: selected.endDate,
        quantity: selected.quantity || "1",
      } : {}),
    };
    const response = await fetch("/api/nearby", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: boundedSignal(signal),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.message || "Nearby listings could not be loaded right now.");
      error.code = data.error || "nearby_search_unavailable";
      throw error;
    }
    return { items: Array.isArray(data.items) ? data.items : [], hasMore: data.hasMore === true, total: Number(data.total || 0), radiusKm: Number(data.radiusKm || radiusKm) };
  }

  function safeImageUrl(value) {
    if (typeof value !== "string" || !value.trim()) return "";
    try {
      const url = new URL(value, window.location.origin);
      return url.protocol === "https:" || url.origin === window.location.origin ? url.href : "";
    } catch { return ""; }
  }

  function formatPrice(item) {
    if (item.price_amount === null || item.price_amount === undefined || !item.currency) return "Price to be confirmed";
    const amount = Number(item.price_amount);
    if (!Number.isFinite(amount) || amount < 0) return "Price to be confirmed";
    let value;
    try { value = new Intl.NumberFormat("en-KE", { style: "currency", currency: item.currency, maximumFractionDigits: 0 }).format(amount); }
    catch { value = `${item.currency} ${amount.toLocaleString("en-KE")}`; }
    const unit = { hour: "hour", day: "day", night: "night", week: "week", month: "month", trip: "trip" }[item.price_unit];
    return `${value}${unit ? ` / ${unit}` : ""}`;
  }

  function detailUrl(item) {
    const current = new URL(window.location.href);
    const target = new URL("rental.html", window.location.href);
    target.searchParams.set("slug", item.slug);
    target.searchParams.set("returnTo", `${current.pathname}${current.search}#discover-feed`);
    if (startDate.value && endDate.value) {
      target.searchParams.set("startDate", startDate.value);
      target.searchParams.set("endDate", endDate.value);
      target.searchParams.set("quantity", $("#discovery-quantity").value || "1");
    }
    return target.href;
  }

  function cardFor(item, index) {
    const article = document.createElement("article");
    article.className = "discovery-card";
    article.dataset.category = item.category || "";
    article.dataset.listingId = item.id || "";
    article.style.setProperty("--motion-delay", `${Math.min(index, 5) * 35}ms`);
    const imageLink = document.createElement("a");
    imageLink.className = "discovery-card-image";
    imageLink.href = detailUrl(item);
    imageLink.setAttribute("aria-label", `View ${item.title}`);
    const imageUrl = safeImageUrl(Array.isArray(item.images) ? item.images[0] : "");
    if (imageUrl) {
      const image = document.createElement("img");
      image.src = imageUrl;
      image.alt = item.image_alt || item.title || "Rental listing photograph";
      image.loading = "lazy";
      image.decoding = "async";
      window.LockdImages?.configure(image, item);
      image.addEventListener("error", () => {
        const fallback = document.createElement("span");
        fallback.className = "discovery-card-image-fallback";
        fallback.setAttribute("aria-hidden", "true");
        fallback.textContent = "LOCKD";
        image.replaceWith(fallback);
      }, { once: true });
      imageLink.append(image);
    } else {
      const fallback = document.createElement("span");
      fallback.className = "discovery-card-image-fallback";
      fallback.setAttribute("aria-hidden", "true");
      fallback.textContent = "LOCKD";
      imageLink.append(fallback);
    }
    article.append(imageLink);
    const saveButton = window.LockdAccount?.createFavoriteButton(item, { className: "listing-save" });
    if (saveButton) article.append(saveButton);
    const copy = document.createElement("div");
    copy.className = "discovery-card-copy";
    const meta = document.createElement("p");
    meta.className = "discovery-card-meta";
    const category = document.createElement("span");
    category.textContent = categories[item.category] || "Rental";
    meta.append(category);
    const distance = Number(item.distance_km);
    if (Number.isFinite(distance)) {
      const distanceLabel = document.createElement("span");
      distanceLabel.className = "discovery-distance";
      distanceLabel.textContent = distance < 1 ? "Under 1 km" : `About ${Math.round(distance)} km`;
      meta.append(distanceLabel);
    }
    const title = document.createElement("h4");
    const titleLink = document.createElement("a");
    titleLink.href = detailUrl(item);
    titleLink.textContent = item.title || "LOCKD rental";
    title.append(titleLink);
    copy.append(meta, title);
    if (item.location_label) {
      const place = document.createElement("p");
      place.className = "discovery-card-location";
      place.textContent = item.location_label;
      copy.append(place);
    }
    const price = document.createElement("p");
    price.className = "discovery-card-price";
    price.textContent = formatPrice(item);
    copy.append(price);
    const facts = [];
    const attrs = item.attributes && typeof item.attributes === "object" ? item.attributes : {};
    const type = item.category === "drive" ? attrs.vehicle_type : item.category === "stay" ? attrs.property_type : attrs.product_type;
    if (typeof type === "string" && type.trim()) facts.push(type.replace(/_/g, " "));
    if (item.category === "drive") {
      if (attrs.transmission) facts.push(String(attrs.transmission).replace(/_/g, " "));
      if (Number.isInteger(Number(attrs.seating_capacity)) && Number(attrs.seating_capacity) > 0) facts.push(`${attrs.seating_capacity} seats`);
    }
    if (facts.length) {
      const detail = document.createElement("p");
      detail.className = "discovery-card-facts";
      detail.textContent = facts.join(" · ");
      copy.append(detail);
    }
    article.append(copy);
    return article;
  }

  function renderGrid(host, items) {
    host.replaceChildren();
    host.append(...items.map(cardFor));
  }

  function appendGrid(host, items) {
    const known = new Set([...host.querySelectorAll("[data-listing-id]")].map((node) => node.dataset.listingId));
    items.filter((item) => item.id && !known.has(item.id)).forEach((item, index) => host.append(cardFor(item, index)));
  }

  function emptyMessage(host, message) {
    host.replaceChildren();
    const note = document.createElement("p");
    note.className = "discovery-empty";
    note.textContent = message;
    host.append(note);
  }

  function drawSkeletons(host, count = 3) {
    host.replaceChildren();
    for (let index = 0; index < count; index += 1) {
      const card = document.createElement("div");
      card.className = "discovery-skeleton";
      card.setAttribute("aria-hidden", "true");
      host.append(card);
    }
  }

  function updateShareUrl() {
    const values = filtersState({ includeDates: true });
    const next = new URL(window.location.href);
    ["category", "location", "place", "minPrice", "maxPrice", "startDate", "endDate", "quantity", "guests"].forEach((key) => next.searchParams.delete(key));
    if (values.category) next.searchParams.set("category", values.category);
    if (["manual","selected"].includes(location?.mode)) next.searchParams.set("location", location.label);
    if (location?.mode === "selected" && location.id) next.searchParams.set("place",location.id);
    if (values.minPrice) next.searchParams.set("minPrice", values.minPrice);
    if (values.maxPrice) next.searchParams.set("maxPrice", values.maxPrice);
    if (values.startDate && values.endDate) {
      next.searchParams.set("startDate", values.startDate);
      next.searchParams.set("endDate", values.endDate);
      if (values.quantity !== "1") next.searchParams.set("quantity", values.quantity);
    }
    if (values.guests && values.category === "stay") next.searchParams.set("guests", values.guests);
    const clean = `${next.pathname}${next.search}${next.hash}`;
    if (`${window.location.pathname}${window.location.search}${window.location.hash}` !== clean) history.pushState({}, "", clean);
  }

  function fillFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const rawLocation = params.get("location") || readManualLocation();
    areaRestoreRun++;
    const selectedId=params.has("location")?(params.get("place")||""):readSelectedPlaceId();
    if(selectedId && /^[0-9a-f-]{36}$/i.test(selectedId))restoreSelectedPlace(selectedId);
    const savedManual = rawLocation.length <= 160 && /^[\p{L}\p{N} .,&'()_-]+$/u.test(rawLocation) ? rawLocation.trim().replace(/\s+/g, " ") : "";
    applyLocation(savedManual ? { mode: "manual", label: savedManual } : null);
    const allowedCategory = params.get("category") || "";
    $("#discovery-category").value = Object.hasOwn(categories, allowedCategory) ? allowedCategory : "";
    $("#discovery-min-price").value = /^\d+(?:\.\d{1,2})?$/.test(params.get("minPrice") || "") ? params.get("minPrice") : "";
    $("#discovery-max-price").value = /^\d+(?:\.\d{1,2})?$/.test(params.get("maxPrice") || "") ? params.get("maxPrice") : "";
    startDate.value = /^\d{4}-\d{2}-\d{2}$/.test(params.get("startDate") || "") ? params.get("startDate") : "";
    endDate.value = /^\d{4}-\d{2}-\d{2}$/.test(params.get("endDate") || "") ? params.get("endDate") : "";
    $("#discovery-quantity").value = /^[1-9]\d?$/.test(params.get("quantity") || "") && Number(params.get("quantity")) <= 20 ? params.get("quantity") : "1";
    $("#discovery-guests").value = /^[1-9]\d?$/.test(params.get("guests") || "") && Number(params.get("guests")) <= 20 ? params.get("guests") : "";
    endDate.min = startDate.value || "";
  }

  async function loadFeed({ updateUrl = false } = {}) {
    const run = ++pageRun;
    activeController?.abort();
    activeController = new AbortController();
    const { signal } = activeController;
    const values = filtersState({ includeDates: true });
    const hasStart = Boolean(values.startDate);
    const hasEnd = Boolean(values.endDate);
    if (hasStart !== hasEnd || (hasStart && values.endDate <= values.startDate)) {
      setStatus("Choose a valid start and return date.", "error");
      return;
    }
    if (values.minPrice && values.maxPrice && Number(values.minPrice) > Number(values.maxPrice)) {
      setStatus("Minimum price cannot be greater than maximum price.", "error");
      return;
    }
    if (updateUrl) updateShareUrl();
    window.dispatchEvent(new CustomEvent("lockd:discovery-change", {detail: discoveryState()}));
    if (mapIsActive()) return;
    lastFeed = { values: { ...values }, location: location ? { ...location } : null, radiusKm: radiusOptions[radiusIndex] };
    pageState = {};
    Object.values(pageButtons).forEach((selector) => { $(selector).hidden = true; $(selector).disabled = false; });
    $("#expand-nearby").hidden = true;
    setStatus("Finding rentals…");
    const recentRow = $("#recent-row");
    recentRow.hidden = !document.querySelector("#recent-listings")?.children.length;
    drawSkeletons($("#recent-listings"));
    const nearRow = $("#nearby-row");
    nearRow.hidden = !location;
    if (location) drawSkeletons($("#nearby-listings"));
    $("#available-row").hidden = !(hasStart && hasEnd);
    if (hasStart && hasEnd) drawSkeletons($("#available-listings"));
    $("#discovery-shelves").replaceChildren();

    function renderRecent(recentResult) {
      if (run !== pageRun) return;
      const recent = recentResult.status === "fulfilled" ? recentResult.value : null;
    recentRow.hidden = !recent || recent.items.length === 0;
    if (recent?.items.length) {
      renderGrid($("#recent-listings"), recent.items.slice(0, 6));
      $("#recent-row-title").textContent = recent.publicationTimestampReliable ? "Recently added" : "Published rentals";
      $("#recent-row").querySelector(".discovery-row-heading > p").textContent = recent.publicationTimestampReliable
        ? "Recently published listings from LOCKD listers."
        : "Explore recently added rentals.";
      pageState.recent = { page: 0, hasMore: recent.hasMore, buffer: recent.items.slice(6) };
      $(pageButtons.recent).hidden = !pageState.recent.hasMore && !pageState.recent.buffer.length;
    }
    if (recentResult.status === "rejected") emptyMessage($("#recent-listings"), recentResult.reason?.message || "Published rentals could not be loaded. Try again.");

    }
    function renderNearby(nearbyResult) {
      if (run !== pageRun) return;
      const nearby = nearbyResult.status === "fulfilled" ? nearbyResult.value : null;
    if (location && nearby) {
      nearRow.hidden = false;
      const host = $("#nearby-listings");
      if (nearby.items.length) renderGrid(host, nearby.items.slice(0, 6));
      else emptyMessage(host, isPointLocation()
        ? "No rentals here yet. Try a wider area or choose another place."
        : `No published listings match ${location.label} yet. Try a nearby town or clear the location filter.`);
      $("#nearby-row-title").textContent = isPointLocation() ? `Near your area · ${radiusOptions[radiusIndex]} km` : `In ${location.label}`;
      $("#nearby-row-note").textContent = isPointLocation()
        ? "Locations and distances are approximate."
        : "Rentals in your chosen area.";
      pageState.nearby = { page: 0, hasMore: nearby.hasMore, buffer: nearby.items.slice(6) };
      $(pageButtons.nearby).hidden = !pageState.nearby.hasMore && !pageState.nearby.buffer.length;
      $("#expand-nearby").hidden = !isPointLocation() || radiusIndex >= radiusOptions.length - 1 || nearby.items.length > 0;
    } else if (location) {
      nearRow.hidden = false;
      const notConfigured = nearbyResult.reason?.code === "nearby_search_not_configured";
      emptyMessage($("#nearby-listings"), notConfigured
        ? "Nearby rentals could not be loaded. Please try again."
        : nearbyResult.reason?.message || "Nearby listings could not be loaded. Try again.");
      $("#nearby-row-title").textContent = notConfigured ? "Nearby rentals" : "Nearby rentals";
      $("#nearby-row-note").textContent = "Choose another area or try again.";
      $("#expand-nearby").hidden = true;
      $(pageButtons.nearby).hidden = true;
    } else nearRow.hidden = true;

    }
    function renderAvailable(availableResult) {
      if (run !== pageRun) return;
      const available = availableResult.status === "fulfilled" ? availableResult.value : null;
    if (hasStart && hasEnd) {
      const availableHost = $("#available-listings");
      $("#available-row").hidden = false;
      if (available) {
        if (available.items.length) renderGrid(availableHost, available.items.slice(0, 6));
        else emptyMessage(availableHost, "No published rentals match these dates and filters. Choose different dates or clear a filter.");
        $("#available-row-note").textContent = "Dates checked. Select a rental to continue.";
        pageState.available = { page: 0, hasMore: available.hasMore, buffer: available.items.slice(6) };
        $(pageButtons.available).hidden = !pageState.available.hasMore && !pageState.available.buffer.length;
      } else {
        emptyMessage(availableHost, "Date-specific availability could not be confirmed. Try again before relying on these dates.");
        $("#available-row-note").textContent = "Please check again before booking.";
        $(pageButtons.available).hidden = true;
      }
    } else $("#available-row").hidden = true;

    }
    const progressive = (task, render) => task.then(value => { render({status:"fulfilled", value}); return value; }, reason => { render({status:"rejected", reason}); throw reason; });
    const recentTask = progressive(requestList(values, { dates: false, newest: true, signal }), renderRecent);
    const nearbyTask = progressive(!location ? Promise.resolve(null) : isPointLocation()
      ? requestNearby(values, { radiusKm: radiusOptions[radiusIndex], signal })
      : requestList(values, { dates: false, signal }), renderNearby);
    const availableTask = progressive(!(hasStart && hasEnd) ? Promise.resolve(null) : isPointLocation()
      ? requestNearby(values, { dates: true, radiusKm: radiusOptions[radiusIndex], signal })
      : requestList(values, { dates: true, signal }), renderAvailable);
    const categoryTasks = location && !values.category ? marketGroups.map(async (group) => {
      if (isPointLocation() && !(await nearbyTask)?.items?.length) return { group, items: [] };
      const result = isPointLocation()
        ? await requestNearby(values, { category: group.category || "", market: group.market, radiusKm: radiusOptions[radiusIndex], signal })
        : await requestList(values, { category: group.category || "", market: group.market, signal });
      return { group, items: result.items.slice(0, 4) };
    }) : [];
    const categoryResultsTask=Promise.allSettled(categoryTasks);

    const [recentResult, nearbyResult, availableResult] = await Promise.allSettled([recentTask, nearbyTask, availableTask]);
    if (run !== pageRun) return;
    const recent = recentResult.status === "fulfilled" ? recentResult.value : null;
    const nearby = nearbyResult.status === "fulfilled" ? nearbyResult.value : null;
    const available = availableResult.status === "fulfilled" ? availableResult.value : null;
    const failures = [recentResult, nearbyResult, availableResult].filter((result) => result.status === "rejected").map((result) => result.reason);
    if (failures.length) {
      const migrationPending = failures.some((error) => error?.code === "nearby_search_not_configured");
      setStatus(migrationPending
        ? "Nearby rentals could not be loaded. Please try again."
        : "Some discovery results could not be loaded. Check your connection and try again.", "error");
    } else if (!recent?.items.length && !nearby?.items?.length && !available?.items?.length) {
      setStatus(location ? "No rentals match these filters. Try another area or category." : "No rentals here yet. Choose an area or explore the categories below.");
    } else {
      const locationText = location?.mode === "manual" ? ` Results use ${location.label}.` : isPointLocation() ? " Distances are approximate." : " Choose an area to find rentals nearby.";
      setStatus(`Explore the rentals below.${locationText}`);
    }

    if (categoryTasks.length) {
      const categoryResults = await categoryResultsTask;
      if (run !== pageRun) return;
      const shelves = $("#discovery-shelves");
      categoryResults.forEach((result) => {
        if (result.status !== "fulfilled" || !result.value.items.length) return;
        const section = document.createElement("section");
        section.className = "discovery-shelf";
        const heading = document.createElement("h3");
        heading.textContent = isPointLocation() ? result.value.group.title : result.value.group.title.replace(" nearby", ` in ${location.label}`);
        const cards = document.createElement("div");
        cards.className = "discovery-card-grid";
        result.value.items.forEach((item, index) => cards.append(cardFor(item, index)));
        section.append(heading, cards);
        shelves.append(section);
      });
    }
  }

  async function loadMore(sectionName) {
    const state = pageState[sectionName];
    const settings = lastFeed;
    const button = $(pageButtons[sectionName]);
    if (!state || !settings || (!state.buffer.length && !state.hasMore) || busyPages.has(sectionName)) return;
    const run = pageRun;
    const host = $(`#${sectionName === "nearby" ? "nearby" : sectionName}-listings`);
    busyPages.add(sectionName);
    button.disabled = true;
    const oldLabel = button.textContent;
    button.textContent = "Loading…";
    try {
      let items;
      if (state.buffer.length) {
        items = state.buffer.splice(0, 6);
      } else {
        const page = state.page + 1;
        const useGeoSearch = isPointLocation(settings.location) && ["nearby", "available"].includes(sectionName);
        const response = useGeoSearch
          ? await requestNearby(settings.values, { dates: sectionName === "available", radiusKm: settings.radiusKm, page, signal: activeController?.signal })
          : await requestList(settings.values, {
            dates: sectionName === "available",
            newest: sectionName === "recent",
            page,
            signal: activeController?.signal,
          });
        state.page = page;
        state.hasMore = response.hasMore;
        items = response.items.slice(0, 6);
        state.buffer = response.items.slice(6);
      }
      if (run !== pageRun) return;
      appendGrid(host, items);
      button.hidden = !state.buffer.length && !state.hasMore;
    } catch (error) {
      if (error.name !== "AbortError" && run === pageRun) setStatus(error.message || "More listings could not be loaded. Try again.", "error");
    } finally {
      busyPages.delete(sectionName);
      if (run === pageRun) { button.disabled = false; button.textContent = oldLabel; }
    }
  }

  function openDialog(anchor) {
    if(window.LockdLocationPicker)return window.LockdLocationPicker.open(anchor?.currentTarget||anchor);
    if (typeof dialog.showModal === "function" && !dialog.open) {
      locationDialogStatus.textContent = "";
      manualForm.hidden = true;
      dialog.showModal();
    }
  }

  function useCurrentLocation() {
    const deniedKey='lockd:location-denied:v1';try{if(localStorage.getItem(deniedKey)){showManualFallback('Location access is off. Search for a place instead.');return;}}catch{}
    if (!window.isSecureContext) { showManualFallback("Choose an area to keep browsing."); return; }
    if (!navigator.geolocation) {
      showManualFallback("Your browser does not provide location access here. Search by town or neighbourhood instead.");
      return;
    }
    const button = $("#use-current-location");
    if (button.disabled) return;
    button.disabled = true;
    const selectionVersion=++areaRestoreRun;
    locationCleared = false;
    locationDialogStatus.textContent = "Waiting for your browser’s location permission…";
    navigator.geolocation.getCurrentPosition(async (position) => {
      button.disabled = false;
      if(selectionVersion!==areaRestoreRun)return;
      const latitude = Math.round(position.coords.latitude * 100) / 100;
      const longitude = Math.round(position.coords.longitude * 100) / 100;
      applyLocation({ mode: "current", latitude, longitude });
      radiusIndex = 0;
      window.LockdLocationPicker?.close();if(!window.LockdLocationPicker)dialog.close();
      loadFeed({ updateUrl: true });
      try{const response=await fetch('/api/listings?view=places',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reverse:true,latitude,longitude})});const data=await response.json();const place=data.items?.[0];if(response.ok&&place&&selectionVersion===areaRestoreRun){applyLocation({mode:'current',latitude,longitude,id:place.id,label:place.label},{save:true});loadFeed();}}catch{/* Nearby browsing works even if a locality name cannot be resolved. */}
    }, (error) => {
      button.disabled = false;
      if(selectionVersion!==areaRestoreRun)return;
      if(error.code===error.PERMISSION_DENIED){try{localStorage.setItem(deniedKey,'1');}catch{}button.hidden=true;}
      const message = error.code === error.PERMISSION_DENIED
        ? "Location permission was declined. Choose a town or neighbourhood manually; browsing still works."
        : error.code === error.TIMEOUT
          ? "We could not get a location before the request timed out. Choose a place manually instead."
          : "Your current location is unavailable. Choose a place manually instead.";
      if (!location && approximateArea && !locationCleared) { applyLocation({mode:"approximate",...approximateArea}); loadFeed(); }
      showManualFallback(message);
    }, { enableHighAccuracy: false, timeout: 12000, maximumAge: 300000 });
  }

  $("#open-location-picker").addEventListener("click", openDialog);
  $("#use-current-location").addEventListener("click", useCurrentLocation);
  $("#choose-manual-location")?.addEventListener("click", () => showManualFallback("Search a town or neighbourhood, then choose a place."));
  $("#location-not-now")?.addEventListener("click", () => window.LockdLocationPicker?window.LockdLocationPicker.close():dialog.close());
  function clearArea(){
    locationCleared = true;areaRestoreRun++;
    applyLocation(null, { save: true });
    radiusIndex = 0;
    loadFeed({ updateUrl: true });
  }
  $("#clear-location").addEventListener("click",clearArea);
  filters.addEventListener("submit", (event) => {
    event.preventDefault();
    loadFeed({ updateUrl: true });
  });
  startDate.addEventListener("change", () => { endDate.min = startDate.value || ""; });
  $("#expand-nearby").addEventListener("click", () => {
    radiusIndex = Math.min(radiusIndex + 1, radiusOptions.length - 1);
    loadFeed({ updateUrl: true });
  });
  $(pageButtons.nearby).addEventListener("click", () => loadMore("nearby"));
  $(pageButtons.available).addEventListener("click", () => loadMore("available"));
  $(pageButtons.recent).addEventListener("click", () => loadMore("recent"));
  window.addEventListener("lockd:discovery-view", event => { if(event.detail?.view === "map"){activeController?.abort();pageRun++;}else loadFeed(); });
  window.addEventListener("popstate", () => { fillFromUrl(); loadFeed(); });

  function discoveryState() { return {location:location?{...location}:null,filters:{...filtersState({includeDates:true})}}; }
  window.LockdDiscovery = {getState:discoveryState,createCard:cardFor,clearArea,openLocation:openDialog,cancelLocationRequest:()=>{areaRestoreRun++;$('#use-current-location').disabled=false;},requestLocation:()=>{openDialog();useCurrentLocation();},setArea:(area,{save=false}={})=>{areaRestoreRun++;if(area&&Number.isFinite(area.latitude)&&Number.isFinite(area.longitude)&&Math.abs(area.latitude)<=90&&Math.abs(area.longitude)<=180){applyLocation({mode:"selected",id:area.id,latitude:Math.round(area.latitude*100)/100,longitude:Math.round(area.longitude*100)/100,label:area.label||""},{save});loadFeed({updateUrl:save});}}};
  fillFromUrl();
  loadFeed();
  window.LockdAccount?.getConfig().then(config=>{approximateArea=config.approximateArea;if(!location&&!locationCleared&&approximateArea){applyLocation({mode:"approximate",...approximateArea});loadFeed();}}).catch(()=>{});
})();
