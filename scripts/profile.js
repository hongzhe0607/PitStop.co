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
    await loadOrders();
  }

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
