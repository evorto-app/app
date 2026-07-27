#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: probe-http-latency.sh \
  --origin https://staging.evorto.app \
  --output latency.json \
  [--summary-output latency.md] \
  [--warm-samples 4] \
  [--mode report-only|enforce-critical] \
  [--vantage github-actions/ubuntu-latest]
EOF
}

origin=''
output=''
summary_output=''
warm_samples=4
mode='report-only'
vantage="${GITHUB_ACTIONS:+github-actions/${RUNNER_OS:-unknown}-${RUNNER_ARCH:-unknown}}"
vantage="${vantage:-local}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --origin)
      [[ $# -ge 2 ]] || {
        usage >&2
        exit 64
      }
      origin="$2"
      shift 2
      ;;
    --output)
      [[ $# -ge 2 ]] || {
        usage >&2
        exit 64
      }
      output="$2"
      shift 2
      ;;
    --summary-output)
      [[ $# -ge 2 ]] || {
        usage >&2
        exit 64
      }
      summary_output="$2"
      shift 2
      ;;
    --warm-samples)
      [[ $# -ge 2 ]] || {
        usage >&2
        exit 64
      }
      warm_samples="$2"
      shift 2
      ;;
    --mode)
      [[ $# -ge 2 ]] || {
        usage >&2
        exit 64
      }
      mode="$2"
      shift 2
      ;;
    --vantage)
      [[ $# -ge 2 ]] || {
        usage >&2
        exit 64
      }
      vantage="$2"
      shift 2
      ;;
    --help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 64
      ;;
  esac
done

if [[ -z "${origin}" || -z "${output}" ]]; then
  usage >&2
  exit 64
fi
if [[ ! "${warm_samples}" =~ ^[1-9][0-9]*$ ]] || ((warm_samples > 100)); then
  echo "--warm-samples must be an integer between 1 and 100" >&2
  exit 64
fi
if [[ "${mode}" != 'report-only' && "${mode}" != 'enforce-critical' ]]; then
  echo "--mode must be report-only or enforce-critical" >&2
  exit 64
fi
if [[ ! "${origin}" =~ ^https?://[^[:space:]]+$ ]]; then
  echo "--origin must be an absolute HTTP(S) origin" >&2
  exit 64
fi

origin="${origin%/}"

for required_command in awk curl date dirname grep jq mkdir mktemp mv rm; do
  if ! command -v "${required_command}" >/dev/null; then
    echo "Missing required command: ${required_command}" >&2
    exit 69
  fi
done

temporary_root="${TMPDIR:-/tmp}"
working_directory="$(mktemp -d "${temporary_root%/}/evorto-latency.XXXXXX")"
cleanup() {
  rm -rf "${working_directory}"
}
trap cleanup EXIT

samples_file="${working_directory}/samples.jsonl"
: >"${samples_file}"
sample_failures=0
last_body_file=''

extract_header() {
  local header_name="$1"
  local headers_file="$2"

  awk -v header_name="${header_name}" '
    {
      line = $0
      sub(/\r$/, "", line)
      split(line, fields, ":")
      if (tolower(fields[1]) == tolower(header_name)) {
        sub(/^[^:]*:[[:space:]]*/, "", line)
        value = line
      }
    }
    END {
      if (value != "") {
        print value
      }
    }
  ' "${headers_file}"
}

probe() {
  local kind="$1"
  local sequence="$2"
  local path="$3"
  local content_validator="$4"
  local max_time_seconds="$5"
  local sample_name="${kind}-${sequence}"
  local headers_file="${working_directory}/${sample_name}.headers"
  local body_file="${working_directory}/${sample_name}.body"
  local curl_metrics
  local curl_exit_status=0
  local curl_failed='false'

  : >"${headers_file}"
  : >"${body_file}"
  curl_metrics="$(
    curl \
      --connect-timeout 5 \
      --dump-header "${headers_file}" \
      --header 'Accept-Encoding: identity' \
      --max-time "${max_time_seconds}" \
      --output "${body_file}" \
      --silent \
      --show-error \
      --user-agent 'evorto-latency-monitor/1' \
      --write-out '%{json}' \
      "${origin}${path}"
  )" || curl_exit_status=$?
  if ((curl_exit_status != 0)); then
    echo "Latency probe failed before receiving ${path}" >&2
    curl_failed='true'
  fi

  if ! jq --exit-status '
    type == "object"
      and (.http_code | type == "number")
      and (.http_version | type == "string")
      and (.num_redirects | type == "number")
      and (.time_appconnect | type == "number")
      and (.time_connect | type == "number")
      and (.time_namelookup | type == "number")
      and (.time_starttransfer | type == "number")
      and (.time_total | type == "number")
  ' <<<"${curl_metrics}" >/dev/null; then
    echo "curl did not return the expected timing JSON for ${path}" >&2
    curl_failed='true'
    curl_metrics='{"http_code":0,"http_version":"","num_redirects":0,"time_appconnect":0,"time_connect":0,"time_namelookup":0,"time_starttransfer":0,"time_total":0}'
  elif [[ "${curl_failed}" == 'true' ]]; then
    curl_metrics="$(jq --compact-output '.http_code = 0' <<<"${curl_metrics}")"
  fi

  local status_code
  status_code="$(jq --raw-output '.http_code' <<<"${curl_metrics}")"
  local content_valid='true'
  if [[ "${curl_failed}" == 'true' ]]; then
    content_valid='false'
  elif ((status_code < 200 || status_code >= 300)); then
    content_valid='false'
  else
    case "${content_validator}" in
      application)
        if ! grep --quiet '<app-root' "${body_file}"; then
          content_valid='false'
        fi
        ;;
      health)
        if ! jq --exit-status '.status == "ok"' "${body_file}" >/dev/null 2>&1; then
          content_valid='false'
        fi
        ;;
      version)
        if ! jq --exit-status '
          (.environment | type == "string")
            and (.imageDigest | type == "string")
            and (.revision | type == "string")
        ' "${body_file}" >/dev/null 2>&1; then
          content_valid='false'
        fi
        ;;
      *)
        echo "Unknown content validator: ${content_validator}" >&2
        return 1
        ;;
    esac
  fi

  if [[ "${content_valid}" != 'true' ]]; then
    sample_failures=$((sample_failures + 1))
  fi

  local upstream_service_ms
  upstream_service_ms="$(
    extract_header 'x-envoy-upstream-service-time' "${headers_file}"
  )"
  if [[ ! "${upstream_service_ms}" =~ ^[0-9]+$ ]]; then
    upstream_service_ms=''
  fi

  local request_id
  request_id="$(extract_header 'x-request-id' "${headers_file}")"

  jq --null-input --compact-output \
    --arg kind "${kind}" \
    --arg path "${path}" \
    --arg request_id "${request_id}" \
    --arg timestamp "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" \
    --arg upstream_service_ms "${upstream_service_ms}" \
    --arg vantage "${vantage}" \
    --argjson content_valid "${content_valid}" \
    --argjson curl_metrics "${curl_metrics}" \
    --argjson sequence "${sequence}" '
      def milliseconds:
        . * 1000 * 100 | round / 100;
      def non_negative:
        if . < 0 then 0 else . end;

      {
        kind: $kind,
        sequence: $sequence,
        path: $path,
        timestamp: $timestamp,
        vantage: $vantage,
        statusCode: $curl_metrics.http_code,
        httpVersion: $curl_metrics.http_version,
        redirectCount: $curl_metrics.num_redirects,
        contentValid: $content_valid,
        requestId: (
          if $request_id == "" then null else $request_id end
        ),
        upstreamServiceMs: (
          if $upstream_service_ms == ""
          then null
          else ($upstream_service_ms | tonumber)
          end
        ),
        timingMs: {
          dns: ($curl_metrics.time_namelookup | milliseconds),
          connect: (
            ($curl_metrics.time_connect - $curl_metrics.time_namelookup)
            | non_negative
            | milliseconds
          ),
          tls: (
            if $curl_metrics.time_appconnect == 0
            then 0
            else (
              ($curl_metrics.time_appconnect - $curl_metrics.time_connect)
              | non_negative
              | milliseconds
            )
            end
          ),
          ttfb: ($curl_metrics.time_starttransfer | milliseconds),
          total: ($curl_metrics.time_total | milliseconds)
        }
      }
    ' >>"${samples_file}"

  last_body_file="${body_file}"
}

