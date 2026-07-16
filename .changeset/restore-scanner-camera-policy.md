---
default: patch
---

# Restore first-party QR scanner camera access

- allow the authenticated first-party scanner to request camera access while keeping geolocation and microphone disabled,
- expose accessible camera starting, ready, and failure states with retry guidance,
- use one server-authoritative test clock for scanner timing, check-in timestamps, and seeded Docker event windows,
- add server and page-backed camera-policy regressions,
- add a beginner-friendly generated check-in guide covering navigation, camera recovery, partial guest arrival, duplicate scans, and organizer totals.
