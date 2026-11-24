(() => {
  const grid = document.querySelector("#product-grid");
  const searchInput = document.querySelector("#product-search");
  const emptyState = document.querySelector("#empty-state");
  const cartPanel = document.querySelector(".cart-panel");
  const overlay = document.querySelector(".cart-overlay");
  const cartItemsElement = document.querySelector(".cart-items");
  const cartFooter = document.querySelector(".cart-footer");
  const cartEmpty = document.querySelector(".cart-empty");
  const cartTrigger = document.querySelector(".cart-trigger");
  const checkoutStart = document.querySelector(".checkout-start");
  const checkoutForm = document.querySelector(".checkout-form");
  const toast = document.querySelector(".toast");
  const bestSellers = document.querySelector("#best-sellers");
  const newArrivals = document.querySelector("#new-arrivals");
  const brandList = document.querySelector("#brand-list");
  const heroStats = document.querySelector("#hero-stats");
  const featured = document.querySelector("#featured");
  const categoryTiles = document.querySelector("#category-tiles");
  const categoryFilter = document.querySelector("#category-filter");
  const brandFilter = document.querySelector("#brand-filter");
  const priceFilter = document.querySelector("#price-filter");
  const stockFilter = document.querySelector("#stock-filter");
  const sortFilter = document.querySelector("#sort-filter");
  const savedFilter = document.querySelector("#saved-filter");
  const resultCount = document.querySelector("#result-count");
  const productDetail = document.querySelector("#product-detail");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let products = [];
  let cart = [];
  let wishlist = new Set();
  let alerts = new Map();
  let galleryIndex = 0;
  let galleryProductId = null;
  let brands = [];
  let categories = [];
  let currentUser = null;
  let shopEmail = "";
  let detailQuantity = 1;
  let toastTimer;
  let cartWasDragged = false;

  const CAR_PATHS = `
    <path class="placeholder-road" d="M28 108h184"></path>
    <path class="placeholder-car-body" d="m53 91 8-21c2-5 6-8 12-9l17-3 17-19c4-4 9-6 15-6h31c7 0 12 3 16 8l15 19 12 4c6 2 10 7 10 13v14H53Z"></path>
    <path class="placeholder-car-window" d="m99 58 15-17c2-2 5-4 9-4h29c4 0 7 2 10 5l12 16H99Z"></path>
    <circle class="placeholder-wheel" cx="86" cy="91" r="13"></circle>
    <circle class="placeholder-wheel" cx="177" cy="91" r="13"></circle>
    <circle class="placeholder-hub" cx="86" cy="91" r="5"></circle>
    <circle class="placeholder-hub" cx="177" cy="91" r="5"></circle>`;
  const HEART = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z"></path></svg>';

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[character]);
  }

  function formatPrice(price) {
    return new Intl.NumberFormat("en-MY", { style: "currency", currency: "MYR" }).format(price);
  }

  function productUrl(product) {
    return `product.html?id=${encodeURIComponent(product.id)}`;
  }

  function imageMarkup(product) {
    if (product.image) {
      return `<img class="product-image" src="${escapeHtml(product.image)}" alt="${escapeHtml(product.imageAlt || product.name)}" loading="lazy">`;
    }
    return `<div class="product-placeholder" role="img" aria-label="Photo coming soon for ${escapeHtml(product.name)}">
        <svg viewBox="0 0 240 140" aria-hidden="true" focusable="false">${CAR_PATHS}</svg>
        <span>Photo coming soon</span>
      </div>`;
  }

  const dateFormat = new Intl.DateTimeFormat("en-MY", { day: "numeric", month: "short", year: "numeric" });
  const numberFormat = new Intl.NumberFormat("en-MY");

  function formatReleaseDate(value) {
    return value ? dateFormat.format(new Date(`${value}T00:00:00`)) : "";
  }

  function daysUntil(value) {
    if (!value) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.round((new Date(`${value}T00:00:00`) - today) / 86400000);
  }

  function canBuy(product) {
    return product.stock > 0 && !product.preorder;
  }

  function badgesMarkup(product, limit = 2) {
    const badges = [];
    if (product.preorder) badges.push('<span class="badge badge-preorder">Pre-order</span>');
    else if (product.stock === 0) badges.push('<span class="badge badge-sold-out">Sold out</span>');
    if (product.chase) badges.push('<span class="badge badge-chase">Chase</span>');
    if (product.editionSize) badges.push(`<span class="badge badge-limited">1 of ${numberFormat.format(product.editionSize)}</span>`);
    if (!product.preorder && product.stock > 0 && product.stock <= 2) badges.push(`<span class="badge badge-low">Only ${product.stock} left!</span>`);
    if (product.newArrival) badges.push('<span class="badge badge-new">New</span>');
    if (product.bestSeller) badges.push('<span class="badge badge-best">Best seller</span>');
    return badges.length ? `<div class="product-badges">${badges.slice(0, limit).join("")}</div>` : "";
  }

  function stockLabel(product) {
    if (product.preorder) {
      return product.releaseDate ? `Pre-order · releases ${formatReleaseDate(product.releaseDate)}` : "Pre-order · coming soon";
    }
    return product.stock > 0 ? `In stock (${product.stock})` : "Sold out";
  }

  function wishButton(product, extraClass = "") {
    const saved = wishlist.has(product.id);
    return `<button class="wish-button ${extraClass}" type="button" data-wish="${escapeHtml(product.id)}" aria-pressed="${saved}" aria-label="Save ${escapeHtml(product.name)}">${HEART}</button>`;
  }

  function productMarkup(product) {
    const inStock = canBuy(product);
    const name = escapeHtml(product.name);
    return `
      <article class="product-card${product.stock === 0 && !product.preorder ? " is-sold-out" : ""}">
        <div class="product-image-wrap">
          ${imageMarkup(product)}
          ${badgesMarkup(product)}
          ${wishButton(product)}
          <button class="quick-add" type="button" data-add="${escapeHtml(product.id)}" aria-label="Add ${name} to bag" ${inStock ? "" : "disabled"}>+</button>
        </div>
        <div class="product-details">
          <div><p class="product-make">${escapeHtml(product.make)} · ${escapeHtml(product.scale)}</p><h3><a class="product-link" href="${productUrl(product)}">${name}</a></h3></div>
          <strong>${formatPrice(product.price)}</strong>
        </div>
        <p class="product-description">${escapeHtml(product.condition)} · ${escapeHtml(product.description)}</p>
        <p class="stock-status ${inStock ? "in-stock" : product.preorder ? "preorder" : "sold-out"}">${stockLabel(product)}${alerts.has(product.id) ? " · on your list" : ""}</p>
      </article>
    `;
  }

  function sortProducts(list, sort) {
    const sorted = [...list];
    const byName = (a, b) => a.name.localeCompare(b.name);
    const comparators = {
      featured: (a, b) => (b.stock > 0) - (a.stock > 0) || b.bestSeller - a.bestSeller || byName(a, b),
      newest: (a, b) => b.newArrival - a.newArrival || (b.stock > 0) - (a.stock > 0) || byName(a, b),
      "price-asc": (a, b) => a.price - b.price || byName(a, b),
      "price-desc": (a, b) => b.price - a.price || byName(a, b),
      name: byName,
    };
    return sorted.sort(comparators[sort] || comparators.featured);
  }

  function renderHomeSections() {
    if (bestSellers) bestSellers.innerHTML = products.filter((product) => product.bestSeller).map(productMarkup).join("");
    if (newArrivals) newArrivals.innerHTML = products.filter((product) => product.newArrival).map(productMarkup).join("");
    if (brandList) {
      brandList.innerHTML = brands.map((brand) => {
        const count = products.filter((product) => product.make === brand).length;
        return `<li><a href="diecast.html?brand=${encodeURIComponent(brand)}">${escapeHtml(brand)}${count ? ` <span>${count}</span>` : ""}</a></li>`;
      }).join("");
    }
    if (heroStats) {
      const inStock = products.filter(canBuy).length;
      const brandCount = new Set(products.map((product) => product.make)).size;
      heroStats.innerHTML = [
        [products.length, products.length === 1 ? "model" : "models"],
        [inStock, "in stock now"],
        [brandCount, brandCount === 1 ? "brand" : "brands"],
      ].map(([value, label]) => `<li><strong>${value}</strong><span>${label}</span></li>`).join("");
    }
    if (categoryTiles) {
      categoryTiles.innerHTML = categories.map((category, index) => {
        const count = products.filter((product) => product.category === category).length;
        return `<a class="category-tile tile-${index % 3}" href="diecast.html?category=${encodeURIComponent(category)}">
            <svg viewBox="0 0 240 140" aria-hidden="true" focusable="false">${CAR_PATHS}</svg>
            <span class="category-name">${escapeHtml(category)}</span>
            <span class="category-count">${count} ${count === 1 ? "model" : "models"} →</span>
          </a>`;
      }).join("");
    }
    if (featured) {
      const pick = products.find((product) => product.bestSeller && canBuy(product))
        || products.find(canBuy)
        || products[0];
      featured.closest("section").hidden = !pick;
      if (pick) {
        featured.innerHTML = `
          <div class="featured-media">${imageMarkup(pick)}${badgesMarkup(pick, 3)}</div>
          <div class="featured-info">
            <p class="product-make">${escapeHtml(pick.make)} · ${escapeHtml(pick.scale)} · ${escapeHtml(pick.category)}</p>
            <h3>${escapeHtml(pick.name)}</h3>
            <p class="featured-description">${escapeHtml(pick.description)}</p>
            <p class="featured-price">${formatPrice(pick.price)}</p>
            <div class="featured-actions">
              <button class="primary-link" type="button" data-add="${escapeHtml(pick.id)}" ${canBuy(pick) ? "" : "disabled"}>${canBuy(pick) ? "Add to bag" : pick.preorder ? "Pre-order" : "Sold out"}</button>
              <a class="secondary-button" href="${productUrl(pick)}">View details</a>
              ${wishButton(pick)}
            </div>
          </div>`;
      }
    }
  }

  function readCatalogParams() {
    if (!grid) return;
    const params = new URLSearchParams(window.location.search);
    const setIfOption = (select, value) => {
      if (value && [...select.options].some((option) => option.value === value)) select.value = value;
    };
    searchInput.value = params.get("q") || "";
    setIfOption(categoryFilter, params.get("category"));
    setIfOption(brandFilter, params.get("brand"));
    setIfOption(sortFilter, params.get("sort"));
    savedFilter.setAttribute("aria-pressed", String(params.get("saved") === "1"));
  }

  function writeCatalogParams() {
    const params = new URLSearchParams();
    if (searchInput.value.trim()) params.set("q", searchInput.value.trim());
    if (categoryFilter.value !== "All") params.set("category", categoryFilter.value);
    if (brandFilter.value !== "All") params.set("brand", brandFilter.value);
    if (sortFilter.value !== "featured") params.set("sort", sortFilter.value);
    if (savedFilter.getAttribute("aria-pressed") === "true") params.set("saved", "1");
    const query = params.toString();
    history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
  }

  function renderCatalog() {
    if (!grid) return;
    const term = searchInput.value.trim().toLowerCase();
    const category = categoryFilter.value;
    const brand = brandFilter.value;
    const priceRange = priceFilter.value;
    const status = stockFilter.value;
    const savedOnly = savedFilter.getAttribute("aria-pressed") === "true";
    const matches = products.filter((product) => {
      const matchesSearch = `${product.name} ${product.make} ${product.scale}`.toLowerCase().includes(term);
      const matchesCategory = category === "All" || product.category === category;
      const matchesBrand = brand === "All" || product.make === brand;
      const matchesStock = status === "all" ||
        (status === "available" && canBuy(product)) ||
        (status === "sold-out" && product.stock === 0 && !product.preorder) ||
        (status === "preorder" && product.preorder) ||
        (status === "limited" && (product.chase || Boolean(product.editionSize)));
      let matchesPrice = true;
      if (priceRange === "0-25") matchesPrice = product.price < 25;
      if (priceRange === "25-50") matchesPrice = product.price >= 25 && product.price <= 50;
      if (priceRange === "50-100") matchesPrice = product.price > 50 && product.price <= 100;
      if (priceRange === "100+") matchesPrice = product.price > 100;
      const matchesSaved = !savedOnly || wishlist.has(product.id);
      return matchesSearch && matchesCategory && matchesBrand && matchesStock && matchesPrice && matchesSaved;
    });
    grid.innerHTML = sortProducts(matches, sortFilter.value).map(productMarkup).join("");
    emptyState.hidden = matches.length > 0;
    emptyState.textContent = savedOnly && !wishlist.size
      ? "You haven't saved any models yet. Tap the heart on a model to save it."
      : "No models match those filters. Try changing your search.";
    resultCount.textContent = `${matches.length} ${matches.length === 1 ? "model" : "models"}`;
    writeCatalogParams();
  }

  // ---- Product page: gallery, rarity, alerts, scale ----

  function galleryViews(product) {
    const views = [];
    if (product.image) views.push({ src: product.image, label: product.imageAlt || "Main photo" });
    (product.gallery || []).forEach((photo) => views.push({ src: photo.src, label: photo.label }));
    return views;
  }

  function galleryMarkup(product) {
    const views = galleryViews(product);
    if (galleryProductId !== product.id) {
      galleryProductId = product.id;
      galleryIndex = 0;
    }
    galleryIndex = Math.min(galleryIndex, Math.max(0, views.length - 1));
    const view = views[galleryIndex];
    const name = escapeHtml(product.name);
    let main;
    if (!view) {
      main = imageMarkup(product);
    } else {
      main = `<button class="zoom-frame" type="button" data-zoom aria-label="Zoom in on ${escapeHtml(view.label || product.name)}">
          <img class="product-image" src="${escapeHtml(view.src)}" alt="${escapeHtml(view.label || product.name)}" draggable="false">
          <span class="zoom-hint" aria-hidden="true">Tap to zoom</span>
        </button>`;
    }
    const caption = view && galleryIndex > 0 && view.label
      ? `<p class="media-caption">${escapeHtml(view.label)}</p>` : "";
    const thumbs = views.length > 1
      ? `<div class="gallery-thumbs" role="group" aria-label="Photos of ${name}">${views.map((entry, index) => `
          <button type="button" class="gallery-thumb" data-gallery="${index}" aria-pressed="${index === galleryIndex}" aria-label="${escapeHtml(entry.label || `Photo ${index + 1}`)}">
            <img src="${escapeHtml(entry.src)}" alt="" loading="lazy">
          </button>`).join("")}</div>`
      : "";
    return `<div class="detail-gallery">
        <div class="detail-media">${main}${badgesMarkup(product, 3)}${caption}</div>
        ${thumbs}
      </div>`;
  }

  function rarityMarkup(product) {
    const rows = [];
    if (product.editionSize) {
      rows.push(["Limited edition", `1 of ${numberFormat.format(product.editionSize)} made`, "limited"]);
    }
    if (product.chase) {
      rows.push(["Chase variant", "A rare version packed at random. Hard to find.", "chase"]);
    }
    if (product.releaseDate) {
      const days = daysUntil(product.releaseDate);
      const when = formatReleaseDate(product.releaseDate);
      let text = `Released ${when}`;
      if (days > 1) text = `Releases ${when} · in ${days} days`;
      else if (days === 1) text = `Releases tomorrow, ${when}`;
      else if (days === 0) text = "Releases today";
      rows.push([product.preorder ? "Release date" : "Released", text, "release"]);
    } else if (product.preorder) {
      rows.push(["Release date", "Coming soon. Date to be confirmed.", "release"]);
    }
    if (!rows.length) return "";
    return `<ul class="rarity-panel" aria-label="Edition details">${rows.map(([title, text, kind]) => `
        <li class="rarity-${kind}"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(text)}</span></li>`).join("")}</ul>`;
  }

  function buyMarkup(product, available, inStock) {
    if (canBuy(product)) {
      return `<div class="qty-picker" role="group" aria-label="Quantity">
          <button type="button" data-qty="-1" aria-label="Decrease quantity" ${detailQuantity <= 1 || !available ? "disabled" : ""}>−</button>
          <output aria-live="polite">${available ? detailQuantity : 0}</output>
          <button type="button" data-qty="1" aria-label="Increase quantity" ${detailQuantity >= available ? "disabled" : ""}>+</button>
        </div>
        <button class="primary-link detail-add" type="button" data-add-detail="${escapeHtml(product.id)}" ${available ? "" : "disabled"}>${!inStock ? "Sold out" : available ? "Add to bag" : "All in your bag"}</button>`;
    }
    const onList = alerts.has(product.id);
    const label = product.preorder
      ? (onList ? "✓ You’re on the pre-order list" : "Join the pre-order list")
      : (onList ? "✓ We’ll let you know" : "Notify me when it’s back");
    return `<button class="primary-link detail-add alert-button${onList ? " is-on" : ""}" type="button" data-alert="${escapeHtml(product.id)}" aria-pressed="${onList}">${label}</button>`;
  }

  function alertNote(product) {
    if (canBuy(product)) return "";
    const onList = alerts.has(product.id);
    const what = product.preorder ? "when it’s released" : "as soon as it’s back in stock";
    return `<p class="alert-note">${onList
      ? `It will show under <a href="profile.html#alerts">My alerts</a> ${what}. Tap the button again to leave the list.`
      : `Join free. It will show under My alerts on your profile ${what}, and the shop can email you.`}</p>`;
  }

  // Typical 1:1 car length, used when the admin hasn't entered a model length.
  const REAL_CAR_MM = 4500;
  const COMMON_SCALES = [18, 24, 32, 43, 64];
  // Phones only have room for the biggest and smallest common scales next to this one.
  const PHONE_SCALES = [18, 64];
  const narrowScreen = window.matchMedia("(max-width: 600px)");

  function scaleRatio(product) {
    const match = /1\s*[:/]\s*(\d{1,3})/.exec(product.scale || "");
    const ratio = match ? Number(match[1]) : 0;
    return ratio >= 5 && ratio <= 200 ? ratio : 0;
  }

  function sizeComparison(mm) {
    if (mm <= 30) return "about the size of a coin";
    if (mm <= 95) return "about the length of a bank card";
    if (mm <= 135) return "a little shorter than a phone";
    if (mm <= 165) return "about as long as a phone";
    return `about ${(mm / 147).toFixed(1)}× the length of a phone`;
  }

  function renderScaleSection(product) {
    const section = document.querySelector("#scale-section");
    if (!section) return;
    const ratio = product ? scaleRatio(product) : 0;
    section.hidden = !ratio;
    if (!ratio) return;
    const thisMm = product.lengthMm || Math.round(REAL_CAR_MM / ratio);
    const shown = narrowScreen.matches ? PHONE_SCALES : COMMON_SCALES;
    const scales = [...new Set([...shown, ratio])].sort((a, b) => a - b);
    const items = [
      { kind: "phone", mm: 71, heightMm: 147, label: "Phone", size: "14.7 cm tall" },
      { kind: "coin", mm: 24, heightMm: 24, label: "Coin", size: "2.4 cm" },
      ...scales.map((scale) => {
        const mm = scale === ratio ? thisMm : Math.round(REAL_CAR_MM / scale);
        return { kind: "car", mm, label: `1:${scale}`, size: `${(mm / 10).toFixed(1)} cm`, current: scale === ratio };
      }),
    ];
    const totalMm = items.reduce((sum, item) => sum + item.mm, 0);
    const car = `<svg viewBox="50 34 175 72" aria-hidden="true" focusable="false">${CAR_PATHS}</svg>`;
    section.innerHTML = `
      <div class="section-heading">
        <div><p class="eyebrow">HOW BIG IS IT?</p><h2 id="scale-heading">Size check</h2></div>
      </div>
      <p class="scale-summary">This ${escapeHtml(`1:${ratio}`)} model is about <strong>${(thisMm / 10).toFixed(1)} cm</strong> long, ${sizeComparison(thisMm)}.${product.lengthMm ? "" : " <span>Estimated from a 4.5 m car. Real lengths vary by model.</span>"}</p>
      <div class="scale-shelf-wrap">
        <ul class="scale-shelf" aria-label="Size compared with a phone, a coin, and other scales">
          ${items.map((item) => `
            <li class="scale-item scale-${item.kind}${item.current ? " is-current" : ""}" data-mm="${item.mm}">
              <span class="scale-shape">${item.kind === "car" ? car : ""}</span>
              <span class="scale-label"><strong>${escapeHtml(item.current ? "This model" : item.label)}</strong><small>${item.current ? `${escapeHtml(item.label)} · ` : ""}${escapeHtml(item.size)}</small></span>
            </li>`).join("")}
        </ul>
      </div>
      <p class="scale-legend">Everything on this shelf is drawn to the same scale.</p>`;
    // Widths go through the CSSOM because the CSP blocks inline style attributes.
    section.querySelectorAll(".scale-item").forEach((element) => {
      element.style.flexBasis = `${(Number(element.dataset.mm) / totalMm) * 100}%`;
    });
  }


  // ---- Videos & links about the model ----

  // Turns a YouTube or Vimeo address into a player address; anything else stays a link.
  function videoFor(url) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    const host = parsed.hostname.replace(/^(www|m|music)\./, "");
    const youTubeId = /^[A-Za-z0-9_-]{11}$/;
    let id = "";
    if (host === "youtu.be") id = parsed.pathname.slice(1).split("/")[0];
    else if (host === "youtube.com" || host === "youtube-nocookie.com") {
      id = parsed.searchParams.get("v") || (/^\/(shorts|embed|live)\/([^/]+)/.exec(parsed.pathname) || [])[2] || "";
    }
    if (youTubeId.test(id)) {
      return {
        site: "YouTube",
        embed: `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`,
        thumb: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      };
    }
    const vimeo = host === "vimeo.com" && /^\/(\d+)/.exec(parsed.pathname);
    if (vimeo) return { site: "Vimeo", embed: `https://player.vimeo.com/video/${vimeo[1]}?autoplay=1`, thumb: "" };
    return null;
  }

  function siteName(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return url;
    }
  }

  // "Mini GT" + "MINIGT #1218" -> "MINIGT #1218"; "Mini GT" + "Skyline" -> "Mini GT Skyline".
  function searchQuery(product) {
    const squash = (value) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
    return squash(product.name).includes(squash(product.make)) ? product.name : `${product.make} ${product.name}`;
  }

  const PLAY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8 5.5v13l11-6.5z"></path></svg>';
  const LINK_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="8.5"></circle><path d="M3.5 12h17M12 3.5c2.5 2.6 3.6 5.4 3.6 8.5s-1.1 5.9-3.6 8.5c-2.5-2.6-3.6-5.4-3.6-8.5s1.1-5.9 3.6-8.5Z"></path></svg>';

  function renderResources(product) {
    const section = document.querySelector("#resources-section");
    if (!section) return;
    section.hidden = !product;
    if (!product) return;
    const links = product.links || [];
    // The page redraws on every bag change; don't cut off a video that's playing.
    const key = JSON.stringify([product.id, product.name, product.make, links]);
    if (section.dataset.renderedFor === key) return;
    section.dataset.renderedFor = key;
    const videos = [];
    const pages = [];
    links.forEach((link) => {
      const video = videoFor(link.url);
      if (video) videos.push({ ...link, video });
      else pages.push(link);
    });
    const query = searchQuery(product);
    const outbound = 'target="_blank" rel="noopener noreferrer nofollow"';
    section.innerHTML = `
      <div class="section-heading">
        <div><p class="eyebrow">LEARN MORE</p><h2 id="resources-heading">Videos &amp; links</h2></div>
      </div>
      ${videos.length ? `<div class="video-grid">${videos.map((item) => `
        <div class="video-card">
          <button type="button" class="video-poster${item.video.thumb ? "" : " no-thumb"}" data-video-embed="${escapeHtml(item.video.embed)}" data-video-title="${escapeHtml(item.title || `${item.video.site} video`)}" aria-label="Play ${escapeHtml(item.title || `${item.video.site} video`)}">
            ${item.video.thumb ? `<img src="${escapeHtml(item.video.thumb)}" alt="" loading="lazy">` : ""}
            <span class="video-play">${PLAY_ICON}</span>
          </button>
          <p class="video-title"><strong>${escapeHtml(item.title || `${item.video.site} video`)}</strong><span>${escapeHtml(item.video.site)}</span></p>
        </div>`).join("")}</div>` : ""}
      ${pages.length ? `<div class="link-grid">${pages.map((link) => `
        <a class="link-card" href="${escapeHtml(link.url)}" ${outbound}>
          <span class="link-icon">${LINK_ICON}</span>
          <span class="link-text"><strong>${escapeHtml(link.title || siteName(link.url))}</strong><small>${escapeHtml(siteName(link.url))} ↗</small></span>
        </a>`).join("")}</div>` : ""}
      <div class="search-links">
        <span>${links.length ? "Find even more:" : "Find reviews, photos, and videos of this model:"}</span>
        <a class="search-chip search-youtube" href="https://www.youtube.com/results?search_query=${encodeURIComponent(query)}" ${outbound}>${PLAY_ICON}Search YouTube</a>
        <a class="search-chip" href="https://www.google.com/search?q=${encodeURIComponent(query)}" ${outbound}>${LINK_ICON}Search Google</a>
      </div>`;
  }

  function playVideo(poster) {
    const frame = document.createElement("iframe");
    frame.src = poster.dataset.videoEmbed;
    frame.title = poster.dataset.videoTitle;
    frame.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
    frame.allowFullscreen = true;
    frame.referrerPolicy = "strict-origin-when-cross-origin";
    frame.className = "video-frame";
    poster.replaceWith(frame);
  }

  narrowScreen.addEventListener("change", () => {
    if (productDetail) renderProductDetail();
  });

  function renderProductDetail() {
    if (!productDetail) return;
    const id = new URLSearchParams(window.location.search).get("id");
    const product = products.find((entry) => entry.id === id);
    const crumb = document.querySelector("#crumb-name");
    if (!product) {
      crumb.textContent = "Not found";
      productDetail.innerHTML = '<div class="detail-missing"><h1>We couldn’t find that model.</h1><p>It may have sold out and been removed from the shop.</p><a class="primary-link" href="diecast.html">Browse all diecast cars →</a></div>';
      renderScaleSection(null);
      renderResources(null);
      return;
    }
    document.title = `${product.name} | PitStop.co`;
    crumb.textContent = product.name;
    const inStock = product.stock > 0;
    const inBag = cart.find((item) => item.product.id === product.id)?.quantity || 0;
    const available = canBuy(product) ? Math.max(0, product.stock - inBag) : 0;
    detailQuantity = Math.min(Math.max(1, detailQuantity), Math.max(1, available));
    let status = "Sold out";
    let statusClass = "sold-out";
    if (product.preorder) {
      status = stockLabel(product);
      statusClass = "preorder";
    } else if (inStock) {
      status = `In stock · ${product.stock} available${inBag ? ` · ${inBag} in your bag` : ""}`;
      statusClass = "in-stock";
    }
    productDetail.innerHTML = `
      ${galleryMarkup(product)}
      <div class="detail-info">
        <p class="product-make">${escapeHtml(product.make)} · ${escapeHtml(product.scale)} · ${escapeHtml(product.category)}</p>
        <h1>${escapeHtml(product.name)}</h1>
        <p class="detail-price">${formatPrice(product.price)}</p>
        <p class="stock-status ${statusClass}">${escapeHtml(status)}</p>
        ${rarityMarkup(product)}
        <p class="detail-description">${escapeHtml(product.description)}</p>
        <dl class="detail-specs">
          <div><dt>Brand</dt><dd>${escapeHtml(product.make)}</dd></div>
          <div><dt>Scale</dt><dd>${escapeHtml(product.scale)}</dd></div>
          <div><dt>Category</dt><dd>${escapeHtml(product.category)}</dd></div>
          <div><dt>Condition</dt><dd>${escapeHtml(product.condition)}</dd></div>
        </dl>
        <div class="detail-buy">
          ${buyMarkup(product, available, inStock)}
          ${wishButton(product, "wish-large")}
        </div>
        ${alertNote(product)}
      </div>`;
    renderScaleSection(product);
    renderResources(product);

    const related = products
      .filter((entry) => entry.id !== product.id)
      .map((entry) => ({ entry, score: (entry.category === product.category) * 2 + (entry.make === product.make) + (entry.stock > 0) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 4)
      .map(({ entry }) => entry);
    document.querySelector("#related-section").hidden = !related.length;
    document.querySelector("#related-grid").innerHTML = related.map(productMarkup).join("");
  }

  function renderAll() {
    renderHomeSections();
    renderCatalog();
    renderProductDetail();
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
          : `<div class="cart-placeholder" aria-hidden="true"><svg viewBox="0 0 240 140" focusable="false">${CAR_PATHS}</svg></div>`}
        <div class="cart-item-info"><p class="product-make">${escapeHtml(product.make)}</p><h3><a href="${productUrl(product)}">${name}</a></h3><strong>${formatPrice(product.price)}</strong>
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
    renderAll();
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

  function bumpBag() {
    if (reduceMotion) return;
    cartTrigger.classList.remove("is-bumping");
    void cartTrigger.offsetWidth;
    cartTrigger.classList.add("is-bumping");
  }

  function flyToBag(source) {
    if (reduceMotion || !source) return Promise.resolve();
    const from = source.getBoundingClientRect();
    const to = cartTrigger.getBoundingClientRect();
    const car = document.createElement("div");
    car.className = "fly-car";
    car.setAttribute("aria-hidden", "true");
    car.innerHTML = `<svg viewBox="0 0 240 140" focusable="false">${CAR_PATHS}</svg>`;
    document.body.append(car);
    const startX = from.left + from.width / 2 - 28;
    const startY = from.top + from.height / 2 - 16;
    const endX = to.left + to.width / 2 - 28;
    const endY = to.top + to.height / 2 - 16;
    const animation = car.animate([
      { transform: `translate(${startX}px, ${startY}px) scale(1)`, opacity: 1 },
      { transform: `translate(${(startX + endX) / 2}px, ${Math.min(startY, endY) - 90}px) scale(1.15)`, opacity: 1, offset: .45 },
      { transform: `translate(${endX}px, ${endY}px) scale(.35)`, opacity: .2 },
    ], { duration: 700, easing: "cubic-bezier(.45, 0, .25, 1)" });
    return animation.finished.catch(() => {}).then(() => car.remove());
  }

  async function refreshCart() {
    const result = await window.PitstopApi.request("/api/cart");
    cart = result.items;
    renderCart();
  }

  async function refreshWishlist() {
    const result = await window.PitstopApi.request("/api/wishlist");
    wishlist = new Set(result.items.map((product) => product.id));
  }

  function setAlerts(items) {
    alerts = new Map(items.map((item) => [item.product.id, item]));
  }

  async function refreshAlerts() {
    const result = await window.PitstopApi.request("/api/alerts");
    setAlerts(result.items);
  }

  function announceReadyAlerts() {
    const ready = [...alerts.values()].filter((item) => item.ready);
    const key = `pitstopAlertsSeen:${ready.map((item) => item.product.id).sort().join(",")}`;
    if (!ready.length || sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");
    showToast(ready.length === 1
      ? `Good news: ${ready[0].product.name} is ${ready[0].kind === "preorder" ? "out now" : "back in stock"}!`
      : `Good news: ${ready.length} models you were waiting for are available now.`);
  }

  async function toggleAlert(button) {
    if (!currentUser) {
      goToLogin();
      return;
    }
    const id = button.dataset.alert;
    const joining = !alerts.has(id);
    button.disabled = true;
    try {
      const result = await window.PitstopApi.request(`/api/alerts/${encodeURIComponent(id)}`, {
        method: joining ? "PUT" : "DELETE",
      });
      setAlerts(result.items);
      const product = products.find((entry) => entry.id === id);
      showToast(joining
        ? (product?.preorder ? "You’re on the pre-order list." : "Done! We’ll let you know when it’s back.")
        : "Removed from your alerts.");
      renderProductDetail();
    } catch (error) {
      if (error.status === 401) goToLogin();
      else showToast(error.message);
      button.disabled = false;
    }
  }

  async function updateQuantity(productId, quantity) {
    try {
      const result = await window.PitstopApi.request(`/api/cart/${encodeURIComponent(productId)}`, {
        method: "PUT",
        body: JSON.stringify({ quantity }),
      });
      cart = result.items;
      renderCart();
      renderProductDetail();
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

  async function addToBag(product, amount, source) {
    if (!currentUser) {
      goToLogin();
      return;
    }
    const item = cart.find((entry) => entry.product.id === product.id);
    const current = item ? item.quantity : 0;
    if (current + amount > product.stock) {
      showToast("No more of this model is currently in stock.");
      return;
    }
    const flight = flyToBag(source);
    if (await updateQuantity(product.id, current + amount)) {
      await flight;
      bumpBag();
      showToast(`${amount > 1 ? `${amount} × ` : ""}${product.name} added to your bag.`);
    }
  }

  async function toggleWish(button) {
    if (!currentUser) {
      goToLogin();
      return;
    }
    const id = button.dataset.wish;
    const saving = !wishlist.has(id);
    try {
      const result = await window.PitstopApi.request(`/api/wishlist/${encodeURIComponent(id)}`, {
        method: saving ? "PUT" : "DELETE",
      });
      wishlist = new Set(result.items.map((product) => product.id));
      document.querySelectorAll(`[data-wish="${CSS.escape(id)}"]`).forEach((element) => {
        element.setAttribute("aria-pressed", String(saving));
        if (saving && !reduceMotion) element.classList.add("is-popping");
      });
      showToast(saving ? "Saved to your collection wishlist." : "Removed from your saved models.");
      if (grid && savedFilter.getAttribute("aria-pressed") === "true") renderCatalog();
    } catch (error) {
      if (error.status === 401) goToLogin();
      else showToast(error.message);
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

  function setUpReveal() {
    const targets = document.querySelectorAll("[data-reveal]");
    if (reduceMotion || !("IntersectionObserver" in window) || !targets.length) return;
    document.documentElement.classList.add("reveal-ready");
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-revealed");
        observer.unobserve(entry.target);
      });
    }, { rootMargin: "0px 0px -8% 0px" });
    targets.forEach((target) => observer.observe(target));
  }

  function makeCartDraggable() {
    let pointerStart;

    cartTrigger.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      const bounds = cartTrigger.getBoundingClientRect();
      pointerStart = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        left: bounds.left,
        top: bounds.top,
        moved: false,
      };
      cartTrigger.setPointerCapture(event.pointerId);
    });

    cartTrigger.addEventListener("pointermove", (event) => {
      if (!pointerStart || pointerStart.id !== event.pointerId) return;
      const deltaX = event.clientX - pointerStart.x;
      const deltaY = event.clientY - pointerStart.y;
      if (!pointerStart.moved && Math.hypot(deltaX, deltaY) < 5) return;
      pointerStart.moved = true;
      cartWasDragged = true;
      const maxLeft = Math.max(8, window.innerWidth - cartTrigger.offsetWidth - 8);
      const maxTop = Math.max(8, window.innerHeight - cartTrigger.offsetHeight - 8);
      const left = Math.min(Math.max(8, pointerStart.left + deltaX), maxLeft);
      const top = Math.min(Math.max(8, pointerStart.top + deltaY), maxTop);
      cartTrigger.style.left = `${left}px`;
      cartTrigger.style.top = `${top}px`;
      cartTrigger.style.right = "auto";
      cartTrigger.style.bottom = "auto";
    });

    const finishDrag = (event) => {
      if (!pointerStart || pointerStart.id !== event.pointerId) return;
      if (cartTrigger.hasPointerCapture(event.pointerId)) cartTrigger.releasePointerCapture(event.pointerId);
      if (event.type === "pointercancel") cartWasDragged = false;
      pointerStart = null;
    };
    cartTrigger.addEventListener("pointerup", finishDrag);
    cartTrigger.addEventListener("pointercancel", finishDrag);

    window.addEventListener("resize", () => {
      if (!cartTrigger.style.left) return;
      const maxLeft = Math.max(8, window.innerWidth - cartTrigger.offsetWidth - 8);
      const maxTop = Math.max(8, window.innerHeight - cartTrigger.offsetHeight - 8);
      cartTrigger.style.left = `${Math.min(Math.max(8, parseFloat(cartTrigger.style.left)), maxLeft)}px`;
      cartTrigger.style.top = `${Math.min(Math.max(8, parseFloat(cartTrigger.style.top)), maxTop)}px`;
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
      readCatalogParams();
      if (currentUser) {
        await Promise.all([refreshCart(), refreshWishlist(), refreshAlerts()]);
      } else {
        renderCart();
      }
      renderAll();
      announceReadyAlerts();
    } catch (error) {
      console.error("Could not load the storefront.", error);
      showToast(`Could not load the storefront: ${error.message}`);
    }
  }

  if (searchInput) searchInput.addEventListener("input", renderCatalog);
  [categoryFilter, brandFilter, priceFilter, stockFilter, sortFilter].forEach((filter) => {
    if (filter) filter.addEventListener("change", renderCatalog);
  });
  if (savedFilter) {
    savedFilter.addEventListener("click", () => {
      if (!currentUser) {
        goToLogin();
        return;
      }
      const pressed = savedFilter.getAttribute("aria-pressed") === "true";
      savedFilter.setAttribute("aria-pressed", String(!pressed));
      renderCatalog();
    });
  }
  const clearFilters = document.querySelector("#clear-filters");
  if (clearFilters) {
    clearFilters.addEventListener("click", () => {
      searchInput.value = "";
      categoryFilter.value = "All";
      brandFilter.value = "All";
      priceFilter.value = "all";
      stockFilter.value = "all";
      sortFilter.value = "featured";
      savedFilter.setAttribute("aria-pressed", "false");
      renderCatalog();
    });
  }

  document.addEventListener("click", (event) => {
    const wishButtonElement = event.target.closest("[data-wish]");
    if (wishButtonElement) {
      toggleWish(wishButtonElement);
      return;
    }
    const poster = event.target.closest("[data-video-embed]");
    if (poster) {
      playVideo(poster);
      return;
    }
    const alertButton = event.target.closest("[data-alert]");
    if (alertButton) {
      toggleAlert(alertButton);
      return;
    }
    const thumb = event.target.closest("[data-gallery]");
    if (thumb) {
      galleryIndex = Number(thumb.dataset.gallery);
      renderProductDetail();
      productDetail.querySelector(`[data-gallery="${galleryIndex}"]`)?.focus();
      return;
    }
    const zoomFrame = event.target.closest("[data-zoom]");
    if (zoomFrame) {
      const zoomed = zoomFrame.classList.toggle("is-zoomed");
      zoomFrame.setAttribute("aria-label", zoomed ? "Zoom out" : "Zoom in");
      if (zoomed) moveZoom(zoomFrame, event);
      return;
    }
    const qtyButton = event.target.closest("[data-qty]");
    if (qtyButton) {
      detailQuantity += Number(qtyButton.dataset.qty);
      renderProductDetail();
      return;
    }
    const detailAdd = event.target.closest("[data-add-detail]");
    const addButton = detailAdd || event.target.closest("[data-add]");
    if (!addButton || addButton.disabled) return;
    const product = products.find((entry) => entry.id === (detailAdd ? detailAdd.dataset.addDetail : addButton.dataset.add));
    if (!product) return;
    addToBag(product, detailAdd ? detailQuantity : 1, addButton).then(() => {
      if (detailAdd) detailQuantity = 1;
    });
  });

  function moveZoom(frame, event) {
    const image = frame.querySelector("img");
    const bounds = frame.getBoundingClientRect();
    // Keyboard clicks have no pointer position, so zoom into the centre.
    const x = event.detail === 0 ? 50 : ((event.clientX - bounds.left) / bounds.width) * 100;
    const y = event.detail === 0 ? 50 : ((event.clientY - bounds.top) / bounds.height) * 100;
    image.style.transformOrigin = `${Math.min(100, Math.max(0, x))}% ${Math.min(100, Math.max(0, y))}%`;
  }

  if (productDetail) {
    productDetail.addEventListener("pointermove", (event) => {
      const frame = event.target.closest(".zoom-frame.is-zoomed");
      if (frame) moveZoom(frame, event);
    });
  }

  document.addEventListener("animationend", (event) => {
    if (event.target.classList?.contains("is-popping")) event.target.classList.remove("is-popping");
    if (event.target === cartTrigger) cartTrigger.classList.remove("is-bumping");
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
      await Promise.all([refreshProducts(), refreshAlerts().catch(() => {})]);
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
  setUpReveal();
  initialize();
})();
