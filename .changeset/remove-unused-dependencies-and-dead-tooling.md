---
default: patch
---

# Remove unused dependencies and dead tooling

- remove unused `@tanstack/eslint-plugin-query`, `tsx`, `@tiptap/extension-image`, `@tiptap/extension-text-style`, `@types/dom-speech-recognition` and `playwright-ng-schematics`, together with the unused Angular `e2e` target,
- drop the unread `PLAYWRIGHT_SELECTED_PROJECTS` variable from scripts, workflow and wrapper test,
- drop the no-op `@neondatabase` removal from the runtime image build and stale ignore entries with their build-context fixtures.
