import eslintPluginUnicorn from "eslint-plugin-unicorn";
import perfectionist from "eslint-plugin-perfectionist";
import eslintConfigPrettier from "eslint-config-prettier";
import unusedImports from "eslint-plugin-unused-imports";
import eslint from "@eslint/js";
import { defineConfig } from "eslint/config";
import * as tseslint from "typescript-eslint";
import * as angular from "angular-eslint";
import { effectBoundaryPlugin } from "./tools/eslint-rules/effect-boundaries.mjs";
import { playwrightTagPlugin } from "./tools/eslint-rules/playwright-tags.mjs";
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

export default defineConfig(
  {
    files: ["**/*.ts"],
    ignores: ["old/**/*", "tests/**/*"],
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
      "unicorn/consistent-function-scoping": "off",
      "unicorn/no-null": "off",
      "unicorn/throw-new-error": "off",
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
  // Client-side restrictions (Angular app)
  {
    files: ["src/app/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@server/*",
                "../server/*",
                "../../server/*",
                "../../../server/*",
              ],
              message:
                "Client code cannot import server-side modules. Use tRPC client instead.",
              allowImportNames: ["AppRouter"],
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
  {
    files: ["tests/**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
    },
    plugins: {
      "playwright-tags": playwrightTagPlugin,
    },
    rules: {
      "playwright-tags/require-test-tags": "error",
    },
  },
);
