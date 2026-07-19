---
default: patch
---

# Stabilize event review documentation coverage

Wait for event review mutations to complete before checking the persisted event
status, preventing transient queue rerenders from racing the documentation test.
