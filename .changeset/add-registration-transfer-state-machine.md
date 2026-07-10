---
evorto: patch
---

# Add private registration transfer offers and paid resale

- let confirmed participants create a private transfer link and manual claim code while their source ticket remains active,
- revalidate the recipient against current eligibility, questions, add-ons, guests, capacity, discounts, and pricing at claim time,
- use tenant-connected Stripe Checkout with the platform application fee for paid claims before cancelling the source ticket and queuing its persisted refund,
- preserve exact checkout and refund claims across retries, expiry, webhook replay, and operator recovery,
- block ordinary source/recipient mutations while a transfer owns the ticket and fully refund a paid recipient if a competing source change still wins,
- and document and cover the participant transfer journey without storing raw bearer credentials.
