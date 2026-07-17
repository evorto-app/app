import * as OtelNodeSdk from '@effect/opentelemetry/NodeSdk';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import {
  BatchSpanProcessor,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
} from '@opentelemetry/sdk-trace-base';
import { Effect, Layer, Option, Redacted } from 'effect';

import { deploymentConfig } from '../config/deployment-config';
import { serverTelemetryConfig } from '../config/server-config';

export const traceSamplingRatio = (
  environment: 'local' | 'production' | 'staging',
) => (environment === 'production' ? 0.1 : 1);

export const serverTelemetryLayer = Layer.unwrap(
  Effect.gen(function* () {
    const deployment = yield* deploymentConfig;
    const { PACKAGE_VERSION } = yield* serverTelemetryConfig;
    const endpoint = Option.getOrUndefined(deployment.COCKPIT_TRACES_ENDPOINT);
    const token = Option.getOrUndefined(deployment.COCKPIT_TRACES_TOKEN);
    const resource = {
      serviceName: 'evorto-server',
      ...Option.match(PACKAGE_VERSION, {
        onNone: () => ({}),
        onSome: (serviceVersion) => ({ serviceVersion }),
      }),
      attributes: {
        'deployment.environment.name': deployment.APP_ENVIRONMENT,
        'evorto.app.image_digest': Option.getOrElse(
          deployment.APP_IMAGE_DIGEST,
          () => 'unknown',
        ),
        'evorto.app.revision': Option.getOrElse(
          deployment.APP_REVISION,
          () => 'unknown',
        ),
        'evorto.app.role': deployment.APP_ROLE,
      },
    };

    if (!endpoint || !token) {
      return OtelNodeSdk.layer(() => ({ resource }));
    }

    const exporter = new OTLPTraceExporter({
      concurrencyLimit: 2,
      headers: { 'X-Token': Redacted.value(token) },
      timeoutMillis: 10_000,
      url: endpoint.toString(),
    });

    return OtelNodeSdk.layer(() => ({
      resource,
      shutdownTimeout: 10_000,
      spanProcessor: new BatchSpanProcessor(exporter, {
        exportTimeoutMillis: 10_000,
        maxExportBatchSize: 256,
        maxQueueSize: 1024,
        scheduledDelayMillis: 5000,
      }),
      tracerConfig: {
        sampler: new ParentBasedSampler({
          root: new TraceIdRatioBasedSampler(
            traceSamplingRatio(deployment.APP_ENVIRONMENT),
          ),
        }),
      },
    }));
  }),
);
