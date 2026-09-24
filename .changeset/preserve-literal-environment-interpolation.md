---
default: patch
---

# Preserve literal credentials in local environment references

Local commands preserve dollar signs, backslashes, and replacement characters
when environment files reference caller credentials. Variable expansion resolves
forward references and nested defaults without executing command text, and
rejects cycles with key-only errors before starting the command.

Refresh Angular framework and Material packages to 22.2.0, along with the
reviewed Auth0, Maps loader, dotenv, lint, and formatter updates. Update CI
actions to their current immutable releases.

Browser test teardown leaves application documents before cancelling their
requests, preserving tenant interception while preventing cleanup from creating
unhandled initializer failures.
