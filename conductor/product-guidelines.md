# Product Guidelines

## Guiding Principles
- Balance simplicity with power: default to simple flows, but allow advanced options when they unlock clear value.
- Progressive disclosure: hide complexity by default and provide an explicit action to reveal advanced controls.
- Readability over cleverness: prioritize code clarity and future maintenance.
- Solo-dev friendly: every module is documented to enable fast re-onboarding.

## Documentation & Testing
- Doc-first shipping: every feature must ship with doc tests that generate screenshots and text.
- E2E tests are required alongside docs before shipping.
- It’s acceptable to develop first, but documentation and tests must be completed before release.

## Decision Recording
- Small decisions: inline code comments and/or commit messages.
- Larger decisions: record in per-feature `AGENTS.md` files (feature-local rationale and constraints).

## Quality Gates
- Default gate: build + lint + e2e + docs tests required before shipping.
- Exception mode: allow a “Balanced” gate temporarily while reaching legacy parity.

## Roadmap Focus (Parity Phase)
- Parity is primary, but allow targeted improvements that justify the new version.
- Some unpopular legacy features may be intentionally dropped if they do not fit the new direction.

## Accessibility & UX
- Favor clear, predictable UX with minimal cognitive load.
- Use progressive disclosure for complex workflows.
- Follow Material Design guidelines for UI patterns, layout, and motion.
