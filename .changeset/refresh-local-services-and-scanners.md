---
default: patch
---

# Refresh local services and image verification

Update PostgreSQL 17, Mailpit and the Stripe test listener. Build MinIO from
its fixed upstream source release so restricted service accounts cannot create
unrestricted credentials. Refresh the Node base image and the image scanners.
