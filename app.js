(() => {
  const categories = [
    { id: "stay", label: "Stay", itemHint: "Apartment or stay name", keywords: ["stay", "stays", "accommodation", "hotel", "apartment", "house", "villa", "room", "bedroom", "weekend away", "sleep", "place to stay", "coast", "beach house"] },
    { id: "drive", label: "Drive", itemHint: "Car or SUV", keywords: ["drive", "car", "vehicle", "suv", "mercedes", "bmw", "maybach", "pickup", "transport", "road trip", "get around", "wheels"] },
    { id: "play", label: "Play", itemHint: "Console or gaming setup", keywords: ["play", "game", "gaming", "console", "playstation", "ps5", "xbox", "nintendo", "controller", "headset", "game night"] },
    { id: "tech", label: "Technology", itemHint: "Phone, camera or laptop", keywords: ["technology", "tech", "phone", "iphone", "camera", "laptop", "tablet", "computer", "electronics", "device", "monitor"] },
    { id: "explore", label: "Experience", itemHint: "Activity or experience", keywords: ["explore", "experience", "activity", "safari", "balloon", "tour", "trip", "excursion", "adventure", "boat", "coast", "beach", "scenery", "wildlife"] }
  ];
  const storageKey = "lockd:bundle-draft:v2";
  const dialog = document.querySelector("#bundle-dialog");
  const form = document.querySelector("#bundle-form");
  const itemsContainer = document.querySelector("#bundle-items");
  const result = document.querySelector("#draft-result");
  const summary = document.querySelector("#draft-summary");
  const draftStatus = document.querySelector("#draft-status");
  const toast = document.querySelector("#toast");
  const menuToggle = document.querySelector(".menu-toggle");
  const nav = document.querySelector("#primary-nav");
  let toastTimer;
  let itemSequence = 0;

  function announce(message) {
    toast.textContent = message;
    toast.classList.add("is-visible");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 3200);
  }

  function currentItems() {
    return Array.from(itemsContainer.querySelectorAll(".bundle-item"), (row) => ({
      category: row.dataset.category,
      name: row.querySelector("[data-item-name]").value.trim(),
      quantity: row.querySelector("[data-quantity]").value,
      accessories: row.querySelector("[data-accessories]").value.trim()
    }));
  }

  function fieldValues() {
    return {
      items: currentItems(),
      start: form.elements.start.value,
      end: form.elements.end.value,
      delivery: form.elements.delivery.value,
      location: form.elements.location.value.trim(),
      notes: form.elements.notes.value.trim()
    };
  }

  function saveBundle() {
    try {
      localStorage.setItem(storageKey, JSON.stringify(fieldValues()));
    } catch {
      // The builder remains usable in the current tab when storage is unavailable.
    }
  }

  function updatePriceSummary() {
    const items = currentItems();
    const units = items.reduce((total, item) => total + (Number.parseInt(item.quantity, 10) || 0), 0);
    const start = form.elements.start.value;
    const end = form.elements.end.value;
    document.querySelector("#summary-items-count").textContent = String(items.length);
    document.querySelector("#summary-units-count").textContent = String(units);
    document.querySelector("#summary-period").textContent = start && end ? `${start} to ${end}` : start || end || "Dates not selected";
    document.querySelector("#summary-price").textContent = "Awaiting confirmed rates";
  }

  function addItem(categoryId, values = {}) {
    const category = categories.find((entry) => entry.id === categoryId);
    if (!category) return;

    itemSequence += 1;
    const row = document.createElement("section");
    row.className = "bundle-item";
    row.dataset.category = category.id;
    row.dataset.row = String(itemSequence);

    const top = document.createElement("div");
    top.className = "bundle-item-top";
    const title = document.createElement("h3");
    title.textContent = category.label;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove-item";
    remove.textContent = "Remove";
    remove.setAttribute("aria-label", `Remove ${category.label.toLowerCase()} item`);
    remove.addEventListener("click", () => {
      row.remove();
      updatePriceSummary();
      saveBundle();
      if (!itemsContainer.querySelector(".bundle-item")) renderEmptyItemsMessage();
    });
    top.append(title, remove);

    const fields = document.createElement("div");
    fields.className = "bundle-item-fields";

    const nameLabel = document.createElement("label");
    nameLabel.className = "item-name-field";
    nameLabel.textContent = "Rental item you have in mind";
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.placeholder = category.itemHint;
    nameInput.value = typeof values.name === "string" ? values.name : "";
    nameInput.dataset.itemName = "true";
    nameInput.autocomplete = "off";
    nameLabel.append(nameInput);

    const quantityLabel = document.createElement("label");
    quantityLabel.className = "quantity-field";
    quantityLabel.textContent = "Qty";
    const quantityInput = document.createElement("input");
    quantityInput.type = "number";
    quantityInput.min = "1";
    quantityInput.max = "20";
    quantityInput.step = "1";
    quantityInput.value = String(values.quantity || "1");
    quantityInput.inputMode = "numeric";
    quantityInput.dataset.quantity = "true";
    quantityLabel.append(quantityInput);

    const accessoryLabel = document.createElement("label");
    accessoryLabel.className = "accessories-field";
    accessoryLabel.textContent = "Accessories or extras";
    const accessoryInput = document.createElement("input");
    accessoryInput.type = "text";
    accessoryInput.placeholder = "Optional; inclusion needs confirmation";
    accessoryInput.value = typeof values.accessories === "string" ? values.accessories : "";
    accessoryInput.dataset.accessories = "true";
    accessoryLabel.append(accessoryInput);

    fields.append(nameLabel, quantityLabel, accessoryLabel);
    row.append(top, fields);
    itemsContainer.querySelector(".bundle-empty")?.remove();
    itemsContainer.append(row);
    updatePriceSummary();
  }

  function renderEmptyItemsMessage() {
    if (itemsContainer.querySelector(".bundle-item")) return;
    const empty = document.createElement("p");
    empty.className = "bundle-empty";
    empty.textContent = "Choose a category above to add an item.";
    itemsContainer.replaceChildren(empty);
  }

  function restoreBundle() {
    let saved;
    try {
      saved = JSON.parse(localStorage.getItem(storageKey) || "null");
    } catch {
      saved = null;
    }
    form.reset();
    itemsContainer.replaceChildren();
    if (saved && typeof saved === "object") {
      for (const name of ["start", "end", "delivery", "location", "notes"]) {
        if (typeof saved[name] === "string" && form.elements[name]) form.elements[name].value = saved[name];
      }
      if (Array.isArray(saved.items)) {
        saved.items.forEach((item) => {
          if (item && categories.some((entry) => entry.id === item.category)) addItem(item.category, item);
        });
      }
    }
    renderEmptyItemsMessage();
    updatePriceSummary();
  }

  function openBundle({ category = "", idea = "" } = {}) {
    restoreBundle();
    if (category) addItem(category);
    if (idea && !form.elements.notes.value.trim()) form.elements.notes.value = idea;
    saveBundle();
    result.hidden = true;
    dialog.showModal();
    document.body.classList.add("dialog-open");
    window.setTimeout(() => {
      const target = category ? itemsContainer.querySelector(".bundle-item:last-child [data-item-name]") : document.querySelector(".dialog-close");
      target?.focus();
    }, 0);
  }

  function closeBundle() {
    if (dialog.open) dialog.close();
  }

  document.querySelectorAll("[data-open-bundle]").forEach((button) => button.addEventListener("click", () => openBundle()));
  document.querySelectorAll("[data-category]").forEach((button) => button.addEventListener("click", () => openBundle({ category: button.dataset.category })));
  document.querySelectorAll("[data-add-item]").forEach((button) => button.addEventListener("click", () => {
    addItem(button.dataset.addItem);
    saveBundle();
    itemsContainer.querySelector(".bundle-item:last-child [data-item-name]")?.focus();
  }));
  document.querySelectorAll("[data-close-bundle]").forEach((button) => button.addEventListener("click", closeBundle));
  dialog.addEventListener("close", () => document.body.classList.remove("dialog-open"));
  dialog.addEventListener("click", (event) => { if (event.target === dialog) closeBundle(); });
  dialog.addEventListener("cancel", () => document.body.classList.remove("dialog-open"));
  form.addEventListener("input", () => {
    saveBundle();
    updatePriceSummary();
    if (!result.hidden) result.hidden = true;
  });
  form.addEventListener("change", () => {
    saveBundle();
    updatePriceSummary();
  });

  function makeSummary() {
    const items = currentItems();
    const values = fieldValues();
    if (!items.length) {
      announce("Add at least one item to your bundle.");
      document.querySelector(".category-picker").scrollIntoView({ behavior: "smooth", block: "center" });
      return "";
    }
    const missingName = items.findIndex((item) => !item.name);
    if (missingName !== -1) {
      announce("Add a name for each rental item.");
      itemsContainer.querySelectorAll("[data-item-name]")[missingName]?.focus();
      return "";
    }
    const invalidQuantity = items.findIndex((item) => !Number.isInteger(Number(item.quantity)) || Number(item.quantity) < 1 || Number(item.quantity) > 20);
    if (invalidQuantity !== -1) {
      announce("Quantities must be between 1 and 20.");
      itemsContainer.querySelectorAll("[data-quantity]")[invalidQuantity]?.focus();
      return "";
    }
    if (values.start && values.end && values.end < values.start) {
      form.elements.end.setCustomValidity("Choose an end date on or after the start date.");
      form.elements.end.reportValidity();
      form.elements.end.setCustomValidity("");
      return "";
    }
    if (values.delivery === "Delivery" && !values.location) {
      announce("Add a city or area for delivery.");
      form.elements.location.focus();
      return "";
    }

    const lines = ["LOCKD bundle draft", "Items:"];
    items.forEach((item) => {
      const category = categories.find((entry) => entry.id === item.category)?.label || "Rental";
      lines.push(`- ${category}: ${item.name} (quantity ${item.quantity})${item.accessories ? `; accessories/extras: ${item.accessories}` : ""}`);
    });
    if (values.start) lines.push(`Start date: ${values.start}`);
    if (values.end) lines.push(`End date: ${values.end}`);
    if (values.delivery) lines.push(`Delivery or collection: ${values.delivery}`);
    if (values.location) lines.push(`Location: ${values.location}`);
    if (values.notes) lines.push(`Additional details: ${values.notes}`);
    lines.push(
      "",
      `Price summary: ${items.length} requested item${items.length === 1 ? "" : "s"}; ${items.reduce((total, item) => total + Number(item.quantity), 0)} total unit${items.reduce((total, item) => total + Number(item.quantity), 0) === 1 ? "" : "s"}; rates awaiting confirmation.`,
      "No total is available because live inventory, rates and checkout are not connected.",
      "Not sent. No booking or reservation has been made."
    );
    return lines.join("\n");
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = makeSummary();
    if (!text) return;
    summary.textContent = text;
    result.hidden = false;
    draftStatus.textContent = "Not sent. No booking or reservation has been made.";
    result.scrollIntoView({ behavior: "smooth", block: "nearest" });
    saveBundle();
  });

  async function copySummary() {
    const text = summary.textContent;
    try {
      await navigator.clipboard.writeText(text);
      draftStatus.textContent = "Copied to your clipboard. Not sent; no booking has been made.";
      announce("Bundle copied. It has not been sent.");
    } catch {
      const fallback = document.createElement("textarea");
      fallback.value = text;
      fallback.setAttribute("readonly", "");
      fallback.style.position = "fixed";
      fallback.style.opacity = "0";
      document.body.append(fallback);
      fallback.select();
      const copied = document.execCommand("copy");
      fallback.remove();
      draftStatus.textContent = copied
        ? "Copied to your clipboard. Not sent; no booking has been made."
        : "Select and copy the bundle details above. They have not been sent.";
      announce(copied ? "Bundle copied. It has not been sent." : "Bundle is ready to select and copy.");
    }
  }

  document.querySelector("#copy-draft").addEventListener("click", copySummary);
  document.querySelector("#edit-draft").addEventListener("click", () => {
    result.hidden = true;
    itemsContainer.querySelector("[data-item-name]")?.focus();
  });
  document.querySelector("#clear-draft").addEventListener("click", () => {
    form.reset();
    itemsContainer.replaceChildren();
    renderEmptyItemsMessage();
    result.hidden = true;
    updatePriceSummary();
    try { localStorage.removeItem(storageKey); } catch { /* Ignore unavailable storage. */ }
    announce("Bundle cleared from this device.");
  });

  const searchForm = document.querySelector("#idea-search-form");
  const searchInput = document.querySelector("#idea-search");
  const searchResults = document.querySelector("#search-results");
  searchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const idea = searchInput.value.trim();
    if (!idea) {
      searchInput.focus();
      announce("Add a few words about the plan you have in mind.");
      return;
    }
    const normalized = idea.toLowerCase();
    const matches = categories.filter((category) => category.keywords.some((keyword) => normalized.includes(keyword)));
    const options = matches.length ? matches : categories;
    const intro = matches.length
      ? `Based on the words in “${idea}”, choose a category to add to your bundle:`
      : `No clear category match for “${idea}”. Choose where to start:`;
    searchResults.replaceChildren();
    const text = document.createElement("p");
    text.textContent = intro;
    const list = document.createElement("div");
    list.className = "search-hit-list";
    options.forEach((category) => {
      const button = document.createElement("button");
      button.className = "search-hit";
      button.type = "button";
      button.textContent = `Choose ${category.label}`;
      button.addEventListener("click", () => openBundle({ category: category.id, idea }));
      list.append(button);
    });
    searchResults.append(text, list);
    searchResults.hidden = false;
    searchResults.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });

  menuToggle.addEventListener("click", () => {
    const open = menuToggle.getAttribute("aria-expanded") !== "true";
    menuToggle.setAttribute("aria-expanded", String(open));
    menuToggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    nav.classList.toggle("is-open", open);
  });
  nav.querySelectorAll("a").forEach((link) => link.addEventListener("click", () => {
    menuToggle.setAttribute("aria-expanded", "false");
    menuToggle.setAttribute("aria-label", "Open menu");
    nav.classList.remove("is-open");
  }));

  restoreBundle();
  document.querySelector("#year").textContent = String(new Date().getFullYear());
})();