# The control request may wake a scale-to-zero staging instance. Give it a
# separate availability timeout and exclude it from every latency objective.
probe 'version' 1 '/version' 'version' 60
version_body_file="${last_body_file}"
probe 'healthz' 1 '/healthz' 'health' 20
probe 'cold_eligible' 1 '/events' 'application' 20
for ((sample = 1; sample <= warm_samples; sample += 1)); do
  probe 'warm_candidate' "${sample}" '/events' 'application' 20
done

deployment_environment="$(
  jq --raw-output '.environment // "unknown"' "${version_body_file}" 2>/dev/null ||
    echo 'unknown'
)"
image_digest="$(
  jq --raw-output '.imageDigest // "unknown"' "${version_body_file}" 2>/dev/null ||
    echo 'unknown'
)"
revision="$(
  jq --raw-output '.revision // "unknown"' "${version_body_file}" 2>/dev/null ||
    echo 'unknown'
)"
workflow_url=''
if [[ -n "${GITHUB_SERVER_URL:-}" && -n "${GITHUB_REPOSITORY:-}" && -n "${GITHUB_RUN_ID:-}" ]]; then
  workflow_url="${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}"
fi

report_file="${working_directory}/report.json"
jq --slurp \
  --arg deployment_environment "${deployment_environment}" \
  --arg image_digest "${image_digest}" \
  --arg mode "${mode}" \
  --arg origin "${origin}" \
  --arg revision "${revision}" \
  --arg timestamp "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" \
  --arg vantage "${vantage}" \
  --arg workflow_url "${workflow_url}" \
  --argjson sample_failures "${sample_failures}" \
  --argjson warm_samples "${warm_samples}" '
    def percentile($values; $ratio):
      ($values | sort) as $sorted
      | if ($sorted | length) == 0
        then null
        else $sorted[
          (((($sorted | length) * $ratio) | ceil) - 1)
        ]
        end;

    def distribution($values):
      {
        p50: percentile($values; 0.5),
        p95: percentile($values; 0.95),
        max: (
          if ($values | length) == 0
          then null
          else ($values | max)
          end
        )
      };

    def classify($value; $target; $warning; $critical):
      if $value == null then "insufficient"
      elif $value > $critical then "critical"
      elif $value > $warning then "warning"
      elif $value > $target then "above_target"
      else "within_budget"
      end;

    . as $samples
    | [$samples[] | select(.kind == "warm_candidate")] as $warm
    | [$warm[].upstreamServiceMs | select(. != null)] as $upstream
    | [$warm[].timingMs.ttfb] as $ttfb
    | [$warm[].timingMs.total] as $total
    | distribution($upstream) as $upstream_distribution
    | distribution($ttfb) as $ttfb_distribution
    | distribution($total) as $total_distribution
    | classify($upstream_distribution.p95; 500; 750; 1500) as $upstream_status
    | classify($ttfb_distribution.p95; 750; 1000; 2000) as $ttfb_status
    | (
        if $sample_failures > 0 then "critical"
        elif [$upstream_status, $ttfb_status] | any(. == "critical") then "critical"
        elif [$upstream_status, $ttfb_status] | any(. == "warning") then "warning"
        elif [$upstream_status, $ttfb_status] | any(. == "above_target") then "above_target"
        elif [$upstream_status, $ttfb_status] | any(. == "insufficient") then "insufficient"
        else "within_budget"
        end
      ) as $overall_status
    | {
        schemaVersion: 1,
        generatedAt: $timestamp,
        targetOrigin: $origin,
        vantage: $vantage,
        mode: $mode,
        deployment: {
          environment: $deployment_environment,
          revision: $revision,
          imageDigest: $image_digest,
          workflowUrl: (
            if $workflow_url == ""
            then null
            else $workflow_url
            end
          )
        },
        samples: $samples,
        thresholdsMs: {
          upstreamServiceP95: {
            target: 500,
            warning: 750,
            critical: 1500
          },
          ttfbP95: {
            target: 750,
            warning: 1000,
            critical: 2000
          }
        },
        summary: {
          overallStatus: $overall_status,
          contentFailures: $sample_failures,
          warmCandidateCount: ($warm | length),
          expectedWarmCandidateCount: $warm_samples,
          upstreamServiceMs: (
            $upstream_distribution + { status: $upstream_status }
          ),
          ttfbMs: (
            $ttfb_distribution + { status: $ttfb_status }
          ),
          totalMs: $total_distribution
        }
      }
  ' "${samples_file}" >"${report_file}"

