---
default: patch
---

# Add fixed-bundle registration transfers

- let confirmed participants create a private transfer link and manual claim code while their source ticket remains active,
- revalidate the recipient against current eligibility and questions, then price the unchanged registration, guest count, and complete add-on bundle from current base prices with recipient-current discounts only,
- keep the same confirmed registration, add-on lots, quantities, check-in state, and fulfillment history while changing ownership in place,
- use tenant-connected Stripe Checkout with the platform application fee for paid claims and queue one exact remaining refund claim for every original source Stripe payment,
- record each owner, payment, settled registration/add-on component, and cancellation allocation in an append-only acquisition ledger so repeat transfers never infer ownership from timestamps,
- complete a transfer without Stripe only when the entire bundle is free and no source refund is required,
- require every event registration option and add-on to remain free when the tenant has no connected Stripe account,
- preserve exact checkout and refund claims across retries, expiry, webhook replay, account rotation, and operator recovery,
- block conflicting mutations only while an offer or Checkout owns the ticket, and fully refund a paid recipient if a competing source change still wins,
- and document and cover the participant transfer journey without storing raw bearer credentials.
