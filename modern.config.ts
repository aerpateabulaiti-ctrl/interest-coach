import { appTools, defineConfig } from '@modern-js/app-tools';
export default defineConfig({
  runtime: { router: true },
  server: { port: 3000 },
  html: { title: '拾阶 · AI 兴趣教练' },
  plugins: [appTools({ bundler: 'rspack' })],
});
