# Latency Monitoring Runbook

Use this runbook to detect and diagnose warm-path latency regressions on
`staging.evorto.app` and, after production is enabled, the equivalent production
hostname. Improvement work follows
[../../LATENCY_IMPROVEMENT.md](../../LATENCY_IMPROVEMENT.md).

## Monitoring model

Use three complementary views:

1. An external synthetic measures what the user-facing endpoint actually does.
2. Application traces divide server time into SSR, context, RPC, and SQL work.
3. Native Scaleway metrics show platform status and saturation.

Scaleway's native Serverless Container metrics include container status,
instances, CPU, memory, request rate, status-code percentages, and network
traffic. The currently documented list does not include request duration, so it
cannot provide the application latency signal or breakdown required here. See
Scaleway's
[Serverless Container monitoring documentation](https://www.scaleway.com/en/docs/serverless-containers/how-to/monitor-container/).

Cockpit custom telemetry is billable. Reuse the existing trace source and
native metrics first. Add custom OTLP metrics only after confirming the
expected ingestion volume and cost.

## Provisional latency objectives

These thresholds become active after the corresponding improvement has met the
budget in `LATENCY_IMPROVEMENT.md`. Until then, collect them in report-only mode
so the known defect does not create permanent noise.

| Signal                                     | Target        | Warning                 | Critical                |
| ------------------------------------------ | ------------- | ----------------------- | ----------------------- |
| Warm-candidate `/events` upstream p95      | <= 500 ms     | > 750 ms for 3 checks   | > 1,500 ms for 2 checks |
| Warm-candidate `/events` external TTFB p95 | <= 750 ms     | > 1,000 ms for 3 checks | > 2,000 ms for 2 checks |
| `events.eventList` trace p95               | <= 350 ms     | > 500 ms for 15 min     | > 1,000 ms for 5 min    |
| Request-context trace p95                  | <= 250 ms     | > 350 ms for 15 min     | > 750 ms for 5 min      |
| Event-list-ready browser measure           | p75 <= 1.25 s | p75 > 1.5 s for 30 min  | p75 > 2.5 s for 15 min  |
| HTTP 5xx ratio                             | < 1%          | > 1% for 10 min         | > 5% for 5 min          |

Page immediately for availability failures, persistent critical latency, or a
latency increase paired with elevated errors. Send warnings to the normal
operational channel for investigation during working hours.

`Rpc.config.bootstrap` remains planned and is not emitted by the application.
Add it to the active trace objectives and dashboards only after the endpoint
described in `LATENCY_IMPROVEMENT.md` is implemented.

## External warm-path synthetic

Run the synthetic from outside Scaleway every 15 minutes. Do not poll every
minute: that would keep a scale-to-zero service warm and make the cold and warm
populations indistinguishable.

Each check must:

1. fetch `/version` and record revision and image digest;
2. fetch `/healthz` as the DB-free control;
3. fetch `/events` once and label it `cold_eligible`;
4. immediately make four more sequential `/events` requests and label them
   `warm_candidate`;
5. record HTTP status, DNS/connect/TLS/TTFB/total time,
   `X-Envoy-Upstream-Service-Time`, `X-Request-Id`, vantage region, and
   timestamp;
6. evaluate warm latency from the four-request candidate group and retain every
   sample rather than only its average;
7. alert on any request returning 5xx or invalid application content.

The platform does not expose an instance identity in the public response, so a
post-first request cannot be proven to hit the same instance. Treat the burst
as warm-candidate evidence and confirm persistent regressions with hot
application traces.

A manual equivalent is:

```bash
for sample in 1 2 3 4 5; do
  curl --silent --show-error --dump-header - --output /dev/null \
    --write-out "sample=${sample} code=%{http_code} connect=%{time_connect}s ttfb=%{time_starttransfer}s total=%{time_total}s\n" \
    https://staging.evorto.app/events
done
```

`/readyz` is an application-behavior readiness check that renders `/events`.
Use its status for availability, not as the primary latency signal: it is
deliberately untraced and its probe semantics differ from a user navigation.

The temporary implementation is
`.github/workflows/staging-latency.yml`. It runs at minutes 7, 22, 37, and 52
of every hour, calls `ops/scaleway/probe-http-latency.sh`, writes the full JSON
sample set plus a Markdown summary, and retains the workflow artifact for seven
days. It runs independently from deployment reconciliation and records the
GitHub runner class as its vantage because GitHub does not expose a stable
runner region.

Latency thresholds remain report-only while the known defect is open. A manual
workflow dispatch can enable `enforce_critical` to exercise the critical gate.
Status or application-content failures always fail the check; report-only mode
suppresses latency-threshold failure, not availability failure. Replace the
temporary workflow with a fixed-region synthetic service if one is approved.

## Deployment performance check

The post-traffic smoke section of `scaleway-staging.yml` captures a release
baseline when a deployment or non-scheduled reconciliation is checked:

1. make one cold-eligible `/events` request;
2. make 10 consecutive warm-candidate requests;
3. store per-request upstream and total timing as JSON;
4. calculate p50, p95, and maximum without discarding outliers;
5. attach revision, digest, workflow URL, and timestamp;
6. upload the JSON with the deployment evidence;
7. include the summary in the append-only deployment manifest.

The check currently runs in report-only mode and cannot trigger deployment
rollback; the preceding revision/readiness smoke remains the authoritative
deployment gate. Count seven successful deployment baselines after the latency
fix meets its budget, then change the deployment probe to `enforce-critical`
and remove its `continue-on-error`. At that point, a failed post-traffic
performance check may restore the previous image, while schema changes remain
forward-only.

## Cockpit traces

Application traces are sent to the Terraform-managed
`evorto-<environment>-traces` source. Hosted roles normally sample 10% of
complete parent-based traces for seven days.

Create a Grafana trace view filtered by:

- `service.name = evorto-server`;
- deployment environment and role;
- revision and image digest;
- normalized HTTP route or RPC method;
- span status.

Show p50, p95, and p99 duration plus request count for:

- `Server.renderSsr`;
- `Server.resolveHttpRequestContext`;
- `Server.resolveTenantContext`;
- `Server.resolveUserContext`;
- `Rpc.events.eventList`;
- `Db.events.eventList`;
- `Angular.handle`.

`Rpc.config.bootstrap` remains planned; add it to this view only after the
bootstrap endpoint and span exist.

Keep trace attributes bounded. Never group by raw user ID, tenant object,
cookie, token, email address, full URL query, RPC payload, or SQL parameter.

For a short investigation, manually dispatch `Deploy Scaleway staging` with
`full_trace_debugging` enabled. Confirm the next normal deployment restores 10%
sampling. Scaleway documents the OTLP trace endpoint and trace-source workflow
in its
[Cockpit tracing guide](https://www.scaleway.com/en/docs/cockpit/how-to/activate-push-traces/).

## Native Scaleway dashboard and alerts

Continue using the `Serverless Containers Overview` and
`Serverless Containers logs` dashboards. Correlate latency with:

- instance count and container status;
- CPU utilization;
- memory utilization;
- requests per second and concurrent traffic;
- response status-code percentage;
- network ingress and egress;
- deployment revision and restart time.

Terraform already enables the regional Cockpit alert manager, all available
preconfigured alerts, and the operational email contact. Test delivery after
any contact or alert change.

In the Grafana interface, add data-source-managed alert rules using the
Scaleway Metrics data source for the web container:

- container status is `error` for 10 seconds;
- CPU exceeds 90% for 10 minutes;
- memory exceeds 90% for 10 minutes;
- 5xx percentage exceeds the thresholds above.

Select the `Scaleway Alerting` alert manager in `fr-par` for notifications.
Do not select Grafana-managed rules or the Grafana alert manager; Cockpit
supports rules evaluated by the data source and notifications handled by
Scaleway Alerting. Follow Scaleway's
[container alert guide](https://www.scaleway.com/en/docs/serverless-containers/how-to/configure-alerts-containers)
and
[custom alert guide](https://www.scaleway.com/en/docs/cockpit/how-to/configure-alerts-for-scw-resources/).

## Optional application metrics

Add a custom Cockpit metrics source only if synthetics plus traces cannot
provide reliable alerting. Estimate and approve ingestion cost first because
custom data pushed to Cockpit is billed.

If approved, export low-cardinality histograms and counters through the
application's OpenTelemetry layer:

- `evorto_http_server_duration_ms` by normalized route, method, status class,
  environment, and role;
- `evorto_rpc_duration_ms` by RPC method and outcome;
- `evorto_request_context_duration_ms` by authenticated/anonymous and source;
- `evorto_db_pool_acquire_duration_ms` by role;
- `evorto_db_query_duration_ms` by stable query name and outcome;
- `evorto_browser_event_list_ready_ms` by environment and coarse navigation
  type;
- request and error counters matching those boundaries.

Do not label metrics with IDs, arbitrary paths, query strings, error messages,
or payload values. Export metrics through the existing layer composition, not
from individual business functions. Scaleway's supported OTLP metrics endpoint
is documented in its
[OTLP metrics guide](https://www.scaleway.com/en/docs/cockpit/how-to/send-metrics-logs-to-cockpit-with-otlp/).

## Browser performance measurement

Server timings do not show when the event list becomes usable. Add a sampled,
privacy-safe browser measure around navigation:

```text
events_navigation_start -> events_initial_list_ready
```

Also collect TTFB, FCP, LCP, and INP when available. Send only:

- metric name and duration;
- environment and app revision;
- normalized route template;
- anonymous/authenticated;
- success/error outcome.

Do not send URL queries, event names/IDs, user/tenant identifiers, form data, or
stack traces through this channel. Rate-limit and sample the endpoint, and
reuse the existing browser telemetry sanitization rules.

Start in dashboard-only mode. Enable alerts after seven representative days and
after confirming that bots, background tabs, and staging automation are
excluded.

## Triage workflow

When an alert fires:

1. Record the alert, timestamp, affected environment, and current `/version`.
2. Reproduce the external request burst and compare total time with
   `X-Envoy-Upstream-Service-Time`.
3. If total time is high but upstream time is healthy, investigate DNS, TLS,
   routing, or the external vantage.
4. If upstream time is high, find traces for the revision, route, and alert
   window.
5. Compare SSR, request-context, RPC, database acquisition, SQL, and Angular
   spans.
6. Check container CPU, memory, instances, request rate, status codes, and
   restart timing.
7. If SQL dominates, use the read-only JSON
   `EXPLAIN (ANALYZE, BUFFERS)` procedure in `LATENCY_IMPROVEMENT.md`.
8. If the regression begins at a deployment, compare the prior manifest and
   decide whether the documented image rollback is appropriate.
9. Record the cause, mitigation, evidence links, and follow-up owner.

Do not blame cold start when the post-first burst or sampled hot traces remain
slow. Do not hide a database or application regression by increasing timeouts,
retries, minimum instances, or connection-pool size without measured evidence.

## Review cadence

- After every staging deployment: review the release timing artifact.
- Weekly: review p50/p95/p99, errors, and the slowest trace groups by revision.
- Monthly: test one warning alert and one resolution notification.
- Quarterly: review sampling, retention, cardinality, and Cockpit ingestion
  cost.
- After each incident: add the missing signal or runbook step that would have
  shortened diagnosis.

Record threshold changes with the old value, new value, evidence window,
reason, approver, and effective revision.

## Incident record

```text
Alert:
Started/resolved:
Environment:
Revision and digest:
External cold-eligible/warm-candidate timings:
Request IDs:
Trace links:
Platform dashboard:
Database plan:
User-visible impact:
Cause:
Mitigation:
Follow-up owner:
```
