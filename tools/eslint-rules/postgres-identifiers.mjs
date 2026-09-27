// Catch explicit PostgreSQL names at declaration sites, before PostgreSQL can
// silently truncate them. Resolve local constant strings, not arbitrary code.
const transparentExpressions = new Set([
  "TSAsExpression",
  "TSSatisfiesExpression",
  "TSNonNullExpression",
  "TSInstantiationExpression",
  "ChainExpression",
]);
const namedFactories = new Set([
  "pgTable",
  "pgEnum",
  "pgView",
  "pgMaterializedView",
  "pgSchema",
  "pgSequence",
  "pgRole",
  "pgPolicy",
  "check",
  "index",
  "uniqueIndex",
  "unique",
  "primaryKey",
  "foreignKey",
  "bigint",
  "bigserial",
  "boolean",
  "char",
  "date",
  "doublePrecision",
  "integer",
  "interval",
  "json",
  "jsonb",
  "numeric",
  "real",
  "serial",
  "smallint",
  "smallserial",
  "text",
  "time",
  "timestamp",
  "uuid",
  "varchar",
]);

export const postgresIdentifiersPlugin = {
  rules: {
    "explicit-name-length": {
      meta: {
        type: "problem",
        schema: [],
        docs: {
          description:
            "Keep explicit PostgreSQL identifiers within 63 UTF-8 bytes.",
        },
        messages: {
          tooLong:
            "PostgreSQL truncates identifiers above 63 UTF-8 bytes; this name uses {{bytes}}. Shorten the declared name.",
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
        const schemaFactories = new Map([
          ["table", "pgTable"],
          ["view", "pgView"],
          ["materializedView", "pgMaterializedView"],
          ["enum", "pgEnum"],
          ["sequence", "pgSequence"],
        ]);
        const memberName = (node) =>
          node.computed ? stringValue(node.property) : node.property.name;
        const factoryName = (node, visited = new Set()) => {
          if (!node || visited.has(node)) return;
          visited.add(node);
          if (transparentExpressions.has(node.type))
            return factoryName(node.expression, visited);
          if (node.type === "Identifier") {
            for (const definition of variable(node)?.defs ?? []) {
              if (
                definition.type === "ImportBinding" &&
                definition.parent?.source.value === "drizzle-orm/pg-core"
              ) {
                if (definition.node.type === "ImportNamespaceSpecifier")
                  return "pg-namespace";
                return (
                  definition.node.imported?.name ??
                  definition.node.imported?.value
                );
              }
              if (
                definition.type === "Variable" &&
                definition.parent?.kind === "const" &&
                definition.node.id.type === "Identifier"
              )
                return factoryName(definition.node.init, visited);
            }
          }
          if (node.type === "MemberExpression") {
            const owner = factoryName(node.object, visited);
            const member = memberName(node);
            if (owner === "pg-namespace") return member;
            if (owner === "pg-schema") return schemaFactories.get(member);
            if (owner === "pgTable" && member === "withRLS") return "pgTable";
            // Builder chains keep their Drizzle origin. A column's unique(name)
            // declares a PostgreSQL constraint just like top-level unique(name).
            if (owner === "pg-builder")
              return member === "unique" ? "unique" : "pg-builder";
          }
          if (node.type === "CallExpression") {
            if (factoryName(node.callee, new Set(visited)) === "pgSchema")
              return "pg-schema";
            if (
              node.callee.type === "MemberExpression" &&
              memberName(node.callee) === "existing" &&
              factoryName(node.callee.object, new Set(visited)) === "pg-schema"
            )
              return "pg-schema";
            const factory = factoryName(node.callee, new Set(visited));
            if (
              factory &&
              factory !== "pg-namespace" &&
              factory !== "pg-schema"
            )
              return "pg-builder";
          }
        };
        const stringValue = (node, visited = new Set()) => {
          if (!node || visited.has(node)) return;
          visited.add(node);
          if (node.type === "Literal" && typeof node.value === "string")
            return node.value;
          if (node.type === "TemplateLiteral" && node.expressions.length === 0)
            return node.quasis[0].value.cooked;
          if (transparentExpressions.has(node.type))
            return stringValue(node.expression, visited);
          if (node.type === "Identifier") {
            for (const definition of variable(node)?.defs ?? []) {
              if (
                definition.type === "Variable" &&
                definition.parent?.kind === "const"
              )
                return stringValue(definition.node.init, visited);
            }
          }
          if (node.type === "BinaryExpression" && node.operator === "+") {
            const left = stringValue(node.left, new Set(visited));
            const right = stringValue(node.right, new Set(visited));
            if (typeof left === "string" && typeof right === "string")
              return left + right;
          }
        };
        return {
          CallExpression(node) {
            const factory = factoryName(node.callee);
            if (!namedFactories.has(factory)) return;
            let name = node.arguments[0];
            if (
              name?.type === "ObjectExpression" &&
              ["primaryKey", "foreignKey"].includes(factory)
            ) {
              name = name.properties.find(
                (property) =>
                  property.type === "Property" &&
                  (property.computed
                    ? stringValue(property.key)
                    : (property.key.name ?? property.key.value)) === "name",
              )?.value;
            }
            const value = stringValue(name);
            if (typeof value !== "string") return;
            const bytes = new TextEncoder().encode(value).byteLength;
            if (bytes > 63)
              context.report({
                node: name,
                messageId: "tooLong",
                data: { bytes },
              });
          },
        };
      },
    },
  },
};
