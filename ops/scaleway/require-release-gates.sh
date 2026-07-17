#!/usr/bin/env bash

set -euo pipefail

readonly revision="${1:?Pass the full main revision to verify}"
: "${GITHUB_TOKEN:?GITHUB_TOKEN is required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"

if [[ ! "${revision}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "The release revision must be a full lowercase Git SHA" >&2
  exit 1
fi

successful_run_id() {
  local workflow_file="$1"
  local response

  response="$(
    gh api \
      --method GET \
      "repos/${GITHUB_REPOSITORY}/actions/workflows/${workflow_file}/runs" \
      --field "head_sha=${revision}" \
      --field status=completed \
      --field per_page=100
  )"

  jq --exit-status --raw-output \
    --arg revision "${revision}" \
    '[
      .workflow_runs[]
      | select(
          .head_sha == $revision
          and .head_branch == "main"
          and .conclusion == "success"
        )
    ]
    | sort_by(.updated_at)
    | last
    | .id // empty' <<<"${response}"
}

require_successful_job() {
  local run_id="$1"
  local job_name="$2"

  gh api \
    --method GET \
    "repos/${GITHUB_REPOSITORY}/actions/runs/${run_id}/jobs" \
    --field filter=latest \
    --field per_page=100 \
    | jq --exit-status \
      --arg job_name "${job_name}" \
      'any(.jobs[]; .name == $job_name and .conclusion == "success")' \
      >/dev/null
}

quality_run_id="$(successful_run_id pr-quality.yml)"
if [[ -z "${quality_run_id}" ]]; then
  echo "No successful PR Quality run exists for ${revision}" >&2
  exit 1
fi
require_successful_job "${quality_run_id}" 'CI/gate'

baseline_run_id="$(successful_run_id e2e-baseline.yml)"
if [[ -z "${baseline_run_id}" ]]; then
  echo "No successful protected E2E Baseline run exists for ${revision}" >&2
  exit 1
fi
require_successful_job \
  "${baseline_run_id}" \
  'Playwright E2E (functional + docs)'

echo "Exact-SHA release gates passed for ${revision}"
