# LOCKD project state

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
