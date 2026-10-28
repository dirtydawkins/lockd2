(() => {
  const params = new URLSearchParams(window.location.search);
  const slug = params.get("slug");
  const detail = document.querySelector("#rental-detail");
  const state = document.querySelector("#rental-state");
  const form = document.querySelector("#availability-form");
  const status = document.querySelector("#availability-status");
  const storageKey = "lockd:bundle:v3";
  let listing = null;

  const categoryLabels = {
    stay: "Stay", drive: "Drive", play: "Play", technology: "Technology", experience: "Experiences",
    camera: "Cameras", phone: "Phones", laptop: "Laptops", audio: "Audio", creative: "Creative equipment",
  };

  function safeImageUrl(value) {
    if (typeof value !== "string" || !value.trim()) return "";
    try {
      const url = new URL(value, window.location.origin);
      return url.protocol === "https:" || url.origin === window.location.origin ? url.href : "";
    } catch { return ""; }
  }

  function priceText(amount, currency, unit) {
    if (amount === null || amount === undefined || amount === "") return "Price to be confirmed";
    const price = Number(amount);
    if (!Number.isFinite(price) || price < 0 || !currency) return "Price to be confirmed";
    let formatted;
    try { formatted = new Intl.NumberFormat("en-KE", { style: "currency", currency, maximumFractionDigits: 0 }).format(price); }
    catch { formatted = `${currency} ${price.toLocaleString("en-KE")}`; }
    const units = { hour: "hour", day: "day", night: "night", week: "week", month: "month", trip: "trip" };
    return `${formatted}${units[unit] ? ` / ${units[unit]}` : ""}`;
  }

  function factLabel(value) {
    return String(value).replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  function addFact(facts, label, value) {
    if (value === null || value === undefined || value === "") return;
    const row = document.createElement("div");
    const term = document.createElement("dt");
    term.textContent = label;
    const definition = document.createElement("dd");
    definition.textContent = Array.isArray(value) ? value.map(String).join(", ") : String(value);
    row.append(term, definition);
    facts.append(row);
  }

  function setMessage(message, kind = "info") {
    if (!status) return;
    status.textContent = message;
    status.dataset.kind = kind;
  }

  function renderEstimate() {
    const output = document.querySelector("#rental-total-estimate");
    if (!output || !listing) return;
    const startDate = start?.value;
    const endDate = end?.value;
    const units = Number(document.querySelector("#quantity")?.value || 1);
    const rate = Number(listing.price_amount);
    if (!startDate || !endDate) {
      output.textContent = "Choose dates to estimate the rental subtotal. Fees and refundable deposits are separate.";
      return;
    }
    if (endDate <= startDate || !Number.isInteger(units) || units < 1 || units > 20 || !Number.isFinite(rate) || rate <= 0) {
      output.textContent = "A rental subtotal cannot be estimated from these dates, quantity or listing rate.";
      return;
    }
    const estimate = window.LockdRentalPricing?.estimateRentalSubtotal({
      amount: rate,
      currency: listing.currency,
      unit: listing.price_unit,
      quantity: units,
      startDate,
      endDate,
    });
    if (!estimate) {
      output.textContent = listing.price_unit === "week" || listing.price_unit === "month"
        ? `This ${listing.price_unit} rate needs a whole ${listing.price_unit} period for a reliable estimate. Confirm partial periods with the owner.`
        : "The listing rate cannot be calculated from the selected dates. Confirm the total with the owner.";
      return;
    }
    output.textContent = `Rental subtotal estimate: ${priceText(estimate.amount, estimate.currency, "")} (${estimate.period} × ${estimate.quantity}). Fees and refundable deposit are separate. This estimate does not reserve the rental.`;
  }

  function addToBundle() {
    if (!listing) return;
    let bundle;
    try { bundle = JSON.parse(localStorage.getItem(storageKey) || "{}"); } catch { bundle = {}; }
    if (!Array.isArray(bundle.items)) bundle.items = [];
    const existing = bundle.items.find((item) => item.id === listing.id);
    if (existing) existing.quantity = Math.min(20, Number(existing.quantity || 1) + 1);
    else bundle.items.push({
      id: listing.id, slug: listing.slug, title: listing.title, quantity: 1,
      priceAmount: listing.price_amount, currency: listing.currency, priceUnit: listing.price_unit,
    });
    try { localStorage.setItem(storageKey, JSON.stringify(bundle)); } catch { /* Storage can be disabled. */ }
    const button = document.querySelector("#add-to-bundle");
    if (button) button.textContent = "Added to bundle";
  }

  function renderGallery(images) {
    const cover = document.querySelector("#rental-cover");
    const thumbs = document.querySelector("#rental-thumbnails");
    const validImages = Array.isArray(images) ? images.map(safeImageUrl).filter(Boolean) : [];
    if (!validImages.length) {
      cover.removeAttribute("src");
      cover.alt = "No listing photograph has been provided";
      const placeholder = document.createElement("span");
      placeholder.className = "listing-image-placeholder rental-placeholder";
      placeholder.setAttribute("aria-hidden", "true");
      placeholder.textContent = (listing?.title || "L").slice(0, 1).toUpperCase();
      cover.replaceWith(placeholder);
      document.querySelector("#rental-image-caption").textContent = "No listing photograph provided";
      return;
    }
    cover.src = validImages[0];
    cover.alt = typeof listing.image_alt === "string" ? listing.image_alt : listing.title;
    document.querySelector("#rental-image-caption").textContent = `${validImages.length} ${validImages.length === 1 ? "photograph" : "photographs"}`;
    validImages.forEach((url, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("aria-label", `Show listing photograph ${index + 1}`);
      button.setAttribute("aria-current", String(index === 0));
      const image = document.createElement("img");
      image.src = url;
      image.alt = "";
      image.loading = "lazy";
      button.append(image);
      button.addEventListener("click", () => {
        cover.src = url;
        cover.alt = typeof listing.image_alt === "string" ? listing.image_alt : listing.title;
        thumbs.querySelectorAll("button").forEach((thumb) => thumb.setAttribute("aria-current", String(thumb === button)));
      });
      thumbs.append(button);
    });
  }

  function renderRelated(listings) {
    const section = document.querySelector("#related-tech-rentals");
    const grid = document.querySelector("#related-tech-grid");
    if (!section || !grid || !listing) return;
    const rows = listings.filter((record) => record.slug !== listing.slug).slice(0, 4);
    section.hidden = rows.length === 0;
    grid.replaceChildren(...rows.map((record) => {
      const card = document.createElement("article");
      card.className = "related-rental-card";
      const link = document.createElement("a");
      const url = new URL("rental.html", window.location.href);
      url.searchParams.set("slug", record.slug);
      url.searchParams.set("from", record.category || "technology");
      link.href = url.href;
      const rawImage = Array.isArray(record.images) ? record.images[0] : "";
      let imageUrl = "";
      try {
        const parsed = new URL(rawImage, window.location.origin);
        if (parsed.protocol === "https:" || parsed.origin === window.location.origin) imageUrl = parsed.href;
      } catch { /* No external or invalid image URLs. */ }
      if (imageUrl) {
        const image = document.createElement("img");
        image.src = imageUrl;
        image.alt = typeof record.image_alt === "string" ? record.image_alt : record.title;
        image.loading = "lazy";
        image.decoding = "async";
        link.append(image);
      } else {
        const placeholder = document.createElement("span");
        placeholder.className = "related-rental-placeholder";
        placeholder.setAttribute("aria-hidden", "true");
        placeholder.textContent = (record.title || "L").slice(0, 1).toUpperCase();
        link.append(placeholder);
      }
      const title = document.createElement("h3");
      title.textContent = record.title;
      const price = document.createElement("p");
      price.textContent = priceText(record.price_amount, record.currency, record.price_unit);
      card.append(link, title, price);
      return card;
    }));
  }

  async function loadRelated(record) {
    if (!["technology", "play", "camera", "phone", "laptop", "audio", "creative"].includes(record.category) && !record.market_category) return;
    try {
      const url = new URL("/api/listings", window.location.origin);
      url.searchParams.set("category", record.category);
      url.searchParams.set("sort", "newest");
      const response = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (response.ok && Array.isArray(data.items)) renderRelated(data.items);
    } catch { /* Related inventory is optional; the listing stays readable. */ }
  }

  function renderListing(record, config = {}) {
    listing = record;
    document.title = `${record.title} — LOCKD`;
    const canonical = new URL("rental.html", window.location.origin);
    canonical.searchParams.set("slug", record.slug);
    document.querySelector('link[rel="canonical"]')?.setAttribute("href", canonical.href);
    document.querySelector('meta[name="robots"]')?.setAttribute("content", "index,follow");
    document.querySelector('meta[property="og:title"]')?.setAttribute("content", `${record.title} — LOCKD`);
    document.querySelector('meta[property="og:description"]')?.setAttribute("content", record.summary || record.description || "View this published LOCKD rental and check its availability.");
    document.querySelector('meta[property="og:url"]')?.setAttribute("content", canonical.href);
    const coverImage = safeImageUrl(Array.isArray(record.images) ? record.images[0] : "");
    if (coverImage) document.querySelector('meta[property="og:image"]')?.setAttribute("content", coverImage);
    document.querySelector("#breadcrumb-title").textContent = record.title;
    document.querySelector("#rental-category").textContent = categoryLabels[record.category] || record.category || "Rental";
    document.querySelector("#rental-title").textContent = record.title;
    document.querySelector("#rental-location").textContent = record.location_label || "Location details to be confirmed";
    document.querySelector("#rental-price").textContent = priceText(record.price_amount, record.currency, record.price_unit);
    const approvalNote = document.querySelector("#approval-note");
    const enquiryLink = document.querySelector("#manual-enquiry");
    if (record.requires_approval && approvalNote) {
      approvalNote.hidden = false;
      approvalNote.textContent = config.supportEmail
        ? "Owner confirmation is required before a booking can be completed."
        : "Owner confirmation is required. The enquiry contact is not configured yet.";
    }
    if (record.requires_approval && config.supportEmail && enquiryLink) {
      const subject = encodeURIComponent(`Rental enquiry: ${record.title}`);
      const body = encodeURIComponent(`I’m interested in ${record.title} (${record.slug}).\n\nListing: ${window.location.href}\n\nPlease confirm the next steps.`);
      enquiryLink.href = `mailto:${encodeURIComponent(config.supportEmail)}?subject=${subject}&body=${body}`;
      enquiryLink.hidden = false;
    }
    const description = document.querySelector("#rental-description");
    if (record.description) {
      const paragraph = document.createElement("p");
      paragraph.textContent = record.description;
      description.replaceChildren(paragraph);
    } else {
      description.textContent = "A description has not been provided for this listing yet.";
    }
    const facts = document.querySelector("#rental-facts");
    facts.replaceChildren();
    const attributes = record.attributes && typeof record.attributes === "object" ? record.attributes : {};
    ["brand", "model", "configuration", "generation", "storage", "memory", "condition", "included_accessories", "specifications", "mandatory_fees"].forEach((key) => {
      addFact(facts, factLabel(key), attributes[key]);
    });
    if (record.rental_durations?.length) addFact(facts, "Available durations", record.rental_durations);
    if (record.deposit_amount !== null && record.deposit_amount !== undefined) {
      addFact(facts, "Refundable deposit", priceText(record.deposit_amount, record.deposit_currency || record.currency, ""));
    }
    if (record.collection_available !== null && record.collection_available !== undefined) addFact(facts, "Collection", record.collection_available ? "Available" : "Not available");
    if (record.delivery_available !== null && record.delivery_available !== undefined) addFact(facts, "Delivery", record.delivery_available ? "Available" : "Not available");
    if (record.requires_approval) addFact(facts, "Booking process", "Owner confirmation required");
    else if (record.checkout_enabled) addFact(facts, "Booking process", "This listing is marked checkout-enabled, but LOCKD checkout is not live yet");
    else addFact(facts, "Booking process", "Availability check only; no online checkout is configured");
    if (["technology", "play", "camera", "phone", "laptop", "audio", "creative"].includes(record.category) || record.market_category) {
      try {
        const key = "lockd:tech:recent:v1";
        const slugs = JSON.parse(localStorage.getItem(key) || "[]");
        const list = Array.isArray(slugs) ? slugs.filter((entry) => typeof entry === "string") : [];
        localStorage.setItem(key, JSON.stringify([record.slug, ...list.filter((entry) => entry !== record.slug)].slice(0, 12)));
      } catch { /* Browsing history is optional and stored on this device only. */ }
    }
    renderGallery(record.images);
    detail.hidden = false;
    state.hidden = true;
    renderEstimate();
    loadRelated(record);
  }

  async function loadListing() {
    if (!slug) {
      state.dataset.kind = "error";
      state.textContent = "No rental was selected. Return to the catalogue and choose a listing.";
      return;
    }
    try {
      const url = new URL("/api/listings", window.location.origin);
      url.searchParams.set("slug", slug);
      const response = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 503 || data.error === "catalogue_not_configured") {
          throw new Error("The live catalogue is not connected yet. Add the Supabase project URL and anon key to Vercel, then apply the catalogue migration.");
        }
        throw new Error(data.message || "This rental could not be loaded.");
      }
      if (!data.item) throw new Error("This rental is no longer published or could not be found.");
      let config = {};
      try {
        const configResponse = await fetch("/api/config", { headers: { Accept: "application/json" }, cache: "no-store" });
        if (configResponse.ok) config = await configResponse.json();
      } catch { /* The listing remains readable if optional public contact config is unavailable. */ }
      renderListing(data.item, config);
    } catch (error) {
      state.dataset.kind = "error";
      state.textContent = error.message || "This rental is temporarily unavailable.";
    }
  }

  function localToday() {
    const date = new Date();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${date.getFullYear()}-${month}-${day}`;
  }

  const start = document.querySelector("#start-date");
  const end = document.querySelector("#end-date");
  if (start && end) {
    start.min = localToday();
    end.min = localToday();
    start.addEventListener("change", () => { end.min = start.value || localToday(); });
    start.addEventListener("input", renderEstimate);
    end.addEventListener("input", renderEstimate);
  }
  document.querySelector("#quantity")?.addEventListener("input", renderEstimate);

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!listing) return;
    const startDate = start.value;
    const endDate = end.value;
    const quantity = Number(document.querySelector("#quantity").value);
    if (!startDate || !endDate || endDate <= startDate || !Number.isInteger(quantity) || quantity < 1) {
      setMessage("Choose a valid date range and quantity.", "error");
      return;
    }
    setMessage("Checking the published availability calendar…", "loading");
    const submit = form.querySelector("button[type=submit]");
    submit.disabled = true;
    try {
      const response = await fetch("/api/availability", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ listingId: listing.id, startDate, endDate, quantity }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 503 || result.error === "catalogue_not_configured") {
          throw new Error("Live availability is not connected yet. Please check back later.");
        }
        throw new Error(result.message || "Availability could not be checked.");
      }
      if (result.available) {
        const manual = listing.requires_approval ? " The owner still needs to confirm this rental." : " This check does not reserve the rental.";
        setMessage(`The listing calendar shows availability for these dates.${manual}`, "available");
      } else {
        setMessage("This rental is not available for the selected dates. Try another date range.", "unavailable");
      }
    } catch (error) {
      setMessage(error.message || "Availability could not be checked.", "error");
    } finally {
      submit.disabled = false;
    }
  });

  document.querySelector("#add-to-bundle")?.addEventListener("click", addToBundle);
  const from = params.get("from");
  const backLink = document.querySelector("#back-to-category");
  if (from && categoryLabels[from]) backLink.href = `rentals.html?category=${encodeURIComponent(from)}`;
  loadListing();
})();
