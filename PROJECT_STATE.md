# LOCKD project state

## Automatic chat updates and device approval

The inbox subscribes to participant-scoped message inserts and receipt updates before a thread is selected. Visible tabs also refresh on focus, reconnection and a ten-second interval. A returning device uses its registered identity. First-time setup is serialized across tabs where Web Locks are supported.

After the user approves a new device, its signed, encrypted approval is sent over a temporary Realtime channel identified by the random link request ID. The new device resumes an unexpired request after reload. The approval link remains available if the devices cannot reach each other. Device authorization and signature checks still happen before local access is restored.

Verified 33 focused tests, marketplace checks, live ephemeral broadcast delivery with non-user data, and automatic display of an incoming encrypted reply in both the inbox and the open thread in an isolated browser fixture. A physical two-phone pairing was not tested.

## Account settings and linked devices — November 12

The account menu opens settings.html for both rental and listing workspaces. Personal information, sign-in methods, preferences and privacy use the existing account handlers. Cookie preferences are available to visitors. Google-only accounts manage their password through Google.

On a new browser the conversation list opens first. Encrypted history still requires an approved device. Linking now uses expiring request and approval links shared between the account holder’s devices. The account, origin, request, signature, recipient and expiry checks remain in messaging-device.mjs. The share payload is carried in the URL fragment. The inbox no longer asks people to download or upload files.

Verification included 40 focused tests for accounts, direct messaging, database permissions and encryption, the marketplace checks, and a local browser check of the unlinked inbox and link generation. A two-phone production handoff was not exercised.

## Messages

The inbox uses the existing LOCKD account and encrypted messaging service. Desktop has a conversation list beside the thread. On phones, selecting a conversation opens the thread and All messages returns to the list. Listers can switch between listing enquiries and their own rentals.

The search and refresh controls share a row below the account switcher. Long conversation previews truncate. An empty filtered inbox offers a reset. Signed-out visitors see a sign-in link that returns them to Messages. The editorial photograph on this screen comes from the supplied LOCKD collection.

Private thread controls clear on a conversation change. Asynchronous device and contact lookups check the active conversation before updating the interface.

## Verification

32 messaging tests passed and 15 marketplace release checks passed. Checking a populated production inbox requires an authenticated participant session. No customer messages or booking records were created for this UI work.

## Direct messages to listers

Public listing details and rental cards on public lister profiles link to the same listing-scoped inbox. Sign-in preserves the listing ID. The backend derives the recipient from the published listing and reuses its existing private conversation. An unavailable listing or a daily conversation limit now leaves the rest of the inbox usable.

The isolated database journey in tests/messaging-direct.test.js opened a conversation before the lister registered a device, exchanged signed encrypted messages in both directions after registration, recorded reads, and denied access to a third account. Delivery requires the recipient account to have registered its public key. A two-account exchange on the production deployment remains unverified.

## Account navigation

Messages lives in Account on desktop and inside the mobile menu’s Account group. The same account can switch between the lister workspace and renting. Reservation and inbox links carry the current view in their URLs. Changing the reservation tab updates the account shortcuts. The navigation mode grants no additional access. Eight account and booking UI checks and 15 marketplace release checks passed.

## Signed-in account interface — 2026-11-13

The account header groups the avatar, name and session actions. Account navigation links and tabs share touch targets. The shared sans-serif font is served locally. Profile, preferences and password controls show pending, confirmed and retry states beside the action. A pending save temporarily locks editable fields in that form.

Verification: 7 account-service tests and 15 marketplace checks passed. An isolated profile handler check covered pending, failure, retry, saved and subsequent edits. The inbuilt browser timed out loading the local preview. Authenticated mobile rendering and a real profile write remain unverified in this release.

## Conversation responsiveness — 2026-11-13

Conversation history loads independently of inbox refresh. Pending bubbles show locally composed text and the composer is available while delivery completes. The persistent outbox still contains ciphertext. The UI deduplicates pending and confirmed bubbles and skips device lookups on refreshes with nothing to decrypt.

Verification: 33 messaging tests and 15 marketplace checks passed. Live two-account delivery, visual mobile behavior and network latency were not measured.

## Assisted rental search — 2026-11-13

Plain-language searches can use NVIDIA Nemotron 3.5 Bolt E4B through the existing listings API. The model extracts category, item and location, then selects from published catalogue matches. Displayed titles and prices are assembled from those catalogue records. The normal search remains available. The provider key is a private Vercel environment variable, absent from browser assets and Git.

Verification: provider authentication and a small search extraction succeeded, the new endpoint passed a mocked published-listing check, and 15 marketplace release checks passed. The production endpoint and inbuilt-browser interaction returned camera/Nairobi filters and an honest empty state on 2026-11-13. Mobile rendering remains unverified. The supplied key was exposed in chat and should be rotated.

Homepage search now answers descriptive queries inline with links to current public listings. Short item searches open the catalogue. The existing PostgreSQL search vector, trigram indexes and write trigger support discovery. Interpretation and ranking each use a bounded five-minute cache per server instance. Ranking reuse requires unchanged candidate facts. A focused check verified concurrent reuse, updated prices and paused-listing removal with isolated fixtures.

Category discovery uses shared assisted search on submit, including scoped car, tech, lodging and experience queries. Validated model filters feed each page's existing listing query. Catalogue, tech and stay location fields suggest real localities via the places service and offer opt-in coarse reverse geocoding. Private searches remain participant-scoped.
