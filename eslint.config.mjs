import eslintPluginUnicorn from "eslint-plugin-unicorn";
import perfectionist from "eslint-plugin-perfectionist";
import eslintConfigPrettier from "eslint-config-prettier";
import unusedImports from "eslint-plugin-unused-imports";
import eslint from "@eslint/js";
import { defineConfig } from "eslint/config";
import * as tseslint from "typescript-eslint";
import * as angular from "angular-eslint";
import { effectBoundaryPlugin } from "./tools/eslint-rules/effect-boundaries.mjs";
import { financialLedgerPlugin } from "./tools/eslint-rules/financial-ledger.mjs";
import { postgresIdentifiersPlugin } from "./tools/eslint-rules/postgres-identifiers.mjs";
import * as yamlParser from "yaml-eslint-parser";
// import * as pluginQuery from "@tanstack/eslint-plugin-query";

const baseConfig = [
  eslint.configs.recommended,
  ...tseslint.configs.strict,
  ...tseslint.configs.stylistic,
  eslintPluginUnicorn.configs["flat/recommended"],
  perfectionist.configs["recommended-natural"],
  // ...pluginQuery.configs["flat/recommended"],
  eslintConfigPrettier,
];

const nodeSideFiles = ["*.config.ts", "helpers/**/*.ts", "tests/**/*.ts"];

