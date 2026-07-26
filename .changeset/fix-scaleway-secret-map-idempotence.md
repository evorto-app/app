---
default: patch
---

Compare Scaleway secret environment variable keys using the current container
API map shape so unchanged scheduled reconciliations do not create new
deployments.
