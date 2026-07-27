---
default: patch
---

# Observe warm staging latency

- split server traces across authentication, request context, SSR, Angular,
  Effect RPC, and event-list database boundaries with bounded attributes,
- run an independent report-only staging latency synthetic every 15 minutes,
- retain cold-eligible and sequential warm-candidate network timings as
  workflow evidence, and
- attach a 10-request warm latency baseline to changed staging deployments and
  their immutable manifests.
