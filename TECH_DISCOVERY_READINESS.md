# LOCKD catalogue implementation notes

This document records the implementation boundary for the customer-facing catalogue. It is not a production-readiness certificate.

## Current customer flow

| Area | Implementation | Status |
| --- | --- | --- |
| General rental discovery | `rentals.html`, `catalogue.js`, `api/listings.js` | Searches approved, published owner listings only. |
| Room search | `rooms.html`, `rooms.js`, `rooms.css`, `api/listings.js` | Searches published stays by location, dates, guest count, quantity, property type and amenities. Date searches use the server calendar RPC. |
| Rental details and date checks | `rental.html`, `rental.js`, `api/availability.js` | Shows owner-supplied listing terms and performs a read-only availability check. It creates no booking or hold. |
| Technology catalogue | `tech.html`, `tech.js` | Shows actual approved inventory when records exist. Editorial images link to broad categories and are not shown as listings. |
| Destination guides | `destinations.html`, `index.html` | Editorial destination copy links into the experience catalogue. A guide is not a bookable trip. |
| Vehicle discovery | `rentals.html`, `catalogue.js` | Published inventory is separate from category photography. |
| Internal market research | Supabase table managed under admin policy | No customer-facing API, source list or static research file is deployed. Apply migration `20261028_0003_lockd_private_research.sql` to remove anonymous access to existing database rows. |
| Search-engine discovery | `api/sitemap.js`, `robots.txt` | Public shell pages include the room-search page; listing slugs enter only when approved and published. |

## What remains unavailable

- The live listing catalogue is empty, so no real rooms, cars, experiences or equipment can be priced or booked yet.
- Availability checks are read-only. There is no reservation hold or concurrency-safe booking creation endpoint.
- Customer authentication, owner registration and listing submission, administrator web workflows, payment checkout, cancellations, refunds, payouts, notifications and booking lifecycle operations are not implemented.
- A published nightly rate needs an explicit `attributes.price_basis` of `per_room_per_night` or `per_property_per_night` before the room interface will calculate a stay total. Fees and taxes are not available unless the owner enters them as listing data.
- The site remains a static/serverless catalogue plus a calendar read API. It must not be described as a completed transactional marketplace.

## Checks

Run `node --test`, `node --check` on changed JavaScript files, and `git diff --check`. The tests mock Supabase; they do not prove a production reservation or payment journey.
