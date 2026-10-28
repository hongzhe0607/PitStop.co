(() => {
  const grid = document.querySelector("#product-grid");
  const searchInput = document.querySelector("#product-search");
  const emptyState = document.querySelector("#empty-state");
  const cartPanel = document.querySelector(".cart-panel");
  const overlay = document.querySelector(".cart-overlay");
  const cartItemsElement = document.querySelector(".cart-items");
  const cartFooter = document.querySelector(".cart-footer");
  const cartEmpty = document.querySelector(".cart-empty");
  const checkoutStart = document.querySelector(".checkout-start");
  const checkoutForm = document.querySelector(".checkout-form");
  const toast = document.querySelector(".toast");
  const bestSellers = document.querySelector("#best-sellers");
  const newArrivals = document.querySelector("#new-arrivals");
  const brandList = document.querySelector("#brand-list");
  const categoryFilter = document.querySelector("#category-filter");
  const brandFilter = document.querySelector("#brand-filter");
  const priceFilter = document.querySelector("#price-filter");
  const stockFilter = document.querySelector("#stock-filter");
  const resultCount = document.querySelector("#result-count");
  let products = [];
  let cart = [];
  let brands = [];
  let categories = [];
  let currentUser = null;
  let shopEmail = "";
  let toastTimer;
  let cartWasDragged = false;

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[character]);
  }

  function formatPrice(price) {
    return new Intl.NumberFormat("en-MY", { style: "currency", currency: "MYR" }).format(price);
  }

  function productMarkup(product) {
    const inStock = product.stock > 0;
    const name = escapeHtml(product.name);
    const image = product.image
      ? `<img class="product-image" src="${escapeHtml(product.image)}" alt="${escapeHtml(product.imageAlt || product.name)}" loading="lazy">`
      : `<div class="product-placeholder" role="img" aria-label="Photo coming soon for ${name}">
          <svg viewBox="0 0 240 140" aria-hidden="true" focusable="false">
            <path class="placeholder-road" d="M28 108h184"></path>
            <path class="placeholder-car-body" d="m53 91 8-21c2-5 6-8 12-9l17-3 17-19c4-4 9-6 15-6h31c7 0 12 3 16 8l15 19 12 4c6 2 10 7 10 13v14H53Z"></path>
            <path class="placeholder-car-window" d="m99 58 15-17c2-2 5-4 9-4h29c4 0 7 2 10 5l12 16H99Z"></path>
            <circle class="placeholder-wheel" cx="86" cy="91" r="13"></circle>
            <circle class="placeholder-wheel" cx="177" cy="91" r="13"></circle>
            <circle class="placeholder-hub" cx="86" cy="91" r="5"></circle>
            <circle class="placeholder-hub" cx="177" cy="91" r="5"></circle>
          </svg>
          <span>Photo coming soon</span>
        </div>`;
    return `
      <article class="product-card">
        <div class="product-image-wrap">
          ${image}
          <button class="quick-add" type="button" data-add="${escapeHtml(product.id)}" aria-label="Add ${name} to bag" ${inStock ? "" : "disabled"}>+</button>
        </div>
        <div class="product-details">
          <div><p class="product-make">${escapeHtml(product.make)} · ${escapeHtml(product.scale)}</p><h3>${name}</h3></div>
          <strong>${formatPrice(product.price)}</strong>
        </div>
        <p class="product-description">${escapeHtml(product.condition)} · ${escapeHtml(product.description)}</p>
        <p class="stock-status ${inStock ? "in-stock" : "sold-out"}">${inStock ? `In stock (${product.stock})` : "Sold out"}</p>
      </article>
    `;
  }

  function renderHomeSections() {
    if (bestSellers) bestSellers.innerHTML = products.filter((product) => product.bestSeller).map(productMarkup).join("");
    if (newArrivals) newArrivals.innerHTML = products.filter((product) => product.newArrival).map(productMarkup).join("");
    if (brandList) brandList.innerHTML = brands.map((brand) => `<li>${escapeHtml(brand)}</li>`).join("");
  }

  function renderCatalog() {
    if (!grid) return;
    const term = searchInput.value.trim().toLowerCase();
    const category = categoryFilter.value;
    const brand = brandFilter.value;
    const priceRange = priceFilter.value;
    const status = stockFilter.value;
    const matches = products.filter((product) => {
      const matchesSearch = `${product.name} ${product.make} ${product.scale}`.toLowerCase().includes(term);
      const matchesCategory = category === "All" || product.category === category;
      const matchesBrand = brand === "All" || product.make === brand;
      const matchesStock = status === "all" ||
        (status === "available" && product.stock > 0) ||
        (status === "sold-out" && product.stock === 0);
      let matchesPrice = true;
      if (priceRange === "0-25") matchesPrice = product.price < 25;
      if (priceRange === "25-50") matchesPrice = product.price >= 25 && product.price <= 50;
      if (priceRange === "50-100") matchesPrice = product.price > 50 && product.price <= 100;
      if (priceRange === "100+") matchesPrice = product.price > 100;
      return matchesSearch && matchesCategory && matchesBrand && matchesStock && matchesPrice;
    });
    grid.innerHTML = matches.map(productMarkup).join("");
    emptyState.hidden = matches.length > 0;
    resultCount.textContent = `${matches.length} ${matches.length === 1 ? "model" : "models"}`;
  }

  function renderCart() {
    const count = cart.reduce((sum, item) => sum + item.quantity, 0);
    document.querySelectorAll(".cart-count").forEach((element) => { element.textContent = count; });
    document.querySelector(".cart-heading-count").textContent = `(${count})`;
    if (!currentUser) {
      cartItemsElement.replaceChildren();
      cartEmpty.innerHTML = '<p>Sign in or create an account to use your bag.</p><a class="contact-link" href="login.html">Sign in</a> · <a class="contact-link" href="register.html">Create account</a>';
      cartEmpty.hidden = false;
      cartFooter.hidden = true;
      return;
    }
    cartItemsElement.innerHTML = cart.map((item) => {
      const product = item.product;
      const name = escapeHtml(product.name);
      return `<article class="cart-item">
        ${product.image
          ? `<img src="${escapeHtml(product.image)}" alt="${escapeHtml(product.imageAlt || product.name)}">`
          : `<div class="cart-placeholder" aria-hidden="true"></div>`}
        <div class="cart-item-info"><p class="product-make">${escapeHtml(product.make)}</p><h3>${name}</h3><strong>${formatPrice(product.price)}</strong>
          <div class="quantity-control" aria-label="Quantity for ${name}">
            <button type="button" data-quantity="${escapeHtml(product.id)}" data-change="-1" aria-label="Remove one ${name}">−</button>
            <span>${item.quantity}</span>
            <button type="button" data-quantity="${escapeHtml(product.id)}" data-change="1" aria-label="Add one ${name}">+</button>
          </div>
        </div>
        <button class="remove-item" type="button" data-remove="${escapeHtml(product.id)}" aria-label="Remove ${name} from bag">×</button>
      </article>`;
    }).join("");
    cartEmpty.innerHTML = "<p>Your bag is empty.</p><button class=\"contact-link continue-shopping\" type=\"button\">Continue shopping</button>";
    cartEmpty.hidden = cart.length > 0;
    cartFooter.hidden = cart.length === 0;
    const subtotal = cart.reduce((sum, item) => sum + item.product.price * item.quantity, 0);
    document.querySelector(".cart-subtotal strong").textContent = formatPrice(subtotal);
    if (!cart.length) setCheckoutOpen(false);
  }

  function setCheckoutOpen(open) {
    checkoutForm.hidden = !open;
    checkoutStart.hidden = open;
    cartItemsElement.hidden = open;
    if (!open) return;
    if (!checkoutForm.elements.name.value && currentUser) checkoutForm.elements.name.value = currentUser.name;
    checkoutForm.querySelector(".checkout-message").textContent = "";
    checkoutForm.elements.name.focus();
  }

  async function refreshProducts() {
    const catalog = await window.PitstopApi.request("/api/products");
    products = catalog.products;
    renderHomeSections();
    renderCatalog();
  }

  function mailtoAddress() {
    return encodeURIComponent(shopEmail).replace("%40", "@");
  }

  function renderShopEmail() {
    const contactEmail = document.querySelector("#shop-email");
    if (!contactEmail || !shopEmail) return;
    const link = document.createElement("a");
    link.href = `mailto:${mailtoAddress()}?subject=Question%20for%20PitStop.co`;
    link.textContent = shopEmail;
    contactEmail.replaceChildren(link);
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add("is-visible");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 2800);
  }

  function goToLogin() {
    const next = `${window.location.pathname}${window.location.search}`;
    window.location.assign(`/login.html?next=${encodeURIComponent(next)}`);
  }

  async function refreshCart() {
    const result = await window.PitstopApi.request("/api/cart");
    cart = result.items;
    renderCart();
  }

  async function updateQuantity(productId, quantity) {
    try {
      const result = await window.PitstopApi.request(`/api/cart/${encodeURIComponent(productId)}`, {
        method: "PUT",
        body: JSON.stringify({ quantity }),
      });
      cart = result.items;
      renderCart();
      return true;
    } catch (error) {
      if (error.status === 401) {
        goToLogin();
        return false;
      }
      showToast(error.message);
      return false;
    }
  }

  function setCartOpen(open) {
    cartPanel.classList.toggle("is-open", open);
    cartPanel.setAttribute("aria-hidden", String(!open));
    cartPanel.inert = !open;
    overlay.hidden = !open;
    document.body.classList.toggle("cart-open", open);
    if (open) cartPanel.querySelector(".cart-close").focus();
  }

  function makeCartDraggable() {
    const trigger = document.querySelector(".cart-trigger");
    let pointerStart;

    trigger.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      const bounds = trigger.getBoundingClientRect();
      pointerStart = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        left: bounds.left,
        top: bounds.top,
        moved: false,
      };
      trigger.setPointerCapture(event.pointerId);
    });

    trigger.addEventListener("pointermove", (event) => {
      if (!pointerStart || pointerStart.id !== event.pointerId) return;
      const deltaX = event.clientX - pointerStart.x;
      const deltaY = event.clientY - pointerStart.y;
      if (!pointerStart.moved && Math.hypot(deltaX, deltaY) < 5) return;
      pointerStart.moved = true;
      cartWasDragged = true;
      const maxLeft = Math.max(8, window.innerWidth - trigger.offsetWidth - 8);
      const maxTop = Math.max(8, window.innerHeight - trigger.offsetHeight - 8);
      const left = Math.min(Math.max(8, pointerStart.left + deltaX), maxLeft);
      const top = Math.min(Math.max(8, pointerStart.top + deltaY), maxTop);
      trigger.style.left = `${left}px`;
      trigger.style.top = `${top}px`;
      trigger.style.right = "auto";
      trigger.style.bottom = "auto";
    });

    const finishDrag = (event) => {
      if (!pointerStart || pointerStart.id !== event.pointerId) return;
      if (trigger.hasPointerCapture(event.pointerId)) trigger.releasePointerCapture(event.pointerId);
      if (event.type === "pointercancel") cartWasDragged = false;
      pointerStart = null;
    };
    trigger.addEventListener("pointerup", finishDrag);
    trigger.addEventListener("pointercancel", finishDrag);

    window.addEventListener("resize", () => {
      if (!trigger.style.left) return;
      const maxLeft = Math.max(8, window.innerWidth - trigger.offsetWidth - 8);
      const maxTop = Math.max(8, window.innerHeight - trigger.offsetHeight - 8);
      trigger.style.left = `${Math.min(Math.max(8, parseFloat(trigger.style.left)), maxLeft)}px`;
      trigger.style.top = `${Math.min(Math.max(8, parseFloat(trigger.style.top)), maxTop)}px`;
    });
  }

  async function initialize() {
    try {
      currentUser = await window.PitstopApi.getUser();
      const catalog = await window.PitstopApi.request("/api/products");
      products = catalog.products;
      brands = catalog.brands;
      categories = catalog.categories;
      shopEmail = catalog.shopEmail || "";
      renderShopEmail();
      brands.forEach((brand) => {
        if (!brandFilter) return;
        const option = document.createElement("option");
        option.value = brand;
        option.textContent = brand;
        brandFilter.append(option);
      });
      if (categoryFilter) {
        categories.forEach((category) => {
          const option = document.createElement("option");
          option.value = category;
          option.textContent = category;
          categoryFilter.append(option);
        });
      }
      renderHomeSections();
      renderCatalog();
      if (currentUser) await refreshCart();
      else renderCart();
    } catch (error) {
      console.error("Could not load the storefront.", error);
      showToast(`Could not load the storefront: ${error.message}`);
    }
  }

  if (searchInput) searchInput.addEventListener("input", renderCatalog);
  [categoryFilter, brandFilter, priceFilter, stockFilter].forEach((filter) => {
    if (filter) filter.addEventListener("change", renderCatalog);
  });
  const clearFilters = document.querySelector("#clear-filters");
  if (clearFilters) {
    clearFilters.addEventListener("click", () => {
      searchInput.value = "";
      categoryFilter.value = "All";
      brandFilter.value = "All";
      priceFilter.value = "all";
      stockFilter.value = "all";
      renderCatalog();
    });
  }

  document.addEventListener("click", async (event) => {
    const addButton = event.target.closest("[data-add]");
    if (!addButton || addButton.disabled) return;
    if (!currentUser) {
      goToLogin();
      return;
    }
    const product = products.find((entry) => entry.id === addButton.dataset.add);
    if (!product) return;
    const item = cart.find((entry) => entry.product.id === product.id);
    if (item && item.quantity >= product.stock) {
      showToast("No more of this model is currently in stock.");
      return;
    }
    if (await updateQuantity(product.id, item ? item.quantity + 1 : 1)) {
      showToast(`${product.name} added to your bag.`);
    }
  });

  cartItemsElement.addEventListener("click", (event) => {
    const quantityButton = event.target.closest("[data-quantity]");
    const removeButton = event.target.closest("[data-remove]");
    if (removeButton) {
      updateQuantity(removeButton.dataset.remove, 0);
    } else if (quantityButton) {
      const item = cart.find((entry) => entry.product.id === quantityButton.dataset.quantity);
      if (item) updateQuantity(item.product.id, item.quantity + Number(quantityButton.dataset.change));
    }
  });

  const cartTrigger = document.querySelector(".cart-trigger");
  makeCartDraggable();
  cartTrigger.addEventListener("click", (event) => {
    if (cartWasDragged) {
      event.preventDefault();
      cartWasDragged = false;
      return;
    }
    setCartOpen(true);
  });
  document.querySelector(".cart-close").addEventListener("click", () => setCartOpen(false));
  overlay.addEventListener("click", () => setCartOpen(false));
  checkoutStart.addEventListener("click", () => setCheckoutOpen(true));
  checkoutForm.querySelector(".checkout-back").addEventListener("click", () => setCheckoutOpen(false));
  checkoutForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = checkoutForm.querySelector(".checkout-message");
    const submit = checkoutForm.querySelector("button[type=submit]");
    message.textContent = "";
    submit.disabled = true;
    const values = new FormData(checkoutForm);
    try {
      const result = await window.PitstopApi.request("/api/orders", {
        method: "POST",
        body: JSON.stringify({
          name: values.get("name"),
          phone: values.get("phone"),
          address: values.get("address"),
          note: values.get("note"),
        }),
      });
      checkoutForm.reset();
      cart = [];
      renderCart();
      setCartOpen(false);
      showToast(`Order #${result.order.id} placed. The shop will contact you about payment.`);
      await refreshProducts();
    } catch (error) {
      if (error.status === 401) {
        goToLogin();
        return;
      }
      message.textContent = error.message;
      if (error.status === 409) await refreshCart().catch(() => {});
    } finally {
      submit.disabled = false;
    }
  });
  cartEmpty.addEventListener("click", (event) => {
    if (event.target.closest(".continue-shopping")) setCartOpen(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && cartPanel.classList.contains("is-open")) setCartOpen(false);
  });
  cartPanel.inert = true;
  initialize();
})();
