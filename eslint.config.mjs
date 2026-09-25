import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated output: the compiled API, framework builds and Expo state.
    ".api-build/**",
    "dist/**",
    "**/.next/**",
    ".vinext/**",
    ".wrangler/**",
    ".sites-runtime/**",
    "**/.expo/**",
  ]),
  {
    files: [
      "apps/web/components/ui/**/*.{ts,tsx}",
      "apps/web/hooks/use-mobile.ts",
    ],
    rules: {
      // These files are vendored verbatim from shadcn@4.17.0. Keep the
      // registry source intact while applying the stricter rules to Site code.
      "@typescript-eslint/no-unused-vars": "off",
      "react-hooks/purity": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
  {
    // The web app navigates with plain anchors and location.assign on purpose:
    // it never uses next/link, and full loads reset session and view state.
    files: ["apps/web/**/*.{ts,tsx}"],
    rules: { "@next/next/no-html-link-for-pages": "off" },
  },
  {
    // CommonJS tool configs (Metro) must use require().
    files: ["**/*.cjs"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
]);

export default eslintConfig;
