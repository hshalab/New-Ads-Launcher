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
    // Agent git worktrees live here (see `git worktree list`) — each one is a full
    // second copy of the app, `launch/page.tsx` included. Flat config does not skip
    // dot-directories, so without this ESLint type-checks every copy and exhausts
    // the V8 heap before it reports a single finding.
    ".claude/**",
  ]),
]);

export default eslintConfig;
