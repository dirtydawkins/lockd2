# Responsive image refinement — 1 November 2026

This increment implements the user's image-refinement request. The attached wider account, Experiences and location briefs are separate functionality work; this image increment does not claim to complete their payment, scheduling or geolocation requirements.

## Phase 1 — Audit

Audited current root routes and image builders: homepage/discovery, catalogue/cars, Tech, rooms, destinations, rental detail/related items, account saves, owner cards/upload previews/listing preview. The legacy `lockd2/` directory is not an active root application route and was not rewritten.

Found incorrect intrinsic dimensions (including 736×1104 markup on a 564×555 car photo), universal cover crops in product details/saved/owner previews, narrow mobile Tech tiles, inconsistent mixed-category card stages, oversized gallery minimum heights, and tablet header/catalogue-control overflow. The production catalogue had no published inventory at preflight; real photos and explicitly labelled local synthetic records were used for layout QA, never published as rentals.

## Phase 2 — Shared presentation and responsive assets

- `image-presentation.js` and `.css`: one framing layer for current root pages. Products and vehicles use contain; stays and editorial scenes use cover, with explicit contain supported when needed. Orientation is measured from natural dimensions. No automatic object-recognition or subject-detection claim is made.
- Optional per-photo metadata in existing `attributes.image_presentation[index]`: `{focal_x: 50, focal_y: 65, fit: "cover"}`. Focal values must be finite numbers in 0–100. Product/vehicle evidence always remains fully visible. No database migration is needed; this reuses existing JSON attributes. An owner focal-point editing UI is not included in this increment.
- Gallery photo indexing preserves the original index even when an invalid photo URL is skipped. Source changes clear old responsive candidates before selecting the new photograph.
- Stable card/gallery frames reserve space; natural dimensions and orientation are filled after loading. JS failure never hides photographs. Failed photographs retain their stage and truthful alt text, without inserting unrelated inventory photos.
- `scripts/prepare-images.py` creates same-content WebP resizes with Pillow and corrects static intrinsic dimensions. All **34 original references** are preserved byte-for-byte, including duplicated aliases. **84 deduplicated derivatives** cover widths 320, 480 and up to the original width (never upscale). Checked-in derivatives are deployable without Python or an image service.
- Native srcset/sizes in static HTML work before JS. Important hero images retain high fetch priority and eager loading; remaining static photography is lazy and asynchronous. Dynamic owner originals and signed Storage URLs remain intact; no unsupported Storage transformation service is assumed.

## Phase 3 — Layout, motion and verification

- Mobile Tech now uses readable full-width rental cards and compact image/text editorial rows, with complete photos. The exact headline “The right tool for the moment.” is retained on the Tech hero.
- Consistent shared image stages align mixed-category results; category fit differs without stretching. Gallery minimum-height overrides were removed. Destination scenes use taller mobile compositions. Owner hero, upload/preview and saved card photos remain fully visible.
- Product hover feedback uses restrained framing/background changes without zooming product edges out of view. Editorial cover photographs retain existing subtle hover motion. Image load reveals last 360ms and respect the current reduced-motion preference. Nonessential product-hero parallax was removed. No animation library was added.
- Tablet navigation and catalogue controls were repaired after real viewport testing exposed overflow. No horizontal-overflow clipping was used to conceal the problem.

## Verification evidence

- Inbuilt browser: baseline production Tech screenshots, followed by local screenshots at **320, 375, 390, 430, 768, 1024 and 1440px**.
- Final matrix: seven public page types × seven widths (**49 checks**) without horizontal document overflow or broken image sources. A separate local private-component fixture covers saved cards, owner cards, upload previews and listing previews at the same seven widths. All records are explicitly synthetic and never deployed.
- Mobile gallery photograph switching verified the new source, corresponding WebP candidate, contain fit and loaded state; no console warnings/errors observed in that flow.
- Static responsive asset references checked: no missing generated paths. `git diff` confirms no original JPEG/PNG was modified.
- `npm test`: **98 tests passed**, including fit/focal validation plus existing booking/auth/search/owner/trust regressions. JavaScript syntax and diff checks passed. Python service tests remain a separate 16-test trust-service verification.
- Limitations: no real owner-uploaded inventory was available for a live signed-Storage visual journey. OS reduced-motion emulation, real hardware performance, network-throttled CLS/LCP measurement and paid image-CDN delivery were not tested. Browser screenshots were inspected directly; no exported screenshot artifact is claimed.

## Release state

Work is on the existing development branch. Record the final commit/push/preview/live deployment separately; local browser checks do not prove production deployment. Persona remains deferred/disabled, and this image release never creates listings, payments, verification outcomes or account roles.
