---
default: patch
---

Check organizer capability before starting the registration camera, keep camera
and navigation failures in explicit retry states, and remove the platform
scanner's incomplete fixed-first-page registration list and its unused API.
Replace the scanner's source-spelling checks and the hand-maintained Playwright
file list with rendered behavior and filesystem discovery. Remove an unused
documentation screenshot compatibility export and commented-out browser
projects.
