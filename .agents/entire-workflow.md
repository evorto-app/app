# Entire operating workflow and migration

Owner: EVO-54 under EVO-50. Billing: EVO-57. This document records current
operation and remaining migration work; unchecked items are not shipped.

## Current operation

Use Entire Trails over the existing GitHub mirror `gh/evorto-app/app`.
Keep `origin` pointed at GitHub during this phase. Preserve Git history,
outstanding work and PR reviews. The earlier plan to create a repository with
one new initial commit is superseded.

A Trail records intent before code exists and can contain several branch
changes. Each change has its own base, review and merge. On this mirror it uses
a linked GitHub PR for CI and merging. Entire approvals are separate from
GitHub approvals. Linear remains the issue source of truth until the migration
below is verified and repository policy changes land.

Read the installed CLI's `entire agent-help` before using it. In particular:

```sh
entire repo view --json
entire trail list --project gh/evorto-app --status open --json
entire agent-help trail create
entire agent-help trail link
entire agent-help trail ci-pr
entire agent-help trail show
entire agent-help trail finding
entire agent-help trail merge
```

For planning, `entire trail create --no-branch` creates intent without publishing
code. For existing remote work, explicit `--repo gh/evorto-app/app` with
`--branch <existing-branch>` and `--base <actual-base>` links that branch without
pushing a local checkout. Inspect existing work first to avoid duplicate Trails.
`entire trail ci-pr <repository/change>` links or creates the supporting PR;
verify it reused the intended PR. These operations can trigger automation, so
complete required local verification before publishing any new code.

Use `entire trail show <trail> --project gh/evorto-app --json` to inspect the
changes and exact heads. Use the returned change URL and repository/change
selector, not an assumed equality between Trail, change and GitHub PR numbers.
Check both platforms' approvals, findings, required checks and base freshness.
`entire trail merge <repository/change> --dry-run --json` is a read-only preview;
it neither approves the change nor proves GitHub will accept a real merge.
Never use `--force` to get through migration.

Initial consolidation on 8 November 2026:

