// Application history is append-only. This is a bounded syntax rule: it resolves
// imports and local aliases, not arbitrary interprocedural value flow or SQL.
const transparentExpressions = new Set([
  "TSAsExpression",
  "TSSatisfiesExpression",
  "TSNonNullExpression",
  "TSInstantiationExpression",
  "ChainExpression",
]);
const unwrap = (node) => {
  while (transparentExpressions.has(node?.type)) node = node.expression;
  return node;
};
const tables = new Map([
  ["registrationAcquisitions", "registration_acquisitions"],
  ["registrationAcquisitionPayments", "registration_acquisition_payments"],
  ["registrationAcquisitionComponents", "registration_acquisition_components"],
  [
    "registrationAcquisitionRefundAllocations",
    "registration_acquisition_refund_allocations",
  ],
  [
    "registrationTransferRefundPlanAcquisitionLinks",
    "registration_transfer_refund_plan_acquisition_links",
  ],
  ["platformAuditEntries", "platform_audit_entries"],
]);
const sqlIdentifier = String.raw`(?:"(?:[^"]|"")*"|[a-z_][\w$]*)`;
const sqlRelation = String.raw`(?:${sqlIdentifier}\s*\.\s*)?${sqlIdentifier}`;
const precedingTruncateTargets = String.raw`(?:(?:ONLY\s+)?${sqlRelation}(?:\s*\*)?\s*,\s*)*`;
const sqlMutation = new RegExp(
  String.raw`(?:^|[\s;(])(?:UPDATE\s+|DELETE\s+FROM\s+|TRUNCATE(?:\s+TABLE)?\s+${precedingTruncateTargets})(?:ONLY\s+)?(?:${sqlIdentifier}\s*\.\s*)?"?(${[...tables.values()].join("|")})"?(?=\s|;|,|\)|$)`,
  "iu",
);

