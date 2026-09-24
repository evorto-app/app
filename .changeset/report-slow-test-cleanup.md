---
default: patch
---

# Identify slow test cleanup stages

Report fixed cleanup-stage labels when test teardown remains pending, without
logging fixture data or changing cleanup deadlines and failure handling.
