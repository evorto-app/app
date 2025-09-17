# Quickstart: Registration cancellation configuration

This quickstart demonstrates tenant policy setup, option override, and attendee cancellation with refund handling.

## Steps
1. As a tenant admin, open Settings → Cancellations and define a default policy:
   - Allow cancellations
   - Cutoff: 2 days 0 hours before start
   - Include transaction fees: off
   - Include app fees: on
   - Apply to all variants (progressive disclosure)
2. Edit a template’s participant registration option and leave "Use tenant default" enabled.
3. Edit the organizer registration option and set a stricter override (1 day, exclude app fees too). Save.
4. Create an event from the template. Option policies are copied; organizer inherits override.
5. Register a paid participant for the event. Confirm payment.
6. Before the cutoff, go to "My registration" and cancel:
   - The system accepts the cancellation and shows refund summary based on the policy.
   - A refund transaction is created; app fees are included, transaction fees excluded.
7. After the cutoff, try to cancel another registration for the same option:
   - The system denies cancellation and explains the cutoff passed.
8. For a free registration, cancel before cutoff:
   - The system releases the spot with no refund created.
9. As an unauthorized user, attempt to edit cancellation settings:
   - Access is denied.
10. As a privileged organizer/admin with `events:registrations:cancel:any`, cancel another user’s registration:
    - Choose a `cancellationReason` (e.g., `admin`) or `other` with a short note.
    - If you also hold `events:registrations:cancelWithoutRefund` and the event is paid, you may set "no refund"; otherwise, refund follows policy.
11. Event overview displays the standardized reason label (and note when `other`).

## Expected Outcomes
- Options inherit tenant policy unless overridden; effective policy is snapshotted at registration.
- Paid cancellations within the window create refunds per fee flags; free cancellations only release capacity.
- Cancel action is hidden/disabled when not allowed.
- Policy summary is visible on registration UI before purchase.
