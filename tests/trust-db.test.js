const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { PGlite } = require("@electric-sql/pglite");

test("trust PostgreSQL gates preserve private evidence and independent approvals", async (t) => {
  const db = new PGlite();
  const owner = "11111111-1111-4111-8111-111111111111",
    customer = "22222222-2222-4222-8222-222222222222",
    admin = "33333333-3333-4333-8333-333333333333";
  const listing = "44444444-4444-4444-8444-444444444444";
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
 create table auth.users(id uuid primary key,email_confirmed_at timestamptz);
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
 grant usage on schema auth to anon,authenticated;
 insert into auth.users values('${owner}',now()),('${customer}',now()),('${admin}',now());`);
  await db.exec(
    readFileSync(
      "supabase/migrations/20261028_0001_lockd_catalogue.sql",
      "utf8",
    ),
  );
  await db.exec(
    "alter table lockd_listings add column deposit_amount numeric(12,2),add column deposit_currency text;",
  );
  for (const file of [
    "20261031_0008_lockd_reservations.sql",
    "20261101_0009_lockd_trust.sql",
    "20261101_0010_lockd_operations.sql",
    "20261101_0011_lockd_identity_jobs.sql",
  ])
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  await db.exec(`update lockd_booking_settings set requests_enabled=true;
 insert into lockd_listings(id,owner_id,slug,title,category,price_amount,currency,price_unit,listing_status,approval_status,deposit_amount,deposit_currency)
 values('${listing}','${owner}','trust-test','Trust rental','drive',100,'KES','day','published','approved',50,'KES');
 insert into lockd_listing_availability select '${listing}',current_date+i,2,now() from generate_series(0,30)i;`);
  const as = async (id, role = "customer", userRole = "") => {
    await db.exec("reset role");
    await db.query(
      "select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",
      [
        id,
        JSON.stringify({
          app_metadata: { role },
          user_metadata: { role: userRole },
        }),
      ],
    );
    await db.exec("set role authenticated");
  };
  const policy = {
    category: "drive",
    enabled: true,
    identity_required: true,
    address_required: true,
    owner_approval_required: true,
    platform_approval_required: true,
    minimum_deposit: 40,
    conditions: "Return at the agreed pickup location.",
    handover_required: true,
  };
  const configure = () =>
    db.query("select configure_lockd_verification_policy($1) item", [policy]);
  const verify = (kind, outcome = "verified", environment = "production") =>
    db.query("select record_lockd_manual_verification($1,$2,$3,$4,30,$5)", [
      customer,
      kind,
      outcome,
      "test-evidence-reference",
      environment,
    ]);
  const request = async () =>
    (
      await db.query(
        "select request_lockd_booking($1,current_date+1,current_date+3,1,$2,250,'KES') item",
        [listing, crypto.randomUUID()],
      )
    ).rows[0].item;
  let booking;
  try {
    await t.test("customer metadata cannot grant admin access", async () => {
      await as(customer, "customer", "admin");
      await assert.rejects(configure(), /Administrator access/);
      await assert.rejects(
        db.query("select lockd_trust_admin_overview()"),
        /Administrator access/,
      );
    });
    await t.test(
      "policy versions are configured by a real administrator and append-only",
      async () => {
        await as(admin, "admin");
        assert.equal((await configure()).rows[0].item.version, 1);
        await db.exec("reset role");
        await assert.rejects(
          db.exec("update lockd_verification_policies set enabled=false"),
          /append-only/,
        );
      },
    );
    await t.test(
      "requests snapshot requirements and never auto-approve",
      async () => {
        await as(customer);
        booking = await request();
        assert.equal(booking.status, "pending_owner");
        assert.equal(booking.owner_approval, "pending");
        assert.equal(booking.platform_approval, "pending");
        assert.equal(booking.trust_requirements.identity, true);
        assert.equal(booking.trust_requirements.address, true);
      },
    );
    await t.test(
      "owner acceptance cannot bypass platform review, identity or conditions",
      async () => {
        await as(owner);
        const accepted = (
          await db.query("select transition_lockd_booking($1,'accept') item", [
            booking.id,
          ])
        ).rows[0].item;
        assert.equal(accepted.status, "pending_owner");
        assert.equal(accepted.owner_approval, "approved");
        assert.equal(accepted.payment_status, "unpaid");
        await assert.rejects(
          db.query(
            "select review_lockd_booking($1,'approved','Valid reviewed request')",
            [booking.id],
          ),
          /Administrator access/,
        );
        await as(owner, "admin");
        await assert.rejects(
          db.query(
            "select review_lockd_booking($1,'approved','Valid reviewed request')",
            [booking.id],
          ),
          /different reviewer/,
        );
      },
    );
    await t.test(
      "platform approval remains independent and sandbox evidence cannot clear the gate",
      async () => {
        await as(admin, "admin");
        await verify("identity", "verified", "sandbox");
        await verify("address");
        const reviewed = (
          await db.query(
            "select review_lockd_booking($1,'approved','Evidence reviewed by qualified operator') item",
            [booking.id],
          )
        ).rows[0].item;
        assert.equal(reviewed.status, "pending_owner");
        assert.equal(reviewed.platform_approval, "approved");
        await as(customer);
        await db.query(
          "select transition_lockd_booking($1,'accept_conditions')",
          [booking.id],
        );
        assert.equal(
          (
            await db.query(
              "select transition_lockd_booking($1,'continue') item",
              [booking.id],
            )
          ).rows[0].item.status,
          "pending_owner",
        );
      },
    );
    await t.test(
      "valid reusable passport permits payment stage, never payment confirmation",
      async () => {
        await as(admin, "admin");
        await verify("identity");
        await as(customer);
        const ready = (
          await db.query(
            "select transition_lockd_booking($1,'continue') item",
            [booking.id],
          )
        ).rows[0].item;
        assert.equal(ready.status, "awaiting_payment");
        assert.equal(ready.payment_status, "unpaid");
        const passport = (await db.query("select my_lockd_verification() item"))
          .rows[0].item;
        assert.equal(passport.identityVerified, true);
        assert.equal(
          JSON.stringify(passport).includes("test-evidence-reference"),
          false,
        );
      },
    );
    await t.test(
      "revocation and approval expiry prevent confirmation and handover even from trusted server writes",
      async () => {
        await as(admin, "admin");
        await verify("identity", "revoked");
        await db.exec("reset role");
        await assert.rejects(
          db.query(
            "update lockd_bookings set status='confirmed',payment_status='paid' where id=$1",
            [booking.id],
          ),
          /both required approvals/,
        );
        await as(admin, "admin");
        await verify("identity");
        await db.exec("reset role");
        await db.query(
          "update lockd_bookings set owner_approved_at=now()-interval '2 days' where id=$1",
          [booking.id],
        );
        await assert.rejects(
          db.query("update lockd_bookings set status='confirmed' where id=$1", [
            booking.id,
          ]),
          /both required approvals/,
        );
      },
    );
    await t.test(
      "policy changes invalidate prior approvals; cancellation remains accessible",
      async () => {
        await as(admin, "admin");
        assert.equal((await configure()).rows[0].item.version, 2);
        await db.exec("reset role");
        await assert.rejects(
          db.query("update lockd_bookings set status='confirmed' where id=$1", [
            booking.id,
          ]),
          /both required approvals/,
        );
        await as(customer);
        assert.equal(
          (
            await db.query(
              "select transition_lockd_booking($1,'cancel') item",
              [booking.id],
            )
          ).rows[0].item.status,
          "cancelled",
        );
      },
    );
    await t.test(
      "private verification and audit tables cannot be read or forged by customers",
      async () => {
        await as(customer);
        for (const name of [
          "lockd_verification_passport",
          "lockd_verification_policies",
          "lockd_trust_audit",
          "lockd_listing_trust_values",
        ])
          await assert.rejects(
            db.exec(`select * from ${name}`),
            /permission denied/,
          );
        await assert.rejects(verify("identity"), /Administrator access/);
        await as(admin, "admin");
        await assert.rejects(
          db.query(
            "select record_lockd_manual_verification($1,'identity','verified','self-review',30)",
            [admin],
          ),
          /different reviewer/,
        );
      },
    );
    await t.test(
      "policy max duration and minimum deposit fail closed without changing quoted prices",
      async () => {
        await as(admin, "admin");
        policy.maximum_duration = 1;
        await configure();
        await as(customer);
        await assert.rejects(request(), /duration limit/);
        await as(admin, "admin");
        delete policy.maximum_duration;
        policy.minimum_deposit = 1000;
        await configure();
        await as(customer);
        await assert.rejects(request(), /deposit does not meet/);
      },
    );
    await t.test(
      "a lower-value asset requires a reviewed value before bypassing a threshold",
      async () => {
        await as(admin, "admin");
        policy.minimum_deposit = 0;
        policy.replacement_value_threshold = 50000;
        await configure();
        await as(customer);
        const unknown = await request();
        assert.ok(unknown.trust_policy_id);
        await db.query("select transition_lockd_booking($1,'cancel')", [
          unknown.id,
        ]);
        await as(admin, "admin");
        await db.query("select record_lockd_listing_trust_value($1,1000)", [
          listing,
        ]);
        await as(customer);
        const lower = await request();
        assert.equal(lower.trust_policy_id, null);
        await db.query("select transition_lockd_booking($1,'cancel')", [
          lower.id,
        ]);
      },
    );
    await t.test(
      "handover requires genuine paid state, both parties and exact condition version",
      async () => {
        await as(admin, "admin");
        policy.enabled = false;
        await configure();
        await as(customer);
        booking = await request();
        await assert.rejects(
          db.query(
            "select acknowledge_lockd_handover($1,'out','Pristine casing',0)",
            [booking.id],
          ),
          /not permitted/,
        );
        await as(owner);
        await db.query("select transition_lockd_booking($1,'accept')", [
          booking.id,
        ]);
        // Trusted fixture setup only: no provider or real payment is implied.
        await db.exec("reset role");
        await db.query(
          "update lockd_bookings set start_date=current_date,status='confirmed',payment_status='paid' where id=$1",
          [booking.id],
        );
        await as(owner);
        await assert.rejects(
          db.query("select transition_lockd_booking($1,'check_out')", [
            booking.id,
          ]),
          /both handover/,
        );
        await db.query(
          "select acknowledge_lockd_handover($1,'out','Pristine casing',0)",
          [booking.id],
        );
        await as(customer);
        await assert.rejects(
          db.query(
            "select acknowledge_lockd_handover($1,'out','Different condition',1)",
            [booking.id],
          ),
          /not permitted/,
        );
        await db.query(
          "select acknowledge_lockd_handover($1,'out','Pristine casing',1)",
          [booking.id],
        );
        await as(owner);
        await db.query(
          "select acknowledge_lockd_handover($1,'out','Small scratch recorded',1)",
          [booking.id],
        );
        await assert.rejects(
          db.query("select transition_lockd_booking($1,'check_out')", [
            booking.id,
          ]),
          /both handover/,
        );
        await as(customer);
        await assert.rejects(
          db.query(
            "select acknowledge_lockd_handover($1,'out','Small scratch recorded',1)",
            [booking.id],
          ),
          /not permitted/,
        );
        await db.query(
          "select acknowledge_lockd_handover($1,'out','Small scratch recorded',2)",
          [booking.id],
        );
        await as(owner);
        assert.equal(
          (
            await db.query(
              "select transition_lockd_booking($1,'check_out') item",
              [booking.id],
            )
          ).rows[0].item.status,
          "active",
        );
      },
    );
    await t.test(
      "return cannot be marked completed without two acknowledgements",
      async () => {
        await assert.rejects(
          db.query("select transition_lockd_booking($1,'check_in')", [
            booking.id,
          ]),
          /both return/,
        );
        await db.query(
          "select acknowledge_lockd_handover($1,'return','Returned with agreed scratch',0)",
          [booking.id],
        );
        await as(customer);
        await db.query(
          "select acknowledge_lockd_handover($1,'return','Returned with agreed scratch',1)",
          [booking.id],
        );
        await as(owner);
        assert.equal(
          (
            await db.query(
              "select transition_lockd_booking($1,'check_in') item",
              [booking.id],
            )
          ).rows[0].item.status,
          "completed",
        );
      },
    );
    let dispute;
    await t.test(
      "disputes require an account, description, independent resolution and private history",
      async () => {
        await as(customer);
        await assert.rejects(
          db.query("select transition_lockd_booking($1,'dispute')", [
            booking.id,
          ]),
          /description/,
        );
        dispute = (
          await db.query(
            "select open_lockd_dispute($1,'Return condition requires a human review') item",
            [booking.id],
          )
        ).rows[0].item;
        assert.equal(
          (
            await db.query(
              "select open_lockd_dispute($1,'Retry of the same case request') item",
              [booking.id],
            )
          ).rows[0].item.id,
          dispute.id,
        );
        await as(owner, "admin");
        await assert.rejects(
          db.query(
            "select resolve_lockd_dispute($1,'resolved','Reviewed the return acknowledgements')",
            [dispute.id],
          ),
          /different reviewer/,
        );
        await as(admin, "admin");
        assert.deepEqual(
          (await db.query("select my_lockd_disputes() items")).rows[0].items,
          [],
        );
        await assert.rejects(
          db.query("select my_lockd_handover($1)", [booking.id]),
          /not found/,
        );
        const resolved = (
          await db.query(
            "select resolve_lockd_dispute($1,'resolved','Reviewed the return acknowledgements') item",
            [dispute.id],
          )
        ).rows[0].item;
        assert.equal(resolved.status, "resolved");
        await as(customer);
        assert.equal(
          (await db.query("select my_lockd_disputes() items")).rows[0].items
            .length,
          1,
        );
      },
    );
    await t.test(
      "in-app notifications are persisted and another account cannot read or acknowledge them",
      async () => {
        await as(customer);
        const notes = (await db.query("select my_lockd_notifications() items"))
          .rows[0].items;
        assert.ok(notes.length >= 4);
        const id = notes[0].id;
        await as(admin, "admin");
        assert.deepEqual(
          (await db.query("select my_lockd_notifications() items")).rows[0]
            .items,
          [],
        );
        await db.query("select read_lockd_notification($1)", [id]);
        await as(customer);
        assert.equal(
          (
            await db.query("select my_lockd_notifications() items")
          ).rows[0].items.find((n) => n.id === id).read_at,
          null,
        );
        await db.query("select read_lockd_notification($1)", [id]);
        assert.ok(
          (
            await db.query("select my_lockd_notifications() items")
          ).rows[0].items.find((n) => n.id === id).read_at,
        );
        for (const name of [
          "lockd_handover_records",
          "lockd_disputes",
          "lockd_notifications",
        ])
          await assert.rejects(
            db.exec(`select * from ${name}`),
            /permission denied/,
          );
      },
    );
    await t.test(
      "appeals reopen a case once, block premature finalization, and preserve payment state",
      async () => {
        await as(customer);
        const appeal = (
          await db.query(
            "select appeal_lockd_dispute($1,'Please review the return record again') item",
            [dispute.id],
          )
        ).rows[0].item;
        assert.equal(appeal.status, "open");
        await as(admin, "admin");
        await assert.rejects(
          db.query(
            "select finalize_lockd_disputed_return($1,'Physical return records are complete')",
            [booking.id],
          ),
          /not permitted/,
        );
        await db.query(
          "select resolve_lockd_dispute($1,'resolved','A second independent review is complete')",
          [dispute.id],
        );
        const completed = (
          await db.query(
            "select finalize_lockd_disputed_return($1,'Physical return records are complete') item",
            [booking.id],
          )
        ).rows[0].item;
        assert.equal(completed.status, "completed");
        assert.equal(completed.payment_status, "paid");
        await as(customer);
        await assert.rejects(
          db.query(
            "select appeal_lockd_dispute($1,'A duplicate appeal should not be accepted')",
            [dispute.id],
          ),
          /not permitted/,
        );
      },
    );
    await t.test(
      "confirmed rentals retain their agreed policy and can renew expired approvals before pickup",
      async () => {
        await as(admin, "admin");
        Object.assign(policy, {
          enabled: true,
          identity_required: false,
          address_required: false,
          replacement_value_threshold: null,
          handover_required: false,
        });
        await configure();
        await as(customer);
        const next = await request();
        const checks = (
          await db.query("select my_lockd_rental_checks($1) item", [next.id])
        ).rows[0].item;
        assert.equal(checks.handoverAvailable, false);
        await as(owner);
        await db.query("select transition_lockd_booking($1,'accept')", [
          next.id,
        ]);
        await as(admin, "admin");
        await db.query(
          "select review_lockd_booking($1,'approved','Independent approval of this fixture')",
          [next.id],
        );
        await as(customer);
        await db.query(
          "select transition_lockd_booking($1,'accept_conditions')",
          [next.id],
        );
        await db.exec("reset role");
        await db.query(
          "update lockd_bookings set start_date=current_date,status='confirmed',payment_status='paid' where id=$1",
          [next.id],
        );
        await db.query(
          "update lockd_bookings set owner_approved_at=now()-interval '2 days',platform_approved_at=now()-interval '2 days' where id=$1",
          [next.id],
        );
        await as(owner);
        await assert.rejects(
          db.query("select transition_lockd_booking($1,'check_out')", [
            next.id,
          ]),
          /both required approvals/,
        );
        await db.query("select transition_lockd_booking($1,'accept')", [
          next.id,
        ]);
        await as(admin, "admin");
        await db.query(
          "select review_lockd_booking($1,'approved','Fresh independent approval before pickup')",
          [next.id],
        );
        policy.enabled = false;
        await configure();
        await as(owner);
        assert.equal(
          (
            await db.query(
              "select transition_lockd_booking($1,'check_out') item",
              [next.id],
            )
          ).rows[0].item.status,
          "active",
        );
        await db.query("select transition_lockd_booking($1,'check_in')", [
          next.id,
        ]);
        await as(admin, "admin");
        await assert.rejects(
          db.query("select my_lockd_rental_checks($1)", [next.id]),
          /not found/,
        );
      },
    );
    await t.test('rejecting an expired hold returns its actual expired record',async()=>{
      await as(customer);const expired=await request();await db.exec('reset role');await db.query("update lockd_bookings set expires_at=now()-interval '1 second' where id=$1",[expired.id]);await as(owner);
      assert.equal((await db.query("select transition_lockd_booking($1,'reject') item",[expired.id])).rows[0].item.status,'expired');
    });
    let attempt, job;
    const service = () => db.exec("reset role;set role service_role");
    const enqueue = (id = "evt_test1", minutes = 0) =>
      db.query(
        "select enqueue_lockd_identity_event($1,'inq_test1','sandbox',date_trunc('second',now())-make_interval(mins=>$2),$3)",
        [id, minutes, "a".repeat(64)],
      );
    await t.test(
      "identity attempts are reused and clients cannot bind inquiries or process webhook jobs",
      async () => {
        await as(admin, "admin");
        await verify("identity", "revoked");
        await as(customer);
        attempt = (
          await db.query(
            "select begin_lockd_identity_attempt('sandbox','identity-sandbox-v1') item",
          )
        ).rows[0].item;
        assert.equal(
          (
            await db.query(
              "select begin_lockd_identity_attempt('sandbox','identity-sandbox-v1') item",
            )
          ).rows[0].item.id,
          attempt.id,
        );
        await assert.rejects(
          db.query("select link_lockd_identity_inquiry($1,'inq_test1',$1)", [
            attempt.id,
          ]),
          /permission denied/,
        );
        await assert.rejects(
          db.exec("select claim_lockd_identity_job()"),
          /permission denied/,
        );
        await service();
        await db.query(
          "select link_lockd_identity_inquiry($1,'inq_test1',$1)",
          [attempt.id],
        );
        await enqueue();
        await enqueue();
        job = (await db.query("select claim_lockd_identity_job() item")).rows[0]
          .item;
        assert.equal(job.eventId, "evt_test1");
        assert.equal(
          (await db.query("select claim_lockd_identity_job() item")).rows[0]
            .item,
          null,
        );
      },
    );
    await t.test(
      "lease tokens and authoritative inquiry ownership are required before any passport write",
      async () => {
        const finish = (token = job.leaseToken, ref = attempt.id) =>
          db.query(
            "select finish_lockd_identity_job($1,$2,'inq_test1',$3,'approved',now()-interval '1 minute',30)",
            [job.eventId, token, ref],
          );
        await assert.rejects(finish(crypto.randomUUID()), /lease expired/);
        await assert.rejects(
          finish(job.leaseToken, admin),
          /ownership mismatch/,
        );
        await finish();
        await assert.rejects(finish(), /lease expired/);
        await as(customer);
        const passport = (await db.query("select my_lockd_verification() item"))
          .rows[0].item;
        assert.equal(
          passport.checks.find(
            (c) => c.kind === "identity" && c.environment === "sandbox",
          ).outcome,
          "verified",
        );
        // This customer's pre-existing production revocation is still authoritative.
        assert.equal(passport.identityVerified, false);
      },
    );
    await t.test(
      "out-of-order provider responses cannot overwrite a newer result",
      async () => {
        await service();
        await enqueue("evt_test2", 2);
        job = (await db.query("select claim_lockd_identity_job() item")).rows[0]
          .item;
        await db.query(
          "select finish_lockd_identity_job($1,$2,'inq_test1',$3,'declined',now()-interval '10 minutes',30)",
          [job.eventId, job.leaseToken, attempt.id],
        );
        await as(customer);
        const p = (await db.query("select my_lockd_verification() item"))
          .rows[0].item;
        assert.equal(
          p.checks.find(
            (c) => c.environment === "sandbox" && c.kind === "identity",
          ).outcome,
          "verified",
        );
      },
    );
    await t.test(
      "expired leases are reclaimed with fencing and failures are durably retried",
      async () => {
        await service();
        await enqueue("evt_retry", 3);
        job = (await db.query("select claim_lockd_identity_job() item")).rows[0]
          .item;
        await db.exec("reset role");
        await db.exec(
          "update lockd_identity_jobs set lease_until=now()-interval '1 second' where event_id='evt_retry'",
        );
        await service();
        const next = (await db.query("select claim_lockd_identity_job() item"))
          .rows[0].item;
        assert.notEqual(next.leaseToken, job.leaseToken);
        await assert.rejects(
          db.query(
            "select retry_lockd_identity_job($1,$2,'provider_unavailable')",
            [job.eventId, job.leaseToken],
          ),
          /lease expired/,
        );
        await db.query(
          "select retry_lockd_identity_job($1,$2,'provider_unavailable')",
          [next.eventId, next.leaseToken],
        );
        assert.equal(
          (await db.query("select claim_lockd_identity_job() item")).rows[0]
            .item,
          null,
        );
        await db.exec("reset role");
        const row = (
          await db.query(
            "select state,attempts,last_error_code from lockd_identity_jobs where event_id='evt_retry'",
          )
        ).rows[0];
        assert.deepEqual(row, {
          state: "retry",
          attempts: 2,
          last_error_code: "provider_unavailable",
        });
      },
    );
  } finally {
    await db.close();
  }
});
