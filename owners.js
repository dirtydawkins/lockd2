(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const authStorageKey = "lockd:owner-session:v1";
  const draftStorageKey = "lockd:owner-draft:v1";
  const categories = {
    stay: "Rooms & accommodation", drive: "Cars & Mobility", play: "Gaming & consoles",
    technology: "Technology & gadgets", phone: "Phones", laptop: "Computers",
    camera: "Cameras & creator equipment", audio: "Audio & event equipment",
    creative: "Creative equipment", experience: "Destinations & experiences", other: "Other supported rentals",
  };
  const categoriesWithProductSpecs = new Set(["technology", "play", "camera", "phone", "laptop", "audio", "creative"]);
  const authPanel = $("#owner-auth");
  const workspace = $("#owner-workspace");
  const liveStatus = $("#owner-live-status");
  const authForm = $("#owner-auth-form");
  const authStatus = $("#owner-auth-status");
  const listingForm = $("#owner-listing-form");
  const listingStatus = $("#owner-listing-status");
  const categorySelect = $("#listing-category");
  const photoInput = $("#listing-photos");
  const photoList = $("#owner-photo-list");
  const uploadProgress = $("#owner-upload-progress");
  let config = null;
  let session = null;
  let authMode = "signin";
  let selectedPhotos = [];
  let draft = null;
  let busy = false;

  const setStatus = (element, text, kind = "info") => {
    if (!element) return;
    element.textContent = text;
    element.dataset.kind = kind;
  };

  const getSavedSession = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(authStorageKey) || "null");
      return saved && typeof saved.access_token === "string" && typeof saved.refresh_token === "string" ? saved : null;
    } catch { return null; }
  };

  function saveSession(value) {
    if (!value?.access_token || !value?.refresh_token) throw new Error("Sign-in did not return a complete session.");
    session = {
      access_token: value.access_token,
      refresh_token: value.refresh_token,
      expires_at: Number(value.expires_at || (Date.now() / 1000 + Number(value.expires_in || 3600))),
      user: value.user || session?.user || null,
    };
    localStorage.setItem(authStorageKey, JSON.stringify(session));
  }

  function clearSession() {
    session = null;
    try { localStorage.removeItem(authStorageKey); } catch { /* Session storage may be unavailable. */ }
  }

  async function authRequest(path, payload, token = null) {
    const response = await fetch(`${config.supabase.url}/auth/v1/${path}`, {
      method: "POST",
      headers: {
        apikey: config.supabase.publishableKey,
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload || {}),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = typeof data.msg === "string" ? data.msg : typeof data.message === "string" ? data.message : "Authentication could not be completed.";
      throw new Error(message);
    }
    return data;
  }

  async function ensureSession() {
    if (!session) return null;
    if (Number(session.expires_at) > Date.now() / 1000 + 75) return session;
    try {
      const refreshed = await authRequest("token?grant_type=refresh_token", { refresh_token: session.refresh_token });
      saveSession(refreshed);
      return session;
    } catch {
      clearSession();
      showAuth("Your session expired. Sign in again to continue.");
      return null;
    }
  }

  function setBusy(value) {
    busy = value;
    listingForm?.querySelectorAll("button[type=submit]").forEach((button) => { button.disabled = value; });
    $("#owner-auth-submit")?.toggleAttribute("disabled", value);
    $("#owner-signout")?.toggleAttribute("disabled", value);
  }

  function showAuth(message = "") {
    authPanel.hidden = false;
    workspace.hidden = true;
    liveStatus.textContent = "Sign in or create an account to manage LOCKD listings.";
    liveStatus.dataset.kind = "info";
    if (message) setStatus(authStatus, message, "error");
    $("#owner-email")?.focus({ preventScroll: true });
  }

  function showWorkspace() {
    authPanel.hidden = true;
    workspace.hidden = false;
    liveStatus.textContent = "Owner workspace connected. Drafts and published listings are saved to your LOCKD account.";
    liveStatus.dataset.kind = "success";
    $("#owner-account-label").textContent = session?.user?.email ? `Signed in as ${session.user.email}` : "Signed in to your LOCKD owner account";
  }

  function switchAuthMode(mode) {
    authMode = mode;
    const create = mode === "signup";
    $("#owner-auth-title").textContent = create ? "Create your owner account." : "Sign in to continue.";
    $("#owner-auth-intro").textContent = create
      ? "Use an email address you can verify. Your listing draft stays on this device while you confirm it."
      : "Sign in to create, publish and manage your own listings.";
    $("#owner-name-row").hidden = !create;
    $("#owner-name").required = create;
    $("#owner-password").autocomplete = create ? "new-password" : "current-password";
    $("#owner-auth-submit").textContent = create ? "Create account" : "Sign in";
    $("#owner-auth-switch").textContent = create ? "I already have an account" : "Create an account";
    setStatus(authStatus, "");
  }

  const fieldTemplates = {
    stay: [
      { key: "property_type", label: "Property type", type: "select", required: true, options: [["hotel", "Hotel"], ["guesthouse", "Guesthouse"], ["apartment", "Apartment"], ["holiday_home", "Holiday home"], ["lodge", "Lodge"], ["hostel", "Hostel"]] },
      { key: "room_type", label: "Space offered", type: "select", required: true, options: [["entire_place", "Entire place"], ["private_room", "Private room"], ["shared_room", "Shared room"], ["hotel_room", "Hotel room"]] },
      { key: "max_guests", label: "Maximum guests", type: "number", required: true, min: 1, max: 30 },
      { key: "bedrooms", label: "Bedrooms", type: "number", min: 0, max: 50 },
      { key: "beds", label: "Beds and sleeping arrangements", type: "text", max: 160 },
      { key: "bathrooms", label: "Bathrooms", type: "number", min: 0, max: 30 },
      { key: "amenities", label: "Amenities", type: "text", max: 500, placeholder: "Separate each with a comma" },
      { key: "house_rules", label: "House rules", type: "textarea", max: 1000 },
      { key: "check_in_time", label: "Check-in time", type: "time" },
      { key: "check_out_time", label: "Check-out time", type: "time" },
      { key: "cancellation_policy", label: "Cancellation terms", type: "select", options: [["flexible", "Flexible"], ["moderate", "Moderate"], ["strict", "Strict"]] },
      { key: "price_basis", label: "Nightly rate applies to", type: "select", required: true, options: [["per_room_per_night", "Each room, per night"], ["per_property_per_night", "The whole property, per night"]] },
    ],
    drive: [
      { key: "brand", label: "Make", type: "text", required: true, max: 80 },
      { key: "model", label: "Model", type: "text", required: true, max: 100 },
      { key: "year", label: "Year (if confirmed)", type: "number", min: 1950, max: 2100 },
      { key: "vehicle_type", label: "Vehicle type", type: "select", required: true, options: [["car", "Car"], ["suv", "SUV"], ["sedan", "Sedan"], ["coupe", "Coupe"], ["hatchback", "Hatchback"], ["van", "Van"], ["pickup", "Pickup"], ["motorcycle", "Motorcycle"], ["4x4", "4×4"], ["other", "Other"]] },
      { key: "seating_capacity", label: "Seating capacity", type: "number", required: true, min: 1, max: 40 },
      { key: "transmission", label: "Transmission", type: "select", required: true, options: [["automatic", "Automatic"], ["manual", "Manual"]] },
      { key: "fuel_type", label: "Fuel or powertrain", type: "select", required: true, options: [["petrol", "Petrol"], ["diesel", "Diesel"], ["hybrid", "Hybrid"], ["plug_in_hybrid", "Plug-in hybrid"], ["electric", "Electric"], ["other", "Other"]] },
      { key: "service_mode", label: "Rental service", type: "select", required: true, options: [["self_drive", "Self-drive"], ["chauffeur", "Chauffeur-driven"], ["both", "Both"]] },
      { key: "minimum_driver_age", label: "Minimum driver age (self-drive)", type: "number", min: 18, max: 100 },
      { key: "luggage_capacity", label: "Luggage capacity", type: "text", max: 80 },
      { key: "mileage_limit_km", label: "Included mileage per day (km)", type: "number", min: 0, max: 10000 },
      { key: "excess_mileage_fee", label: "Fee per excess km (KSh)", type: "number", min: 0, max: 1000000 },
      { key: "insurance_requirements", label: "Insurance and driver requirements", type: "textarea", max: 1000 },
      { key: "pickup_instructions", label: "Pickup and return instructions", type: "textarea", max: 1000 },
      { key: "cancellation_policy", label: "Cancellation terms", type: "select", required: true, options: [["flexible", "Flexible"], ["moderate", "Moderate"], ["strict", "Strict"]] },
      { key: "rental_terms", label: "Rental terms", type: "textarea", max: 1200 },
    ],
    product: [
      { key: "product_type", label: "Equipment type", type: "select", required: true, options: [["gaming", "Gaming equipment"], ["phone", "Phone"], ["computer", "Computer"], ["tablet", "Tablet"], ["camera", "Camera"], ["lens", "Lens"], ["audio", "Audio equipment"], ["creator", "Creator equipment"], ["projector", "Projector"]] },
      { key: "brand", label: "Brand", type: "text", required: true, max: 80 },
      { key: "model", label: "Exact model", type: "text", required: true, max: 120 },
      { key: "condition", label: "Condition", type: "select", required: true, options: [["new", "New"], ["excellent", "Excellent"], ["good", "Good"], ["fair", "Fair"], ["refurbished", "Refurbished"]] },
      { key: "specifications", label: "Specifications", type: "textarea", max: 1000 },
      { key: "included_accessories", label: "Included accessories", type: "text", max: 500, placeholder: "Separate each with a comma" },
      { key: "rental_restrictions", label: "Rental restrictions", type: "textarea", max: 700 },
    ],
    experience: [
      { key: "duration", label: "Experience duration", type: "text", required: true, max: 100, placeholder: "e.g. Half day" },
      { key: "capacity", label: "Maximum participants", type: "number", required: true, min: 1, max: 100 },
      { key: "included_services", label: "Included services", type: "textarea", max: 1000 },
      { key: "excluded_services", label: "Not included", type: "textarea", max: 1000 },
      { key: "booking_rules", label: "Booking rules", type: "textarea", max: 1000 },
      { key: "cancellation_policy", label: "Cancellation terms", type: "select", options: [["flexible", "Flexible"], ["moderate", "Moderate"], ["strict", "Strict"]] },
    ],
    other: [{ key: "specifications", label: "Asset details and included items", type: "textarea", max: 1200 }],
  };

  function makeInput(descriptor) {
    const label = document.createElement("label");
    label.className = "owner-field";
    const caption = document.createElement("span");
    caption.textContent = descriptor.label;
    label.append(caption);
    let input;
    if (descriptor.type === "select") {
      input = document.createElement("select");
      const blank = document.createElement("option");
      blank.value = "";
      blank.textContent = "Choose one";
      input.append(blank);
      descriptor.options.forEach(([value, text]) => {
        const option = document.createElement("option"); option.value = value; option.textContent = text; input.append(option);
      });
    } else if (descriptor.type === "textarea") {
      input = document.createElement("textarea"); input.rows = 3;
    } else {
      input = document.createElement("input"); input.type = descriptor.type;
    }
    input.dataset.attribute = descriptor.key;
    input.required = Boolean(descriptor.required);
    if (descriptor.max) input.maxLength = descriptor.max;
    if (descriptor.min !== undefined) input.min = descriptor.min;
    if (descriptor.max !== undefined) input.max = descriptor.max;
    if (descriptor.placeholder) input.placeholder = descriptor.placeholder;
    label.append(input);
    return label;
  }

  function renderCategoryFields(category, values = {}) {
    const host = $("#owner-category-fields");
    host.replaceChildren();
    if (!category) return;
    let fields = fieldTemplates[category];
    if (categoriesWithProductSpecs.has(category)) fields = fieldTemplates.product;
    if (!fields) return;
    const fieldset = document.createElement("fieldset");
    const legend = document.createElement("legend"); legend.textContent = `${categories[category]} details`;
    const grid = document.createElement("div"); grid.className = "owner-form-grid";
    fieldset.append(legend, grid);
    fields.forEach((descriptor) => {
      const field = makeInput(descriptor);
      const input = field.querySelector("[data-attribute]");
      const value = values[descriptor.key];
      if (Array.isArray(value)) input.value = value.join(", ");
      else if (value !== undefined && value !== null) input.value = String(value);
      if (descriptor.type === "textarea" || descriptor.key === "amenities" || descriptor.key === "included_accessories") field.classList.add("owner-field-wide");
      grid.append(field);
    });
    host.append(fieldset);
    const unitSelect = $("#listing-price-unit");
    const units = category === "stay" ? ["night", "week", "month"] : category === "experience" ? ["trip", "hour", "day"] : category === "drive" ? ["day", "week", "month"] : ["hour", "day", "week", "month"];
    [...unitSelect.options].forEach((option) => { option.hidden = !units.includes(option.value); });
    if (!units.includes(unitSelect.value)) unitSelect.value = units[0];
  }

  function getAttributes() {
    const result = {};
    $("#owner-category-fields").querySelectorAll("[data-attribute]").forEach((input) => {
      const raw = input.value.trim();
      if (!raw) return;
      if (input.type === "number") result[input.dataset.attribute] = Number(raw);
      else if (["amenities", "included_accessories"].includes(input.dataset.attribute)) {
        result[input.dataset.attribute] = raw.split(",").map((value) => value.trim()).filter(Boolean).slice(0, 30);
      } else result[input.dataset.attribute] = raw;
    });
    if (result.price_basis === undefined && categorySelect.value === "stay") result.price_basis = "per_room_per_night";
    return result;
  }

  function readLocalDraft() {
    try {
      const saved = JSON.parse(localStorage.getItem(draftStorageKey) || "null");
      return saved && typeof saved === "object" ? saved : null;
    } catch { return null; }
  }

  function storeLocalDraft() {
    const details = {};
    const uploadedPhotos = selectedPhotos.filter((photo) => photo.storagePath && photo.uploaded);
    $("#owner-category-fields").querySelectorAll("[data-attribute]").forEach((input) => { details[input.dataset.attribute] = input.value; });
    const values = {
      id: $("#listing-id").value || crypto.randomUUID(), category: categorySelect.value,
      title: $("#listing-title").value, summary: $("#listing-summary").value,
      description: $("#listing-description").value, location: $("#listing-location").value,
      price: $("#listing-price").value, priceUnit: $("#listing-price-unit").value,
      deposit: $("#listing-deposit").value, minDays: $("#listing-min-days").value,
      startDate: $("#availability-start").value, endDate: $("#availability-end").value,
      units: $("#availability-units").value, collection: $("#listing-collection").checked,
      delivery: $("#listing-delivery").checked, attributes: details,
      image_paths: uploadedPhotos.map((photo) => photo.storagePath),
      image_urls: uploadedPhotos.map((photo) => photo.url || null),
    };
    draft = values;
    $("#listing-id").value = values.id;
    try { localStorage.setItem(draftStorageKey, JSON.stringify(values)); } catch { /* Backend draft saving is separate. */ }
    return values;
  }

  function photoStoragePath(value) {
    if (typeof value !== "string" || !value) return null;
    if (!/^https:\/\//i.test(value)) return value;
    try {
      const url = new URL(value);
      if (url.origin !== config?.supabase?.url) return null;
      const match = url.pathname.match(/^\/storage\/v1\/object\/(?:public|sign)\/lockd-listings\/(.+)$/);
      return match ? match[1].split("/").map((part) => decodeURIComponent(part)).join("/") : null;
    } catch { return null; }
  }

  async function createSignedPhotoUrl(path) {
    const active = await ensureSession();
    if (!active) throw new Error("Sign in again to view your listing photos.");
    const encoded = path.split("/").map(encodeURIComponent).join("/");
    const response = await fetch(`${config.supabase.url}/storage/v1/object/sign/lockd-listings/${encoded}`, {
      method: "POST",
      headers: { apikey: config.supabase.publishableKey, Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ expiresIn: 3600 }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error("A saved listing photo could not be loaded. Please retry or upload it again.");
    const signed = data.signedURL || data.signedUrl;
    if (typeof signed !== "string") throw new Error("A saved listing photo could not be loaded.");
    if (/^https:\/\//i.test(signed)) {
      const url = new URL(signed);
      if (url.origin !== config.supabase.url) throw new Error("The saved listing photo URL is invalid.");
      return signed;
    }
    return signed.startsWith("/storage/v1/") ? `${config.supabase.url}${signed}` : `${config.supabase.url}/storage/v1${signed.startsWith("/") ? signed : `/${signed}`}`;
  }

  async function restoreDraft(values) {
    if (!values) return;
    $("#listing-id").value = values.id || crypto.randomUUID();
    categorySelect.value = values.category || "";
    renderCategoryFields(values.category, values.attributes || {});
    $("#listing-title").value = values.title || "";
    $("#listing-summary").value = values.summary || "";
    $("#listing-description").value = values.description || "";
    $("#listing-location").value = values.location_label || values.location || "";
    $("#listing-price").value = values.price_amount ?? values.price ?? "";
    $("#listing-price-unit").value = values.price_unit || values.priceUnit || "day";
    $("#listing-deposit").value = values.deposit_amount ?? values.deposit ?? "";
    $("#listing-min-days").value = values.min_rental_days ?? values.minDays ?? 1;
    $("#availability-start").value = values.availability?.startDate || values.startDate || "";
    $("#availability-end").value = values.availability?.endDate || values.endDate || "";
    $("#availability-units").value = values.availability?.units || values.units || 1;
    $("#listing-collection").checked = Boolean(values.collection_available ?? values.collection);
    $("#listing-delivery").checked = Boolean(values.delivery_available ?? values.delivery);
    selectedPhotos.forEach((photo) => { if (photo.objectUrl) URL.revokeObjectURL(photo.objectUrl); });
    const valuesImages = Array.isArray(values.images) ? values.images : [];
    const imagePaths = Array.isArray(values.image_paths) ? values.image_paths : valuesImages.map(photoStoragePath).filter(Boolean);
    const imageUrls = Array.isArray(values.image_urls) ? values.image_urls : values.image_paths ? valuesImages : [];
    selectedPhotos = imagePaths.slice(0, 12).map((path, index) => ({
      storagePath: path,
      url: imageUrls[index] || (/^https:\/\//i.test(path) ? path : null),
      uploaded: true,
      alt: values.title || "Listing photograph",
    }));
    let unavailablePhoto = false;
    if (session) await Promise.all(selectedPhotos.map(async (photo) => {
      if (!photo.storagePath) return;
      try { photo.url = await createSignedPhotoUrl(photo.storagePath); }
      catch { photo.url = null; unavailablePhoto = true; }
    }));
    renderPhotos();
    if (unavailablePhoto) setStatus(listingStatus, "One or more saved photos could not be loaded. Upload replacement photos before publishing.", "error");
    $("#listing-id").value ||= crypto.randomUUID();
    $("#wizard-title").textContent = values.listing_status === "published" ? "Update your listing details." : "Continue your draft.";
    $("#wizard-eyebrow").textContent = values.listing_status === "published" ? "Edit a listing" : "Resume your draft";
    storeLocalDraft();
    $("#owner-listing-form").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function photoLabel(index) { return index === 0 ? "Cover photo" : `Photo ${index + 1}`; }

  function renderPhotos() {
    photoList.replaceChildren();
    selectedPhotos.forEach((photo, index) => {
      const card = document.createElement("div"); card.className = "owner-photo";
      const image = document.createElement("img");
      if (photo.objectUrl || photo.url) image.src = photo.objectUrl || photo.url;
      else image.hidden = true;
      image.alt = "";
      const label = document.createElement("span"); label.className = "owner-photo-label";
      label.textContent = photo.file?.name || photoLabel(index);
      const actions = document.createElement("div"); actions.className = "owner-photo-actions";
      const left = document.createElement("button"); left.type = "button"; left.textContent = "←"; left.setAttribute("aria-label", `Move ${photoLabel(index)} earlier`); left.disabled = index === 0;
      left.addEventListener("click", () => movePhoto(index, index - 1));
      const cover = document.createElement("button"); cover.type = "button"; cover.textContent = index === 0 ? "Cover" : "Set cover"; cover.disabled = index === 0;
      cover.addEventListener("click", () => movePhoto(index, 0));
      const right = document.createElement("button"); right.type = "button"; right.textContent = "→"; right.setAttribute("aria-label", `Move ${photoLabel(index)} later`); right.disabled = index === selectedPhotos.length - 1;
      right.addEventListener("click", () => movePhoto(index, index + 1));
      const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "Remove";
      remove.addEventListener("click", () => {
        const [removed] = selectedPhotos.splice(index, 1);
        if (removed.objectUrl) URL.revokeObjectURL(removed.objectUrl);
        renderPhotos(); storeLocalDraft();
      });
      actions.append(left, cover, right, remove);
      card.append(image, label, actions);
      photoList.append(card);
    });
    if ($("#owner-preview-dialog")?.open) updatePreview();
  }

  function updatePreview() {
    const image = $("#owner-preview-image");
    const firstPhoto = selectedPhotos[0];
    if (firstPhoto && (firstPhoto.objectUrl || firstPhoto.url)) {
      image.src = firstPhoto.objectUrl || firstPhoto.url;
      image.alt = $("#listing-title").value.trim() || "Listing cover photograph";
      image.hidden = false;
    } else {
      image.removeAttribute("src");
      image.alt = "";
      image.hidden = true;
    }
    $("#owner-preview-meta").textContent = `${categories[categorySelect.value] || "Rental"}${$("#listing-location").value.trim() ? ` · ${$("#listing-location").value.trim()}` : ""}`;
    $("#owner-preview-title").textContent = $("#listing-title").value.trim() || "Your listing title";
    const price = $("#listing-price").value;
    $("#owner-preview-price").textContent = price ? `${moneyText(Number(price), "KES")}${$("#listing-price-unit").value ? ` / ${$("#listing-price-unit").value}` : ""}` : "Rate not set";
    $("#owner-preview-summary").textContent = $("#listing-summary").value.trim();
    $("#owner-preview-description").textContent = $("#listing-description").value.trim() || "Your description will appear here.";
  }

  function movePhoto(from, to) {
    if (to < 0 || to >= selectedPhotos.length) return;
    const [photo] = selectedPhotos.splice(from, 1);
    selectedPhotos.splice(to, 0, photo);
    renderPhotos(); storeLocalDraft();
  }

  function validateFile(file) {
    return ["image/jpeg", "image/png", "image/webp"].includes(file.type) && file.size > 0 && file.size <= 8 * 1024 * 1024;
  }

  function onPhotosSelected() {
    const files = [...(photoInput.files || [])];
    photoInput.value = "";
    const invalid = files.find((file) => !validateFile(file));
    if (invalid) {
      setStatus(listingStatus, `${invalid.name}: choose a JPEG, PNG or WebP image smaller than 8 MB.`, "error");
      return;
    }
    if (selectedPhotos.length + files.length > 12) {
      setStatus(listingStatus, "Choose no more than 12 listing photographs.", "error");
      return;
    }
    for (const file of files) selectedPhotos.push({ file, objectUrl: URL.createObjectURL(file), uploaded: false, alt: file.name });
    renderPhotos();
    storeLocalDraft();
  }

  function uploadFile(file, path, onProgress) {
    return new Promise((resolve, reject) => {
      const request = new XMLHttpRequest();
      const url = `${config.supabase.url}/storage/v1/object/lockd-listings/${path.split("/").map(encodeURIComponent).join("/")}`;
      request.open("POST", url);
      request.setRequestHeader("apikey", config.supabase.publishableKey);
      request.setRequestHeader("Authorization", `Bearer ${session.access_token}`);
      request.setRequestHeader("Content-Type", file.type);
      request.setRequestHeader("x-upsert", "false");
      request.upload.addEventListener("progress", (event) => { if (event.lengthComputable) onProgress(event.loaded / event.total); });
      request.addEventListener("load", () => {
        if (request.status < 200 || request.status >= 300) {
          let message = "The photograph could not be uploaded.";
          try { const response = JSON.parse(request.responseText); message = response.message || response.error || message; } catch { /* Keep the useful fallback. */ }
          reject(new Error(message));
          return;
        }
        resolve(path);
      });
      request.addEventListener("error", () => reject(new Error("The photograph upload was interrupted. Check your connection and retry.")));
      request.addEventListener("abort", () => reject(new Error("The photograph upload was cancelled.")));
      request.send(file);
    });
  }

  async function uploadPhotos() {
    const pending = selectedPhotos.filter((photo) => !photo.uploaded && photo.file);
    if (!pending.length) return;
    uploadProgress.hidden = false;
    uploadProgress.value = 0;
    const total = pending.reduce((sum, photo) => sum + photo.file.size, 0);
    let completed = 0;
    for (const photo of pending) {
      if (photo.storagePath) {
        photo.url = await createSignedPhotoUrl(photo.storagePath);
        photo.uploaded = true;
        completed += photo.file.size;
        continue;
      }
      const extension = photo.file.type === "image/png" ? "png" : photo.file.type === "image/webp" ? "webp" : "jpg";
      const path = `${session.user.id}/${$("#listing-id").value}/${crypto.randomUUID()}.${extension}`;
      try {
        photo.storagePath = await uploadFile(photo.file, path, (fraction) => {
          uploadProgress.value = Math.round((completed + photo.file.size * fraction) / total * 100);
        });
        photo.url = await createSignedPhotoUrl(photo.storagePath);
        photo.uploaded = true;
        completed += photo.file.size;
        if (photo.objectUrl) { URL.revokeObjectURL(photo.objectUrl); photo.objectUrl = null; }
        renderPhotos();
        storeLocalDraft();
      } catch (error) {
        throw new Error(`${photo.file.name}: ${error.message}`);
      }
    }
    uploadProgress.value = 100;
  }

  function validatePublish(attributes) {
    const errors = [];
    if (!categorySelect.value) errors.push("Choose a supported category.");
    if ($("#listing-title").value.trim().length < 2) errors.push("Add a listing title.");
    if ($("#listing-location").value.trim().length < 2) errors.push("Add the location or pickup area.");
    if ($("#listing-description").value.trim().length < 30) errors.push("Add a description of at least 30 characters.");
    if (!(Number($("#listing-price").value) > 0)) errors.push("Set a rate greater than zero.");
    if (selectedPhotos.length < 1 || selectedPhotos.length > 12) errors.push("Add between one and twelve photos of the real asset.");
    if (!$("#availability-start").value || !$("#availability-end").value || $("#availability-end").value <= $("#availability-start").value) errors.push("Choose a future availability range.");
    if (!Number.isInteger(Number($("#availability-units").value)) || Number($("#availability-units").value) < 1 || Number($("#availability-units").value) > 20) errors.push("Enter between one and twenty available units.");
    const descriptors = fieldTemplates[categorySelect.value] || (categoriesWithProductSpecs.has(categorySelect.value) ? fieldTemplates.product : []);
    descriptors.filter((field) => field.required).forEach((field) => {
      if (!attributes[field.key] && attributes[field.key] !== 0) errors.push(`Complete “${field.label}” for this category.`);
    });
    if (categorySelect.value === "stay" && !attributes.price_basis) errors.push("Choose whether the nightly rate applies per room or per property.");
    if (categorySelect.value === "drive" && ["self_drive", "both"].includes(attributes.service_mode) && (!Number.isInteger(Number(attributes.minimum_driver_age)) || Number(attributes.minimum_driver_age) < 18 || Number(attributes.minimum_driver_age) > 100)) errors.push("Enter a minimum self-drive age between 18 and 100.");
    if (errors.length) throw new Error(errors[0]);
  }

  function makeListingPayload(values, publish) {
    const attributes = getAttributes();
    if (publish) validatePublish(attributes);
    const title = $("#listing-title").value.trim();
    const id = values.id || crypto.randomUUID();
    const baseSlug = title.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 92) || "lockd-rental";
    const price = $("#listing-price").value.trim();
    const deposit = $("#listing-deposit").value.trim();
    return {
      id, slug: `${baseSlug}-${id.slice(0, 8)}`, title, category: categorySelect.value,
      summary: $("#listing-summary").value.trim(), description: $("#listing-description").value.trim(),
      images: selectedPhotos.filter((photo) => photo.uploaded).map((photo) => photo.storagePath),
      image_alt: title, location_label: $("#listing-location").value.trim(),
      price_amount: price ? Number(price) : null, currency: price ? "KES" : null,
      price_unit: price ? $("#listing-price-unit").value : null,
      deposit_amount: deposit ? Number(deposit) : null,
      collection_available: $("#listing-collection").checked,
      delivery_available: $("#listing-delivery").checked,
      min_rental_days: Number($("#listing-min-days").value || 1), attributes,
    };
  }

  async function ownerApi(method, body = null) {
    await ensureSession();
    if (!session) throw new Error("Sign in again to continue.");
    const response = await fetch("/api/owner-listings", {
      method,
      headers: { Authorization: `Bearer ${session.access_token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401) { clearSession(); showAuth("Your session expired. Sign in again to continue."); }
      if (data.error === "owner_verification_required") showAuth(data.message || "Verify your email before managing listings.");
      throw new Error(data.message || "The owner service could not save that change.");
    }
    return data;
  }

  function moneyText(amount, currency) {
    if (amount === null || amount === undefined) return "Rate not set";
    try { return new Intl.NumberFormat("en-KE", { style: "currency", currency: currency || "KES", maximumFractionDigits: 0 }).format(amount); }
    catch { return `${currency || "KES"} ${Number(amount).toLocaleString("en-KE")}`; }
  }

  async function refreshListings() {
    const host = $("#owner-listings");
    host.replaceChildren(Object.assign(document.createElement("p"), { textContent: "Loading your listings…" }));
    const data = await ownerApi("GET");
    const items = Array.isArray(data.items) ? data.items : [];
    host.replaceChildren();
    if (!items.length) {
      const empty = document.createElement("p"); empty.textContent = "No listings yet. Start with a draft or publish your first complete listing."; host.append(empty); return;
    }
    items.forEach((item) => {
      const card = document.createElement("article"); card.className = "owner-listing-card";
      const imageUrl = Array.isArray(item.images) ? item.images[0] : "";
      if (imageUrl) {
        const image = document.createElement("img"); image.src = imageUrl; image.alt = ""; image.loading = "lazy"; card.append(image);
      } else {
        const placeholder = document.createElement("div"); placeholder.className = "owner-card-placeholder"; placeholder.textContent = (item.title || "L").slice(0, 1).toUpperCase(); card.append(placeholder);
      }
      const copy = document.createElement("div"); copy.className = "owner-listing-card-copy";
      const title = document.createElement("h4"); title.textContent = item.title;
      const category = document.createElement("p"); category.textContent = `${categories[item.category] || item.category} · ${item.location_label || "Location not set"}`;
      const price = document.createElement("p"); price.textContent = `${moneyText(item.price_amount, item.currency)}${item.price_unit ? ` / ${item.price_unit}` : ""}`;
      const status = document.createElement("p"); status.className = "owner-card-status"; status.textContent = `${item.listing_status || "draft"}${item.approval_status === "suspended" ? " · suspended" : ""}`;
      const actions = document.createElement("div"); actions.className = "owner-card-actions";
      if (item.listing_status === "published") {
        const view = document.createElement("a"); view.href = `rental.html?slug=${encodeURIComponent(item.slug)}`; view.textContent = "View listing"; actions.append(view);
      }
      if (["draft", "published", "paused", "archived"].includes(item.listing_status)) {
        const edit = document.createElement("button"); edit.type = "button"; edit.textContent = item.listing_status === "draft" ? "Continue draft" : "Edit";
        edit.addEventListener("click", () => { restoreDraft(item).catch((error) => setStatus(liveStatus, error.message, "error")); }); actions.append(edit);
      }
      if (["published", "paused"].includes(item.listing_status)) {
        const toggle = document.createElement("button"); toggle.type = "button"; toggle.textContent = item.listing_status === "published" ? "Pause" : "Publish";
        toggle.addEventListener("click", () => changeStatus(item, item.listing_status === "published" ? "paused" : "published")); actions.append(toggle);
      }
      if (!["archived", "suspended", "rejected"].includes(item.listing_status)) {
        const archive = document.createElement("button"); archive.type = "button"; archive.textContent = "Archive";
        archive.addEventListener("click", () => changeStatus(item, "archived")); actions.append(archive);
      }
      copy.append(title, category, price, status, actions); card.append(copy); host.append(card);
    });
  }

  async function changeStatus(item, status) {
    try {
      const result = await ownerApi("PATCH", { listingId: item.id, status });
      setStatus(liveStatus, `${item.title} is now ${result.item?.listing_status || status}.`, "success");
      await refreshListings();
    } catch (error) { setStatus(liveStatus, error.message, "error"); }
  }

  async function saveListing(publish) {
    const draftValues = storeLocalDraft();
    if (!categorySelect.value || !$("#listing-title").value.trim() || !$("#listing-location").value.trim()) {
      throw new Error("Choose a category, add a title and enter a location before saving.");
    }
    if (publish) validatePublish(getAttributes());
    if (publish && $("#availability-start").value < new Date().toISOString().slice(0, 10)) throw new Error("Choose a start date today or later.");
    if (selectedPhotos.length) await uploadPhotos();
    const listing = makeListingPayload(draftValues, publish);
    const availability = publish ? {
      startDate: $("#availability-start").value,
      endDate: $("#availability-end").value,
      units: Number($("#availability-units").value),
    } : {};
    const response = await ownerApi("POST", { listing, availability, publish });
    return response.item;
  }

  async function handleListingSubmit(event) {
    event.preventDefault();
    if (busy) return;
    const publish = event.submitter?.value === "publish";
    const button = event.submitter;
    const oldText = button?.textContent;
    setBusy(true);
    if (button) button.textContent = publish ? "Publishing…" : "Saving…";
    setStatus(listingStatus, publish ? "Checking details and preparing the listing…" : "Saving your draft securely…");
    try {
      const item = await saveListing(publish);
      if (publish && item?.slug) {
        try { localStorage.removeItem(draftStorageKey); } catch { /* Optional local recovery. */ }
        setStatus(listingStatus, "Published and saved. Opening the public listing…", "success");
        await refreshListings();
        window.location.assign(`rental.html?slug=${encodeURIComponent(item.slug)}`);
        return;
      }
      setStatus(listingStatus, "Draft saved to your owner account.", "success");
      await refreshListings();
    } catch (error) {
      setStatus(listingStatus, error.message, "error");
      storeLocalDraft();
    } finally {
      setBusy(false);
      if (button) button.textContent = oldText || (publish ? "Publish listing" : "Save draft");
      uploadProgress.hidden = true;
    }
  }

  async function handleAuthSubmit(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    const email = $("#owner-email").value.trim();
    const password = $("#owner-password").value;
    const submit = $("#owner-auth-submit");
    const oldText = submit.textContent;
    submit.textContent = authMode === "signup" ? "Creating account…" : "Signing in…";
    setStatus(authStatus, authMode === "signup" ? "Creating your account…" : "Checking your details…");
    try {
      const result = authMode === "signup"
        ? await authRequest("signup", { email, password, data: { full_name: $("#owner-name").value.trim() } })
        : await authRequest("token?grant_type=password", { email, password });
      if (result.access_token && result.refresh_token) {
        saveSession(result);
        setStatus(authStatus, "Signed in. Loading your workspace…", "success");
        await enterWorkspace();
      } else if (authMode === "signup") {
        switchAuthMode("signin");
        setStatus(authStatus, "Account created. Check your email for the verification link, then sign in here. Your draft is saved on this device.", "success");
      } else {
        throw new Error("Sign-in did not return a session. Confirm your email address and try again.");
      }
    } catch (error) {
      setStatus(authStatus, error.message || "Authentication could not be completed.", "error");
    } finally {
      setBusy(false);
      submit.textContent = oldText;
    }
  }

  async function enterWorkspace() {
    const active = await ensureSession();
    if (!active) return;
    showWorkspace();
    await refreshListings();
    if (draft) await restoreDraft(draft);
  }

  async function signOut() {
    try {
      if (session && config?.supabase) await authRequest("logout", {}, session.access_token);
    } catch { /* The local session is removed even when remote sign-out is unavailable. */ }
    clearSession();
    showAuth("You have signed out.");
  }

  async function loadConfig() {
    try {
      const response = await fetch("/api/config", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.supabase?.url || !data.supabase?.publishableKey) throw new Error("Supabase authentication and storage are not configured for this deployment.");
      config = data;
      liveStatus.textContent = "Secure owner service connected.";
      liveStatus.dataset.kind = "success";
      draft = readLocalDraft();
      if (!$("#listing-id").value) $("#listing-id").value = draft?.id || crypto.randomUUID();
      const saved = getSavedSession();
      session = saved;
      if (session) {
        try {
          const userResponse = await fetch(`${config.supabase.url}/auth/v1/user`, { headers: { apikey: config.supabase.publishableKey, Authorization: `Bearer ${session.access_token}` } });
          if (!userResponse.ok && Number(session.expires_at) <= Date.now() / 1000 + 75) await ensureSession();
          const active = await ensureSession();
          if (active) {
            const user = await fetch(`${config.supabase.url}/auth/v1/user`, { headers: { apikey: config.supabase.publishableKey, Authorization: `Bearer ${session.access_token}` } });
            if (!user.ok) throw new Error("session expired");
            session.user = await user.json();
            saveSession(session);
            await enterWorkspace();
            return;
          }
        } catch { clearSession(); }
      }
      showAuth();
      if (draft) await restoreDraft(draft);
    } catch (error) {
      liveStatus.textContent = error.message || "The owner service could not be connected.";
      liveStatus.dataset.kind = "error";
      authPanel.hidden = true;
      workspace.hidden = true;
    }
  }

  const menuToggle = $(".menu-toggle");
  const nav = $("#primary-nav");
  if (menuToggle && nav) {
    menuToggle.addEventListener("click", () => {
      const open = menuToggle.getAttribute("aria-expanded") !== "true";
      menuToggle.setAttribute("aria-expanded", String(open));
      menuToggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
      nav.classList.toggle("is-open", open);
    });
    nav.querySelectorAll("a").forEach((link) => link.addEventListener("click", () => {
      menuToggle.setAttribute("aria-expanded", "false"); nav.classList.remove("is-open");
    }));
  }
  categorySelect.addEventListener("change", () => {
    renderCategoryFields(categorySelect.value);
    setStatus(listingStatus, "Category changed. Review the details for this listing type.");
    storeLocalDraft();
  });
  photoInput.addEventListener("change", onPhotosSelected);
  listingForm.addEventListener("input", () => { storeLocalDraft(); updatePreview(); });
  listingForm.addEventListener("change", () => { storeLocalDraft(); updatePreview(); });
  listingForm.addEventListener("submit", handleListingSubmit);
  authForm.addEventListener("submit", handleAuthSubmit);
  $("#owner-preview-open").addEventListener("click", () => {
    updatePreview();
    $("#owner-preview-dialog").showModal();
    $("#owner-preview-close").focus({ preventScroll: true });
  });
  $("#owner-preview-close").addEventListener("click", () => $("#owner-preview-dialog").close());
  $("#owner-auth-switch").addEventListener("click", () => switchAuthMode(authMode === "signin" ? "signup" : "signin"));
  $("#owner-signout").addEventListener("click", signOut);
  $("#owner-reset-form").addEventListener("click", () => {
    if (!window.confirm("Start a new listing? Your saved account draft will remain in your listings.")) return;
    listingForm.reset();
    selectedPhotos.forEach((photo) => { if (photo.objectUrl) URL.revokeObjectURL(photo.objectUrl); });
    selectedPhotos = [];
    $("#listing-id").value = crypto.randomUUID();
    $("#listing-min-days").value = "1";
    $("#availability-units").value = "1";
    renderCategoryFields(""); renderPhotos();
    $("#wizard-title").textContent = "Tell renters what you offer.";
    $("#wizard-eyebrow").textContent = "Create a listing";
    setStatus(listingStatus, "");
  });
  $("#year").textContent = String(new Date().getFullYear());
  switchAuthMode("signin");
  loadConfig();
})();
