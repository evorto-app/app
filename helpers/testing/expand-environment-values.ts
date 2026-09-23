// File references expand recursively; caller and generated values stay opaque.
export const expandEnvironmentValues = (
  values: Readonly<Record<string, string>>,
  opaqueKeys: ReadonlySet<string>,
) => {
  const cache = new Map<string, string>();
  const resolving: string[] = [];

  function resolve(name: string): string {
    if (!Object.hasOwn(values, name)) return '';
    const value = values[name];
    if (value === undefined) return '';
    if (opaqueKeys.has(name)) return value;
    const cached = cache.get(name);
    if (cached !== undefined) return cached;
    const cycleStart = resolving.indexOf(name);
    if (cycleStart !== -1) {
      throw new Error(
        `Environment reference cycle: ${[...resolving.slice(cycleStart), name].join(' -> ')}`,
      );
    }
    resolving.push(name);
    try {
      const result = expand(value);
      cache.set(name, result);
      return result;
    } finally {
      resolving.pop();
    }
  }

  function expressionValue(expression: string): string | undefined {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)(?:(:-|-|:\+|\+)([\s\S]*))?$/u.exec(
      expression,
    );
    const name = match?.[1];
    if (name === undefined) return undefined;
    const operator = match?.[2];
    const operand = match?.[3] ?? '';
    const present = Object.hasOwn(values, name);
    switch (operator) {
      case undefined:
        return resolve(name);
      case '-':
        return present ? resolve(name) : expand(operand);
      case ':-': {
        const value = resolve(name);
        return value === '' ? expand(operand) : value;
      }
      case '+':
        return present ? expand(operand) : '';
      case ':+':
        return present && resolve(name) !== '' ? expand(operand) : '';
      default:
        return undefined;
    }
  }

  function closingBrace(value: string, start: number): number {
    let depth = 1;
    for (let index = start; index < value.length; index += 1) {
      const character = value.charAt(index);
      if (character === '{') depth += 1;
      else if (character === '}') {
        depth -= 1;
        if (depth === 0) return index;
      }
    }
    return -1;
  }

  function expand(value: string): string {
    const parts: string[] = [];
    let index = 0;
    while (index < value.length) {
      const character = value.charAt(index);
      if (character === '\\' && value.charAt(index + 1) === '$') {
        parts.push('$');
        index += 2;
      } else if (character === '$' && value.charAt(index + 1) === '{') {
        const end = closingBrace(value, index + 2);
        if (end === -1) {
          parts.push(value.slice(index));
          break;
        }
        const expression = value.slice(index + 2, end);
        parts.push(expressionValue(expression) ?? value.slice(index, end + 1));
        index = end + 1;
      } else if (character === '$') {
        const name = /^[A-Za-z_][A-Za-z0-9_]*/u.exec(
          value.slice(index + 1),
        )?.[0];
        parts.push(name === undefined ? '$' : resolve(name));
        index += name === undefined ? 1 : name.length + 1;
      } else {
        parts.push(character);
        index += 1;
      }
    }
    return parts.join('');
  }

  const result = new Map<string, string>();
  for (const name of Object.keys(values)) result.set(name, resolve(name));
  return Object.fromEntries(result);
};
