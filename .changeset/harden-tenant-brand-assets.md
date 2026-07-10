---
evorto: patch
---

# Keep uploaded tenant branding tenant-bound

- reject uploaded logo and favicon paths that belong to another tenant or the
  wrong brand-asset kind,
- exercise real object-storage uploads in the tenant settings browser test,
  and
- document upload, save, persisted readback, and recovery behavior in the
  generated tenant settings guide.
