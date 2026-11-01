# Location and cookie UX — 2 November 2026

The existing discovery state, PostGIS queries, free map renderer, categories, account and booking architecture are reused. No dependency or AI API was added.

## Changes

- Search-bar and navigation location controls open one shared picker: anchored desktop popover, mobile bottom sheet, 200–220 ms transitions, recent genuine places, debounced provider results, arrow/Enter navigation, Escape/outside/drag dismissal and focus return. Reduced-motion styles are present.
- Location is never requested on page load. Only current-location/Near me actions call the browser API. A previous denial is remembered; the picker offers manual search. A successful device fix uses rounded coordinates for nearby search and coarse server-side locality resolution.
- The selected real locality is remembered automatically in a host-only `lockd_area` preference cookie for 90 days. It stores locality ID/name, never device coordinates. Anywhere clears the locality/history and remembers the all-areas choice. No extra remember toggle or consent overlay was added to location selection.
- Map/feed filters continue through the same LockdDiscovery state and backend. Real formatted location names containing commas now pass the existing catalogue filter validation.
- A small first-visit cookie notice has exactly **Accept** and **Reject**. Settings remain in the footer/privacy page. Notices stay off authentication, booking, payment, account, lister, verification and messaging routes and hide while a dialog is open.
- Accept enables first-party anonymous visitor/session identifiers and basic page, visit and search counts in cookies. Reject removes these usage cookies and leaves sign-in/selected-area preferences intact. No search text, full browsing URLs, precise GPS, private account details or message contents are included. No external analytics or advertising provider was added, and no server analytics dashboard is claimed.
- Cookie choice is stored in `lockd_consent` (180 days); anonymous visitor/count cookies expire after 90 days, session ID after 30 minutes. Cookies use SameSite=Lax and Secure on HTTPS. Consent purpose version 2 requires a fresh choice before the newly added optional usage cookies activate; authentication storage is unchanged.

## Actual verification

| Check | Result |
|---|---|
| Source/asset/privacy checks | 13 read-only checks passed, including Edge TypeScript compilation. |
| Existing real backend | 15 live checks passed locally against actual Supabase/provider responses, including formatted locality filtering, coarse resolution, PostGIS and private-data denial. |
| Manual search / keyboard | Actual Nairobi result selected with Arrow/Enter; locality restored on a bare homepage visit. |
| Cookie choice | Accept produced checked optional preferences; choices persisted; switching off optional cookies through settings succeeded. No fabricated business records. |
| Responsive | Picker measured at 320, 375, 390, 430, 768, 1024, 1440; no horizontal overflow. Desktop/mobile screenshots inspected. |
| Dismissal / focus | Mobile swipe and Escape closed the sheet and returned focus; native keyboard opened cookie settings. |
| GPS | An explicit click triggered the browser request. The real device lookup timed out; manual fallback remained usable. Successful on-device grant and deliberate native denial were not simulated or marked passed. Denial suppression and reduced-motion branches were source-checked. |
| Map/inventory | Genuine empty state; there are no published rentals to exercise populated pins or a valid booking. These record-dependent paths remain blocked. |
| Account / booking safety | Auth/session code and booking state machines were not rewritten. Existing authenticated lister reads were verified after the preceding map migration; final live session/browser checks follow deployment. No real booking/payment was created. |

The previous map release `68a87c0` passed GitHub CI and reached production; actual production map module/header/config and 13 endpoint checks were verified. Supabase migrations 0019–0021 are applied, with no RLS-disabled LOCKD tables and no exposed private geometry or address tables. The current UI release and final live checks are recorded below after deployment.
