import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // eslint-config-next itself ignores build/**; restore the maintained plugin.
  globalIgnores(["!build/", "!build/sites-vite-plugin.ts"]),
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    // build/sites-vite-plugin.ts is maintained source, not generated output.
    "build/Release/**",
    "next-env.d.ts",
    // Generated output: the compiled API, framework builds and Expo state.
    "**/.api-build/**",
    // Alternate checkouts are linted in their own workspace.
    ".claude/worktrees/**",
    // Kod kalitesi analiz çıktıları (pnpm quality:sonar, pnpm quality:dup).
    "reports/**",
    ".scannerwork/**",
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
    // The web app intentionally uses anchors/location.assign to reset session
    // and view state. This Next-only rule also searches for a root pages/
    // directory in API, mobile and scripts, where it is inapplicable.
    rules: { "@next/next/no-html-link-for-pages": "off" },
  },
  {
    // CommonJS tool configs (Metro) must use require().
    files: ["**/*.cjs"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
]);

export default eslintConfig;
