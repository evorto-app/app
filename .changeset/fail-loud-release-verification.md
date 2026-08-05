---
default: patch
---

Require vulnerability scans for every exact staging and production image
digest, select only the latest completed exact-SHA release gates, fail on
corrupt Playwright runtime state, and keep test artifacts out of image builds.
