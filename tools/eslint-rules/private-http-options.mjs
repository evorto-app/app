// Explicit boundary options keep Effect's raw URL logger out of production.
// This resolves local constants, not arbitrary runtime or interprocedural flow.
const methods = new Set(["serve", "toWebHandler"]);
const transparentExpressions = new Set([
  "TSAsExpression",
  "TSSatisfiesExpression",
  "TSNonNullExpression",
  "TSInstantiationExpression",
  "ChainExpression",
]);

export const privateHttpOptionsRule = {
  meta: {
    type: "problem",
    schema: [],
    docs: {
      description:
        "Require explicit private request-logging options at Effect HTTP boundaries.",
    },
    messages: {
      rawLogger:
        "Pass disableLogger: true at the HTTP boundary; request logging belongs to the sanitizing middleware.",
    },
  },
  create(context) {
    const source = context.sourceCode;
    const variable = (node) => {
      for (let scope = source.getScope(node); scope; scope = scope.upper) {
        const found = scope.set.get(node.name);
        if (found) return found;
      }
    };
    const constant = (node, visited = new Set()) => {
      if (!node || visited.has(node)) return;
      visited.add(node);
      if (transparentExpressions.has(node.type))
        return constant(node.expression, visited);
      if (node.type !== "Identifier") return node;
      for (const definition of variable(node)?.defs ?? []) {
        if (
          definition.type === "Variable" &&
          definition.parent?.kind === "const"
        )
          return constant(definition.node.init, visited);
      }
    };
    const keyName = (node) =>
      node.computed
        ? constant(node.key)?.value
        : (node.key?.name ?? node.key?.value);
    const memberName = (node) =>
      node.computed ? constant(node.property)?.value : node.property.name;
    const routerBinding = (node, visited = new Set()) => {
      if (!node || visited.has(node)) return;
      visited.add(node);
      if (transparentExpressions.has(node.type))
        return routerBinding(node.expression, visited);
      if (node.type === "Identifier") {
        for (const definition of variable(node)?.defs ?? []) {
          if (definition.type === "ImportBinding") {
            const module = definition.parent?.source.value;
            const imported =
              definition.node.imported?.name ?? definition.node.imported?.value;
            const namespace =
              definition.node.type === "ImportNamespaceSpecifier";
            if (module === "effect/unstable/http") {
              if (namespace) return "http";
              if (imported === "HttpRouter") return "router";
            }
            if (module === "effect/unstable/http/HttpRouter") {
              if (namespace) return "router";
              if (methods.has(imported)) return "boundary";
            }
          }
          if (
            definition.type === "Variable" &&
            definition.parent?.kind === "const"
          )
            return routerBinding(definition.node.init, visited);
        }
      }
      if (node.type === "MemberExpression") {
        const parent = routerBinding(node.object, visited);
        const member = memberName(node);
        if (parent === "http" && member === "HttpRouter") return "router";
        if (parent === "router" && methods.has(member)) return "boundary";
      }
    };
    const loggerOption = (input, visited = new Set()) => {
      const node = constant(input);
      if (!node || node.type !== "ObjectExpression" || visited.has(node))
        return { touched: true, value: undefined };
      visited.add(node);
      let result = { touched: false, value: undefined };
      for (const property of node.properties) {
        if (property.type === "SpreadElement") {
          const spread = loggerOption(property.argument, new Set(visited));
          if (spread.touched) result = spread;
          continue;
        }
        const key = keyName(property);
        if (key === undefined) result = { touched: true, value: undefined };
        else if (key === "disableLogger")
          result = { touched: true, value: constant(property.value)?.value };
      }
      return result;
    };
    return {
      CallExpression(node) {
        if (
          routerBinding(node.callee) === "boundary" &&
          loggerOption(node.arguments[1]).value !== true
        ) {
          context.report({ node, messageId: "rawLogger" });
        }
      },
    };
  },
};
