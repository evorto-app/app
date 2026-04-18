---
evorto: minor
---

# Migrate forms to Angular Signal Forms

Migrate form models, templates, and custom form controls from legacy reactive
forms/CVA patterns to Angular Signal Forms.

Highlights:

- migrate form bindings to `form()` + `[formField]` patterns,
- move reusable form logic into signal-form schemas and defaults,
- update reusable child form composition and hidden-field behavior,
- fix migration regressions (date handling, dependent permissions, role
  autocomplete de-duplication, location search input behavior),
- update docs/e2e coverage for key signal-forms flows.
