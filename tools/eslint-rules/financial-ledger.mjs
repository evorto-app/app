// Application history is append-only. This is a bounded syntax rule: it resolves
// imports and local aliases, not arbitrary interprocedural value flow or SQL.
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
const sqlMutation = new RegExp(
  `^\\s*(?:UPDATE|DELETE\\s+FROM)\\s+(?:ONLY\\s+)?(?:(?:"[^" ]+"|[a-z_][\\w$]*)\\s*\\.\\s*)?"?(${[...tables.values()].join("|")})"?(?=\\s|;|$)`,
  "iu",
);
const propertyName = (node) =>
  node.computed ? node.property?.value : node.property?.name;
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
        const resolve = (node, visited = new Set()) => {
          if (!node || visited.has(node)) return;
          visited.add(node);
          if (
            node.type === "TSAsExpression" ||
            node.type === "TSSatisfiesExpression"
          )
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
        const reportSql = (node, text) => {
          const table =
            typeof text === "string" ? sqlMutation.exec(text)?.[1] : undefined;
          if (table)
            context.report({ node, messageId: "mutation", data: { table } });
        };
        return {
          CallExpression(node) {
            const callee = node.callee;
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
            if (method === "raw" && resolve(callee.object) === "sql")
              reportSql(node, node.arguments[0]?.value);
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
