---
default: patch
---

Add a PostgreSQL burst test for simultaneous sign-ups: 40 members sign up for a
10-place option at once, free and paid, with production-sized connection pools.
It checks that exactly 10 places are taken and records wall time, latency and
lock waits (EVO-21).
