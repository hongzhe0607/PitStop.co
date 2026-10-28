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
    if (options.body) headers.set("Content-Type", "application/json");
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

  function createLink(href, label) {
    const link = document.createElement("a");
    link.href = href;
    if (label === "Profile") {
      link.className = "profile-link";
      link.setAttribute("aria-label", label);
      link.title = label;
      link.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="8" r="3.5"></circle><path d="M5.5 20v-1.2a6.5 6.5 0 0 1 13 0V20z"></path></svg>';
    } else if (label === "Saved models") {
      link.className = "profile-link";
      link.setAttribute("aria-label", label);
      link.title = label;
      link.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z"></path></svg>';
    } else {
      link.textContent = label;
    }
    return link;
  }

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
