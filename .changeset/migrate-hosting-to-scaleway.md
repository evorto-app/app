---
default: minor
---

Add the staging-first Scaleway runtime, infrastructure, deployment, object
storage, email delivery, observability, and local PostgreSQL platform while
keeping production disabled pending explicit acceptance. Retire the legacy Fly
application workflow, configuration, hostname defaults, and deployment token.
Keep web liveness independent from database readiness, make managed database
password rotations explicit, and promote validated receipt bytes away from
browser-writable upload keys before they become durable evidence while
discarding any losing copy from concurrent finalization.
