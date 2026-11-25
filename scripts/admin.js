(() => {
  const form = document.querySelector("#product-form");
  const formMessage = document.querySelector("#form-message");
  const productsMessage = document.querySelector("#products-message");
  const productList = document.querySelector("#admin-product-list");
  const idField = form.elements.id;
  // The stock the admin saw when they opened the form (see save_product on the server).
  let formStockWas = null;
  // The ID follows the name until the admin types their own.
  let idTouched = false;
  const slugify = (text) => text.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/, "");
  form.elements.name.addEventListener("input", () => {
    if (!idField.readOnly && !idTouched) idField.value = slugify(form.elements.name.value);
  });
  idField.addEventListener("input", () => { idTouched = idField.value !== ""; });
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
    formStockWas = product.stock;
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
    linkItems = (product.links || []).map((link) => ({ ...link }));
    renderLinkEditor();
    Object.keys(trays).forEach(clearTray);
    renderPhotoEditors();
    document.querySelector("#product-form-title").textContent = `Edit ${product.name}`;
    submitButton.textContent = "Save changes";
    form.elements.available.checked = product.available !== false;
    openProductDialog();
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

  // ---- Quick status controls on each product row ----
  const QUICK_TAGS = [["newArrival", "New"], ["bestSeller", "Best seller"], ["chase", "Chase"]];
  const stockTimers = new Map();

  function productStatus(product) {
    if (product.preorder) return "preorder";
    return product.stock > 0 ? "instock" : "soldout";
  }

  function quickControls(product) {
    const box = element("div", "quick-controls");
    box.dataset.quickId = product.id;

    const statusLabel = element("label", "quick-status");
    const status = element("select");
    status.dataset.quickStatus = "";
    status.setAttribute("aria-label", `Status of ${product.name}`);
    [["instock", "In stock"], ["soldout", "Sold out"], ["preorder", "Pre-order"]].forEach(([value, text]) => {
      const option = element("option", "", text);
      option.value = value;
      status.append(option);
    });
    status.value = productStatus(product);
    status.className = `status-${status.value}`;
    statusLabel.append(element("span", "", "Status"), status);

    const stock = element("div", "quick-stock");
    stock.setAttribute("role", "group");
    stock.setAttribute("aria-label", `Stock of ${product.name}`);
    const minus = element("button", "", "−");
    minus.type = "button";
    minus.dataset.quickStep = "-1";
    minus.setAttribute("aria-label", "One less in stock");
    minus.disabled = product.stock <= 0;
    const input = element("input");
    input.type = "number";
    input.min = "0";
    input.max = "1000000";
    input.step = "1";
    input.value = product.stock;
    input.dataset.quickStock = "";
    input.setAttribute("aria-label", "Units in stock");
    const plus = element("button", "", "+");
    plus.type = "button";
    plus.dataset.quickStep = "1";
    plus.setAttribute("aria-label", "One more in stock");
    stock.append(minus, input, plus);

    const tags = element("div", "quick-tags");
    QUICK_TAGS.forEach(([field, text]) => {
      const tag = element("button", "quick-tag", text);
      tag.type = "button";
      tag.dataset.quickToggle = field;
      tag.setAttribute("aria-pressed", String(Boolean(product[field])));
      tags.append(tag);
    });

    // The big on/off switch: off hides the product from the shop without deleting it.
    const on = product.available !== false;
    const toggle = element("button", "avail-switch");
    toggle.type = "button";
    toggle.dataset.quickToggle = "available";
    toggle.setAttribute("role", "switch");
    toggle.setAttribute("aria-checked", String(on));
    toggle.setAttribute("aria-label", `${product.name} is available in the shop`);
    const track = element("span", "avail-track");
    track.append(element("span", "avail-knob"));
    toggle.append(track, element("span", "avail-label", on ? "Available" : "Not available"));

    const note = element("span", "quick-note");
    note.setAttribute("aria-live", "polite");
    box.append(toggle, statusLabel, stock, tags, note);
    return box;
  }

  function showQuickNote(productId, text, tone) {
    const note = productList.querySelector(`[data-quick-id="${CSS.escape(productId)}"] .quick-note`);
    if (!note) return;
    note.textContent = text;
    note.className = `quick-note${tone ? ` is-${tone}` : ""}`;
    if (tone === "ok") window.setTimeout(() => { if (note.textContent === text) note.textContent = ""; }, 4000);
  }

  async function quickSave(productId, changes) {
    showQuickNote(productId, "Saving…", "");
    try {
      const result = await window.PitstopApi.request(`/api/admin/products/${encodeURIComponent(productId)}/quick`, {
        method: "PATCH",
        body: JSON.stringify(changes),
      });
      const index = products.findIndex((entry) => entry.id === productId);
      if (index >= 0) products[index] = { ...result.product };
      replaceProductRow(products[index]);
      syncOpenForm(products[index]);
      const waiting = result.waitingNotified || 0;
      let note = "Saved ✓";
      if ("available" in changes) {
        note = changes.available ? "Saved ✓ It's back in the shop." : "Saved ✓ Hidden from the shop. Customers can't see or buy it.";
      }
      if (waiting) note += ` ${waiting} waiting ${waiting === 1 ? "customer" : "customers"} will see it's available.`;
      showQuickNote(productId, note, "ok");
      // A product hidden or shown may no longer match the current filter.
      if ("available" in changes && productFilter.value !== "all") renderProducts();
      loadDashboard().catch(() => {});
    } catch (error) {
      // Put the row back the way the server has it, then say why.
      const product = products.find((entry) => entry.id === productId);
      if (product && Number.isInteger(error.data?.currentStock)) {
        product.stock = error.data.currentStock;
        syncOpenForm(product);
      }
      replaceProductRow(product);
      showQuickNote(productId, `Not saved: ${error.message}`, "error");
    }
  }

  // If the full edit form is open on this product, keep its fields in step.
  function syncOpenForm(product) {
    if (!product || !idField.readOnly || idField.value !== product.id) return;
    form.elements.stock.value = product.stock;
    formStockWas = product.stock;
    form.elements.preorder.checked = product.preorder;
    form.elements.bestSeller.checked = product.bestSeller;
    form.elements.newArrival.checked = product.newArrival;
    form.elements.chase.checked = product.chase;
    form.elements.available.checked = product.available !== false;
  }

  function replaceProductRow(product) {
    if (!product) return;
    const old = productList.querySelector(`[data-product-row="${CSS.escape(product.id)}"]`);
    if (old) old.replaceWith(productRow(product));
  }

  productList.addEventListener("change", (event) => {
    const box = event.target.closest("[data-quick-id]");
    if (!box) return;
    const id = box.dataset.quickId;
    const product = products.find((entry) => entry.id === id);
    if (event.target.matches("[data-quick-status]")) {
      const value = event.target.value;
      if (value === "soldout") quickSave(id, { preorder: false, stock: 0 });
      else if (value === "preorder") quickSave(id, { preorder: true });
      // Back in stock needs at least one on the shelf.
      else quickSave(id, { preorder: false, stock: Math.max(1, product.stock) });
    } else if (event.target.matches("[data-quick-stock]")) {
      window.clearTimeout(stockTimers.get(id));
      const stock = Number(event.target.value);
      if (!Number.isInteger(stock) || stock < 0) {
        replaceProductRow(product);
        showQuickNote(id, "Stock must be a whole number, 0 or more.", "error");
        return;
      }
      if (stock !== product.stock) quickSave(id, { stock, stockWas: product.stock });
    }
  });

  productList.addEventListener("click", (event) => {
    const box = event.target.closest("[data-quick-id]");
    if (!box) return;
    const id = box.dataset.quickId;
    const product = products.find((entry) => entry.id === id);
    const toggle = event.target.closest("[data-quick-toggle]");
    if (toggle) {
      const field = toggle.dataset.quickToggle;
      const next = field === "available" ? product.available === false : !product[field];
      toggle.setAttribute(toggle.getAttribute("role") === "switch" ? "aria-checked" : "aria-pressed", String(next));
      quickSave(id, { [field]: next });
      return;
    }
    const step = event.target.closest("[data-quick-step]");
    if (step) {
      // Taps on − / + add up, then save once the clicking stops.
      const input = box.querySelector("[data-quick-stock]");
      const next = Math.max(0, (Number(input.value) || 0) + Number(step.dataset.quickStep));
      input.value = next;
      box.querySelector('[data-quick-step="-1"]').disabled = next <= 0;
      window.clearTimeout(stockTimers.get(id));
      stockTimers.set(id, window.setTimeout(() => {
        if (next !== product.stock) quickSave(id, { stock: next, stockWas: product.stock });
      }, 600));
    }
  });

  function productRow(product) {
    const row = document.createElement("article");
    row.className = "admin-product-row";
    row.dataset.productRow = product.id;
    fillProductRow(row, product);
    return row;
  }

  const productSearch = document.querySelector("#product-search");
  const productFilter = document.querySelector("#product-filter");
  const PRODUCT_FILTERS = {
    all: () => true,
    available: (product) => product.available !== false,
    hidden: (product) => product.available === false,
    instock: (product) => product.stock > 0 && !product.preorder,
    low: (product) => product.stock > 0 && product.stock <= 2 && !product.preorder,
    soldout: (product) => product.stock === 0 && !product.preorder,
    preorder: (product) => product.preorder,
  };

  function renderProducts() {
    const term = productSearch.value.trim().toLowerCase();
    const matches = products.filter((product) =>
      PRODUCT_FILTERS[productFilter.value](product)
      && `${product.name} ${product.make} ${product.id} ${product.category}`.toLowerCase().includes(term));
    productList.replaceChildren(...matches.map(productRow));
    const hidden = products.filter((product) => product.available === false).length;
    const total = `${products.length} ${products.length === 1 ? "product" : "products"}${hidden ? ` · ${hidden} hidden` : ""}`;
    document.querySelector("#product-count").textContent = matches.length === products.length
      ? total : `Showing ${matches.length} of ${total}`;
    if (!products.length) {
      productList.append(element("p", "dashboard-empty", "No products yet. Click “+ Add product” to list your first model."));
    } else if (!matches.length) {
      productList.append(element("p", "dashboard-empty", "No products match. Try a different search or filter."));
    }
  }

  productSearch.addEventListener("input", renderProducts);
  productFilter.addEventListener("change", renderProducts);

  function fillProductRow(row, product) {
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
    let stockLabel = product.stock === 0 ? "Sold out" : `${product.stock} in stock`;
    let stockClass = product.stock === 0 ? "sold-out" : product.stock <= 2 ? "low" : "ok";
    if (product.preorder) {
      stockLabel = "Pre-order";
      stockClass = "preorder";
    }
    if (product.available === false) {
      stockLabel = "Hidden from shop";
      stockClass = "hidden";
    }
    row.classList.toggle("is-hidden", product.available === false);
    const stock = element("span", `stock-pill stock-${stockClass}`, stockLabel);

    const actions = document.createElement("div");
    actions.className = "admin-row-actions";
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "secondary-button";
    edit.dataset.edit = product.id;
    edit.textContent = "Edit all details";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "secondary-button";
    remove.dataset.delete = product.id;
    remove.textContent = "Delete";
    actions.append(edit, remove);
    row.append(thumb, details, price, stock, quickControls(product), actions);
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

  // ---- Videos & links ----
  const MAX_LINKS = 10;
  const linkEditor = document.querySelector("#link-editor");
  const addLinkButton = document.querySelector("#add-link");
  let linkItems = [];

  function linkKind(url) {
    const value = url.trim();
    if (!value) return { text: "", tone: "" };
    if (!/^https:\/\/[^/\s]+\.[^/\s]+/i.test(value)) return { text: "Start with https://", tone: "bad" };
    if (/^https:\/\/(www\.|m\.)?(youtube\.com|youtu\.be)\//i.test(value)) return { text: "▶ YouTube video", tone: "video" };
    if (/^https:\/\/(www\.)?vimeo\.com\/\d+/i.test(value)) return { text: "▶ Vimeo video", tone: "video" };
    return { text: "Link", tone: "link" };
  }

  function updateLinkBadge(row, url) {
    const badge = row.querySelector(".link-kind");
    const kind = linkKind(url);
    badge.textContent = kind.text;
    badge.className = `link-kind${kind.tone ? ` is-${kind.tone}` : ""}`;
  }

  function renderLinkEditor() {
    linkEditor.replaceChildren(...linkItems.map((item, index) => {
      const row = element("li", "link-editor-item");
      const url = element("input");
      url.type = "url";
      url.placeholder = "https://www.youtube.com/watch?v=… or any web address";
      url.maxLength = 500;
      url.value = item.url;
      url.dataset.linkUrl = index;
      url.setAttribute("aria-label", `Web address ${index + 1}`);
      const title = element("input");
      title.type = "text";
      title.placeholder = "Title (optional), e.g. Unboxing review";
      title.maxLength = 100;
      title.value = item.title;
      title.dataset.linkTitle = index;
      title.setAttribute("aria-label", `Title for link ${index + 1}`);
      const badge = element("span", "link-kind");
      const remove = element("button", "upload-remove", "×");
      remove.type = "button";
      remove.dataset.linkRemove = index;
      remove.setAttribute("aria-label", `Remove link ${index + 1}`);
      const fields = element("div", "link-editor-fields");
      fields.append(url, title);
      row.append(fields, badge, remove);
      updateLinkBadge(row, item.url);
      return row;
    }));
    if (!linkItems.length) linkEditor.append(element("li", "editor-empty", "No videos or links yet."));
    addLinkButton.disabled = linkItems.length >= MAX_LINKS;
  }

  addLinkButton.addEventListener("click", () => {
    if (linkItems.length >= MAX_LINKS) return;
    linkItems.push({ url: "", title: "" });
    renderLinkEditor();
    linkEditor.querySelector(`[data-link-url="${linkItems.length - 1}"]`).focus();
  });
  linkEditor.addEventListener("input", (event) => {
    const { linkUrl, linkTitle } = event.target.dataset;
    if (linkUrl !== undefined) {
      linkItems[Number(linkUrl)].url = event.target.value;
      updateLinkBadge(event.target.closest("li"), event.target.value);
    } else if (linkTitle !== undefined) {
      linkItems[Number(linkTitle)].title = event.target.value;
    }
  });
  linkEditor.addEventListener("click", (event) => {
    const button = event.target.closest("[data-link-remove]");
    if (!button) return;
    linkItems.splice(Number(button.dataset.linkRemove), 1);
    renderLinkEditor();
  });
  renderLinkEditor();

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
    linkItems = [];
    renderLinkEditor();
    uploadStatus.textContent = "";
    renderPhotoEditors();
    CHOICE_KEYS.forEach(syncNewChoice);
    Object.keys(trays).forEach(clearTray);
    idField.readOnly = false;
    idTouched = false;
    formStockWas = null;
    document.querySelector("#product-form-title").textContent = "Add a product";
    submitButton.textContent = "Add product";
    formMessage.textContent = "";
    formDirty = false;
  }

  // ---- Add / edit popup ----
  const productDialog = document.querySelector("#product-dialog");
  let formDirty = false;

  function openProductDialog() {
    formDirty = false;
    if (!productDialog.open) productDialog.showModal();
    productDialog.querySelector(".dialog-body").scrollTop = 0;
    form.elements.name.focus();
  }

  // Closing throws away unsaved changes, so ask first if there are any.
  function closeProductDialog() {
    if (formDirty && !window.confirm("Close without saving your changes?")) return;
    productDialog.close();
  }

  form.addEventListener("input", () => { formDirty = true; });
  form.addEventListener("change", () => { formDirty = true; });
  productDialog.addEventListener("close", resetForm);
  productDialog.addEventListener("cancel", (event) => {
    event.preventDefault(); // Esc goes through the same check as the × button.
    closeProductDialog();
  });
  // A click on the dark backdrop (outside the form) also closes.
  productDialog.addEventListener("click", (event) => {
    if (event.target === productDialog) closeProductDialog();
  });
  document.querySelector("#dialog-close").addEventListener("click", closeProductDialog);
  document.querySelector("#add-product").addEventListener("click", () => {
    resetForm();
    openProductDialog();
  });

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

  initialize().then(startOrderWatch).catch((error) => {
    adminMessage.textContent = `Could not load the dashboard: ${error.message}`;
  });

  // ---- New-order alerts: checks every 30 seconds while this page is open ----
  const alertsButton = document.querySelector("#order-alerts");
  const alertsLabel = document.querySelector("#order-alerts-label");
  const banner = document.querySelector("#new-order-banner");
  const pageTitle = document.title;
  let alertsOn = localStorage.getItem("pitstopOrderAlerts") === "on";
  let lastOrderId = null;
  let audio = null;

  function renderAlertsButton() {
    alertsButton.setAttribute("aria-pressed", String(alertsOn));
    alertsButton.classList.toggle("is-on", alertsOn);
    alertsLabel.textContent = alertsOn ? "Order alerts: on" : "Order alerts: off";
  }

  function unlockSound() {
    if (!window.AudioContext) return;
    audio ??= new AudioContext();
    if (audio.state === "suspended") audio.resume().catch(() => {});
  }

  // Two short rising tones; no sound file needed.
  function chime() {
    if (!audio || audio.state !== "running") return;
    [880, 1320].forEach((frequency, index) => {
      const start = audio.currentTime + index * 0.18;
      const tone = audio.createOscillator();
      const volume = audio.createGain();
      tone.frequency.value = frequency;
      volume.gain.setValueAtTime(0.0001, start);
      volume.gain.exponentialRampToValueAtTime(0.25, start + 0.02);
      volume.gain.exponentialRampToValueAtTime(0.0001, start + 0.3);
      tone.connect(volume).connect(audio.destination);
      tone.start(start);
      tone.stop(start + 0.32);
    });
  }

  function announceOrder(data, newCount) {
    const text = newCount > 1
      ? `${newCount} new orders! The latest is #${data.latestId} from ${data.latestName}.`
      : `New order #${data.latestId} from ${data.latestName}: ${formatPrice(data.latestTotal)}.`;
    document.querySelector("#new-order-text").textContent = text;
    banner.hidden = false;
    if (document.hidden) document.title = `(${data.pending}) New order | ${pageTitle}`;
    if (!alertsOn) return;
    chime();
    if ("Notification" in window && Notification.permission === "granted") {
      const note = new Notification(`New order #${data.latestId}`, {
        body: `${data.latestName} · ${formatPrice(data.latestTotal)}`,
        icon: "images/logo/pitstop-icon.png",
        tag: "pitstop-new-order",
      });
      note.addEventListener("click", () => {
        window.focus();
        showTab("orders");
        note.close();
      });
    }
  }

  function renderEmailNote(emailAlerts) {
    const note = document.querySelector("#email-alerts-note");
    note.hidden = emailAlerts;
    note.textContent = "Order emails are off. To get an email for every order, run python app.py set-mail-password once (see the README).";
  }

  async function checkForOrders() {
    try {
      const data = await window.PitstopApi.request("/api/admin/orders/latest");
      renderEmailNote(data.emailAlerts);
      if (lastOrderId !== null && data.latestId > lastOrderId) {
        announceOrder(data, data.latestId - lastOrderId);
        await refreshAll();
      }
      lastOrderId = data.latestId;
    } catch {
      // Offline for a moment or signed out; try again next time.
    }
  }

  function startOrderWatch() {
    renderAlertsButton();
    checkForOrders();
    window.setInterval(checkForOrders, 30000);
  }

  alertsButton.addEventListener("click", async () => {
    alertsOn = !alertsOn;
    localStorage.setItem("pitstopOrderAlerts", alertsOn ? "on" : "off");
    renderAlertsButton();
    if (!alertsOn) return;
    unlockSound();
    if ("Notification" in window && Notification.permission === "default") {
      await Notification.requestPermission();
    }
    chime();
    adminMessage.textContent = "Order alerts are on. Keep this page open (a background tab is fine) and you'll hear a chime for each new order.";
    if ("Notification" in window && Notification.permission === "denied") {
      adminMessage.textContent += " Pop-up notifications are blocked in this browser, so you'll only get the chime and the banner.";
    }
  });

  // Browsers only allow sound after a click on the page, so unlock it on the first one.
  document.addEventListener("pointerdown", () => { if (alertsOn) unlockSound(); }, { once: true });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    document.title = pageTitle;
    checkForOrders();
  });
  document.querySelector("#new-order-view").addEventListener("click", () => {
    banner.hidden = true;
    showTab("orders");
  });
  document.querySelector("#new-order-dismiss").addEventListener("click", () => { banner.hidden = true; });

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
      available: form.elements.available.checked,
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
      // Empty rows are skipped rather than rejected.
      links: linkItems.filter((link) => link.url.trim()).map((link) => ({ url: link.url.trim(), title: link.title.trim() })),
    };
    if (editing) payload.stockWas = formStockWas;
    else payload.id = values.get("id");
    try {
      const result = await window.PitstopApi.request(
        editing ? `/api/admin/products/${encodeURIComponent(idField.value)}` : "/api/admin/products",
        { method: editing ? "PATCH" : "POST", body: JSON.stringify(payload) },
      );
      formDirty = false;
      productDialog.close();
      const waiting = result.waitingNotified || 0;
      productsMessage.textContent = editing ? "Product updated." : "Product added.";
      if (waiting) {
        productsMessage.textContent += ` ${waiting} ${waiting === 1 ? "customer was" : "customers were"} waiting for it. They'll now see it as available. Email them from Waitlists on the Overview tab.`;
      }
      await refreshAll();
    } catch (error) {
      formMessage.textContent = error.message;
      if (Number.isInteger(error.data?.currentStock)) {
        // Show the live number; saving again uses whatever the admin leaves there.
        formStockWas = error.data.currentStock;
        form.elements.stock.value = error.data.currentStock;
        const product = products.find((entry) => entry.id === idField.value);
        if (product) {
          product.stock = error.data.currentStock;
          replaceProductRow(product);
        }
        form.elements.stock.focus();
      }
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

  cancelEdit.addEventListener("click", closeProductDialog);
})();
