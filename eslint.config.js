// @ts-check
const eslintPluginUnicorn = require("eslint-plugin-unicorn");
const perfectionist = require("eslint-plugin-perfectionist");
const eslintConfigPrettier = require("eslint-config-prettier");
const eslint = require("@eslint/js");
const tseslint = require("typescript-eslint");
const angular = require("angular-eslint");
// const pluginQuery = require("@tanstack/eslint-plugin-query");

const baseConfig = tseslint.config(
  eslint.configs.recommended,
  tseslint.configs.strict,
  tseslint.configs.stylistic,
  eslintPluginUnicorn.configs["flat/recommended"],
  perfectionist.configs["recommended-natural"],
  // ...pluginQuery.configs["flat/recommended"],
  eslintConfigPrettier,
);

module.exports = tseslint.config(
  {
    files: ["**/*.ts"],
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
      "unicorn/consistent-function-scoping": "off",
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
