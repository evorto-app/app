---
default: patch
---

# Migrate rich text editor from TinyMCE to Tiptap core (MIT-only)

- replace TinyMCE integration with a Tiptap core editor implementation in shared form controls,
- add server-side rich text sanitization for template and event descriptions,
- enforce an MIT-only guard for Tiptap dependencies and block Tiptap Platform/Pro references.
