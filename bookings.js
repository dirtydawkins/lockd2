(() => {
  const account = window.LockdAccount;
  const historyRequests = new WeakMap();
  const bookingLabels = {
    pending_owner: "Awaiting approval", awaiting_payment: "Awaiting payment", confirmed: "Confirmed",
    active: "Rental in progress", completed: "Completed", rejected: "Declined", cancelled: "Cancelled",
    expired: "Request expired", disputed: "Under review"
  };
  function formatDate(value) {
    return new Intl.DateTimeFormat("en-KE", {day:"numeric", month:"short", year:"numeric", timeZone:"UTC"})
      .format(new Date(value + "T12:00:00Z"));
  }
  async function request(method, body, owner = false, signal) {
    const session = await account.getSession();
    if (!session) throw new Error("Sign in to manage reservations.");
    const res = await fetch(`/api/bookings${owner ? "?owner=1" : ""}`, {
      method,
      cache: "no-store",
      signal: signal || AbortSignal.timeout(15000),
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await res.json().catch(() => ({}));
    if ((await account.getSession())?.user?.id !== session.user?.id)
      throw new Error("Your account changed. Reopen your reservations.");
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
    historyRequests.get(root)?.abort();
    const controller = new AbortController();
    historyRequests.set(root, controller);
    const deadline = setTimeout(() => controller.abort(), 15000);
    root.textContent = owner ? "Loading booking requests…" : "Loading your reservations…";
    try {
      const { items } = await request("GET", null, owner, controller.signal);
      if (historyRequests.get(root) !== controller) return;
      root.replaceChildren();
      if (!items.length) {
        const note = document.createElement("p"), link = document.createElement("a");
        note.textContent = owner ? "Requests for your listings will appear here." : "Your reservations will appear here when you request a rental.";
        link.href = owner ? "owners.html#owner-workspace" : "rentals.html";
        link.className = "text-button";
        link.textContent = owner ? "View my listings" : "Explore rentals";
        root.append(note, link);
        return;
      }
      for (const b of items) {
        const card = document.createElement("article");
        card.className = "booking-history-item";
        const h = document.createElement("h4");
        h.textContent = b.listing_snapshot?.title || "Rental reservation";
        const p = document.createElement("p");
        p.textContent = `${formatDate(b.start_date)} – ${formatDate(b.end_date)} · Quantity ${b.quantity} · ${bookingLabels[b.status] || b.status} · Payment: ${b.payment_status}`;
        const price = document.createElement("p");
        price.textContent =
          b.total_amount != null
            ? `${b.currency} ${b.total_amount} total${Number(b.deposit_amount) > 0 ? " (includes " + b.currency + " " + b.deposit_amount + " refundable deposit)" : ""}`
            : "Price unavailable for this reservation";
        const ref = document.createElement("small");
        ref.textContent = `Reference ${b.id}`;
        card.append(h, p, price, ref);
        if (b.listing_id) {
          const chat = document.createElement('a');
          chat.href = `messages.html?listing=${encodeURIComponent(b.listing_id)}&booking=${encodeURIComponent(b.id)}`;
          chat.className = 'text-button';
          chat.dataset.lockdMessagingEntry = '';
          chat.hidden = document.documentElement.dataset.lockdMessaging !== 'enabled';
          chat.textContent = owner ? 'Message renter' : 'Message lister';
          card.append(chat);
        }
        if (!owner) { const view=document.createElement('a');view.href='checkout.html?booking='+encodeURIComponent(b.id);view.className='text-button';view.textContent='View reservation';card.append(view); }
        if (!owner && b.status === "completed") { const review=document.createElement("a"); review.href="reviews.html?booking="+encodeURIComponent(b.id);review.textContent="Leave a review";review.dataset.lockdReviewsEntry="";review.hidden=document.documentElement.dataset.lockdReviews!=="enabled";card.append(review); }
        if (b.trust_policy_id) {
          const requirements = document.createElement('p');
          requirements.textContent = `Lister approval: ${b.owner_approval || "pending"} · LOCKD approval: ${b.platform_approval || "pending"}`;
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
          available.push(['reject','Decline request']);
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
              if (historyRequests.get(root) === controller) await renderHistory(root, owner);
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
      if (historyRequests.get(root) !== controller) return;
      root.textContent = controller.signal.aborted ? "Reservations took too long to load. Please try again." : e.message;
      const retry = document.createElement("button");
      retry.textContent = "Retry";
      retry.type = "button";
      retry.addEventListener("click", () => renderHistory(root, owner));
      root.append(retry);
    } finally {
      clearTimeout(deadline);
    }
  }
  const historyTabs = document.querySelectorAll("[data-load-bookings]");
  for (const button of historyTabs) {
    button.addEventListener("click", () => {
      const owner = button.dataset.loadBookings === "owner";
      const url = new URL(location.href);
      if (owner) url.searchParams.set("view", "listing");
      else url.searchParams.delete("view");
      window.history.replaceState(null, "", url.pathname + url.search + "#bookings");
      for (const tab of historyTabs) tab.setAttribute("aria-pressed", String(tab === button));
      void renderHistory(document.querySelector("#booking-history"), owner);
    });
  }
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
          message.textContent = `${quote.item.currency} ${quote.item.totalAmount} total, including ${quote.item.depositAmount} refundable deposit. You won’t be charged when you send this request.`;
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
        message.textContent = "Reservation request saved. Reference " + item.id + ".";
        btn.textContent = "Request recorded";
        btn.dataset.sent = "true";
        location.assign("checkout.html?booking="+encodeURIComponent(item.id));
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
