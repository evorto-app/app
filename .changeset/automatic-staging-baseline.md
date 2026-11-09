---
default: patch
---

Run routine main-branch browser tests without live-provider certification
approval and deploy staging automatically after both quality gates pass.
Load validated immutable staging configuration instead of requiring Terraform
state and DNS credentials on each app deployment. Preserve schema, image and
health checks; inspect infrastructure drift separately (EVO-65).
