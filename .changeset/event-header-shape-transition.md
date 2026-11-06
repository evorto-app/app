---
default: patch
---

# Morph event header SVG paths

Normalize the existing outlines to matching cubic segments and animate the live SVG path when switching events. Keep event shapes stable across server rendering and hydration, retain loaded destination headers, and respect reduced-motion preferences. Event-to-event navigation avoids page snapshots so the morph remains visible; other navigation keeps native view transitions. No animation dependency is required.
