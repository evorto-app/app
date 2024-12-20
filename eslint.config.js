// @ts-check
const eslintPluginUnicorn = require("eslint-plugin-unicorn");
const perfectionist = require("eslint-plugin-perfectionist");
const eslintConfigPrettier = require("eslint-config-prettier");
const eslint = require("@eslint/js");
const tseslint = require("typescript-eslint");
const angular = require("angular-eslint");

const baseConfig = tseslint.config(
  eslint.configs.recommended,
  tseslint.configs.strict,
  tseslint.configs.stylistic,
  eslintPluginUnicorn.configs["flat/recommended"],
  perfectionist.configs["recommended-natural"],
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
