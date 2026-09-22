---
default: patch
---

Prevent built-in HTTP tracing from recording raw request URLs and sensitive
callback or transfer query parameters. Retain the sanitized application request
trace while handlers continue to receive the original request.
