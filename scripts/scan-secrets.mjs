import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
const ignored = new Set([
  'node_modules',
  '.git',
  '.data',
  'dist',
  'coverage',
  '.modern-js',
  'test-results',
]);
const issues = [];
async function scan(dir) {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    if (ignored.has(item.name) || item.isSymbolicLink()) continue;
    const path = join(dir, item.name);
    if (item.isDirectory()) await scan(path);
    else {
      if (item.name.startsWith('.env') && item.name !== '.env.example') {
        issues.push(`${relative('.', path)}: local environment file must stay untracked`);
        continue;
      }
      if (!/\.(ts|tsx|js|mjs|json|md|yml|yaml|example)$/.test(item.name)) continue;
      const text = await readFile(path, 'utf8');
      const patterns = [
        /(?:sk-|tvly-)[a-zA-Z0-9_-]{20,}/g,
        /(?:API_KEY|apiKey|password)\s*[:=]\s*['"][a-zA-Z0-9_\-]{24,}['"]/g,
        /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
      ];
      for (const pattern of patterns)
        if (pattern.test(text)) issues.push(`${relative('.', path)}: possible embedded secret`);
    }
  }
}
await scan('.');
if (issues.length) {
  console.error(issues.join('\n'));
  process.exitCode = 1;
} else
  console.log(
    'Source scan passed: no matching credential patterns. This is a heuristic, not a substitute for review.',
  );
