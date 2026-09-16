import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import { draftSchema, type Conversation, type Mode } from '../shared/contracts';
import { DemoProvider } from '../server/core/provider';
import { runCoach } from '../server/core/graph';

// Deterministic workflow regressions. These scores do NOT measure real model quality.
const cases: { name: string; input: string; mode: Mode; search: boolean }[] = [
  { name: '目标澄清', input: '我想学摄影，但是不知道从哪里开始', mode: 'chat', search: false },
  { name: '计划结构', input: '我想学习 React，先做一个作品', mode: 'plan', search: false },
  { name: '中文输入', input: '想培养阅读习惯，每天坚持一点点', mode: 'plan', search: false },
  { name: '搜索降级', input: '帮我找 React 学习资料', mode: 'chat', search: true },
  { name: '空进度复盘', input: '帮我复盘最近的进度', mode: 'review', search: false },
  { name: '不伪造来源', input: '给我最新资料并附上链接', mode: 'plan', search: true },
];
async function main() {
  const reports = [];
  for (const c of cases) {
    const conversation: Conversation = {
      id: randomUUID(),
      title: c.name,
      updatedAt: new Date().toISOString(),
      messages: [],
      plans: [],
    };
    const start = performance.now();
    const events: string[] = [];
    const result = await runCoach({
      conversation,
      message: {
        id: randomUUID(),
        role: 'user',
        content: c.input,
        createdAt: new Date().toISOString(),
      },
      mode: c.mode,
      search: c.search,
      provider: new DemoProvider(),
      signal: AbortSignal.timeout(10000),
      emit: (e) => events.push(e.type),
    });
    const checks = [
      result.content.length > 0,
      events.includes('delta'),
      result.sources.length === 0,
      result.metrics.modelCalls === 0,
      c.mode !== 'plan' || draftSchema.safeParse(result.draft).success,
    ];
    reports.push({
      case: c.name,
      pass: checks.every(Boolean),
      durationMs: Math.round(performance.now() - start),
      firstTokenMs: result.metrics.firstTokenMs,
      nodes: result.traces.map((t) => t.node).join(' → '),
    });
  }
  console.log('Offline deterministic workflow evaluation — not a model benchmark');
  console.table(reports);
  if (reports.some((r) => !r.pass)) process.exitCode = 1;
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
