---
evorto: patch
---

Require credential-backed Google Maps location search and place-detail evidence for production releases, and remove the retired Cloudflare Images editor-upload RPC, runtime configuration, cleanup tooling, and dependencies while preserving S3-compatible asset storage.

Harden repository workflows with immutable action pins, step-scoped secrets, explicit reusable-provider secret inputs, and separate test and production Stripe credentials. Require an explicit production storage bucket without coupling provider certification to a specific deployment platform.
