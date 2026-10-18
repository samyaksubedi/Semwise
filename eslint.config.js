import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/coverage/**",
      "**/next-env.d.ts",
      "**/src/generated/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // Module boundaries: other modules are imported only through their index.ts,
    // and Prisma only from repositories (and lib, scripts, tests).
    files: ["apps/api/src/modules/**/*.ts"],
    ignores: ["apps/api/src/modules/**/*.repository.ts", "apps/api/src/modules/**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/lib/prisma.js", "**/lib/qdrant.js", "**/generated/prisma/*"],
              message: "Only repositories talk to Prisma and Qdrant.",
            },
            {
              regex: String.raw`^\.\./(?!\.\.)[^/]+/(?!index\.js$).+`,
              message: "Import other modules only through their index.ts.",
            },
          ],
        },
      ],
    },
  },
  prettier,
);
