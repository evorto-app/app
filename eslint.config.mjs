import eslintPluginUnicorn from "eslint-plugin-unicorn";
import perfectionist from "eslint-plugin-perfectionist";
import eslintConfigPrettier from "eslint-config-prettier";
import eslint from "@eslint/js";
import * as tseslint from "typescript-eslint";
import * as angular from "angular-eslint";
// import * as pluginQuery from "@tanstack/eslint-plugin-query";

const baseConfig = tseslint.config(
  eslint.configs.recommended,
  tseslint.configs.strict,
  tseslint.configs.stylistic,
  eslintPluginUnicorn.configs["flat/recommended"],
  perfectionist.configs["recommended-natural"],
  // ...pluginQuery.configs["flat/recommended"],
  eslintConfigPrettier,
);

export default tseslint.config(
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
