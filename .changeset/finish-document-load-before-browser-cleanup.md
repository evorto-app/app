---
default: patch
---

# Stabilize browser cleanup and scroll-restoration checks

Wait for the blank replacement document to load before closing test pages,
avoiding a Chromium cleanup stall on Linux while preserving tenant request
cancellation and drain ownership.

Place the scroll-restoration test's event below the initial viewport so browser
click preparation cannot erase its required nonzero departure position.
