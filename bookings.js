(() => {
  const account = window.LockdAccount;
  async function request(method, body, owner = false) {
    const session = await account.getSession();
    if (!session) throw new Error("Sign in to manage reservations.");
    const res = await fetch(`/api/bookings${owner ? "?owner=1" : ""}`, {
      method,
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await res.json();
    if (!res.ok) {
      const error = new Error(
        data.message || "Reservations could not be loaded.",
      );
      error.status = res.status;
      throw error;
    }
    return data;
  }
  async function renderHistory(root, owner) {
    root.textContent = "Loading reservations…";
    try {
      const { items } = await request("GET", null, owner);
      root.replaceChildren();
      if (!items.length) {
        root.textContent = "No reservations to show yet.";
        return;
      }
      for (const b of items) {
        const card = document.createElement("article");
        card.className = "booking-history-item";
        const h = document.createElement("h4");
        h.textContent = b.listing_snapshot?.title || "Rental reservation";
        const p = document.createElement("p");
        p.textContent = `${b.start_date} – ${b.end_date} · Quantity ${b.quantity} · ${b.status.replaceAll("_", " ")} · Payment: ${b.payment_status}`;
        const price = document.createElement("p");
        price.textContent =
          b.total_amount != null
            ? `${b.currency} ${b.total_amount} total · ${b.deposit_amount} refundable deposit included`
            : "Historical price not recorded";
        const ref = document.createElement("small");
        ref.textContent = `Reference ${b.id}`;
        card.append(h, p, price, ref);
        if (b.trust_policy_id) {
          const requirements = document.createElement('p');
          requirements.textContent = `Verification policy v${b.trust_requirements?.version || ''} · Owner: ${b.owner_approval} · LOCKD: ${b.platform_approval}. Required checks are revalidated before payment and handover.`;
          card.append(requirements);
        }
        if (b.booking_conditions) {
          const conditions = document.createElement('p');
          conditions.textContent = `Rental conditions: ${b.booking_conditions}`;
          card.append(conditions);
        }
        const available = [];
        if (
          ["pending_owner", "awaiting_payment"].includes(b.status) &&
          b.payment_status === "unpaid"
        )
          available.push(["cancel", "Cancel request"]);
        if (owner && b.status === 'pending_owner') {
          if (!b.owner_approval || b.owner_approval === 'pending') available.push(['accept','Accept request']);
          available.push(['reject','Reject request']);
        }
        if (!owner && b.status === 'pending_owner') {
          if (b.booking_conditions && !b.conditions_accepted_at) available.push(['accept_conditions','Accept rental conditions']);
          available.push(['continue','Recheck requirements']);
        }
        if (owner && b.status === "confirmed" && b.payment_status === "paid")
          available.push(["check_out", "Record handover"]);
        if (owner && b.status === 'confirmed' && b.trust_policy_id && b.owner_approval === 'approved') available.push(['accept','Renew owner approval']);
        if (owner && b.status === "active")
          available.push(["check_in", "Record return"]);
        if (["pending_owner", "awaiting_payment", "confirmed", "active", "completed", "disputed"].includes(b.status)) {
          const manage = document.createElement('a');
          manage.href = `trust.html?booking=${encodeURIComponent(b.id)}`;
          manage.className = 'text-button';
          manage.textContent = 'Rental checks & support';
          card.append(manage);
        }
        for (const [action, label] of available) {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "text-button";
          btn.textContent = label;
          btn.addEventListener("click", async () => {
            btn.disabled = true;
            try {
              await request("PATCH", { bookingId: b.id, action });
              await renderHistory(root, owner);
            } catch (e) {
              const err = document.createElement("p");
              err.setAttribute("role", "alert");
              err.textContent = e.message;
              card.append(err);
              btn.disabled = false;
            }
          });
          card.append(btn);
        }
        root.append(card);
      }
    } catch (e) {
      root.textContent = e.message;
      const retry = document.createElement("button");
      retry.textContent = "Retry";
      retry.type = "button";
      retry.addEventListener("click", () => renderHistory(root, owner));
      root.append(retry);
    }
  }
  document
    .querySelectorAll("[data-load-bookings]")
    .forEach((button) =>
      button.addEventListener("click", () =>
        renderHistory(
          document.querySelector("#booking-history"),
          button.dataset.loadBookings === "owner",
        ),
      ),
    );
  const box = document.querySelector("#reservation-request");
  if (box) {
    fetch("/api/bookings?capabilities=1", { cache: "no-store" })
      .then((r) => r.json())
      .then((c) => {
        box.hidden = !c.requestsEnabled;
      })
      .catch(() => {});
    const form = document.querySelector("#availability-form");
    const message = box.querySelector("[role=status]");
    let key = null,
      previous = "",
      attempted = null;
    box.querySelector("button").addEventListener("click", async (event) => {
      if (!form.reportValidity()) return;
      const listingId = form.dataset.listingId;
      if (!listingId) return;
      const body = {
        listingId,
        startDate: form.startDate.value,
        endDate: form.endDate.value,
        quantity: Number(form.quantity.value),
      };
      let session;
      try {
        session = await account.getSession();
      } catch (e) {
        message.textContent =
          e.message || "Sign-in could not be checked. Please retry.";
        return;
      }
      if (!session) {
        const u = new URL(location.href);
        Object.entries(body)
          .filter(([k]) => k !== "listingId")
          .forEach(([k, v]) => u.searchParams.set(k, v));
        location.assign(account.authLink({ returnTo: u.pathname + u.search }));
        return;
      }
      const current = JSON.stringify(body);
      if (previous !== current) {
        key = crypto.randomUUID();
        previous = current;
        attempted = null;
      }
      const btn = event.currentTarget;
      btn.disabled = true;
      try {
        let item;
        if (attempted) {
          ({ item } = await request("POST", attempted));
        } else {
          const quote = await request("POST", { ...body, action: "quote" });
          message.textContent = `${quote.item.currency} ${quote.item.totalAmount} total, including ${quote.item.depositAmount} refundable deposit. Payment is not connected. Review this total before sending your request.`;
          const reviewed = JSON.stringify([
            current,
            quote.item.currency,
            quote.item.totalAmount,
          ]);
          if (btn.dataset.reviewed !== reviewed) {
            btn.dataset.reviewed = reviewed;
            btn.textContent = "Send booking request";
            return;
          }
          attempted = {
            ...body,
            action: "request",
            idempotencyKey: key,
            expectedTotal: String(quote.item.totalAmount),
            expectedCurrency: quote.item.currency,
          };
          ({ item } = await request("POST", attempted));
        }
        message.textContent = `Request recorded: ${item.id}. ${item.status === "pending_owner" ? "Awaiting the required verification and approvals. Manage this request in your account." : "Awaiting payment setup; this is not a confirmed rental."} Hold ends ${new Date(item.expires_at).toLocaleString()}.`;
        btn.textContent = "Request recorded";
        btn.dataset.sent = "true";
      } catch (e) {
        message.textContent = e.message;
        if (e.status >= 400 && e.status < 500) {
          attempted = null;
          delete btn.dataset.reviewed;
        }
      } finally {
        btn.disabled = btn.dataset.sent === "true";
      }
    });
  }
})();
