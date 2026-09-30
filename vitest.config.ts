import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const p = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

// Die Aliase zeigen auf die QUELLEN, nicht auf gebaute Bundles. Ein Testlauf,
// der erst einen Build braucht, wird seltener ausgefuehrt — und ein Test, der
// selten laeuft, ist keiner.
export default defineConfig({
  resolve: {
    alias: {
      '@vp/core-ids': p('./packages/core-ids/src/index.ts'),
      '@vp/errors': p('./packages/errors/src/index.ts'),
      '@vp/registry': p('./packages/registry/src/index.ts'),
      '@vp/compute': p('./packages/compute/src/index.ts'),
      '@vp/feeds': p('./packages/feeds/src/index.ts'),
      '@vp/trading': p('./packages/trading/src/index.ts'),
      '@vp/trace': p('./packages/trace/src/index.ts'),
      '@vp/machine': p('./packages/machine/src/index.ts'),
      '@vp/sim': p('./packages/sim/src/index.ts'),
      '@vp/chart-adapter': p('./packages/chart-adapter/src/index.ts'),
      '@vp/chart-bindung': p('./packages/chart-bindung/src/index.ts'),
      '@vp/mcp': p('./packages/mcp/src/index.ts'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts', 'packages/*/tests/**/*.test.ts'],
    environment: 'node',
  },
});
