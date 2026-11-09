---
default: patch
---

# Check the Google Maps key before local startup

The Docker runtime preflight now reports a missing `PUBLIC_GOOGLE_MAPS_API_KEY` before it stops, resets or starts containers, instead of the web server exiting after the local database reset. The local setup docs and `.env.example` now say that the web server needs the key in every environment, and how to get a development key.
