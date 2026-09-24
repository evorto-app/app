---
default: patch
---

# Finish document loading before browser cleanup

Wait for the blank replacement document to load before closing test pages,
avoiding a Chromium cleanup stall on Linux while preserving tenant request
cancellation and drain ownership.
