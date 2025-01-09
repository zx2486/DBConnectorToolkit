import globals from "globals";

import path from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";
import pluginJs from "@eslint/js";
import pluginTs from "@typescript-eslint/eslint-plugin";
import parserTs from "@typescript-eslint/parser";

// mimic CommonJS variables -- not needed if using CommonJS
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({ baseDirectory: __dirname, recommendedConfig: pluginJs.configs.recommended });

export default [
  { languageOptions: { globals: globals.browser } },
  ...compat.extends("airbnb"),
  {
    files: ["**/*.js", "**/*.ts"],
    languageOptions: { sourceType: "commonjs", parser: parserTs },
    rules: {
      "semi": ["error", "never"],
      "no-unused-vars": ["error", { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_" }],
      /* "padding-line-between-statements": [
        "error",
        { "blankLine": "never", "prev": ["private", "readonly"], "next": "*" }
      ] */
      "lines-between-class-members": ["error", "always", { exceptAfterSingleLine: true }]
    },
    plugins: {
      "@typescript-eslint": pluginTs,
    }
  },
  {
    files: ["**/*.mjs"],
    languageOptions: { sourceType: "commonjs" }
  }
];