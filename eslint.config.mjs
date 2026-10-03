import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import sonarjs from "eslint-plugin-sonarjs";

// Sonar kuralları (SonarJS): Sonar taramasının kapsamıyla aynı dosyalarda ve
// hata düzeyinde. Lint, kapıdan (pnpm quality:gate) önce saniyeler içinde
// uyarır. Kapsam sonar-project.properties ile aynı tutulmalı.
const sonarRules = Object.fromEntries(
  Object.entries(sonarjs.configs.recommended.rules).map(([rule, setting]) => {
    const [level, ...options] = Array.isArray(setting) ? setting : [setting];
    return [
      rule,
      level === "off" || level === 0 ? "off" : ["error", ...options],
    ];
  }),
);

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // eslint-config-next itself ignores build/**; restore the maintained sources
  // (Sonar scans the whole directory, so lint it too).
  globalIgnores(["!build/", "!build/**"]),
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
  {
    // sonar.sources ve sonar.tests ile aynı dosyalar.
    files: [
      "apps/api/src/**/*.{ts,js,mjs}",
      "apps/api/tests/**/*.{ts,js,mjs}",
      "apps/api/drizzle.config.ts",
      "apps/web/{app,components,hooks,lib}/**/*.{ts,tsx,js,mjs}",
      "apps/web/{proxy,next.config}.ts",
      "apps/web/postcss.config.mjs",
      "apps/mobile/src/**/*.{ts,tsx}",
      "apps/mobile/index.ts",
      "apps/mobile/metro.config.cjs",
      "packages/*/src/**/*.{ts,tsx}",
      "scripts/**/*.{js,mjs,cjs,ts}",
      "build/**/*.ts",
      "tests/**/*.{js,mjs,ts}",
      "{next,vite,drizzle}.config.ts",
      "{eslint,postcss}.config.mjs",
    ],
    // Shadcn'den olduğu gibi kopyalanan dosyalar Sonar'da da hariç.
    ignores: [
      "apps/web/components/ui/**",
      "apps/web/hooks/use-mobile.ts",
      "apps/web/vendor/**",
    ],
    plugins: { sonarjs },
    rules: sonarRules,
  },
  // Aşağıdaki üç blok, Sonar'ın bu dosyalarda zaten raporlamadığı ya da
  // sonar-project.properties'te gerekçeyle sustuğu bulguları ESLint'te de
  // aynı yerde kapatır. Sonar kapısı bu dosyalarda sıfır sorun gösteriyor.
  {
    // sonar.issue.ignore.multicriteria.i18nPassword (S2068) ile aynı:
    // çeviri dosyalarındaki "parola" sözcüğünün çevirisi parola sanılıyor.
    files: ["packages/contracts/src/i18n/**"],
    rules: { "sonarjs/no-hardcoded-passwords": "off" },
  },
  {
    // sonar.issue.ignore.multicriteria.scriptsPath (S4036) ile aynı:
    // geliştirici betikleri docker/git/pnpm/node'u geliştiricinin PATH'iyle
    // çağırır.
    files: ["scripts/**"],
    rules: { "sonarjs/no-os-command-from-path": "off" },
  },
  {
    // Sonar güvenlik noktalarını ve karmaşıklık kuralını test kapsamında
    // (sonar.tests) raporlamaz. Testler bilerek sahte adres (loopback, özel
    // ağ), http://localhost, geçici klasör, PATH'ten komut, vm bağlamında
    // kod ve uzun sahte sunucu işleyicileri kullanır.
    files: ["apps/api/tests/**", "tests/**"],
    rules: {
      "sonarjs/no-hardcoded-ip": "off",
      "sonarjs/no-clear-text-protocols": "off",
      "sonarjs/no-os-command-from-path": "off",
      "sonarjs/code-eval": "off",
      "sonarjs/publicly-writable-directories": "off",
      "sonarjs/cognitive-complexity": "off",
    },
  },
]);

export default eslintConfig;
