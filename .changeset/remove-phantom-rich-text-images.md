---
default: patch
---

Remove the unused rich-text image extension, image sanitization allowance, and
pending-upload validation. Rich text now supports only the formatting the
editor actually owns, and saved HTML cannot load third-party tracking images.
