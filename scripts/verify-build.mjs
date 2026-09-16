import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import assert from 'node:assert/strict';

// Modern.js 2 compiles its server using the project tsconfig. A global noEmit
// can yield a successful web build with no server files. Check the actual output.
for (const file of [
  'dist/server/modern.server.js',
  'dist/server/core/api.js',
  'dist/server/core/graph.js',
  'dist/server/core/provider.js',
  'dist/server/core/store.js',
  'dist/shared/contracts.js',
  'dist/shared/sse.js',
])
  assert.ok(existsSync(file), `Missing production artifact: ${file}`);
const require = createRequire(import.meta.url);
const config = require('../dist/server/modern.server.js').default;
assert.ok(
  config.middlewares.some((m) => m.name === 'coach-api'),
  'Production API middleware missing',
);
let files = 0;
function inspect(dir) {
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, item.name);
    if (item.isDirectory()) inspect(path);
    else if (item.name.endsWith('.js')) {
      files++;
      const text = readFileSync(path, 'utf8');
      for (const forbidden of ['LLM_API_KEY', 'TAVILY_API_KEY', 'node:sqlite'])
        assert.ok(
          !text.includes(forbidden),
          `Server-only marker found in client bundle: ${forbidden}`,
        );
    }
  }
}
inspect('dist/static');
console.log(
  `Production artifacts verified; ${files} browser bundles contain no server-only markers.`,
);
