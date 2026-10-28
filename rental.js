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

  function setMessage(message, kind = "info") {
    if (!status) return;
    status.textContent = message;
    status.dataset.kind = kind;
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
    const fields = record.attributes && typeof record.attributes === "object" ? Object.entries(record.attributes) : [];
    if (record.price_unit) fields.unshift(["Pricing unit", record.price_unit]);
    if (record.requires_approval) fields.push(["Booking process", "Owner confirmation required"]);
    fields.slice(0, 8).forEach(([label, value]) => {
      if (value === null || value === undefined || value === "" || typeof value === "object") return;
      const row = document.createElement("div");
      const term = document.createElement("dt");
      term.textContent = String(label).replaceAll("_", " ");
      const definition = document.createElement("dd");
      definition.textContent = String(value);
      row.append(term, definition);
      facts.append(row);
    });
    renderGallery(record.images);
    detail.hidden = false;
    state.hidden = true;
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
  }

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
