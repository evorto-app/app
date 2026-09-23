---
default: patch
---

# Preserve literal credentials in local environment references

Local commands preserve dollar signs, backslashes, and replacement characters
when environment files reference caller credentials. Variable expansion resolves
forward references and nested defaults without executing command text, and
rejects cycles with key-only errors before starting the command.

Refresh Angular framework and Material packages to 22.1.8, along with the
reviewed Auth0, Maps loader, dotenv, lint, and formatter updates.
