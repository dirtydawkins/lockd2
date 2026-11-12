# LOCKD project state

## Messages

The inbox uses the existing LOCKD account and encrypted messaging service. Desktop has a conversation list beside the thread. On phones, selecting a conversation opens the thread and All messages returns to the list. Listers can switch between listing enquiries and their own rentals.

The search and refresh controls share a row below the account switcher. Long conversation previews truncate. An empty filtered inbox offers a reset. Signed-out visitors see a sign-in link that returns them to Messages. The editorial photograph on this screen comes from the supplied LOCKD collection.

Private thread controls clear on a conversation change. Asynchronous device and contact lookups check the active conversation before updating the interface.

## Verification

32 messaging tests passed and 15 marketplace release checks passed. Checking a populated production inbox requires an authenticated participant session. No customer messages or booking records were created for this UI work.

## Direct messages to listers

Public listing details and rental cards on public lister profiles link to the same listing-scoped inbox. Sign-in preserves the listing ID. The backend derives the recipient from the published listing and reuses its existing private conversation. An unavailable listing or a daily conversation limit now leaves the rest of the inbox usable.

The isolated database journey in tests/messaging-direct.test.js opened a conversation before the lister registered a device, exchanged signed encrypted messages in both directions after registration, recorded reads, and denied access to a third account. Delivery requires the recipient account to have registered its public key. A two-account exchange on the production deployment remains unverified.
