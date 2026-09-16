import { Annotation, StateGraph, START, END } from '@langchain/langgraph';
import type {
  Conversation,
  Draft,
  Message,
  Metrics,
  Mode,
  Source,
  StreamEvent,
  Trace,
} from '../../shared/contracts';
import type { Provider } from './provider';

export async function runCoach(input: {
  conversation: Conversation;
  message: Message;
  mode: Mode;
  search: boolean;
  provider: Provider;
  signal: AbortSignal;
  emit: (event: StreamEvent) => void;
}) {
  const { conversation, message, provider, signal, emit } = input;
  const started = performance.now();
  let firstTokenMs: number | null = null;
  const traces: Trace[] = [];
  const activePlan = conversation.plans.find((p) => p.status === 'active');
  const State = Annotation.Root({
    mode: Annotation<Mode>(),
    sources: Annotation<Source[]>(),
    draft: Annotation<Draft | undefined>(),
    answer: Annotation<string>(),
    needsSearch: Annotation<boolean>(),
  });
  const node =
    <T>(name: string, detail: string, work: () => Promise<T>) =>
    async () => {
      signal.throwIfAborted();
      const start = performance.now();
      emit({ type: 'trace', trace: { node: name, status: 'running', detail } });
      try {
        const result = await work();
        signal.throwIfAborted();
        const trace: Trace = {
          node: name,
          status: 'done',
          ms: Math.round(performance.now() - start),
          detail,
        };
        traces.push(trace);
        emit({ type: 'trace', trace });
        return result;
      } catch (e) {
        const trace: Trace = {
          node: name,
          status: 'error',
          ms: Math.round(performance.now() - start),
          detail: '此步骤未完成',
        };
        emit({ type: 'trace', trace });
        throw e;
      }
    };
  const graph = new StateGraph(State)
    .addNode(
      'context',
      node(
        'context',
        input.mode === 'review' ? '读取已确认计划与真实打卡记录' : '读取目标、时间约束与最近对话',
        async () => ({ mode: input.mode, needsSearch: input.search, sources: [], answer: '' }),
      ),
    )
    .addNode('search', async () => {
      const start = performance.now();
      emit({
        type: 'trace',
        trace: { node: 'search', status: 'running', detail: '查找相关学习资料' },
      });
      let sources: Source[] = [];
      let detail = provider.kind === 'demo' ? '离线演示不联网，未提供搜索来源' : '已完成资料检索';
      try {
        sources = await provider.search(
          message.content,
          AbortSignal.any([signal, AbortSignal.timeout(12000)]),
        );
      } catch {
        signal.throwIfAborted();
        detail = '搜索不可用，已降级为基于已有信息回答';
      }
      const trace: Trace = {
        node: 'search',
        status: 'done',
        ms: Math.round(performance.now() - start),
        detail,
      };
      traces.push(trace);
      emit({ type: 'trace', trace });
      emit({ type: 'sources', sources });
      return { sources };
    })
    .addNode('plan', async (state) =>
      node('plan', '生成计划并校验结构、任务唯一性与时间预算', async () => ({
        draft: await provider.plan(
          message.content,
          JSON.stringify({
            activePlan,
            sources: state.sources,
            recent: conversation.messages.slice(-6),
          }),
          signal,
        ),
      }))(),
    )
    .addNode('respond', async (state) =>
      node(
        'respond',
        input.mode === 'review' ? '根据完成记录生成复盘建议' : '逐步生成回答',
        async () => {
          let answer = '';
          for await (const text of provider.answer(
            [...conversation.messages, message],
            state.mode,
            state.draft ?? activePlan,
            state.sources,
            signal,
          )) {
            signal.throwIfAborted();
            firstTokenMs ??= Math.round(performance.now() - started);
            answer += text;
            emit({ type: 'delta', text });
          }
          return { answer };
        },
      )(),
    )
    .addEdge(START, 'context')
    .addConditionalEdges(
      'context',
      (s) => (s.needsSearch ? 'search' : s.mode === 'plan' ? 'plan' : 'respond'),
      ['search', 'plan', 'respond'],
    )
    .addConditionalEdges('search', (s) => (s.mode === 'plan' ? 'plan' : 'respond'), [
      'plan',
      'respond',
    ])
    .addEdge('plan', 'respond')
    .addEdge('respond', END)
    .compile();
  const result = await graph.invoke(
    { mode: input.mode, needsSearch: input.search, sources: [], answer: '' },
    { signal, recursionLimit: 8 },
  );
  const metrics: Metrics = {
    totalMs: Math.round(performance.now() - started),
    firstTokenMs,
    outputChars: result.answer.length,
    modelCalls: provider.calls,
    searchCalls: provider.searches,
  };
  return { content: result.answer, draft: result.draft, sources: result.sources, traces, metrics };
}