mkdir -p "$(dirname "${output}")"
mv "${report_file}" "${output}"

if [[ -n "${summary_output}" ]]; then
  mkdir -p "$(dirname "${summary_output}")"
  {
    echo '## Warm-path latency probe'
    echo
    printf -- "- Target: \`%s\`\n" "${origin}"
    printf -- "- Deployment: \`%s\` / \`%s\`\n" "${revision}" "${image_digest}"
    printf -- "- Vantage: \`%s\`\n" "${vantage}"
    printf -- "- Mode: \`%s\`\n" "${mode}"
    printf -- "- Overall status: \`%s\`\n" "$(
      jq --raw-output '.summary.overallStatus' "${output}"
    )"
    echo
    echo '| Warm-candidate signal | p50 | p95 | max | status |'
    echo '| --- | ---: | ---: | ---: | --- |'
    jq --raw-output '
      def display:
        if . == null then "n/a" else "\(.) ms" end;
      ([
          "Upstream service",
          (.summary.upstreamServiceMs.p50 | display),
          (.summary.upstreamServiceMs.p95 | display),
          (.summary.upstreamServiceMs.max | display),
          .summary.upstreamServiceMs.status
        ] | @tsv),
      ([
          "External TTFB",
          (.summary.ttfbMs.p50 | display),
          (.summary.ttfbMs.p95 | display),
          (.summary.ttfbMs.max | display),
          .summary.ttfbMs.status
        ] | @tsv),
      ([
          "External total",
          (.summary.totalMs.p50 | display),
          (.summary.totalMs.p95 | display),
          (.summary.totalMs.max | display),
          "-"
        ] | @tsv)
    ' "${output}" |
      while IFS=$'\t' read -r signal p50 p95 maximum status; do
        printf '| %s | %s | %s | %s | %s |\n' \
          "${signal}" "${p50}" "${p95}" "${maximum}" "${status}"
      done
  } >"${summary_output}"
fi

overall_status="$(jq --raw-output '.summary.overallStatus' "${output}")"
echo "Latency probe status: ${overall_status}"

if ((sample_failures > 0)); then
  echo "One or more latency samples failed status or content validation" >&2
  exit 1
fi

if [[ "${mode}" == 'enforce-critical' && "${overall_status}" == 'critical' ]]; then
  echo "Warm-path latency exceeded a critical threshold" >&2
  exit 2
fi