export default defineConfig(
  {
    ignores: ["repos/**/*"],
  },
  {
    files: ["**/*.ts"],
    ignores: [...nodeSideFiles],
    extends: [baseConfig, ...angular.configs.tsRecommended],
    plugins: {
      "unused-imports": unusedImports,
    },
    processor: angular.processInlineTemplates,
    rules: {
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "unused-imports/no-unused-imports": "warn",
      "unused-imports/no-unused-vars": [
        "warn",
        {
          vars: "all",
          varsIgnorePattern: "^_",
          args: "after-used",
          argsIgnorePattern: "^_",
        },
      ],
      "@angular-eslint/directive-selector": [
        "error",
        {
          type: "attribute",
          prefix: "app",
          style: "camelCase",
        },
      ],
      "@angular-eslint/component-selector": [
        "error",
        {
          type: "element",
          prefix: "app",
          style: "kebab-case",
        },
      ],
      "@typescript-eslint/no-extraneous-class": [
        "error",
        { allowWithDecorator: true },
      ],
      // Field order can affect eager Signal Form initialization.
      "perfectionist/sort-classes": "off",
      "unicorn/single-line-block-comment-style": "off",
      "unicorn/consistent-boolean-name": "off",
      "unicorn/consistent-function-scoping": "off",
      "unicorn/consistent-class-member-order": "off",
      "unicorn/max-nested-calls": "off",
      "unicorn/no-break-in-nested-loop": "off",
      "unicorn/no-computed-property-existence-check": "off",
      "unicorn/no-declarations-before-early-exit": "off",
      "unicorn/no-null": "off",
      "unicorn/no-top-level-assignment-in-function": "off",
      "unicorn/no-unreadable-for-of-expression": "off",
      "unicorn/name-replacements": "off",
      "unicorn/prefer-array-flat-map": "off",
      "unicorn/prefer-await": "off",
      // Keep explicit guard clauses and loops instead of rewriting control flow.
      "unicorn/prefer-combined-guards": "off",
      "unicorn/no-useless-length-check": "off",
      "unicorn/prefer-set-methods": "off",
      "unicorn/prefer-continue": "off",
      "unicorn/prefer-early-return": "off",
      "unicorn/prefer-group-by": "off",
      "unicorn/prefer-logical-operator-over-ternary": "off",
      "unicorn/prefer-ternary": "off",
      "unicorn/prefer-https": "off",
      "unicorn/prefer-includes-over-repeated-comparisons": "off",
      "unicorn/prefer-iterator-helpers": "off",
      "unicorn/prefer-iterator-to-array": "off",
      "unicorn/prefer-minimal-ternary": "off",
      "unicorn/prefer-number-coercion": "off",
      "unicorn/prefer-number-is-safe-integer": "off",
      "unicorn/prefer-simple-condition-first": "off",
      "unicorn/prefer-then-catch": "off",
      "unicorn/prefer-url-href": "off",
      "unicorn/prefer-uint8array-base64": "off",
      "unicorn/require-array-sort-compare": "off",
      "unicorn/throw-new-error": "off",
    },
  },
  // Node-side repository tooling and Playwright tests share TypeScript
  // correctness rules with the application without inheriting Angular, UI
  // naming, or deterministic sort-order rules that are specific to production
  // source.
  {
    files: nodeSideFiles,
    extends: [
      eslint.configs.recommended,
      ...tseslint.configs.strict,
      eslintConfigPrettier,
    ],
    languageOptions: {
      globals: {
        process: "readonly",
      },
    },
    plugins: {
      unicorn: eslintPluginUnicorn,
    },
    rules: {
      "no-empty-pattern": ["error", { allowObjectPatternsAsParameters: true }],
      "no-unused-vars": "off",
      "@typescript-eslint/no-invalid-void-type": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          vars: "all",
          varsIgnorePattern: "^_",
          args: "after-used",
          argsIgnorePattern: "^_",
        },
      ],
      "unicorn/no-process-exit": "error",
    },
  },
  // Prevent src/ code from importing helpers (development/testing only)
  {
    files: ["src/**/*.ts"],
    ignores: ["src/db/setup-database.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@helpers/*",
                "../helpers/*",
                "../../helpers/*",
                "../../../helpers/*",
                "../../../../helpers/*",
              ],
              message:
                "Helpers are only for development and testing. Production code in src/ cannot import helpers.",
            },
            {
              group: ["helpers/*"],
              message:
                "Helpers are only for development and testing. Production code in src/ cannot import helpers.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/**/*.ts"],
    ignores: [
      "src/**/*.spec.ts",
      "src/main.server.ts",
      "src/main.ts",
      "src/server.ts",
    ],
    plugins: {
      "effect-boundaries": effectBoundaryPlugin,
    },
    rules: {
      "effect-boundaries/no-run-at-internal-boundaries": "warn",
    },
  },
  {
    files: ["src/**/*.ts"],
    ignores: ["**/*.spec.ts"],
    plugins: { "effect-boundaries": effectBoundaryPlugin },
    rules: { "effect-boundaries/private-http-options": "error" },
  },
  {
    files: ["src/server/**/*.ts", "src/db/**/*.ts"],
    ignores: ["**/*.spec.ts"],
    plugins: { "financial-ledger": financialLedgerPlugin },
    rules: { "financial-ledger/no-mutation": "error" },
  },
  {
    files: ["src/db/schema/**/*.ts"],
    ignores: ["**/*.spec.ts"],
    plugins: { "postgres-identifiers": postgresIdentifiersPlugin },
    rules: { "postgres-identifiers/explicit-name-length": "error" },
  },
  // Permission arrays need the shared evaluator for wildcard/dependency grants.
  {
    files: [
      "src/server/effect/rpc/handlers/**/*.ts",
      "src/server/http/**/*.ts",
    ],
    ignores: ["**/*.spec.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression:matches([callee.property.name='includes'], [callee.property.value='includes']):matches([callee.object.name=/^(permissions|currentPermissions)$/], [callee.object.property.name=/^(permissions|currentPermissions)$/], [callee.object.property.value=/^(permissions|currentPermissions)$/])",
          message:
            "Use the shared permission evaluator instead of array includes so wildcard and dependent permissions are respected.",
        },
      ],
    },
  },
  // Shared administrator setup verifies owner-provided authority; it cannot grant it.
  {
    files: [
      "tests/setup/authentication.setup.ts",
      "tests/support/fixtures/base-test.ts",
      "tests/support/auth0/platform-administrator-claim-fixture.ts",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression:matches([callee.property.name='update'], [callee.property.value='update']):matches([callee.object.property.name='users'], [callee.object.property.value='users'])",
          message:
            "Shared administrator setup must read Auth0 users without changing their metadata.",
        },
        {
          selector:
            "CallExpression:matches([callee.name='updateAppMetadata'], [callee.property.name='updateAppMetadata'], [callee.property.value='updateAppMetadata'])",
          message:
            "Shared administrator setup must verify the owner-provided claim without changing it.",
        },
      ],
    },
  },
  {
    files: [".github/workflows/**/*.yml", ".github/workflows/**/*.yaml"],
    languageOptions: { parser: yamlParser },
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "YAMLDocument > YAMLMapping:not(:has(> YAMLPair[key.value='permissions'])) > YAMLPair[key.value='jobs'] > YAMLMapping.value > YAMLPair > YAMLMapping.value:not(:has(> YAMLPair[key.value='permissions']))",
          message: "Declare workflow or job permissions explicitly.",
        },
        {
          selector:
            "YAMLDocument > YAMLMapping > YAMLPair[key.value='jobs'] > YAMLMapping.value > YAMLPair > YAMLMapping.value > YAMLPair[key.value='uses'] > YAMLScalar.value:not([value=/^\\.\\//]):not([value=/^\\$\\/[^@\\s]+$/]):not([value=/^[^:$][^:]*@[a-f0-9]{40}$/]):not([value=/^docker:.*@sha256:[a-f0-9]{64}$/])",
          message:
            "Pin external actions and reusable workflows to a full commit SHA, or Docker actions to an immutable image digest.",
        },
        {
          selector:
            "YAMLDocument > YAMLMapping > YAMLPair[key.value='jobs'] > YAMLMapping.value > YAMLPair > YAMLMapping.value > YAMLPair[key.value='uses'] > *.value:not(YAMLScalar)",
          message:
            "Declare action references explicitly so their immutable pin can be verified.",
        },
        {
          selector:
            "YAMLDocument > YAMLMapping > YAMLPair[key.value='jobs'] > YAMLMapping.value > YAMLPair > YAMLMapping.value > YAMLPair[key.value='steps'] > YAMLSequence.value > YAMLMapping > YAMLPair[key.value='uses'] > YAMLScalar.value:not([value=/^\\.\\//]):not([value=/^\\$\\/[^@\\s]+$/]):not([value=/^[^:$][^:]*@[a-f0-9]{40}$/]):not([value=/^docker:.*@sha256:[a-f0-9]{64}$/])",
          message:
            "Pin external actions and reusable workflows to a full commit SHA, or Docker actions to an immutable image digest.",
        },
        {
          selector:
            "YAMLDocument > YAMLMapping > YAMLPair[key.value='jobs'] > YAMLMapping.value > YAMLPair > YAMLMapping.value > YAMLPair[key.value='steps'] > YAMLSequence.value > YAMLMapping > YAMLPair[key.value='uses'] > *.value:not(YAMLScalar)",
          message:
            "Declare action references explicitly so their immutable pin can be verified.",
        },
        {
          selector:
            "YAMLDocument > YAMLMapping > YAMLPair[key.value='env'] YAMLScalar[value=/\\$\\{\\{[^}]*\\bsecrets\\b/i]",
          message:
            "Keep secrets out of workflow/job environment blocks; provide them only to the step that needs them.",
        },
        {
          selector:
            "YAMLDocument > YAMLMapping > YAMLPair[key.value='jobs'] > YAMLMapping.value > YAMLPair > YAMLMapping.value > YAMLPair[key.value='env'] YAMLScalar[value=/\\$\\{\\{[^}]*\\bsecrets\\b/i]",
          message:
            "Keep secrets out of workflow/job environment blocks; provide them only to the step that needs them.",
        },
        {
          selector:
            "YAMLDocument > YAMLMapping > YAMLPair[key.value='jobs'] > YAMLMapping.value > YAMLPair > YAMLMapping.value > YAMLPair[key.value='steps'] > YAMLSequence.value > YAMLMapping:has(YAMLPair[key.value='uses'] > YAMLScalar.value:not([value=/^\\.\\//]):not([value=/^\\$\\/[^@\\s]+$/])) YAMLScalar[value=/\\$\\{\\{[^}]*\\bsecrets\\b/i]",
          message:
            "Do not pass secrets to external action steps; scope them to the explicit run step that consumes them.",
        },
      ],
    },
  },
  // Shared browser setup must verify certificates; per-origin development
  // routing is handled explicitly by the local tenant routing fixture.
  {
    files: [
      "playwright.config.ts",
      "tests/support/utils/authenticated-test-page.ts",
      "tests/docs/**/*.doc.ts",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "Property:matches([key.name='ignoreHTTPSErrors'], [key.value='ignoreHTTPSErrors'])[value.value=true]",
          message:
            "Keep TLS certificate verification enabled in shared browser setup.",
        },
        {
          selector:
            "Property:matches([key.name='trace'], [key.value='trace']):not([value.value='off']):not([value.type='ObjectExpression'])",
          message:
            "Keep authenticated browser traces disabled to protect credentials.",
        },
        {
          selector:
            "Property:matches([key.name='trace'], [key.value='trace']) > ObjectExpression:not(:has(> Property:matches([key.name='mode'], [key.value='mode'])[value.value='off']))",
          message:
            "Keep authenticated browser traces disabled to protect credentials.",
        },
        {
          selector:
            "Property:matches([key.name='trace'], [key.value='trace']) > ObjectExpression > SpreadElement",
          message:
            "Declare trace options explicitly so traces remain disabled.",
        },
      ],
    },
  },
  // Client-side restrictions (Angular app)
  {
    files: ["src/app/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@angular/material/icon",
              importNames: ["MatIcon", "MatIconModule"],
              message: "Use Font Awesome components for application icons.",
            },
          ],
          patterns: [
            {
              group: [
                "@server/*",
                "../server/*",
                "../../server/*",
                "../../../server/*",
              ],
              message:
                "Client code cannot import server-side modules. Use shared Effect RPC contracts and the application RPC client.",
            },
            {
              group: ["express*", "@trpc/server*", "drizzle-orm*"],
              message: "Client code cannot import server-only dependencies.",
            },
            {
              group: [
                "@helpers/*",
                "../helpers/*",
                "../../helpers/*",
                "../../../helpers/*",
                "../../../../helpers/*",
              ],
              message:
                "Helpers are only for development and testing. Production code cannot import helpers.",
            },
          ],
        },
      ],
      "no-restricted-syntax": [
        "warn",
        {
          selector:
            "ImportDeclaration[source.value='@angular/forms']:has(ImportSpecifier[imported.name=/^(FormsModule|NgForm|NgModel|NgModelGroup)$/])",
          message:
            "Template forms import detected. Migrate to signal forms APIs.",
        },
      ],
    },
  },
  // Server-side restrictions
  {
    files: ["src/server/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@app/*", "../app/*", "../../app/*"],
              message: "Server code cannot import client-side Angular modules.",
            },
            {
              group: [
                "@helpers/*",
                "../helpers/*",
                "../../helpers/*",
                "../../../helpers/*",
                "../../../../helpers/*",
              ],
              message:
                "Helpers are only for development and testing. Production code cannot import helpers.",
            },
          ],
          paths: [
            {
              name: "@angular/core",
              message: "Server code cannot import Angular core modules.",
            },
            {
              name: "@angular/common",
              message: "Server code cannot import Angular common modules.",
            },
            {
              name: "@angular/forms",
              message: "Server code cannot import Angular forms modules.",
            },
            {
              name: "@angular/router",
              message: "Server code cannot import Angular router modules.",
            },
            {
              name: "@angular/material",
              message: "Server code cannot import Angular Material modules.",
            },
          ],
        },
      ],
    },
  },
  // Database layer restrictions
  {
    files: ["src/db/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@app/*", "../app/*", "../../app/*"],
              message:
                "Database layer cannot import client-side Angular modules.",
            },
            {
              group: ["@angular/*", "express*"],
              message: "Database layer should remain framework-agnostic.",
            },
            {
              group: [
                "@helpers/*",
                "../helpers/*",
                "../../helpers/*",
                "../../../helpers/*",
                "../../../../helpers/*",
              ],
              message:
                "Helpers are only for development and testing. Production code cannot import helpers.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/db/setup-database.ts"],
    rules: {
      "no-restricted-imports": "off",
    },
  },
  {
    files: ["src/main.ts"],
    rules: {
      "unicorn/prefer-top-level-await": "off",
    },
  },
  {
    files: ["**/*.html"],
    extends: [
      ...angular.configs.templateRecommended,
      ...angular.configs.templateAccessibility,
    ],
    rules: {},
  },
);
