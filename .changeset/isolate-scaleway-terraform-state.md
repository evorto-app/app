---
default: patch
---

Isolate bootstrap, staging, and production in fixed Terraform state roots,
private buckets, IAM applications, and project-scoped policies. Move
organization IAM and shared resources out of routine deployment credentials,
grant runtime roles the matching least-privilege Object Storage permissions,
and prevent any state credential or environment apply from crossing the
production boundary.
