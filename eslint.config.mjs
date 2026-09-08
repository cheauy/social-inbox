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
    /*
     * The Expo app is a separate project with its own toolchain, and the web
     * tsconfig already excludes it for the same reason. Linting it with Next's
     * rules reports things that are correct in React Native -- require() for a
     * static asset is how Metro resolves images -- and would hide a real web
     * finding in the noise. It has its own tsc run.
     */
    "mobile/**",
  ]),
]);

export default eslintConfig;