| GitHub work                                                                 | Entire change                                                               | Observed state                         |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------- |
| [PR208](https://github.com/evorto-app/app/pull/208), Stripe webhook fencing | [Trail 1, app/1](https://entire.com/gh/evorto-app/-/trails/1/changes/app/1) | CI/gate passed; one commit behind main |
| [PR209](https://github.com/evorto-app/app/pull/209), EVO-8 tooling cleanup  | [Trail 2, app/2](https://entire.com/gh/evorto-app/-/trails/2/changes/app/2) | CI/gate passed; draft PR; up to date   |

These are dated observations, not standing approval. All four inspected Entire
gates (approvals, checks, findings, up_to_date) were disabled. Recheck current
state before any publication or merge. This configuration change is based on
PR209 so its removal of old tool folders cannot overwrite the new entrypoints.

## Agent entrypoints

All agents must read root and nearest module guidance, not maintain parallel
copies of repository policy. Codex reads `AGENTS.md`; Claude uses `CLAUDE.md`;
Gemini CLI uses `GEMINI.md`; current Antigravity supports `AGENTS.md` and
`GEMINI.md`. Tool settings should contain only required, portable configuration.
Authentication, workspace trust and personal permissions remain local.

Optional Entire session/checkpoint capture is independent of Trails. Do not
restore old hooks merely to use hosting or code review. If recording is adopted
later, verify supported agents against the installed CLI and review where
checkpoint data is uploaded, especially for this public repository. Do not
commit credentials or transcript caches.

## Collaborator transition

Move daily planning, review and handoffs to Entire. A GitHub mirror's repository
permissions still come from GitHub; `entire repo grant add/remove` cannot assign
independent permissions on this mirror. Keep the GitHub grants while using it.
Independent Entire access requires a later native-hosting decision.

GitHub currently lists `heddendorp` (admin), `FranzZehetleitner` and
`laurenskuchta` (write). Entire's mirror grant listing currently returns only
`github:heddendorp`. That does not establish why the others are absent or prove
their access. Each collaborator must authenticate and verify access before any
access changes. Do not send invitations or messages without explicit direction.

- [ ] Verify each collaborator can sign in, find the repo/Trails, pull/push a
      feature branch, review and see checks with their own identity.
- [ ] Agree owner/admin/reviewer responsibilities and test denied operations.
- [ ] Verify offboarding and account recovery; retain an owner with recovery
      access. Record evidence without copying tokens or private session data.

## Remaining workflow changes

- [ ] Reconcile EVO-8 cleanup and EVO-9 PR-only policy with Trail publication;
      preserve no-direct-main rules and required review during the transition.
- [ ] Configure Entire review agents and gates, including exact-head/stale
      review behavior; test that failures block merging. Confirm GitHub's
      upstream rules independently. Mirror protection is owned by GitHub.
- [ ] Inventory Linear issues and map each to a canonical Trail, preserving EVO
      IDs, source links, owners, priorities, acceptance criteria and dependencies.
      Preserve comment/status history in a recoverable export or linked source.
      Pilot one issue, reconcile counts and ownership, then migrate remaining
      work. Do not close/delete source issues until verification. No automatic
      Linear/Entire status synchronization is assumed.
- [ ] Update AGENTS.md's issue-first/naming rules after the issue cutover;
      make new planning and progress records authoritative in one place.
- [ ] Define shared local/CI suites and conservative test selection (EVO-52).
      Rebuild verification on RWX (EVO-53); retain complete coverage and local
      pre-publication verification, including browser/provider requirements.
- [ ] Replace GitHub-dependent release, Knope/change-file, artifact/image,
      documentation and deployment integration where needed (EVO-55). Preserve
      schema compatibility, identical image digests, secret boundaries,
      serialization, production approval and rollback.
- [ ] Verify Codex cloud/review and all agent entrypoints using the mirror;
      local CLI access alone does not prove cloud integration readiness.
- [ ] Trial failure blocking, stale heads, collaborator access, independent
      recovery and an authorized release before declaring cutover (EVO-56).
- [ ] Disable duplicate CI only after replacement evidence. Remove obsolete
      tokens/integrations only after verifying their remaining consumers.

## GitHub subscription and cost

Lukas wants to cancel the paid organization subscription after migration,
retaining the organization and mirrored repository on an appropriate free plan.
This is a plan downgrade, not deletion or collaborator revocation.

On 8 November 2026 GitHub's organization API reported plan `enterprise`, one
filled seat, one public repository and no private repositories. That is not an
invoice or verified renewal date. GitHub Free supports protected branches for
public repositories; private-repository feature loss and organization-wide
effects must still be checked against the actual account and billing screen.

- [ ] Verify the billing owner, actual product, enterprise relationship, renewal,
      downgrade effective date, other repositories and feature losses.
- [ ] Check seats, Actions, storage, packages and separately billed add-ons.
      A free organization plan does not imply zero usage/add-on charges.
- [ ] Record current cost and projected remaining GitHub + Entire/RWX cost;
      set available usage controls without inventing savings.
- [ ] Complete the migration validation, execute the intended downgrade and
      verify its effective date and billing state (EVO-57).

## References

- [Entire Trails and GitHub-backed CI/merging](https://entire.com/blog/how-to-run-custom-ai-code-evals-on-every-push-with-trails)
- Installed `entire agent-help` and `entire repo grant list --help` for current
  command behavior and mirror authorization.
- [Gemini context files](https://geminicli.com/docs/cli/gemini-md/)
- [Antigravity rules](https://antigravity.google/docs/rules/)
- [GitHub protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
- [GitHub plan downgrade](https://docs.github.com/en/billing/how-tos/manage-plan-and-licenses/downgrade-plan)
