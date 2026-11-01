# LOCKD project requirements

Latest user decisions, 1 November 2026. Preserve these across subsequent work.

- The final customer and owner UI must use genuine account, listing, booking and conversation records only.
- No mockups, synthetic conversations, demo inventory, fabricated history, fake availability, simulated success or QA/test labels in the final product.
- Show truthful, useful empty states when no real records exist. Never disguise sample data as genuine inventory.
- Latest merged briefs prohibit fabricated marketplace records and mock API success in every environment, including tests and screenshots. Do not run historical fixture-creating suites for this increment. Use source/SQL parsing, genuine authorized assets, actual read-only service responses and safe validation; mark record-dependent journeys blocked until genuine qualifying data is available. Preserve historical tests as excluded source, without presenting their prior runs as current verification.
- Messaging must feel seamless and familiar, with a simple inbox, conversations, search, attachments, receipts, reply, copying, reporting and blocking preserved.
- Reuse the user's existing signed-in LOCKD account. No second messaging sign-in, separate message password or routine key-setup flow.
- Generate and manage elliptic-curve device identities automatically. Use fresh per-message AES session keys protected by the recipient's public key; account identity, passwords and authentication tokens are not encryption keys.
- Keep private keys on authorized devices and ordinary messages encrypted. Do not introduce a server-wide decryption key or silently replace a contact's known identity.
- Describe the protocol actually implemented. Do not claim Signal security equivalence, forward secrecy, independent review or live verification without evidence.
- Necessary sign-in, security and preference cookies/storage are authorized. Do not enable optional tracking merely because essential storage is allowed.
- Use the inbuilt browser for website verification. Keep production screens free of test content.
- Some requested capabilities are foundations for real provider accounts and data to be connected later. Build those foundations without forcing provider setup, diagnostic text, unsupported controls or unfinished workflows into the customer UI. Expose entry points only when the underlying capability is genuinely configured and enabled.
- Preserve LOCKD's existing architecture, authentic supplied images, brand, marketplace functionality and one Supabase identity system.

This document is development context, not customer-facing copy. Markdown and test artifacts are excluded by `.vercelignore`.

- Preserve the hero and search identity; refine selected layouts and remove buzzwords and customer-facing integration diagnostics (including connected/not connected).

- Latest terminology override: use Lister/Listers, not Host/Hosts, for everyone offering stays, items, cars and experiences. Use Become a lister, Message lister and Lister dashboard; customers are Renters. Existing database owner/host identifiers are internal compatibility details and do not create separate accounts.

- Preserve the current visual mode exactly. Do not add light/dark toggles, a new theme, or theme setup text. Keep the current colour palette, typography and hero treatment.

- Migrations 0012–0017 applied on 1 November 2026. Live audit: all LOCKD tables RLS-enabled, private profile/review direct reads denied, private buckets private, zero business records, reviews/messaging disabled. See MARKETPLACE_REFINEMENT.md for verification limits and release status.

- Browser-comment copy choices: homepage eyebrow “Stays and rentals, all in one place.”; car-image right caption “Find your next drive” (overrides Drive your way), left caption Cars & mobility. Preserve theme. Fix narrow footer Privacy/Back to top overlap with separate 44px touch targets.
- Production drift repair 0018 applied: restored existing migrations 0004–0006 definitions for owner publication, indexed search and location/discovery. Actual lister history now loads via the existing signed-in account, showing zero listings. No inventory was created.
