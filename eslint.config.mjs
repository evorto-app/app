import eslintPluginUnicorn from "eslint-plugin-unicorn";
import perfectionist from "eslint-plugin-perfectionist";
import eslintConfigPrettier from "eslint-config-prettier";
import eslint from "@eslint/js";
import { defineConfig } from "eslint/config";
import * as tseslint from "typescript-eslint";
import * as angular from "angular-eslint";
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
    ignores: ["old/**/*"],
    extends: [baseConfig, ...angular.configs.tsRecommended],
    processor: angular.processInlineTemplates,
    rules: {
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
      "unicorn/no-null": "warn",
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
        {
          selector:
            "ImportDeclaration[source.value='@angular/forms']:has(ImportSpecifier[imported.name=/^(ReactiveFormsModule|FormBuilder|NonNullableFormBuilder|FormGroup|FormControl|FormArray|FormRecord|AbstractControl|Validators|FormGroupDirective|FormControlDirective|FormControlName|FormGroupName|FormArrayName|NgControl|UntypedFormBuilder|UntypedFormGroup|UntypedFormControl|UntypedFormArray)$/])",
          message:
            "Reactive forms import detected. Migrate to signal forms APIs.",
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
