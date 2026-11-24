(() => {
  const form = document.querySelector("#product-form");
  const formMessage = document.querySelector("#form-message");
  const productsMessage = document.querySelector("#products-message");
  const productList = document.querySelector("#admin-product-list");
  const idField = form.elements.id;
  const submitButton = form.querySelector("button[type=submit]");
  const cancelEdit = document.querySelector("#cancel-edit");
  const adminMessage = document.querySelector("#admin-message");
  const orderList = document.querySelector("#admin-order-list");
  const orderFilter = document.querySelector("#order-filter");
  const ordersMessage = document.querySelector("#orders-message");
  const { STATUS_LABELS, element, formatPrice, formatDate, statusBadge, renderOrder } = window.PitstopOrders;
  const tabs = ["dashboard", "orders", "products"];
  let products = [];

  function showTab(name, focus = false) {
    const tab = tabs.includes(name) ? name : "dashboard";
    tabs.forEach((entry) => {
      const button = document.querySelector(`#tab-${entry}`);
      const selected = entry === tab;
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
      document.querySelector(`#panel-${entry}`).hidden = !selected;
      if (selected && focus) button.focus();
    });
    if (window.location.hash !== `#${tab}`) history.replaceState(null, "", `#${tab}`);
  }

  function optionalNumber(value) {
    return value === null || String(value).trim() === "" ? null : Number(value);
  }

  function renderWaitlists(waitlists) {
    const container = document.querySelector("#waitlists");
    if (!waitlists.length) {
      listMessage(container, "No one is waiting yet. Customers can ask to be told when sold-out or pre-order models are available.");
      return;
    }
    container.replaceChildren(...waitlists.map(({ product, waiting, emails }) => {
      const row = element("div", "dashboard-row waitlist-row");
      const edit = element("button", "waitlist-name");
      edit.type = "button";
      edit.dataset.editStock = product.id;
      const ready = product.stock > 0 && !product.preorder;
      const state = product.preorder ? "Pre-order" : ready ? "Back in stock" : "Sold out";
      edit.append(element("strong", "", product.name), element("small", "", `${waiting} waiting · ${state}`));
      const mail = element("a", "dash-link", "Email list");
      const subject = ready ? `${product.name} is available at PitStop.co` : `Update on ${product.name} from PitStop.co`;
      mail.href = `mailto:?bcc=${emails.map(encodeURIComponent).join(",")}&subject=${encodeURIComponent(subject)}`;
      row.append(edit, mail);
      return row;
    }));
  }

  function listMessage(container, text) {
    container.replaceChildren(element("p", "dashboard-empty", text));
  }

  async function loadDashboard() {
    const data = await window.PitstopApi.request("/api/admin/dashboard");
    const counts = data.statusCounts;
    document.querySelector("#stat-sales").textContent = formatPrice(data.sales);
    document.querySelector("#stat-sales-sub").textContent = `${formatPrice(data.sales30Days)} in the last 30 days`;
    document.querySelector("#stat-pending").textContent = counts.pending;
    document.querySelector("#stat-pending-sub").textContent = `${data.orders30Days} ${data.orders30Days === 1 ? "order" : "orders"} in the last 30 days`;
    document.querySelector("#stat-customers").textContent = data.customers;
    document.querySelector("#stat-customers-sub").textContent = `${data.unitsInBags} ${data.unitsInBags === 1 ? "item" : "items"} waiting in bags`;
    document.querySelector("#stat-stock").textContent = data.unitsInStock;
    document.querySelector("#stat-stock-sub").textContent = `${data.products} products · ${data.soldOut} sold out · ${formatPrice(data.stockValue)} value`;

    const badge = document.querySelector("#pending-badge");
    badge.hidden = counts.pending === 0;
    badge.textContent = counts.pending;
    badge.setAttribute("aria-label", `${counts.pending} pending`);

    const flow = document.querySelector("#order-flow");
    flow.replaceChildren(...Object.keys(STATUS_LABELS).map((status) => {
      const step = element("li", `flow-step flow-${status}`);
      const button = element("button");
      button.type = "button";
      button.dataset.flow = status;
      button.append(element("strong", "", counts[status]), element("span", "", STATUS_LABELS[status]));
      step.append(button);
      return step;
    }));

    const recent = document.querySelector("#recent-orders");
    if (data.recentOrders.length) {
      recent.replaceChildren(...data.recentOrders.map((order) => {
        const row = element("button", "dashboard-row");
        row.type = "button";
        row.dataset.flow = order.status;
        const text = element("span");
        text.append(element("strong", "", `#${order.id} · ${order.name}`), element("small", "", `${formatDate(order.createdAt)} · ${formatPrice(order.subtotal)}`));
        row.append(text, statusBadge(order.status));
        return row;
      }));
    } else {
      listMessage(recent, "No orders yet. They appear here when customers check out.");
    }

    const alerts = document.querySelector("#stock-alerts");
    if (data.stockAlerts.length) {
      alerts.replaceChildren(...data.stockAlerts.map((product) => {
        const row = element("button", "dashboard-row");
        row.type = "button";
        row.dataset.editStock = product.id;
        const text = element("span");
        text.append(element("strong", "", product.name), element("small", "", product.make));
        row.append(text, element("span", `stock-status ${product.stock ? "in-stock low-stock" : "sold-out"}`, product.stock ? `${product.stock} left` : "Sold out"));
        return row;
      }));
    } else {
      listMessage(alerts, "Every product has more than 2 in stock.");
    }

    renderWaitlists(data.waitlists || []);

    const top = document.querySelector("#top-products");
    if (data.topProducts.length) {
      top.replaceChildren(...data.topProducts.map((product) => {
        const row = element("div", "dashboard-row");
        const text = element("span");
        text.append(element("strong", "", product.name), element("small", "", `${product.units} sold`));
        row.append(text, element("span", "", formatPrice(product.revenue)));
        return row;
      }));
    } else {
      listMessage(top, "Best sellers appear after your first orders.");
    }
  }

  async function loadOrders() {
    const status = orderFilter.value;
    const { orders } = await window.PitstopApi.request(`/api/admin/orders?status=${encodeURIComponent(status)}`);
    orderList.replaceChildren(...orders.map((order) => renderOrder(order, { admin: true })));
    if (!orders.length) listMessage(orderList, status === "all" ? "No orders yet." : `No ${STATUS_LABELS[status].toLowerCase()} orders.`);
    document.querySelector("#order-count").textContent = `${orders.length} ${orders.length === 1 ? "order" : "orders"}`;
  }

  async function refreshAll() {
    await Promise.all([loadDashboard(), loadOrders(), loadProducts()]);
  }

  function editProduct(productId) {
    const product = products.find((entry) => entry.id === productId);
    if (!product) return;
    idField.value = product.id;
    idField.readOnly = true;
    for (const key of ["name", "price", "stock", "image", "imageAlt", "description"]) {
      form.elements[key].value = product[key];
    }
    CHOICE_KEYS.forEach((key) => setChoice(key, product[key]));
    form.elements.bestSeller.checked = product.bestSeller;
    form.elements.newArrival.checked = product.newArrival;
    form.elements.chase.checked = product.chase;
    form.elements.preorder.checked = product.preorder;
    form.elements.editionSize.value = product.editionSize ?? "";
    form.elements.lengthMm.value = product.lengthMm ?? "";
    form.elements.releaseDate.value = product.releaseDate || "";
    galleryItems = product.gallery.map((photo) => ({ ...photo }));
    Object.keys(trays).forEach(clearTray);
    renderPhotoEditors();
    document.querySelector("#product-form-title").textContent = `Edit ${product.name}`;
    submitButton.textContent = "Save changes";
    cancelEdit.hidden = false;
    form.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function loadProducts() {
    const [result, catalog] = await Promise.all([
      window.PitstopApi.request("/api/admin/products"),
      window.PitstopApi.request("/api/products"),
    ]);
    products = result.products;
    renderProducts();
    loadChoices(catalog);
  }

  // ---- Dropdowns for brand, category, scale, and condition ----
  // One spelling per value keeps filters and "Shop by brand" tidy.
  const CHOICE_KEYS = ["make", "category", "scale", "condition"];
  const NEW_CHOICE = "__new__";
  const CHOICE_NOUNS = { make: "brand", category: "category", scale: "scale", condition: "condition" };
  const STARTER_CHOICES = {
    make: [],
    category: [],
    scale: ["1:18 scale", "1:24 scale", "1:32 scale", "1:43 scale", "1:64 scale"],
    condition: ["New", "New (box has wear)", "Pre-owned", "Loose (no box)"],
  };
  const choices = Object.fromEntries(CHOICE_KEYS.map((key) => [key, [...STARTER_CHOICES[key]]]));

  // "minigt", "Mini-GT" and "MINI GT" all become "minigt"; "1:64" and "1:64 scale" match too.
  function choiceKey(value) {
    return String(value).toLowerCase().replace(/scale/g, "").replace(/[^a-z0-9:]/g, "");
  }

  function findChoice(key, value) {
    return choices[key].find((entry) => choiceKey(entry) === choiceKey(value));
  }

  function addChoice(key, value) {
    const clean = String(value || "").trim();
    if (!clean || findChoice(key, clean)) return;
    choices[key].push(clean);
  }

  function renderChoice(key) {
    const select = form.elements[key];
    const current = select.value;
    const sorted = key === "scale"
      ? [...choices.scale].sort((a, b) => (parseInt(a.split(":")[1], 10) || 0) - (parseInt(b.split(":")[1], 10) || 0))
      : [...choices[key]].sort((a, b) => a.localeCompare(b));
    const placeholder = element("option", "", `Choose a ${CHOICE_NOUNS[key]}…`);
    placeholder.value = "";
    const addNew = element("option", "", `+ Add a new ${CHOICE_NOUNS[key]}…`);
    addNew.value = NEW_CHOICE;
    select.replaceChildren(placeholder, ...sorted.map((value) => {
      const option = element("option", "", value);
      option.value = value;
      return option;
    }), addNew);
    select.value = current && [...select.options].some((option) => option.value === current) ? current : "";
    syncNewChoice(key);
  }

  function syncNewChoice(key) {
    const input = form.elements[`${key}New`];
    const adding = form.elements[key].value === NEW_CHOICE;
    input.hidden = !adding;
    input.required = adding;
  }

  function setChoice(key, value) {
    addChoice(key, value);
    renderChoice(key);
    form.elements[key].value = findChoice(key, value) || "";
    syncNewChoice(key);
  }

  function choiceValue(key) {
    const selected = form.elements[key].value;
    if (selected !== NEW_CHOICE) return selected;
    const typed = form.elements[`${key}New`].value.trim();
    return findChoice(key, typed) || typed; // Reuse the existing spelling if it already exists.
  }

  function loadChoices(catalog) {
    (catalog.brands || []).forEach((value) => addChoice("make", value));
    (catalog.categories || []).forEach((value) => addChoice("category", value));
    products.forEach((product) => CHOICE_KEYS.forEach((key) => addChoice(key, product[key])));
    CHOICE_KEYS.forEach(renderChoice);
  }

  CHOICE_KEYS.forEach((key) => {
    form.elements[key].addEventListener("change", () => {
      syncNewChoice(key);
      if (form.elements[key].value === NEW_CHOICE) form.elements[`${key}New`].focus();
    });
  });

  function renderProducts() {
    productList.replaceChildren();
    products.forEach((product) => {
      const row = document.createElement("article");
      row.className = "admin-product-row";
      const thumb = element("div", "admin-product-thumb");
      if (product.image) {
        const image = element("img");
        image.src = product.image;
        image.alt = "";
        image.loading = "lazy";
        thumb.append(image);
      } else {
        thumb.textContent = product.make.slice(0, 2).toUpperCase();
      }
      const details = element("div", "admin-product-details");
      const name = element("h3", "", product.name);
      const meta = element("p", "", `${product.make} · ${product.scale} · ${product.category}`);
      details.append(name, meta);
      const price = element("strong", "admin-product-price", formatPrice(product.price));
      const stockLabel = product.stock === 0 ? "Sold out" : `${product.stock} in stock`;
      const stockClass = product.stock === 0 ? "sold-out" : product.stock <= 2 ? "low" : "ok";
      const stock = element("span", `stock-pill stock-${stockClass}`, stockLabel);

      const actions = document.createElement("div");
      actions.className = "admin-row-actions";
      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "secondary-button";
      edit.dataset.edit = product.id;
      edit.textContent = "Edit";
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "secondary-button";
      remove.dataset.delete = product.id;
      remove.textContent = "Delete";
      actions.append(edit, remove);
      row.append(thumb, details, price, stock, actions);
      productList.append(row);
    });
    document.querySelector("#product-count").textContent = `${products.length} ${products.length === 1 ? "product" : "products"}`;
    if (!products.length) {
      const empty = document.createElement("p");
      empty.textContent = "No products have been added yet.";
      productList.append(empty);
    }
  }

  // ---- Photo uploads ----
  const MAX_GALLERY = 12;
  const MAX_EDGE = 1800;
  const uploadStatus = document.querySelector("#upload-status");
  const imageField = form.elements.image;
  let galleryItems = [];
  let uploading = false;

  // Phone photos are often 4000px+ and several MB. Shrink them in the browser so
  // the upload is quick and product pages stay fast. GIFs are left alone (animation).
  async function shrinkPhoto(file) {
    if (file.type === "image/gif" || !window.createImageBitmap) return file;
    let bitmap;
    try {
      bitmap = await createImageBitmap(file);
    } catch {
      return file; // Let the server explain what it can't read.
    }
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 1.5 * 1024 * 1024) {
      bitmap.close();
      return file;
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext("2d");
    context.fillStyle = "#fff"; // Transparent PNGs become white, not black, as JPEG.
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.86));
    return blob ? new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" }) : file;
  }

  // Each upload shows as a tile: a preview straight away, a progress bar,
  // then a green tick or a red cross with the reason and "Try again".
  const trays = { main: [], gallery: [] };
  let activeUploads = 0;
  let trayItemId = 0;
  let csrfToken = "";

  async function getCsrfToken() {
    if (!csrfToken) {
      const response = await fetch("/api/csrf", { headers: { Accept: "application/json" } });
      csrfToken = (await response.json()).token;
    }
    return csrfToken;
  }

  // XMLHttpRequest rather than fetch, because only XHR reports upload progress.
  function sendPhoto(file, onProgress) {
    return getCsrfToken().then((token) => new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/admin/uploads");
      xhr.setRequestHeader("Accept", "application/json");
      xhr.setRequestHeader("X-CSRF-Token", token);
      xhr.upload.addEventListener("progress", (event) => {
        if (event.lengthComputable) onProgress(event.loaded / event.total);
      });
      xhr.addEventListener("load", () => {
        let data = {};
        try { data = JSON.parse(xhr.responseText); } catch { /* handled below */ }
        if (xhr.status >= 200 && xhr.status < 300 && data.path) resolve(data.path);
        else if (xhr.status === 401 || xhr.status === 403) reject(new Error("You're signed out. Sign in again as an admin."));
        else if (xhr.status === 413) reject(new Error("The photo is over 10 MB."));
        else reject(new Error(data.error || `The server said no (error ${xhr.status}).`));
      });
      xhr.addEventListener("error", () => reject(new Error("Couldn't reach the shop. Is the app still running?")));
      const body = new FormData();
      body.append("photo", file);
      xhr.send(body);
    }));
  }

  function setUploading(change) {
    activeUploads += change;
    uploading = activeUploads > 0;
    submitButton.disabled = uploading;
    submitButton.title = uploading ? "Wait for the photos to finish uploading" : "";
  }

  async function runUpload(target, item) {
    item.status = "uploading";
    item.progress = 0;
    item.error = "";
    renderTray(target);
    setUploading(1);
    try {
      const shrunk = await shrinkPhoto(item.file);
      const path = await sendPhoto(shrunk, (fraction) => {
        item.progress = fraction;
        const bar = document.querySelector(`[data-tray-item="${item.id}"] .tray-progress i`);
        if (bar) bar.style.width = `${Math.round(fraction * 100)}%`;
      });
      item.status = "done";
      item.path = path;
      // Skip if the form was cleared or switched to another product meanwhile.
      if (trays[target].includes(item)) item.onDone(path);
    } catch (error) {
      item.status = "failed";
      item.error = /\.(heic|heif)$/i.test(item.file.name)
        ? "iPhone HEIC photos can't be used. Convert it to JPG first."
        : error.message;
    } finally {
      setUploading(-1);
      renderTray(target);
      renderPhotoEditors();
    }
  }

  function startUploads(target, files, onDoneFor, { replace = false } = {}) {
    if (replace) clearTray(target);
    const items = files.map((file, index) => ({
      id: `u${++trayItemId}`,
      file,
      name: file.name,
      preview: URL.createObjectURL(file),
      status: "waiting",
      progress: 0,
      error: "",
      onDone: onDoneFor(file, index),
    }));
    trays[target].push(...items);
    renderTray(target);
    // One at a time keeps a big batch from flooding the connection.
    items.reduce((chain, item) => chain.then(() => runUpload(target, item)), Promise.resolve());
  }

  function clearTray(target) {
    trays[target].forEach((item) => URL.revokeObjectURL(item.preview));
    trays[target] = [];
    renderTray(target);
  }

  function trayIcon(status) {
    if (status === "done") return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 12.5l4.5 4.5L19 7.5"></path></svg>';
    if (status === "failed") return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 7l10 10M17 7 7 17"></path></svg>';
    return "";
  }

  function renderTray(target) {
    const tray = form.querySelector(`[data-tray="${target}"]`);
    const items = trays[target];
    tray.hidden = !items.length;
    if (!items.length) {
      tray.replaceChildren();
      return;
    }
    const done = items.filter((item) => item.status === "done").length;
    const failed = items.filter((item) => item.status === "failed").length;
    const busy = items.length - done - failed;
    let summary;
    if (busy) summary = `Uploading ${done + failed + 1} of ${items.length}…`;
    else if (failed && done) summary = `${done} uploaded, ${failed} failed`;
    else if (failed) summary = failed === 1 ? "Upload failed" : `${failed} uploads failed`;
    else summary = done === 1 ? "Uploaded" : `All ${done} photos uploaded`;

    const head = element("div", `tray-head${failed && !busy ? " has-failed" : !busy ? " is-done" : ""}`);
    head.append(element("strong", "", summary));
    if (!busy) {
      const clear = element("button", "dash-link", "Dismiss");
      clear.type = "button";
      clear.dataset.trayClear = target;
      head.append(clear);
    }
    const list = element("div", "tray-items");
    items.forEach((item) => {
      const tile = element("div", `tray-item is-${item.status}`);
      tile.dataset.trayItem = item.id;
      const thumb = element("div", "tray-thumb");
      const image = element("img");
      image.src = item.preview;
      image.alt = "";
      image.addEventListener("error", () => thumb.classList.add("no-preview"), { once: true });
      thumb.append(image);
      const badge = element("span", "tray-badge");
      badge.innerHTML = trayIcon(item.status);
      thumb.append(badge);
      if (item.status === "uploading" || item.status === "waiting") {
        const bar = element("span", "tray-progress");
        const fill = element("i");
        fill.style.width = `${Math.round(item.progress * 100)}%`;
        bar.append(fill);
        thumb.append(bar);
      }
      tile.append(thumb);
      const text = element("div", "tray-text");
      const stateText = {
        waiting: "Waiting…",
        uploading: "Uploading…",
        done: "Uploaded ✓",
        failed: item.error,
      }[item.status];
      text.append(element("strong", "", item.name), element("small", "", stateText));
      if (item.status === "failed") {
        const retry = element("button", "tray-retry", "Try again");
        retry.type = "button";
        retry.dataset.trayRetry = `${target}:${item.id}`;
        text.append(retry);
      }
      tile.title = `${item.name}: ${stateText}`;
      tile.append(text);
      list.append(tile);
    });
    tray.replaceChildren(head, list);
  }

  form.addEventListener("click", (event) => {
    const clear = event.target.closest("[data-tray-clear]");
    if (clear) {
      clearTray(clear.dataset.trayClear);
      return;
    }
    const retry = event.target.closest("[data-tray-retry]");
    if (retry) {
      const [target, id] = retry.dataset.trayRetry.split(":");
      const item = trays[target].find((entry) => entry.id === id);
      if (item) runUpload(target, item);
    }
  });

  function photoFiles(fileList) {
    return [...fileList].filter((file) => file.type.startsWith("image/") || /\.(heic|heif)$/i.test(file.name));
  }

  function addPhotos(target, fileList) {
    const files = photoFiles(fileList);
    uploadStatus.textContent = "";
    if (!files.length) {
      uploadStatus.textContent = "Those files aren't photos. Use JPG, PNG, WebP, or GIF.";
      return;
    }
    if (target === "main") {
      startUploads("main", files.slice(0, 1), () => (path) => { imageField.value = path; }, { replace: true });
    } else if (target === "gallery") {
      const pending = trays.gallery.filter((item) => item.status === "waiting" || item.status === "uploading").length;
      const room = MAX_GALLERY - galleryItems.length - pending;
      if (room <= 0) {
        uploadStatus.textContent = `The gallery is full (${MAX_GALLERY} photos). Remove one first.`;
        return;
      }
      if (files.length > room) uploadStatus.textContent = `The gallery holds ${MAX_GALLERY} photos, so only the first ${room} were added.`;
      startUploads("gallery", files.slice(0, room), (file) => (path) => {
        // Start the label from the file name, e.g. "rear-wheels.jpg" -> "Rear wheels".
        const label = file.name.replace(/\.\w+$/, "").replace(/[-_]+/g, " ").replace(/^\w/, (c) => c.toUpperCase()).slice(0, 60);
        galleryItems.push({ src: path, label });
      });
    }
  }

  function renderPhotoEditors() {
    const mainSrc = imageField.value.trim();
    const preview = document.querySelector("#main-preview");
    preview.hidden = !mainSrc;
    document.querySelector("#main-empty").hidden = Boolean(mainSrc);
    if (mainSrc) preview.querySelector("img").src = mainSrc.startsWith("http") ? mainSrc : `/${mainSrc.replace(/^\//, "")}`;

    const gallery = document.querySelector("#gallery-editor");
    gallery.replaceChildren(...galleryItems.map((item, index) => {
      const row = element("li", "gallery-editor-item");
      const image = element("img");
      image.src = `/${item.src.replace(/^\//, "")}`.replace(/^\/https:/, "https:");
      image.alt = "";
      const label = element("input");
      label.type = "text";
      label.maxLength = 60;
      label.placeholder = "Label, e.g. Wheels";
      label.value = item.label;
      label.dataset.galleryLabel = index;
      label.setAttribute("aria-label", `Label for gallery photo ${index + 1}`);
      const remove = element("button", "upload-remove", "×");
      remove.type = "button";
      remove.dataset.galleryRemove = index;
      remove.setAttribute("aria-label", `Remove gallery photo ${index + 1}`);
      row.append(image, label, remove);
      return row;
    }));
    if (!galleryItems.length) gallery.append(element("li", "editor-empty", "No close-ups yet. Add photos or drop them here."));
  }

  form.addEventListener("change", (event) => {
    const input = event.target.closest("[data-upload]");
    if (!input) return;
    addPhotos(input.dataset.upload, input.files);
    input.value = "";
  });
  imageField.addEventListener("input", renderPhotoEditors);
  document.querySelector("#main-remove").addEventListener("click", () => {
    imageField.value = "";
    renderPhotoEditors();
  });
  document.querySelector("#gallery-editor").addEventListener("input", (event) => {
    const index = event.target.dataset.galleryLabel;
    if (index !== undefined) galleryItems[Number(index)].label = event.target.value;
  });
  document.querySelector("#gallery-editor").addEventListener("click", (event) => {
    const button = event.target.closest("[data-gallery-remove]");
    if (!button) return;
    galleryItems.splice(Number(button.dataset.galleryRemove), 1);
    renderPhotoEditors();
  });
  form.querySelectorAll("[data-drop]").forEach((zone) => {
    zone.addEventListener("dragover", (event) => {
      event.preventDefault();
      zone.classList.add("is-dragover");
    });
    zone.addEventListener("dragleave", () => zone.classList.remove("is-dragover"));
    zone.addEventListener("drop", (event) => {
      event.preventDefault();
      zone.classList.remove("is-dragover");
      addPhotos(zone.dataset.drop, event.dataTransfer.files);
    });
  });
  renderPhotoEditors();

  function resetForm() {
    form.reset();
    galleryItems = [];
    uploadStatus.textContent = "";
    renderPhotoEditors();
    CHOICE_KEYS.forEach(syncNewChoice);
    Object.keys(trays).forEach(clearTray);
    idField.readOnly = false;
    document.querySelector("#product-form-title").textContent = "Add a product";
    submitButton.textContent = "Add product";
    cancelEdit.hidden = true;
    formMessage.textContent = "";
  }

  async function initialize() {
    const user = await window.PitstopApi.getUser();
    if (!user) {
      window.location.replace(`/login.html?next=${encodeURIComponent("/admin.html")}`);
      return;
    }
    if (user.role !== "admin") {
      window.location.replace("/profile.html");
      return;
    }
    const today = new Intl.DateTimeFormat("en-MY", { weekday: "long", day: "numeric", month: "long" }).format(new Date());
    document.querySelector("#admin-greeting").textContent = `Welcome back, ${user.name}. Here's the shop for ${today}.`;
    showTab(window.location.hash.slice(1));
    await refreshAll();
  }

  initialize().catch((error) => {
    adminMessage.textContent = `Could not load the dashboard: ${error.message}`;
  });

  document.querySelector(".admin-tabs").addEventListener("click", (event) => {
    const button = event.target.closest("[data-tab]");
    if (button) showTab(button.dataset.tab);
  });
  document.querySelector(".admin-tabs").addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    const current = tabs.indexOf(window.location.hash.slice(1));
    const step = event.key === "ArrowRight" ? 1 : -1;
    showTab(tabs[(current + step + tabs.length) % tabs.length], true);
  });

  document.querySelector("#panel-dashboard").addEventListener("click", (event) => {
    const flowButton = event.target.closest("[data-flow]");
    const stockButton = event.target.closest("[data-edit-stock]");
    if (flowButton) {
      orderFilter.value = flowButton.dataset.flow;
      showTab("orders");
      loadOrders().catch((error) => { ordersMessage.textContent = error.message; });
    } else if (stockButton) {
      showTab("products");
      editProduct(stockButton.dataset.editStock);
    }
  });

  orderFilter.addEventListener("change", () => {
    ordersMessage.textContent = "";
    loadOrders().catch((error) => { ordersMessage.textContent = error.message; });
  });

  orderList.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-status]");
    if (!button) return;
    const { orderId, status } = button.dataset;
    if (status === "cancelled" && !window.confirm(`Cancel order #${orderId}? Its items will be returned to stock.`)) return;
    ordersMessage.textContent = "";
    button.disabled = true;
    try {
      await window.PitstopApi.request(`/api/admin/orders/${encodeURIComponent(orderId)}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      ordersMessage.textContent = `Order #${orderId} is now ${STATUS_LABELS[status].toLowerCase()}.`;
      await refreshAll();
    } catch (error) {
      ordersMessage.textContent = error.message;
      button.disabled = false;
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    formMessage.textContent = "";
    submitButton.disabled = true;
    const values = new FormData(form);
    const editing = idField.readOnly;
    const payload = {
      name: values.get("name"),
      make: choiceValue("make"),
      scale: choiceValue("scale"),
      category: choiceValue("category"),
      price: Number(values.get("price")),
      stock: Number(values.get("stock")),
      bestSeller: form.elements.bestSeller.checked,
      newArrival: form.elements.newArrival.checked,
      condition: choiceValue("condition"),
      image: values.get("image"),
      imageAlt: values.get("imageAlt"),
      description: values.get("description"),
      chase: form.elements.chase.checked,
      preorder: form.elements.preorder.checked,
      editionSize: optionalNumber(values.get("editionSize")),
      lengthMm: optionalNumber(values.get("lengthMm")),
      releaseDate: values.get("releaseDate") || "",
      gallery: galleryItems.map(({ src, label }) => ({ src, label: label.trim() })),
    };
    if (!editing) payload.id = values.get("id");
    try {
      const result = await window.PitstopApi.request(
        editing ? `/api/admin/products/${encodeURIComponent(idField.value)}` : "/api/admin/products",
        { method: editing ? "PATCH" : "POST", body: JSON.stringify(payload) },
      );
      resetForm();
      const waiting = result.waitingNotified || 0;
      productsMessage.textContent = editing ? "Product updated." : "Product added.";
      if (waiting) {
        productsMessage.textContent += ` ${waiting} ${waiting === 1 ? "customer was" : "customers were"} waiting for it. They'll now see it as available. Email them from Waitlists on the Overview tab.`;
      }
      await refreshAll();
    } catch (error) {
      formMessage.textContent = error.message;
    } finally {
      submitButton.disabled = false;
    }
  });

  productList.addEventListener("click", async (event) => {
    const editButton = event.target.closest("[data-edit]");
    const deleteButton = event.target.closest("[data-delete]");
    if (editButton) {
      editProduct(editButton.dataset.edit);
    } else if (deleteButton && window.confirm("Delete this product? It will also be removed from customers’ bags.")) {
      productsMessage.textContent = "";
      try {
        await window.PitstopApi.request(`/api/admin/products/${encodeURIComponent(deleteButton.dataset.delete)}`, {
          method: "DELETE",
        });
        productsMessage.textContent = "Product deleted.";
        await refreshAll();
      } catch (error) {
        productsMessage.textContent = error.message;
      }
    }
  });

  cancelEdit.addEventListener("click", resetForm);
})();