export const financialLedgerPlugin = {
  rules: {
    "no-mutation": {
      meta: {
        type: "problem",
        schema: [],
        docs: {
          description:
            "Keep financial ledger and platform audit history append-only.",
        },
        messages: {
          mutation:
            "{{table}} is append-only. Record a new fact instead of updating or deleting history.",
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
        const propertyName = (node) =>
          node.computed ? staticString(node.property) : node.property?.name;
        const memberPath = (node) => {
          const path = [];
          while (node?.type === "MemberExpression") {
            const name = propertyName(node);
            if (typeof name !== "string") return;
            path.unshift(name);
            node = node.object;
          }
          return node?.type === "Identifier" ? { root: node, path } : undefined;
        };
        const resolve = (node, visited = new Set()) => {
          if (!node || visited.has(node)) return;
          visited.add(node);
          if (transparentExpressions.has(node.type))
            return resolve(node.expression, visited);
          if (node.type === "Identifier") {
            const binding = variable(node);
            if (!binding)
              return tables.has(node.name) || node.name === "sql"
                ? node.name
                : undefined;
            for (const definition of binding.defs) {
              if (definition.type === "ImportBinding") {
                const imported = definition.node.imported;
                const name = imported?.name ?? imported?.value;
                if (tables.has(name) || name === "sql") return name;
              }
              const resolved = resolve(definition.node.init, visited);
              if (resolved) return resolved;
            }
            for (const reference of binding.references) {
              const resolved = resolve(reference.writeExpr, visited);
              if (resolved) return resolved;
            }
          }
          if (node.type === "MemberExpression") {
            const name = propertyName(node);
            if (tables.has(name)) return name;
            const access = memberPath(node);
            if (!access) return;
            const binding = variable(access.root);
            const references = binding
              ? binding.references
              : source.getScope(access.root).through;
            for (const reference of references) {
              if (reference.identifier.name !== access.root.name) continue;
              let left = reference.identifier;
              while (
                left.parent?.type === "MemberExpression" &&
                left.parent.object === left
              )
                left = left.parent;
              const assignment = left.parent;
              if (
                assignment?.type !== "AssignmentExpression" ||
                assignment.left !== left
              )
                continue;
              const candidate = memberPath(left);
              if (
                candidate &&
                JSON.stringify(candidate.path) === JSON.stringify(access.path)
              ) {
                const resolved = resolve(assignment.right, visited);
                if (resolved) return resolved;
              }
            }
          }
        };
        // A local binding that can refer to protected history is treated
        // conservatively; this rule does not model runtime control flow.
        const insertTarget = (node, visited = new Set()) => {
          if (!node || visited.has(node)) return;
          visited.add(node);
          if (transparentExpressions.has(node.type))
            return insertTarget(node.expression, visited);
          if (node.type === "Identifier") {
            const binding = variable(node);
            if (!binding) return;
            for (const value of [
              ...binding.defs.map((definition) => definition.node.init),
              ...binding.references.map((reference) => reference.writeExpr),
            ]) {
              const table = insertTarget(value, visited);
              if (tables.has(table)) return table;
            }
          }
          if (node.type === "CallExpression") {
            const callee = unwrap(node.callee);
            if (callee.type !== "MemberExpression") return;
            return propertyName(callee) === "insert"
              ? resolve(node.arguments[0])
              : insertTarget(callee.object, visited);
          }
        };
        const staticString = (node, visited = new Set()) => {
          if (!node || visited.has(node)) return;
          const path = new Set(visited).add(node);
          if (node.type === "Literal" && typeof node.value === "string")
            return node.value;
          if (transparentExpressions.has(node.type))
            return staticString(node.expression, path);
          if (node.type === "Identifier") {
            const definition = variable(node)?.defs.find(
              (entry) =>
                entry.type === "Variable" && entry.parent.kind === "const",
            );
            return staticString(definition?.node.init, path);
          }
          if (node.type === "BinaryExpression" && node.operator === "+") {
            const left = staticString(node.left, path);
            const right = staticString(node.right, path);
            return left === undefined || right === undefined
              ? undefined
              : left + right;
          }
          if (node.type === "TemplateLiteral") {
            let text = "";
            for (let index = 0; index < node.quasis.length; index++) {
              text += node.quasis[index].value.cooked;
              if (index < node.expressions.length) {
                const value = staticString(node.expressions[index], path);
                if (value === undefined) return;
                text += value;
              }
            }
            return text;
          }
        };
        const reportSql = (node, text) => {
          const table =
            typeof text === "string"
              ? sqlMutation.exec(
                  // Ignore data literals and comments when checking static SQL syntax.
                  text.replace(
                    /'(?:''|[^'])*'|--[^\n]*|\/\*[\s\S]*?\*\//gu,
                    " ",
                  ),
                )?.[1]
              : undefined;
          if (table)
            context.report({ node, messageId: "mutation", data: { table } });
        };
        return {
          CallExpression(node) {
            const callee = unwrap(node.callee);
            if (callee.type !== "MemberExpression") return;
            const method = propertyName(callee);
            if (method === "update" || method === "delete") {
              const table = resolve(node.arguments[0]);
              if (tables.has(table))
                context.report({
                  node,
                  messageId: "mutation",
                  data: { table },
                });
            }
            if (method === "onConflictDoUpdate") {
              const table = insertTarget(callee.object);
              if (tables.has(table))
                context.report({
                  node,
                  messageId: "mutation",
                  data: { table },
                });
            }
            if (method === "raw" && resolve(callee.object) === "sql") {
              const argument = node.arguments[0];
              const text =
                argument?.type === "TemplateLiteral"
                  ? argument.quasis
                      .map(
                        (part, index) =>
                          part.value.cooked +
                          (index < argument.expressions.length
                            ? (staticString(argument.expressions[index]) ??
                              "<expression>")
                            : ""),
                      )
                      .join("")
                  : staticString(argument);
              reportSql(node, text);
            }
          },
          TaggedTemplateExpression(node) {
            if (resolve(node.tag) !== "sql") return;
            const text = node.quasi.quasis
              .map((part, index) => {
                const table = resolve(node.quasi.expressions[index]);
                return (
                  part.value.cooked +
                  (tables.get(table) ??
                    (index < node.quasi.expressions.length
                      ? "<expression>"
                      : ""))
                );
              })
              .join("");
            reportSql(node, text);
          },
        };
      },
    },
  },
};
