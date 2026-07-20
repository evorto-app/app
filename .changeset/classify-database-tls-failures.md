---
default: patch
---

# Classify managed database TLS failures

Distinguish hostname, trust-chain, expired, and not-yet-valid certificate
failures in bounded ops logs so staging deployment diagnostics identify the
safe remediation without exposing provider command output.
