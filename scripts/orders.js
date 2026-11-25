(() => {
  const STATUS_LABELS = {
    pending: "Pending",
    confirmed: "Confirmed",
    shipped: "Shipped",
    completed: "Completed",
    cancelled: "Cancelled",
  };
  const ACTION_LABELS = {
    confirmed: "Confirm order",
    shipped: "Mark shipped",
    completed: "Mark completed",
    cancelled: "Cancel order",
  };
  const priceFormat = new Intl.NumberFormat("en-MY", { style: "currency", currency: "MYR" });
  const dateFormat = new Intl.DateTimeFormat("en-MY", { dateStyle: "medium", timeStyle: "short" });

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function formatPrice(value) {
    return priceFormat.format(value);
  }

  function formatDate(value) {
    return dateFormat.format(new Date(value));
  }

  function statusBadge(status) {
    return element("span", `order-status status-${status}`, STATUS_LABELS[status] || status);
  }

  // Malaysian numbers are usually typed as 012-345 6789; WhatsApp needs 60123456789.
  function whatsappNumber(phone) {
    const digits = phone.split("").filter((character) => character >= "0" && character <= "9").join("");
    if (digits.startsWith("0")) return `6${digits}`;
    return digits;
  }

  function contactLinks(order) {
    const links = element("span", "order-contact");
    const number = whatsappNumber(order.phone);
    const items = order.items.map((item) => `${item.name} × ${item.quantity}`).join(", ");
    const whatsapp = element("a", "order-contact-whatsapp", "WhatsApp");
    whatsapp.href = `https://wa.me/${number}?text=${encodeURIComponent(
      `Hi ${order.name}, this is PitStop.co about your order #${order.id} (${items}, total ${formatPrice(order.subtotal)}).`,
    )}`;
    whatsapp.target = "_blank";
    whatsapp.rel = "noopener noreferrer";
    const call = element("a", "order-contact-call", "Call");
    call.href = `tel:${order.phone.replace(/[^0-9+]/g, "")}`;
    links.append(whatsapp, call);
    return links;
  }

  function renderOrder(order, options = {}) {
    const card = element("article", "order-card");
    const heading = element("div", "order-card-heading");
    const title = element("div");
    title.append(element("h3", "", `Order #${order.id}`), element("p", "order-date", formatDate(order.createdAt)));
    heading.append(title, statusBadge(order.status));
    card.append(heading);

    const items = element("ul", "order-items");
    order.items.forEach((item) => {
      const row = element("li");
      row.append(
        element("span", "", `${item.name} × ${item.quantity}`),
        element("span", "", formatPrice(item.price * item.quantity)),
      );
      items.append(row);
    });
    const total = element("li", "order-total");
    total.append(element("span", "", "Total"), element("strong", "", formatPrice(order.subtotal)));
    items.append(total);
    card.append(items);

    if (options.admin) {
      const customer = element("dl", "order-customer");
      [
        ["Customer", order.name],
        ["Email", order.email || "Account removed"],
        ["Phone", order.phone],
        ["Ship to", order.address],
        ["Note", order.note],
      ].forEach(([label, value]) => {
        if (!value) return;
        const detail = element("dd", "", value);
        if (label === "Phone") detail.append(contactLinks(order));
        customer.append(element("dt", "", label), detail);
      });
      card.append(customer);
      if (order.nextStatuses.length) {
        const actions = element("div", "admin-row-actions");
        order.nextStatuses.forEach((status) => {
          const button = element("button", status === "cancelled" ? "secondary-button" : "primary-link account-submit", ACTION_LABELS[status]);
          button.type = "button";
          button.dataset.orderId = order.id;
          button.dataset.status = status;
          actions.append(button);
        });
        card.append(actions);
      }
    } else if (order.status === "pending") {
      const actions = element("div", "order-customer-actions");
      const cancel = element("button", "secondary-button", "Cancel order");
      cancel.type = "button";
      cancel.dataset.cancelOrder = order.id;
      actions.append(cancel, element("p", "order-cancel-hint", "You can cancel until the shop confirms your order."));
      card.append(actions);
    }
    return card;
  }

  window.PitstopOrders = { STATUS_LABELS, element, formatPrice, formatDate, statusBadge, renderOrder };
})();
