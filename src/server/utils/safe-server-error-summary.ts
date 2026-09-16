import { Predicate } from 'effect';

export interface SafeServerErrorSummary {
  readonly constraint?: string;
  readonly operation: string;
  readonly [key: string]: unknown;
  readonly requestId?: string;
  readonly sqlState?: string;
}

const maximumScannedReasons = 32;
const maximumTraversalDepth = 6;
const maximumTraversedObjects = 32;
const safeConstraintPattern = /^[A-Za-z_][A-Za-z0-9_$]{0,127}$/u;
const safeOperationPattern = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/u;
const safeRequestIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
const sqlStatePattern = /^[0-9A-Z]{5}$/u;

const readDataProperty = (value: object, key: string): unknown => {
  try {
    let current: null | object = value;
    while (current) {
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (descriptor) {
        const propertyValue: unknown =
          'value' in descriptor ? descriptor.value : undefined;
        return propertyValue;
      }
      current = Object.getPrototypeOf(current);
    }
  } catch {
    return undefined;
  }

  return undefined;
};

const firstSafeString = (
  value: object,
  keys: readonly string[],
  pattern: RegExp,
): string | undefined => {
  for (const key of keys) {
    const candidate = readDataProperty(value, key);
    if (typeof candidate === 'string' && pattern.test(candidate)) {
      return candidate;
    }
  }
  return undefined;
};

const safeOperation = (operation: string): string =>
  safeOperationPattern.test(operation) ? operation : 'server.operation';

export const safeServerErrorSummary = (
  operation: string,
  error: unknown,
): SafeServerErrorSummary => {
  let constraint: string | undefined;
  let requestId: string | undefined;
  let sqlState: string | undefined;

  const queue: { readonly depth: number; readonly value: object }[] = [];
  const seen = new WeakSet<object>();
  const enqueue = (value: unknown, depth: number) => {
    if (
      queue.length >= maximumTraversedObjects ||
      !Predicate.isObject(value) ||
      seen.has(value)
    ) {
      return;
    }
    seen.add(value);
    queue.push({ depth, value });
  };
  enqueue(error, 0);
  let queueIndex = 0;
  let scannedReasons = 0;

  while (
    queueIndex < queue.length &&
    (!constraint || !requestId || !sqlState)
  ) {
    const current = queue[queueIndex];
    queueIndex += 1;
    if (!current) {
      continue;
    }

    constraint ??= firstSafeString(
      current.value,
      ['constraint'],
      safeConstraintPattern,
    );
    requestId ??= firstSafeString(
      current.value,
      ['requestId', 'request_id'],
      safeRequestIdPattern,
    );
    sqlState ??= firstSafeString(
      current.value,
      ['code', 'sqlState', 'sqlstate'],
      sqlStatePattern,
    );

    const headers = readDataProperty(current.value, 'headers');
    if (!requestId && Predicate.isObject(headers)) {
      requestId = firstSafeString(
        headers,
        ['request-id', 'x-request-id'],
        safeRequestIdPattern,
      );
    }

    if (current.depth >= maximumTraversalDepth) {
      continue;
    }
    for (const key of ['cause', 'error', 'raw', 'reason']) {
      const nested = readDataProperty(current.value, key);
      enqueue(nested, current.depth + 1);
    }

    const reasons = readDataProperty(current.value, 'reasons');
    if (Array.isArray(reasons)) {
      const reasonList: readonly unknown[] = reasons;
      for (
        let index = 0;
        index < reasonList.length &&
        scannedReasons < maximumScannedReasons &&
        queue.length < maximumTraversedObjects;
        index += 1
      ) {
        scannedReasons += 1;
        enqueue(readDataProperty(reasonList, String(index)), current.depth + 1);
      }
    }
  }

  return {
    ...(constraint && { constraint }),
    operation: safeOperation(operation),
    ...(requestId && { requestId }),
    ...(sqlState && { sqlState }),
  };
};
