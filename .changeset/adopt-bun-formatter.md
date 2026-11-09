---
default: patch
---

Upgrade the package manager, CI and application runtime to Bun 1.4.4 and replace
standalone Prettier with Bun's built-in formatter. Preserve Angular formatting
and reference-source exclusions. Close discarded Node request streams when
their socket closes so Bun's Node HTTP bridge releases drain listeners (EVO-58).
