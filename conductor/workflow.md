# Project Workflow

## Guiding Principles

1. **The Plan is the Source of Truth:** All work must be tracked in `plan.md`
2. **The Tech Stack is Deliberate:** Changes to the tech stack must be documented in `tech-stack.md` _before_ implementation
3. **E2E + Docs First:** Prefer Playwright e2e and doc tests; unit tests only when necessary
4. **User Experience First:** Every decision should prioritize user experience
5. **Non-Interactive & CI-Aware:** Prefer non-interactive commands. Use `CI=true` for watch-mode tools (tests, linters) to ensure single execution
6. **Readable over Clever:** Optimize for maintainability and fast re-onboarding

## Task Workflow

All tasks follow a strict lifecycle:

### Standard Task Workflow

1. **Select Task:** Choose the next available task from `plan.md` in sequential order

2. **Mark In Progress:** Before beginning work, edit `plan.md` and change the task from `[ ]` to `[~]`

3. **Define Test Intent:**
   - For user-visible changes, add/extend Playwright e2e tests.
   - For doc updates, add/extend doc tests that generate screenshots/text.
   - Use unit tests only when there is logic that cannot be validated via e2e/doc tests.
   - Document requirements ↔ test mappings in `conductor/tracks/<track_id>/spec.md`.
   - When moving into test planning or test implementation, use the $playwright-cli skill.

4. **Implement:**
   - Implement the minimum code needed to satisfy the task and test intent.

5. **Verify:**
   - Run lint + build + e2e + doc tests before marking the task complete.

6. **Document Deviations:** If implementation differs from tech stack:
   - **STOP** implementation
   - Update `tech-stack.md` with new design
   - Add a dated note explaining the change
   - Resume implementation

7. **Add Knope Change File:**
   - For every user-facing or release-relevant change, add a change file in `.changeset/*.md`.
   - Change files are required; do not use conventional commits/PR titles as a substitute for release documentation.

8. **Commit Code Changes:**
   - Stage all code changes related to the task.
   - Propose a clear, concise commit message e.g., `feat(ui): Create basic HTML structure for calculator`.
   - Perform the commit.

9. **Attach Task Summary with Git Notes:**
   - **Step 9.1: Get Commit Hash:** Obtain the hash of the _just-completed commit_ (`git log -1 --format="%H"`).
   - **Step 9.2: Draft Note Content:** Create a detailed summary for the completed task. Include the task name, summary of changes, list of created/modified files, and the core "why".
   - **Step 9.3: Attach Note:** Use `git notes add -m "<note content>" <commit_hash>`.

10. **Get and Record Task Commit SHA:**

- **Step 10.1: Update Plan:** Read `plan.md`, find the line for the completed task, update its status from `[~]` to `[x]`, and append the first 7 characters of the _just-completed commit's_ hash.
- **Step 10.2: Write Plan:** Write the updated content back to `plan.md`.

11. **Commit Plan Update:**
    - Stage the modified `plan.md`.
    - Commit with a descriptive message (e.g., `conductor(plan): Mark task 'Create user model' as complete`).

### Phase Completion Verification and Checkpointing Protocol

**Trigger:** Executed immediately after a task completes a phase in `plan.md`.

1. **Announce Protocol Start:** Inform the user that the phase is complete and verification/checkpointing has begun.

2. **Ensure Test Coverage for Phase Changes:**
   - Determine phase scope via the previous checkpoint SHA in `plan.md`.
   - List changed files with `git diff --name-only <previous_checkpoint_sha> HEAD`.
   - Ensure e2e/doc coverage exists for user-facing changes in that phase.
   - Add unit tests only when e2e/doc tests cannot reasonably validate logic.

3. **Execute Automated Tests with Proactive Debugging:**
   - Announce the exact command before running.
   - Run lint + build + e2e + doc tests.
   - If tests fail, propose fixes up to two attempts; otherwise stop and ask for guidance.

4. **Manual Verification Plan:**
   - Provide a step-by-step manual verification plan aligned with `product.md`, `product-guidelines.md`, and `plan.md`.
   - Ask for explicit confirmation before proceeding.

5. **Create Checkpoint Commit:**
   - Stage all changes (or create an empty commit if no changes).
   - Commit with `conductor(checkpoint): Checkpoint end of Phase X`.

6. **Attach Auditable Verification Report (Git Notes):**
   - Include test command, manual steps, and user confirmation.

7. **Record Phase Checkpoint SHA in Plan:**
   - Append `[checkpoint: <sha>]` to the phase heading.

8. **Commit Plan Update:**
   - Commit the `plan.md` update with `conductor(plan): Mark phase '<PHASE NAME>' as complete`.

9. **Knope Update (Per Phase):**
   - Add or update the phase’s change notes in Knope before closing the phase.

10. **Announce Completion:** Inform the user the phase is complete and checkpointed.

### Quality Gates

Before marking any task complete, verify:

- [ ] `bun run lint:check` passes
- [ ] `bun run build:app` passes
- [ ] `bun run test:e2e` passes (or targeted project)
- [ ] `bun run test:e2e:docs` passes
- [ ] Documentation updated if needed
- [ ] Type safety is enforced
- [ ] No linting/static analysis errors
- [ ] Works on mobile (if applicable)

## Development Commands

### Setup

```bash
bun install
bun run db:setup
```

### Daily Development

```bash
bun run dev:start
bun run lint:check
bun run build:app
bun run test:e2e
bun run test:e2e:docs
```

### Before Committing

```bash
bun run lint:check
bun run build:app
bun run test:e2e
bun run test:e2e:docs
```

## Testing Requirements

### E2E + Doc Testing

- Prefer user-journey coverage using Playwright.
- Doc tests must generate screenshots and text for user-facing documentation.
- Use fixtures for setup/teardown where needed.
- New Playwright tests live in `tests/**` (doc tests in `tests/docs/**`); legacy `e2e/tests/**` is reference-only.
- When planning or implementing Playwright coverage, use the $playwright-cli skill.
- Track requirements and test mappings live in `conductor/tracks/<track_id>/spec.md`.

### Unit Testing

- Only when e2e/doc tests cannot reasonably validate a logic path.

## Definition of Done

A task is complete when:

1. Code implemented to specification
2. E2E/doc tests updated as needed and passing
3. Lint + build + e2e + doc tests pass
4. Documentation complete (if applicable)
5. Type safety upheld
6. Plan updated with commit SHA
7. Changes committed with proper message
8. Git note with task summary attached
