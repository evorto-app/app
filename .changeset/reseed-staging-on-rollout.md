---
default: patch
---

# Rebuild and seed staging on every rollout

Each staging rollout rebuilds the staging database with the release schema and
seed data before deploying the worker and web roles.
