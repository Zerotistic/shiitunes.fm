/* Flat ESLint config (self-contained: no plugin packages required).
 * Run with: npx eslint js tests */

const browserGlobals = Object.fromEntries(
  [
    "window", "document", "navigator", "location", "history", "localStorage",
    "fetch", "URL", "URLSearchParams", "CSS", "Intl", "MediaMetadata",
    "Element", "Image", "performance", "TextEncoder", "TextDecoder", "btoa", "atob",
    "setTimeout", "clearTimeout", "setInterval", "clearInterval",
    "requestAnimationFrame", "console", "YT"
  ].map((name) => [name, "readonly"])
);

export default [
  {
    files: ["js/**/*.js", "tests/**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: browserGlobals
    },
    rules: {
      "no-undef": "error",
      "no-unused-vars": ["warn", { args: "after-used" }],
      "no-var": "error",
      "prefer-const": "warn",
      "eqeqeq": ["error", "smart"],
      "no-implicit-globals": "error"
    }
  }
];
