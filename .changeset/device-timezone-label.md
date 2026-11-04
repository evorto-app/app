---
default: patch
---

# Show event timezone only when needed

Hide the event timezone label when the browser reports the same canonical timezone. Keep event times in the organization timezone, retain an explicit label in server-rendered and unknown-device states, and refresh detection when returning to the page.
