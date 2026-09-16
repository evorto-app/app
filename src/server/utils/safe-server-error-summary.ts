import { Predicate } from 'effect';

export interface SafeServerErrorSummary {
  readonly constraint?: string;
  readonly operation: string;
  readonly [key: string]: unknown;
  readonly requestId?: string;
  readonly sqlState?: string;
}

const maximumPrototypeDepth = 32;
const maximumScannedReasons = 32;
const maximumTraversalDepth = 6;
const maximumTraversedObjects = 32;
const safeConstraintPattern = /^[A-Za-z_][A-Za-z0-9_$]{0,127}$/u;
const safeOperationPattern = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/u;
const safeRequestIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
const sqlStatePattern = /^[0-9A-Z]{5}$/u;

const isInspectableObject = (value: unknown): value is object => {
  try {
    return Predicate.isObject(value);
  } catch {
    return false;
  }
};

const isInspectableArray = (value: unknown): value is readonly unknown[] => {
  try {
    return Array.isArray(value);
  } catch {
    return false;
  }
};

const readDataProperty = (value: object, key: string): unknown => {
  try {
    let current: null | object = value;
    const seenPrototypes = new WeakSet<object>();
    for (let depth = 0; current && depth < maximumPrototypeDepth; depth += 1) {
      if (seenPrototypes.has(current)) return undefined;
      seenPrototypes.add(current);
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
      !isInspectableObject(value) ||
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
    if (!requestId && isInspectableObject(headers)) {
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
    if (isInspectableArray(reasons)) {
      const length = readDataProperty(reasons, 'length');
      if (
        typeof length !== 'number' ||
        !Number.isSafeInteger(length) ||
        length < 0
      ) {
        continue;
      }
      const reasonCount = Math.min(
        length,
        maximumScannedReasons - scannedReasons,
      );
      for (
        let index = 0;
        index < reasonCount && queue.length < maximumTraversedObjects;
        index += 1
      ) {
        scannedReasons += 1;
        enqueue(readDataProperty(reasons, String(index)), current.depth + 1);
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
