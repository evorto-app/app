---
default: patch
---

Keep ticket check-in reliable on weak networks. The scanner loads a ticket and
its add-ons in one request, retries a dropped check-in or ticket load with
backoff, waits while the device is offline, and shows whether the check-in is
being sent, retrying, confirmed, or not confirmed. A retried check-in counts the
attendee and guests only once, and a check-in from an outdated ticket view is
rejected so the helper can review the current count.
