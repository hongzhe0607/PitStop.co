(() => {
  class ApiError extends Error {
    constructor(message, status, body) {
      super(message);
      this.status = status;
      this.body = body;
    }
  }

  let csrfToken;
  let currentUser;
  const year = document.querySelector("#year");
  if (year) year.textContent = new Date().getFullYear();
  const accountReady = (async () => {
    const response = await fetch("/api/csrf");
    const data = await response.json();
    if (!response.ok) throw new ApiError(data.error || "Could not start a secure session.", response.status, data);
    csrfToken = data.token;
    const result = await request("/api/me");
    currentUser = result.user;
    renderAccountLinks();
    return currentUser;
  })();

  async function request(url, options = {}) {
    const method = (options.method || "GET").toUpperCase();
    const headers = new Headers(options.headers || {});
    headers.set("Accept", "application/json");
    // FormData (file uploads) sets its own multipart Content-Type.
    if (options.body && !(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
    if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
      if (!csrfToken) {
        const response = await fetch("/api/csrf");
        const data = await response.json();
        if (!response.ok) throw new ApiError(data.error || "Could not start a secure session.", response.status, data);
        csrfToken = data.token;
      }
      headers.set("X-CSRF-Token", csrfToken);
    }
    const response = await fetch(url, { ...options, method, headers });
    let data;
    try {
      data = await response.json();
    } catch {
      throw new ApiError("The server returned an unreadable response.", response.status, null);
    }
    if (!response.ok) throw new ApiError(data.error || "The request could not be completed.", response.status, data);
    return data;
  }

  function renderAccountLinks() {
    const slot = document.querySelector("#account-slot");
    if (!slot) return;
    slot.replaceChildren();
    if (!currentUser) {
      slot.append(
        createLink("login.html", "Sign in"),
        createLink("register.html", "Register")
      );
      return;
    }
    slot.append(createLink("diecast.html?saved=1", "Saved models"), createLink("profile.html", "Profile"));
    if (currentUser.role === "admin") slot.append(createLink("admin.html", "Admin"));
  }

  const ACCOUNT_ICONS = {
    "Sign in": '<path d="M14 4.5h3.5a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H14"></path><path d="m10 16 4-4-4-4M14 12H4.5"></path>',
    Register: '<circle cx="10" cy="8" r="3.5"></circle><path d="M3.5 20v-1.2a6.5 6.5 0 0 1 10.5-5.1M18 14v6M15 17h6"></path>',
    "Saved models": '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z"></path>',
    Profile: '<circle cx="12" cy="8" r="3.5"></circle><path d="M5.5 20v-1.2a6.5 6.5 0 0 1 13 0V20z"></path>',
    Admin: '<rect x="4" y="4" width="7" height="7" rx="1.5"></rect><rect x="13" y="4" width="7" height="7" rx="1.5"></rect><rect x="4" y="13" width="7" height="7" rx="1.5"></rect><rect x="13" y="13" width="7" height="7" rx="1.5"></rect>',
  };

  function createLink(href, label) {
    const link = document.createElement("a");
    link.href = href;
    link.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ACCOUNT_ICONS[label]}</svg>`;
    const text = document.createElement("span");
    text.textContent = label;
    link.append(text);
    if (label === "Register") link.classList.add("account-cta");
    if (["Saved models", "Profile", "Admin"].includes(label)) {
      // These shrink to icons on small screens, so keep a spoken and hover label.
      link.classList.add("account-icon-link");
      link.setAttribute("aria-label", label);
      link.title = label;
    }
    const page = window.location.pathname.split("/").pop() || "index.html";
    if (href.includes("?") ? href === page + window.location.search : href === page) {
      link.classList.add("is-current");
      link.setAttribute("aria-current", "page");
    }
    return link;
  }

  function setUpNavToggle() {
    const toggle = document.querySelector(".nav-toggle");
    const header = document.querySelector(".site-header");
    if (!toggle || !header) return;
    const backdrop = document.createElement("div");
    backdrop.className = "nav-backdrop";
    header.append(backdrop);
    const narrow = window.matchMedia("(max-width: 900px)");
    // Collapsed links show only icons, so give each one a hover label.
    document.querySelectorAll(".main-nav a").forEach((link) => { link.title = link.textContent.trim(); });
    const setOpen = (open) => {
      document.body.classList.toggle("nav-open", open);
      toggle.setAttribute("aria-expanded", String(open));
      toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    };
    const setCollapsed = (collapsed) => {
      document.body.classList.toggle("sidebar-collapsed", collapsed);
      try { localStorage.setItem("sidebarCollapsed", collapsed ? "1" : "0"); } catch {}
      syncToggle();
    };
    const syncToggle = () => {
      if (narrow.matches) {
        setOpen(document.body.classList.contains("nav-open"));
      } else {
        const collapsed = document.body.classList.contains("sidebar-collapsed");
        toggle.setAttribute("aria-expanded", String(!collapsed));
        toggle.setAttribute("aria-label", collapsed ? "Expand menu" : "Collapse menu");
      }
    };
    try { document.body.classList.toggle("sidebar-collapsed", localStorage.getItem("sidebarCollapsed") === "1"); } catch {}
    syncToggle();
    // Animate only clicks, not the saved state being restored on page load.
    requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.add("sidebar-ready")));
    narrow.addEventListener("change", () => { setOpen(false); syncToggle(); });
    toggle.addEventListener("click", () => {
      if (narrow.matches) setOpen(!document.body.classList.contains("nav-open"));
      else setCollapsed(!document.body.classList.contains("sidebar-collapsed"));
    });
    backdrop.addEventListener("click", () => setOpen(false));
    document.querySelector(".main-nav").addEventListener("click", (event) => {
      if (event.target.closest("a")) setOpen(false);
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && document.body.classList.contains("nav-open")) {
        setOpen(false);
        toggle.focus();
      }
    });
  }

  setUpNavToggle();

  window.PitstopApi = {
    ApiError,
    request,
    ready: accountReady,
    getUser: () => accountReady.then(() => currentUser),
    setUser(user) {
      currentUser = user;
      renderAccountLinks();
    },
  };

  accountReady.catch((error) => {
    console.error("Could not load account status.", error);
    const slot = document.querySelector("#account-slot");
    if (slot) slot.textContent = "Account unavailable";
  });
})();
