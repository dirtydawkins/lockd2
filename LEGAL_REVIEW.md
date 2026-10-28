# Legal and regulatory review register

Checked against official public sources on 2026-10-28. This register identifies issues for qualified Kenyan counsel and tax advice; it is not a legal opinion and does not establish compliance. Applicability depends on LOCKD's contracting entity, agency/marketplace role, categories, operating countries, custody of funds, and exact rental model.

## Issues to resolve before launch

| Topic | Official source | Review needed |
| --- | --- | --- |
| Personal data | [Data Protection Act, 2019](https://new.kenyalaw.org/akn/ke/act/2019/24/eng@2022-12-31/publication) and [ODPC regulations and guidance](https://www.odpc.go.ke/data-protection-laws-kenya/) | Identify controller and processor roles; confirm ODPC registration obligations; lawful purposes and notices; rights handling; retention/deletion; incident response; impact assessment needs; and processor contracts. |
| Cross-border processing | [Data Protection (General) Regulations, 2021](https://www.odpc.go.ke/wp-content/uploads/2024/03/THE-DATA-PROTECTION-GENERAL-REGULATIONS-2021-1.pdf) and [ODPC cross-border guidance index](https://www.odpc.go.ke/guidelines-2/) | Confirm Supabase region and every subprocessor/location, lawful transfer basis, safeguards and disclosures before storing customer, owner, identity, payment or device data. |
| Online consumer agreements | [Consumer Protection Act, 2012](https://new.kenyalaw.org/akn/ke/act/2012/46/eng@2022-12-31/source) | Counsel to determine how internet-agreement information, error correction, express acceptance, copy delivery, cancellation rights, price/deposit disclosure, cancellation and refund terms apply to LOCKD and owners. |
| Payments and funds custody | [CBK National Payments System information](https://www.centralbank.go.ke/national-payments-system/) and [CBK legislation and guidelines](https://www.centralbank.go.ke/policy-procedures/legislation-and-guidelines/) | Determine whether LOCKD's collection, split settlement, holding or payout model requires an authorized PSP or other structure. Use an appropriately authorized provider and obtain counsel's approval before holding or redistributing customer funds. |
| M-Pesa | [Safaricom Daraja M-Pesa Express documentation](https://developer.safaricom.co.ke/apis/MpesaExpressSimulate) | Daraja describes asynchronous STK push and callback processing; select sandbox/live products, contract/merchant account, callback verification, reconciliation, refund and payout handling. No Daraja credentials or tested integration are present in this repository. |
| Payment law changes | [CBK's 2026 draft National Payment System Policy and Bill notice](https://www.centralbank.go.ke/2026/09/21/draft-national-payment-system-policy-and-national-payment-system-bill-2026/) | CBK describes this as a draft Bill. Counsel must confirm whether it has since been enacted, commenced or amended and which law applies at launch. Do not treat the draft as current law. |
| Tax | [KRA rental income tax guidance](https://www.kra.go.ke/individual/filing-paying/types-of-taxes/residential-rental-income) | Obtain tax advice on owner earnings, platform fees, residential short stays versus other asset classes, withholding/agent status, VAT, invoices and reporting. KRA's residential immovable-property guidance is not enough to classify all LOCKD rentals. |
| E-contract, risk and disputes | [Consumer Protection Act, 2012](https://new.kenyalaw.org/akn/ke/act/2012/46/eng@2022-12-31/source) | Approve booking terms, item-condition evidence, deposits, supported deductions, overdue returns, damage claims, cancellation/rescheduling and dispute routes. Terms and deductions must match the implemented state machine and evidence process. |

## Product safeguards while review is pending

- Do not collect identity documents, biometrics, IMEIs, card data or M-Pesa credentials until a documented purpose, access policy, retention period, notice and secure workflow have been approved.
- Do not take custody of deposits, promise refunds or create owner payouts before the payment and legal model is approved and implemented.
- Do not call the current catalogue/availability check a reservation. It neither holds inventory nor creates a booking.
- Do not claim legal compliance, verified owners, insured rentals, completed payments, refunds or payouts without evidence.
