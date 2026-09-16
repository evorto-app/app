---
default: patch
---

Resolve local command environments separately for each invocation so concurrent commands cannot select another command's Docker project or database through `.env.dev`. Preserve explicit environment overrides and dotenv expansion, and pass resolved values in memory with native command signals and exit status. Hold the Docker project lease for the full Drizzle Studio session, and validate seed configuration before local database reset.
