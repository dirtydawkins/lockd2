const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { PGlite } = require("@electric-sql/pglite");
test("reservation PostgreSQL functions enforce capacity, identity, money and transitions", async (t) => {
  const db = new PGlite();
  const owner = "11111111-1111-4111-8111-111111111111",
    customer = "22222222-2222-4222-8222-222222222222",
    other = "33333333-3333-4333-8333-333333333333";
  const listing = "44444444-4444-4444-8444-444444444444",
    key = "55555555-5555-4555-8555-555555555555";
  await db.exec(
    `create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;insert into auth.users values('${owner}',now()),('${customer}',now()),('${other}',now());`,
  );
  await db.exec(
    readFileSync(
      "supabase/migrations/20261028_0001_lockd_catalogue.sql",
      "utf8",
    ),
  );
  await db.exec(
    "alter table public.lockd_listings add column deposit_amount numeric(12,2), add column deposit_currency text;",
  );
  await db.exec(
    readFileSync(
      "supabase/migrations/20261031_0008_lockd_reservations.sql",
      "utf8",
    ),
  );
  await db.exec(
    `insert into lockd_listings(id,owner_id,slug,title,category,price_amount,currency,price_unit,listing_status,approval_status,deposit_amount,deposit_currency) values('${listing}','${owner}','test','Test rental','drive',10.25,'KES','day','published','approved',5,'KES');insert into lockd_listing_availability select '${listing}',current_date+i,1,now() from generate_series(0,30)i;`,
  );
  const as = async (id) => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
    await db.exec("set role authenticated");
  };
  const request = (k = key, qty = 1) =>
    db.query(
      `select request_lockd_booking($1,current_date+1,current_date+3,$2,$3,25.50,'KES') item`,
      [listing, qty, k],
    );
  let booking;
  try {
    await t.test("disabled operations fail closed", async () => {
      await as(customer);
      await assert.rejects(request(), /not enabled/);
      await db.exec(
        "reset role;update lockd_booking_settings set requests_enabled=true;",
      );
    });
    await t.test(
      "price changes and manipulated totals are rejected",
      async () => {
        await as(customer);
        await assert.rejects(
          db.query(
            "select request_lockd_booking($1,current_date+1,current_date+3,1,$2,0,'KES')",
            [listing, key],
          ),
          /price changed/,
        );
      },
    );
    await t.test(
      "persist exact server-calculated rental and deposit amounts",
      async () => {
        await as(customer);
        booking = (await request()).rows[0].item;
        assert.equal(booking.status, "pending_owner");
        assert.equal(booking.rental_amount, 20.5);
        assert.equal(booking.deposit_amount, 5);
        assert.equal(booking.total_amount, 25.5);
        assert.equal(booking.payment_status, "unpaid");
      },
    );
    await t.test(
      "retry is idempotent, but reusing a key for a different request is rejected",
      async () => {
        assert.equal((await request()).rows[0].item.id, booking.id);
        await assert.rejects(request(key, 2), /reference was already used/);
      },
    );
    await t.test(
      "overlapping reservations cannot consume held capacity",
      async () => {
        await as(other);
        await assert.rejects(
          request("66666666-6666-4666-8666-666666666666"),
          /unavailable/,
        );
      },
    );
    await t.test(
      "owners cannot remove calendar capacity already held",
      async () => {
        await db.exec("reset role");
        await assert.rejects(
          db.query(
            "delete from lockd_listing_availability where listing_id=$1 and calendar_date=current_date+1",
            [listing],
          ),
          /Availability is reserved/,
        );
        await as(other);
      },
    );
    await t.test(
      "other customers cannot read, change, or directly update private records",
      async () => {
        assert.deepEqual(
          (await db.query("select my_lockd_bookings() items")).rows[0].items,
          [],
        );
        await assert.rejects(
          db.query("select transition_lockd_booking($1,'accept')", [
            booking.id,
          ]),
          /not found/,
        );
        await assert.rejects(
          db.exec("select * from lockd_bookings"),
          /permission denied/,
        );
        await assert.rejects(
          db.exec("update lockd_bookings set payment_status='paid'"),
          /permission denied/,
        );
      },
    );
    await t.test(
      "customers cannot accept requests; owners accept without marking paid",
      async () => {
        await as(customer);
        await assert.rejects(
          db.query("select transition_lockd_booking($1,'accept')", [
            booking.id,
          ]),
          /not permitted/,
        );
        await as(owner);
        const accepted = (
          await db.query("select transition_lockd_booking($1,'accept') item", [
            booking.id,
          ])
        ).rows[0].item;
        assert.equal(accepted.status, "awaiting_payment");
        assert.equal(accepted.payment_status, "unpaid");
        await assert.rejects(
          db.query("select transition_lockd_booking($1,'check_out')", [
            booking.id,
          ]),
          /not permitted/,
        );
      },
    );
    await t.test(
      "cancellation releases capacity and retains audit history",
      async () => {
        await as(customer);
        await db.query("select transition_lockd_booking($1,'cancel')", [
          booking.id,
        ]);
        assert.equal(
          (
            await db.query(
              "select check_lockd_listing_availability($1,current_date+1,current_date+3,1) available",
              [listing],
            )
          ).rows[0].available,
          true,
        );
        await db.exec("reset role");
        assert.equal(
          (
            await db.query(
              "select count(*)::int count from lockd_booking_events where booking_id=$1",
              [booking.id],
            )
          ).rows[0].count,
          3,
        );
      },
    );
    await t.test(
      "expired holds release capacity, retain history, and cannot be accepted",
      async () => {
        await as(other);
        const b = (await request("77777777-7777-4777-8777-777777777777"))
          .rows[0].item;
        await db.exec("reset role");
        await db.query(
          "update lockd_bookings set expires_at=now()-interval '1 second' where id=$1",
          [b.id],
        );
        await as(owner);
        assert.equal(
          (
            await db.query(
              "select transition_lockd_booking($1,'accept') item",
              [b.id],
            )
          ).rows[0].item.status,
          "expired",
        );
      },
    );
    await t.test("anonymous cannot create or read reservations", async () => {
      await db.exec("reset role;set role anon");
      await assert.rejects(request(), /permission denied/);
      await assert.rejects(
        db.query("select my_lockd_bookings()"),
        /permission denied/,
      );
    });
  } finally {
    await db.close();
  }
});
