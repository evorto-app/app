export interface SafeServerErrorSummary {
  readonly constraint?: string;
  readonly operation: string;
  readonly [key: string]: unknown;
  readonly requestId?: string;
  readonly sqlState?: string;
}

const maximumTraversalDepth = 6;
const maximumTraversedObjects = 32;
const safeConstraintPattern = /^[A-Za-z_][A-Za-z0-9_$]{0,127}$/u;
const safeOperationPattern = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/u;
const safeRequestIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
const sqlStatePattern = /^[0-9A-Z]{5}$/u;

const isObject = (value: unknown): value is object =>
  typeof value === 'object' && value !== null;

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
  if (isObject(error)) {
    queue.push({ depth: 0, value: error });
  }
  const visited = new WeakSet<object>();
  let visitedCount = 0;

  while (
    queue.length > 0 &&
    visitedCount < maximumTraversedObjects &&
    (!constraint || !requestId || !sqlState)
  ) {
    const current = queue.shift();
    if (!current || visited.has(current.value)) {
      continue;
    }
    visited.add(current.value);
    visitedCount += 1;

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
    if (!requestId && isObject(headers)) {
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
      if (isObject(nested)) {
        queue.push({ depth: current.depth + 1, value: nested });
      }
    }

    const reasons = readDataProperty(current.value, 'reasons');
    if (Array.isArray(reasons)) {
      const reasonList: readonly unknown[] = reasons;
      for (const reason of reasonList) {
        if (isObject(reason)) {
          queue.push({ depth: current.depth + 1, value: reason });
        }
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
