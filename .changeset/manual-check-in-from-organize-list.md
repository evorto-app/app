---
default: minor
---

# Check in attendees from the organize list

Organizers can now check in a confirmed attendee and their guests from the organize page, without scanning the ticket. This needs the new **Manual check-in** permission on top of access to check in at the event; admins, event managers and section members have it by default, while scanning stays open to event organizers. A confirmation dialog shows how many guests can still check in and explains when check-in is not open, already done or not possible. Guests who arrive after the attendee can be checked in later with **Check in guests**, and the attendee's original check-in time is kept. The existing check-in rules still apply, including no self check-in. As with the scanner, a check-in on a weak connection is retried safely and never counted twice, and a ticket that was transferred to someone else in the meantime is not checked in under the old name. Every sign-up row on the organize page now shows its actions on a line below the name, so rows line up.
