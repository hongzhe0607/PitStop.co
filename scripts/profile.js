(() => {
  const form = document.querySelector("#profile-form");
  const message = document.querySelector("#form-message");
  const nameField = form.elements.name;
  const emailField = form.elements.email;
  const roleLabel = document.querySelector("#profile-role");
  const signoutButton = document.querySelector("#profile-signout");
  const signoutMessage = document.querySelector("#signout-message");

  async function initialize() {
    const user = await window.PitstopApi.getUser();
    if (!user) {
      window.location.replace(`/login.html?next=${encodeURIComponent("/profile.html")}`);
      return;
    }
    nameField.value = user.name;
    emailField.value = user.email;
    renderIdentity(user);
    roleLabel.textContent = user.role === "admin" ? "Administrator" : "Collector";
    roleLabel.classList.toggle("is-admin", user.role === "admin");
    document.querySelector("#admin-shortcut").hidden = user.role !== "admin";
    await Promise.all([loadOrders(), loadAlerts(), loadSavedCount()]);
  }

  function renderIdentity(user) {
    const initials = user.name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
    document.querySelector("#profile-avatar").textContent = initials || "?";
    document.querySelector("#profile-heading").textContent = `Hi, ${user.name.trim().split(/\s+/)[0]}`;
    document.querySelector("#profile-email-label").textContent = user.email;
  }

  function setStat(id, value) {
    document.querySelector(`#stat-${id}`).textContent = value;
  }

  async function loadSavedCount() {
    try {
      const { items } = await window.PitstopApi.request("/api/wishlist");
      setStat("saved", items.length);
    } catch {
      setStat("saved", "–");
    }
  }

  const ICONS = {
    bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15Z"></path><path d="M10 20.5a2 2 0 0 0 4 0"></path>',
    box: '<path d="M4 8l8-4 8 4v8l-8 4-8-4z"></path><path d="M4 8l8 4 8-4M12 12v8"></path>',
  };

  function emptyState(tag, icon, title, text) {
    const empty = document.createElement(tag);
    empty.className = "profile-empty";
    empty.innerHTML = `<span class="profile-empty-icon" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false">${ICONS[icon]}</svg></span>`;
    const copy = document.createElement("div");
    const heading = document.createElement("strong");
    heading.textContent = title;
    const body = document.createElement("p");
    body.textContent = text;
    const link = document.createElement("a");
    link.href = "diecast.html";
    link.textContent = "Browse diecast →";
    copy.append(heading, body, link);
    empty.append(copy);
    return empty;
  }

  const alertList = document.querySelector("#my-alert-list");
  const alertsMessage = document.querySelector("#alerts-message");

  function renderAlerts(items) {
    alertList.replaceChildren(...items.map(({ product, kind, ready }) => {
      const card = document.createElement("li");
      card.className = `alert-card${ready ? " is-ready" : ""}`;
      const info = document.createElement("div");
      info.className = "alert-card-info";
      const link = document.createElement("a");
      link.href = `product.html?id=${encodeURIComponent(product.id)}`;
      link.textContent = product.name;
      const state = document.createElement("small");
      if (ready) state.textContent = kind === "preorder" ? "Out now! Buy it before it sells out." : "Back in stock! Buy it before it sells out.";
      else if (kind === "preorder") state.textContent = product.releaseDate ? `Pre-order · releases ${product.releaseDate}` : "Pre-order · release date to be confirmed";
      else state.textContent = "Sold out · we're watching for a restock";
      info.append(link, state);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "secondary-button";
      remove.dataset.removeAlert = product.id;
      remove.textContent = "Remove";
      remove.setAttribute("aria-label", `Remove alert for ${product.name}`);
      card.append(info, remove);
      return card;
    }));
    setStat("alerts", items.length);
    if (!items.length) {
      alertList.append(emptyState("li", "bell", "No alerts yet",
        "Missed a model? Tap “Notify me” on anything sold out or on pre-order and we’ll flag it here."));
    }
  }

  async function loadAlerts() {
    try {
      const { items } = await window.PitstopApi.request("/api/alerts");
      renderAlerts(items);
    } catch (error) {
      alertsMessage.textContent = `Could not load your alerts: ${error.message}`;
    }
  }

  alertList.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-remove-alert]");
    if (!button) return;
    button.disabled = true;
    alertsMessage.textContent = "";
    try {
      const { items } = await window.PitstopApi.request(`/api/alerts/${encodeURIComponent(button.dataset.removeAlert)}`, {
        method: "DELETE",
      });
      renderAlerts(items);
    } catch (error) {
      alertsMessage.textContent = error.message;
      button.disabled = false;
    }
  });

  async function loadOrders() {
    const list = document.querySelector("#my-order-list");
    try {
      const { orders } = await window.PitstopApi.request("/api/orders");
      list.replaceChildren(...orders.map((order) => window.PitstopOrders.renderOrder(order)));
      setStat("orders", orders.length);
      if (!orders.length) {
        list.append(emptyState("div", "box", "No orders yet",
          "When you check out, your orders and their progress show up here."));
      }
    } catch (error) {
      document.querySelector("#orders-message").textContent = `Could not load your orders: ${error.message}`;
    }
  }

  initialize().catch((error) => {
    message.textContent = `Could not load your profile: ${error.message}`;
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    message.textContent = "";
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      const result = await window.PitstopApi.request("/api/profile", {
        method: "PATCH",
        body: JSON.stringify({ name: nameField.value }),
      });
      nameField.value = result.user.name;
      window.PitstopApi.setUser(result.user);
      renderIdentity(result.user);
      message.textContent = "Saved.";
    } catch (error) {
      message.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });

  signoutButton.addEventListener("click", async () => {
    signoutMessage.textContent = "";
    signoutButton.disabled = true;
    try {
      await window.PitstopApi.request("/api/logout", {
        method: "POST",
        body: "{}",
      });
      window.location.assign("/index.html");
    } catch (error) {
      signoutMessage.textContent = `Could not sign out: ${error.message}`;
      signoutButton.disabled = false;
    }
  });
})();
