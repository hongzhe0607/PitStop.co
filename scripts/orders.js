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
        customer.append(element("dt", "", label), element("dd", "", value));
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
    }
    return card;
  }

  window.PitstopOrders = { STATUS_LABELS, element, formatPrice, formatDate, statusBadge, renderOrder };
})();
