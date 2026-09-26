---
default: patch
---

# Compile the production app once in the quality workflow

Use the required Linux image build to compile and verify the production browser,
server, and ops bundles. Remove the duplicate standalone compile from the unit
test job and local verification checklist, while retaining every test suite,
image inspection, source-map export, security scan, and aggregate quality gate.
