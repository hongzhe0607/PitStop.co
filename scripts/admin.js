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

  function lines(value) {
    return String(value || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
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
    for (const key of ["name", "make", "scale", "category", "price", "stock", "condition", "image", "imageAlt", "description"]) {
      form.elements[key].value = product[key];
    }
    form.elements.bestSeller.checked = product.bestSeller;
    form.elements.newArrival.checked = product.newArrival;
    form.elements.chase.checked = product.chase;
    form.elements.preorder.checked = product.preorder;
    form.elements.editionSize.value = product.editionSize ?? "";
    form.elements.lengthMm.value = product.lengthMm ?? "";
    form.elements.releaseDate.value = product.releaseDate || "";
    form.elements.gallery.value = product.gallery
      .map((photo) => (photo.label ? `${photo.src} | ${photo.label}` : photo.src)).join("\n");
    form.elements.spin.value = product.spin.join("\n");
    document.querySelector("#product-form-title").textContent = `Edit ${product.name}`;
    submitButton.textContent = "Save changes";
    cancelEdit.hidden = false;
    form.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function loadProducts() {
    const result = await window.PitstopApi.request("/api/admin/products");
    products = result.products;
    renderProducts();
  }

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

  function resetForm() {
    form.reset();
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
      make: values.get("make"),
      scale: values.get("scale"),
      category: values.get("category"),
      price: Number(values.get("price")),
      stock: Number(values.get("stock")),
      bestSeller: form.elements.bestSeller.checked,
      newArrival: form.elements.newArrival.checked,
      condition: values.get("condition"),
      image: values.get("image"),
      imageAlt: values.get("imageAlt"),
      description: values.get("description"),
      chase: form.elements.chase.checked,
      preorder: form.elements.preorder.checked,
      editionSize: optionalNumber(values.get("editionSize")),
      lengthMm: optionalNumber(values.get("lengthMm")),
      releaseDate: values.get("releaseDate") || "",
      gallery: lines(values.get("gallery")).map((line) => {
        const [src, ...label] = line.split("|");
        return { src: src.trim(), label: label.join("|").trim() };
      }),
      spin: lines(values.get("spin")),
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
