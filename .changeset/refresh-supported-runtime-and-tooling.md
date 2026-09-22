---
default: patch
---

Update the aligned Effect v4 beta packages to beta.107 while retaining the PostgreSQL cancellation patch. Refresh dotenv, ESLint, Unicorn, Prettier and tsx, preserve the existing control-flow lint style, and correct the generated-documentation checkout paths in the environment template.

Use the renamed typed-error constructor throughout the app and patch Drizzle RC4 error constructors to the same Effect API while preserving their tags, fields and database behavior.
