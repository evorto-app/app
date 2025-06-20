# add-registrations Helper

This document describes the behavior of the `addRegistrations` helper (helpers/add-registrations.ts).

## Purpose

- Seed deterministic registrations for development and testing.
- Batch insert registrations and transactions.

## Key Behaviors

1. **Excludes Admin User**: Filters out `admin@evorto.app` to prevent the admin account from being registered for every event.
2. **Pending vs Confirmed Status**:
   - **Paid Registrations**: Marked as `PENDING` until payment is complete.
   - **Free Registrations**: Marked as `CONFIRMED` immediately.
3. **Spot Filling**: Fills 70% of available spots per registration option.
4. **Transactions**: For paid registrations, creates a Stripe-like transaction record to simulate webhook processing.
5. **Batch and Atomic**: Uses batch inserts and a database transaction to ensure atomicity.

## Usage

```ts
import { addRegistrations } from "./helpers/add-registrations";

await addRegistrations(database, events);
```

Please refer to the source file for more detailed implementation notes.
