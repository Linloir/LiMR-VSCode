import { defineConfig } from 'vitest/config';

// Frozen benchmark candidates contain source copies. They are evidence, not
// additional test suites, and must not multiply work or compete for resources.
export default defineConfig({ test: { include: ['{src,webview,tests}/**/*.test.{ts,tsx,mjs}'] } });
