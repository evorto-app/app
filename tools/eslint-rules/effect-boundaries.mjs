/*
 * This plugin keeps Effect runtime execution at explicit program boundaries.
 *
 * Why this exists:
 * - `Effect.run*`, `Runtime.run*`, and `ManagedRuntime` instance `run*`
 *   methods execute an Effect immediately. The Effect docs describe these as
 *   boundary-only helpers that belong at entrypoints, tests, scripts, or
 *   narrow interop seams.
 * - Internal application modules should stay in pure Effect composition so
 *   dependency wiring, interruption, logging, and runtime ownership remain
 *   centralized.
 *
 * What this rule detects:
 * - Namespace calls such as `Effect.runPromise(...)` and `Runtime.runSync(...)`.
 * - Directly imported helpers such as `runPromise(...)` from `effect`.
 * - Calls on locals initialized from `ManagedRuntime.make(...)`, for example
 *   `managedRuntime.runPromise(...)`.
 * - Chained expressions such as `ManagedRuntime.make(...).runFork(...)`.
 *
 * Scope note:
 * - Detection is intentionally syntactic. It catches the common and useful
 *   patterns without trying to prove full value flow through the program.
 * - Entrypoints and specs are excluded by the flat config, not by the rule.
 */

const EFFECT_BOUNDARY_METHODS = new Set([
  "runCallback",
  "runFork",
  "runPromise",
  "runPromiseExit",
  "runSync",
  "runSyncExit",
]);
const EFFECT_MODULE_SOURCES = new Set(["effect", "effect/Effect"]);
const MANAGED_RUNTIME_BOUNDARY_METHODS = new Set([
  "runCallback",
  "runFork",
  "runPromise",
  "runPromiseExit",
  "runSync",
  "runSyncExit",
]);
const MANAGED_RUNTIME_MODULE_SOURCES = new Set([
  "effect",
  "effect/ManagedRuntime",
]);
const RUNTIME_MODULE_SOURCES = new Set(["effect", "effect/Runtime"]);

function getImportName(specifier) {
  if (specifier.type === "ImportSpecifier") {
    return specifier.imported.type === "Identifier"
      ? specifier.imported.name
      : specifier.imported.value;
  }

  return undefined;
}

function getMemberExpressionPropertyName(memberExpression) {
  if (
    memberExpression.computed ||
    memberExpression.property.type !== "Identifier"
  ) {
    return undefined;
  }

  return memberExpression.property.name;
}

function isManagedRuntimeMakeCall(node, managedRuntimeNamespaces) {
  return (
    node?.type === "CallExpression" &&
    node.callee.type === "MemberExpression" &&
    node.callee.object.type === "Identifier" &&
    managedRuntimeNamespaces.has(node.callee.object.name) &&
    getMemberExpressionPropertyName(node.callee) === "make"
  );
}

