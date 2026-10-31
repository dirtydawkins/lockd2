(() => {
  const $ = (s) => document.querySelector(s),
    status = $("#trust-status"),
    uuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const booking = new URLSearchParams(location.search).get("booking");
  let handovers = [];
  const element = (tag, text) =>
    Object.assign(document.createElement(tag), { textContent: text });
  async function api(view, body) {
    const session = await window.LockdAccount.getSession();
    if (!session) throw Error("Sign in to continue.");
    const r = await fetch(
      `/api/trust${view ? `?${new URLSearchParams(view)}` : ""}`,
      {
        method: body ? "POST" : "GET",
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      },
    );
    const result = await r.json();
    if (!r.ok) throw Error(result.message || "This service is unavailable.");
    return result.item;
  }
  async function load(root, fn) {
    root.textContent = "Loading…";
    try {
      await fn();
    } catch (e) {
      root.replaceChildren(element("p", e.message));
      root.firstChild.setAttribute("role", "alert");
    }
  }
  function bind(id, action, convert = Object.fromEntries, after) {
    const form = $(id);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!form.reportValidity()) return;
      const button = form.querySelector("[type=submit]"),
        message = form.querySelector("[role=status]");
      button.disabled = true;
      message.textContent = "Saving…";
      try {
        const body = convert(new FormData(form));
        await api(null, { action, ...body });
        message.textContent = "Recorded successfully.";
        if (after) await after();
      } catch (error) {
        message.textContent = error.message;
      } finally {
        button.disabled = false;
      }
    });
  }
  const passport = () =>
    load($("#passport-results"), async () => {
      const p = await api({ view: "passport" }),
        root = $("#passport-results");
      root.replaceChildren(
        element(
          "p",
          `Identity: ${p.identityVerified ? "current verification on record" : "not currently verified"}. Address: ${p.addressVerified ? "current verification on record" : "not currently verified"}.`,
        ),
      );
      for (const c of p.checks) {
        root.append(
          element(
            "p",
            `${c.kind} · ${c.outcome.replaceAll("_", " ")} · ${c.environment} · expires ${new Date(c.expiresAt).toLocaleDateString()}`,
          ),
        );
      }
    });
  const notifications = () =>
    load($("#trust-notifications"), async () => {
      const items = await api({ view: "notifications" }),
        root = $("#trust-notifications");
      root.replaceChildren();
      if (!items.length) root.textContent = "No updates yet.";
      for (const item of items) {
        const row = element("article", "");
        row.append(
          element("p", item.message),
          element("small", new Date(item.created_at).toLocaleString()),
        );
        if (!item.read_at) {
          const b = element("button", "Mark read");
          b.type = "button";
          b.className = "text-button";
          b.addEventListener("click", async () => {
            b.disabled = true;
            try {
              await api(null, { action: "read_notification", id: item.id });
              await notifications();
            } catch (e) {
              status.textContent = e.message;
              b.disabled = false;
            }
          });
          row.append(b);
        }
        root.append(row);
      }
    });
  const disputes = () =>
    load($("#trust-disputes"), async () => {
      const items = await api({ view: "disputes" }),
        root = $("#trust-disputes");
      root.replaceChildren();
      if (!items.length) root.textContent = "No disputes recorded.";
      for (const d of items) {
        const row = element("article", "");
        row.append(
          element("h3", d.status),
          element("p", d.description),
          element("small", `Case ${d.id} · Reservation ${d.booking_id}`),
        );
        if (d.resolution_reason) row.append(element("p", d.resolution_reason));
        root.append(row);
      }
    });
  function showHandover() {
    const phase = $("#handover-form").elements.phase.value,
      h = handovers.find((x) => x.phase === phase),
      root = $("#handover-current");
    root.textContent = h
      ? `Version ${h.version} · Owner: ${h.owner_acknowledged_at ? "acknowledged" : "pending"} · Customer: ${h.customer_acknowledged_at ? "acknowledged" : "pending"}`
      : "The owner must create the first condition record.";
    $("#handover-form").elements.summary.value = h?.condition_summary || "";
    $("#handover-form").elements.agree.checked = false;
  }
  const handover = async () => {
    const context = await api({ view: "context", bookingId: booking });
    $("#booking-checks").hidden = false;
    const checks = $("#booking-check-results");
    checks.replaceChildren(
      element(
        "p",
        `Reservation ${booking} · ${context.status.replaceAll("_", " ")} · Payment: ${context.paymentStatus}`,
      ),
    );
    for (const [required, current, label] of [
      [context.identityRequired, context.identityCurrent, "Identity"],
      [context.addressRequired, context.addressCurrent, "Address"],
    ])
      if (required)
        checks.append(
          element(
            "p",
            `${label} check: ${current ? "current verification on record" : "requires verification or an authorized human review"}`,
          ),
        );
    checks.append(
      element(
        "p",
        `Owner approval: ${context.ownerApproval}. LOCKD approval: ${context.platformApproval}.`,
      ),
    );
    if (context.conditions)
      checks.append(element("p", `Rental conditions: ${context.conditions}`));
    const actions = [];
    if (context.status === "pending_owner") {
      if (context.isOwner && context.ownerApproval === "pending")
        actions.push(["accept", "Accept request"]);
      if (!context.isOwner && context.conditions && !context.conditionsAccepted)
        actions.push(["accept_conditions", "Accept rental conditions"]);
      if (!context.isOwner) actions.push(["continue", "Recheck requirements"]);
    }
    for (const [action, label] of actions) {
      const button = element("button", label);
      button.type = "button";
      button.className = "text-button";
      button.addEventListener("click", async () => {
        button.disabled = true;
        try {
          await api(null, {
            action: "booking",
            bookingId: booking,
            bookingAction: action,
          });
          await handover();
        } catch (e) {
          status.textContent = e.message;
          button.disabled = false;
        }
      });
      checks.append(button);
    }
    $("#handover-section").hidden =
      !context.handoverAvailable &&
      !["completed", "disputed"].includes(context.status);
    $("#handover-form").hidden = !context.handoverAvailable;
    $("#handover-reference").textContent = `Reservation ${booking}`;
    handovers = await api({ view: "handover", bookingId: booking });
    $("#handover-form").elements.phase.value =
      context.status === "confirmed" ? "out" : "return";
    for (const o of $("#handover-form").elements.phase.options)
      o.disabled =
        o.value !== (context.status === "confirmed" ? "out" : "return");
    const history = $("#condition-history");
    history.replaceChildren();
    for (const record of handovers)
      history.append(
        element(
          "p",
          `${record.phase === "out" ? "Pickup" : "Return"} · Version ${record.version}: ${record.condition_summary} · Owner ${record.owner_acknowledged_at ? "acknowledged" : "pending"} · Customer ${record.customer_acknowledged_at ? "acknowledged" : "pending"}`,
        ),
      );
    showHandover();
  };
  const loadAdmin = () =>
    load($("#admin-results"), async () => {
      const data = await api({ view: "admin" }),
        root = $("#admin-results");
      root.replaceChildren(element("h3", "Current policy versions"));
      if (!data.policies.length)
        root.append(
          element("p", "No verification policies have been configured."),
        );
      for (const p of data.policies)
        root.append(
          element(
            "p",
            `${p.category} · version ${p.version} · ${p.enabled ? "enabled" : "disabled"}`,
          ),
        );
      root.append(element("h3", "Platform review queue"));
      if (!data.reviews.length)
        root.append(element("p", "No pending platform reviews."));
      for (const r of data.reviews) {
        const row = element("article", "");
        row.append(
          element("h3", r.listing_snapshot?.title || "Rental request"),
          element("small", `Reservation ${r.id} · Customer ${r.customer_id}`),
          element(
            "p",
            `${r.start_date} – ${r.end_date} · Owner: ${r.owner_approval} · LOCKD: ${r.platform_approval}`,
          ),
        );
        const f = element("form", "");
        f.className = "account-form";
        const reason = element("textarea", "");
        reason.name = "reason";
        reason.required = true;
        reason.minLength = 5;
        reason.maxLength = 1000;
        reason.setAttribute("aria-label", "Platform review reason");
        reason.placeholder =
          "Record the reviewed evidence and decision reason, without personal documents.";
        const choice = element("select", "");
        choice.setAttribute("aria-label", "Platform decision");
        for (const [v, label] of [
          ["approved", "Approve"],
          ["rejected", "Reject"],
        ]) {
          const o = element("option", label);
          o.value = v;
          choice.append(o);
        }
        const b = element("button", "Record platform decision");
        b.type = "submit";
        b.className = "button button-dark";
        const msg = element("p", "");
        msg.setAttribute("role", "status");
        f.append(reason, choice, b, msg);
        f.addEventListener("submit", async (e) => {
          e.preventDefault();
          if (!f.reportValidity()) return;
          b.disabled = true;
          try {
            await api(null, {
              action: "review",
              bookingId: r.id,
              decision: choice.value,
              reason: reason.value,
            });
            await admin();
          } catch (e) {
            msg.textContent = e.message;
            b.disabled = false;
          }
        });
        row.append(f);
        root.append(row);
      }
    });
  const operations = () =>
    load($("#operations-results"), async () => {
      const data = await api({ view: "operations" }),
        root = $("#operations-results");
      root.replaceChildren(
        element("h3", "Operational records"),
        element(
          "p",
          `${data.counts.bookings} recorded reservations · ${data.counts.awaitingReview} awaiting review · ${data.counts.overdue} overdue returns`,
        ),
      );
      for (const d of data.disputes) {
        const row = element("article", "");
        row.append(
          element(
            "h3",
            d.appealed_at
              ? "Appeal awaiting review"
              : "Dispute awaiting review",
          ),
          element("p", d.description),
          element("small", `Case ${d.id} · Reservation ${d.booking_id}`),
        );
        root.append(row);
      }
    });
  async function admin() {
    await Promise.all([loadAdmin(), operations()]);
  }
  bind("#appeal-form", "appeal", Object.fromEntries, disputes);
  bind("#finalize-form", "finalize_return", Object.fromEntries, admin);
  $("#refresh-passport").addEventListener("click", passport);
  $("#refresh-notifications").addEventListener("click", notifications);
  $("#refresh-disputes").addEventListener("click", disputes);
  $("#refresh-admin").addEventListener("click", admin);
  $("#handover-form").elements.phase.addEventListener("change", showHandover);
  bind(
    "#handover-form",
    "handover",
    (d) => ({
      bookingId: booking,
      phase: d.get("phase"),
      summary: d.get("summary"),
      expectedVersion:
        handovers.find((x) => x.phase === d.get("phase"))?.version || 0,
    }),
    handover,
  );
  bind(
    "#dispute-form",
    "dispute",
    (d) => ({ bookingId: booking, description: d.get("description") }),
    disputes,
  );
  bind(
    "#policy-form",
    "policy",
    (d) => {
      const f = $("#policy-form"),
        policy = {
          category: d.get("category"),
          conditions: d.get("conditions"),
        };
      for (const k of [
        "enabled",
        "identity_required",
        "address_required",
        "owner_approval_required",
        "platform_approval_required",
        "manual_review_required",
        "handover_required",
      ])
        policy[k] = f.elements[k].checked;
      for (const k of [
        "replacement_value_threshold",
        "rental_duration_threshold",
        "minimum_deposit",
        "maximum_duration",
        "verification_max_age_days",
        "approval_valid_hours",
      ])
        policy[k] = d.get(k) === "" ? null : Number(d.get(k));
      return { policy };
    },
    admin,
  );
  bind("#value-form", "value");
  bind(
    "#verification-form",
    "verification",
    (d) => ({
      ...Object.fromEntries(d),
      validDays: Number(d.get("validDays")),
    }),
    passport,
  );
  bind("#resolve-form", "resolve_dispute", Object.fromEntries, disputes);
  (async () => {
    try {
      const session = await window.LockdAccount.getSession();
      if (!session) {
        status.replaceChildren(
          element("span", "Sign in to view private rental records. "),
        );
        const a = element("a", "Sign in");
        a.href = window.LockdAccount.authLink({
          returnTo: location.pathname + location.search,
        });
        status.append(a);
        return;
      }
      $("#trust-content").hidden = false;
      status.textContent = "Your private rental workspace.";
      await Promise.all([passport(), notifications(), disputes()]);
      if (booking && uuid.test(booking)) {
        await handover();
      }
      if (session.user?.app_metadata?.role === "admin") {
        $("#trust-admin").hidden = false;
        await admin();
      }
    } catch (e) {
      status.textContent = e.message;
    }
  })();
})();
