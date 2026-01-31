# Track Spec: <track title>

- Track: `<track_id>`
- Conductor: `conductor/tracks/<track_id>/`
- Status: draft | in-progress | complete

## Requirements

| ID | Requirement | Notes |
| --- | --- | --- |
| REQ-001 | <requirement summary> | <optional> |

## Test Coverage

List all Playwright tests that validate the requirements. Include file paths and the tags used in the test titles.

- `tests/<path>.spec.ts` — `@track(<track_id>) @req(REQ-001)`

## Doc Coverage

List doc tests that generate documentation for this track.

- `tests/docs/<path>.doc.ts` — `@track(<track_id>) @doc(DOC-001)`

## Notes

Add any constraints, fixtures, or setup notes relevant to the tests in this spec.
