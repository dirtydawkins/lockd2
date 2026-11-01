# LOCKD project requirements

Latest user decisions, 1 November 2026. Preserve these across subsequent work.

- The final customer and owner UI must use genuine account, listing, booking and conversation records only.
- No mockups, synthetic conversations, demo inventory, fabricated history, fake availability, simulated success or QA/test labels in the final product.
- Show truthful, useful empty states when no real records exist. Never disguise sample data as genuine inventory.
- Automated fixtures belong only in isolated development tests. Exclude tests, fixture servers, screenshots and scratch files from deployment. Do not publish fixture records to production databases.
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
