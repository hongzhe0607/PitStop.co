(() => {
  const form = document.querySelector("#login-form, #register-form");
  const message = document.querySelector("#form-message");
  if (!form) return;

  function redirectAfterAuth() {
    const next = new URLSearchParams(window.location.search).get("next");
    if (next) {
      const target = new URL(next, window.location.origin);
      const allowedPaths = new Set(["/", "/index.html", "/diecast.html", "/about.html", "/contact.html", "/product.html", "/profile.html", "/admin.html"]);
      if (target.origin === window.location.origin && allowedPaths.has(target.pathname)) {
        window.location.assign(`${target.pathname}${target.search}${target.hash}`);
        return;
      }
    }
    window.location.assign("/profile.html");
  }

  async function initialize() {
    const user = await window.PitstopApi.getUser();
    if (user) window.location.replace("/profile.html");
  }

  initialize().catch((error) => {
    message.textContent = `Could not reach the account service: ${error.message}`;
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    message.textContent = "";
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    const values = new FormData(form);
    const isRegistration = form.id === "register-form";
    const payload = isRegistration
      ? { name: values.get("name"), email: values.get("email"), password: values.get("password") }
      : { email: values.get("email"), password: values.get("password") };
    try {
      const result = await window.PitstopApi.request(isRegistration ? "/api/register" : "/api/login", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      window.PitstopApi.setUser(result.user);
      redirectAfterAuth();
    } catch (error) {
      message.textContent = error.message;
      button.disabled = false;
    }
  });
})();