export const effectBoundaryPlugin = {
  rules: {
    "no-run-at-internal-boundaries": {
      meta: {
        docs: {
          description:
            "Disallow boundary-only Effect run* helpers in internal application code.",
        },
        messages: {
          boundaryOnly:
            "Effect runtime helper '{{name}}' is boundary-only. Keep this code as pure Effect composition and invoke it from an entrypoint, test, script, or explicit interop boundary via BunRuntime.runMain / NodeRuntime.runMain / BrowserRuntime.runMain.",
        },
        schema: [],
        type: "problem",
      },
      create(context) {
        const directBoundaryFunctionBindings = new Map();
        const effectNamespaces = new Set();
        const managedRuntimeInstanceBindings = new Set();
        const managedRuntimeNamespaces = new Set();
        const runtimeNamespaces = new Set();

        const reportBoundaryCall = (node, name) => {
          context.report({
            data: { name },
            messageId: "boundaryOnly",
            node,
          });
        };

        return {
          AssignmentExpression(node) {
            if (
              node.operator === "=" &&
              node.left.type === "Identifier" &&
              isManagedRuntimeMakeCall(node.right, managedRuntimeNamespaces)
            ) {
              managedRuntimeInstanceBindings.add(node.left.name);
            }
          },
          CallExpression(node) {
            if (node.callee.type === "Identifier") {
              const boundaryFunctionName = directBoundaryFunctionBindings.get(
                node.callee.name,
              );

              if (boundaryFunctionName) {
                reportBoundaryCall(node, boundaryFunctionName);
              }

              return;
            }

            if (node.callee.type !== "MemberExpression") {
              return;
            }

            const propertyName = getMemberExpressionPropertyName(node.callee);
            if (!propertyName) {
              return;
            }

            if (
              node.callee.object.type === "Identifier" &&
              effectNamespaces.has(node.callee.object.name) &&
              EFFECT_BOUNDARY_METHODS.has(propertyName)
            ) {
              reportBoundaryCall(
                node,
                `${node.callee.object.name}.${propertyName}`,
              );
              return;
            }

            if (
              node.callee.object.type === "Identifier" &&
              runtimeNamespaces.has(node.callee.object.name) &&
              EFFECT_BOUNDARY_METHODS.has(propertyName)
            ) {
              reportBoundaryCall(
                node,
                `${node.callee.object.name}.${propertyName}`,
              );
              return;
            }

            if (
              node.callee.object.type === "Identifier" &&
              managedRuntimeInstanceBindings.has(node.callee.object.name) &&
              MANAGED_RUNTIME_BOUNDARY_METHODS.has(propertyName)
            ) {
              reportBoundaryCall(
                node,
                `${node.callee.object.name}.${propertyName}`,
              );
              return;
            }

            if (
              isManagedRuntimeMakeCall(
                node.callee.object,
                managedRuntimeNamespaces,
              ) &&
              MANAGED_RUNTIME_BOUNDARY_METHODS.has(propertyName)
            ) {
              reportBoundaryCall(
                node,
                `ManagedRuntime.make(...).${propertyName}`,
              );
            }
          },
          ImportDeclaration(node) {
            if (EFFECT_MODULE_SOURCES.has(node.source.value)) {
              for (const specifier of node.specifiers) {
                if (specifier.type === "ImportNamespaceSpecifier") {
                  effectNamespaces.add(specifier.local.name);
                  continue;
                }

                const importName = getImportName(specifier);
                if (!importName) {
                  continue;
                }

                if (importName === "Effect") {
                  effectNamespaces.add(specifier.local.name);
                }

                if (EFFECT_BOUNDARY_METHODS.has(importName)) {
                  directBoundaryFunctionBindings.set(
                    specifier.local.name,
                    importName,
                  );
                }
              }
            }

            if (RUNTIME_MODULE_SOURCES.has(node.source.value)) {
              for (const specifier of node.specifiers) {
                if (specifier.type === "ImportNamespaceSpecifier") {
                  runtimeNamespaces.add(specifier.local.name);
                  continue;
                }

                const importName = getImportName(specifier);
                if (!importName) {
                  continue;
                }

                if (importName === "Runtime") {
                  runtimeNamespaces.add(specifier.local.name);
                }

                if (EFFECT_BOUNDARY_METHODS.has(importName)) {
                  directBoundaryFunctionBindings.set(
                    specifier.local.name,
                    importName,
                  );
                }
              }
            }

            if (MANAGED_RUNTIME_MODULE_SOURCES.has(node.source.value)) {
              for (const specifier of node.specifiers) {
                if (specifier.type === "ImportNamespaceSpecifier") {
                  managedRuntimeNamespaces.add(specifier.local.name);
                  continue;
                }

                const importName = getImportName(specifier);
                if (!importName) {
                  continue;
                }

                if (importName === "ManagedRuntime") {
                  managedRuntimeNamespaces.add(specifier.local.name);
                }
              }
            }
          },
          VariableDeclarator(node) {
            if (
              node.id.type === "Identifier" &&
              isManagedRuntimeMakeCall(node.init, managedRuntimeNamespaces)
            ) {
              managedRuntimeInstanceBindings.add(node.id.name);
            }
          },
        };
      },
    },
  },
};
