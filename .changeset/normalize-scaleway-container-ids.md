---
default: patch
---

# Normalize Scaleway container IDs for deployment updates

Strip Terraform's regional resource prefix before passing a container UUID to
the Scaleway CLI, and report which deployment boundary fails without exposing
protected values.
