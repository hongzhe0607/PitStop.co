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
    roleLabel.textContent = user.role === "admin" ? "Administrator account" : "Customer account";
    document.querySelector("#admin-shortcut").hidden = user.role !== "admin";
    await Promise.all([loadOrders(), loadAlerts()]);
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
    if (!items.length) {
      const empty = document.createElement("li");
      empty.className = "profile-role";
      empty.textContent = "No alerts yet. On a sold-out or pre-order model, tap “Notify me” to add one.";
      alertList.append(empty);
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
      if (!orders.length) {
        const empty = document.createElement("p");
        empty.className = "profile-role";
        empty.textContent = "You haven't placed any orders yet.";
        list.append(empty);
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
      message.textContent = "Profile saved.";
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
