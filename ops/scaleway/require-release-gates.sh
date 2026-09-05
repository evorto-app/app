#!/usr/bin/env bash

set -euo pipefail

readonly revision="${1:?Pass the full main revision to verify}"
: "${GITHUB_TOKEN:?GITHUB_TOKEN is required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"

if [[ ! "${revision}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "The release revision must be a full lowercase Git SHA" >&2
  exit 1
fi

latest_completed_run() {
  local workflow_file="$1"
  local response

  response="$(
    gh api \
      --method GET \
      "repos/${GITHUB_REPOSITORY}/actions/workflows/${workflow_file}/runs" \
      --field event=push \
      --field "head_sha=${revision}" \
      --field status=completed \
      --field per_page=100
  )"

  jq --exit-status --compact-output \
    --arg revision "${revision}" \
    '[
      .workflow_runs[]
      | select(
          .head_sha == $revision
          and .head_branch == "main"
          and .event == "push"
          and .status == "completed"
        )
    ]
    | sort_by(.run_number, .run_attempt, .id)
    | last
    // empty' <<<"${response}"
}

require_latest_successful_run() {
  local workflow_file="$1"
  local workflow_name="$2"
  local run
  local conclusion
  local run_url

  if ! run="$(latest_completed_run "${workflow_file}")"; then
    echo "No completed ${workflow_name} run exists for ${revision}" >&2
    exit 1
  fi

  conclusion="$(jq --exit-status --raw-output '.conclusion' <<<"${run}")"
  run_url="$(jq --exit-status --raw-output '.html_url' <<<"${run}")"
  if [ "${conclusion}" != "success" ]; then
    echo "Latest completed ${workflow_name} run for ${revision} concluded ${conclusion}: ${run_url}" >&2
    exit 1
  fi

  jq --exit-status --raw-output '.id' <<<"${run}"
}

require_successful_job() {
  local run_id="$1"
  local job_name="$2"

  if ! gh api \
      --method GET \
      "repos/${GITHUB_REPOSITORY}/actions/runs/${run_id}/jobs" \
      --field filter=latest \
      --field per_page=100 \
    | jq --exit-status \
        --arg job_name "${job_name}" \
        'any(.jobs[]; .name == $job_name and .conclusion == "success")' \
        >/dev/null; then
    echo "Latest completed run ${run_id} does not contain a successful ${job_name} job" >&2
    exit 1
  fi
}

quality_run_id="$(
  require_latest_successful_run pr-quality.yml 'PR Quality'
)"
require_successful_job "${quality_run_id}" 'CI/gate'

baseline_run_id="$(
  require_latest_successful_run e2e-baseline.yml 'protected E2E Baseline'
)"
require_successful_job \
  "${baseline_run_id}" \
  'Playwright E2E (functional + docs)'

echo "Exact-SHA release gates passed for ${revision}"
