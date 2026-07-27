---
default: patch
---

Check organizer capability before starting the registration camera, keep camera
and navigation failures in explicit retry states, and remove the platform
scanner's incomplete fixed-first-page registration list and its unused API.
Replace the scanner's source-spelling checks and the hand-maintained Playwright
file list with rendered behavior and filesystem discovery. Remove an unused
documentation screenshot compatibility export and commented-out browser
projects. Delete the event list's empty filter dialog and unreachable
filter/paging state instead of presenting controls that do nothing. Use
authenticated request context directly for event-list identity instead of
issuing a second self query and echoing the user ID to the server.
