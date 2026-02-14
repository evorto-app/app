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

const PLAYWRIGHT_TEST_CALL_MODIFIERS = new Set([
  "fail",
  "fixme",
  "only",
  "skip",
  "slow",
]);

function isPlaywrightTestCall(callee) {
  if (callee.type === "Identifier") {
    return callee.name === "test";
  }

  if (callee.type === "MemberExpression") {
    return (
      callee.object.type === "Identifier" &&
      callee.object.name === "test" &&
      callee.property.type === "Identifier" &&
      PLAYWRIGHT_TEST_CALL_MODIFIERS.has(callee.property.name)
    );
  }

  return false;
}

function getStaticTitle(firstArgument) {
  if (!firstArgument) {
    return undefined;
  }

  if (
    firstArgument.type === "Literal" &&
    typeof firstArgument.value === "string"
  ) {
    return firstArgument.value;
  }

  if (
    firstArgument.type === "TemplateLiteral" &&
    firstArgument.expressions.length === 0
  ) {
    return firstArgument.quasis[0]?.value.cooked;
  }

  return undefined;
}

function isDocTestFile(fileName) {
  const normalizedFileName = fileName.replaceAll("\\", "/");
  return (
    normalizedFileName.startsWith("tests/docs/") ||
    normalizedFileName.includes("/tests/docs/")
  );
}

const playwrightTagPlugin = {
  rules: {
    "require-test-tags": {
      meta: {
        docs: {
          description:
            "Require @track + @req/@doc tags in Playwright test titles under tests/**",
        },
        messages: {
          missingDocTag:
            "Playwright doc tests under tests/docs/** must include @doc(<id>) in the test title.",
          missingReqTag:
            "Playwright non-doc tests under tests/** must include @req(<id>) in the test title.",
          missingTrackTag:
            "Playwright tests under tests/** must include @track(<track_id>) in the test title.",
        },
        schema: [],
        type: "problem",
      },
      create(context) {
        const trackPattern = /@track\([^()]+\)/;
        const reqPattern = /@req\([^()]+\)/;
        const docPattern = /@doc\([^()]+\)/;
        const docTest = isDocTestFile(context.filename);

        return {
          CallExpression(node) {
            if (!isPlaywrightTestCall(node.callee)) {
              return;
            }

            const title = getStaticTitle(node.arguments[0]);
            if (!title) {
              return;
            }

            if (!trackPattern.test(title)) {
              context.report({ messageId: "missingTrackTag", node });
            }

            if (docTest) {
              if (!docPattern.test(title)) {
                context.report({ messageId: "missingDocTag", node });
              }
              return;
            }

            if (!reqPattern.test(title)) {
              context.report({ messageId: "missingReqTag", node });
            }
          },
        };
      },
    },
  },
};

export default defineConfig(
  {
    files: ["**/*.ts"],
    ignores: ["old/**/*", "tests/**/*"],
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
      "unicorn/no-null": "off",
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
