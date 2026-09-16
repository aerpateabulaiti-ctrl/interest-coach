import { Helmet } from '@modern-js/runtime/head';
import { useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  ArrowUp,
  ArrowUpRight,
  Plus,
  Sparkles,
  Target,
  MessageSquare,
  Check,
  ChevronDown,
  ChevronRight,
  Clock3,
  Globe2,
  Square,
  Download,
  Trash2,
  Activity,
  BookOpen,
  Code2,
  Camera,
  PenLine,
  Layers3,
  X,
  RefreshCw,
  CircleHelp,
  PanelLeftClose,
  PanelLeftOpen,
  CheckCheck,
  LoaderCircle,
} from 'lucide-react';
import type {
  Conversation,
  Message,
  Metrics,
  Mode,
  Plan,
  Summary,
  Trace,
} from '../../shared/contracts';
import { api, exportConversation, streamChat } from '../lib/client';
import PlanPanel from '../components/PlanPanel';
import './index.css';

const presets = [
  {
    title: '把 React 学扎实',
    subtitle: '从组件到一个完整作品',
    icon: Code2,
    className: 'lavender',
    prompt:
      '我会基础 JavaScript，想用 14 天做一个 React 项目，每天 45 分钟。请制定有明确验收标准的学习计划。',
  },
  {
    title: '培养阅读习惯',
    subtitle: '让一本书真正留下点什么',
    icon: BookOpen,
    className: 'peach',
    prompt:
      '我想培养阅读习惯，每天可以读 20 分钟，先试一周，希望读完后能写出自己的想法。请制定计划。',
  },
  {
    title: '记录生活的美',
    subtitle: '开始你的第一个摄影练习',
    icon: Camera,
    className: 'mint',
    prompt: '我只有手机，想入门摄影，每天练习 30 分钟，一周后交付一组主题照片。请制定练习计划。',
  },
  {
    title: '建立写作节奏',
    subtitle: '从一个想法，到一篇文章',
    icon: PenLine,
    className: 'blue',
    prompt:
      '我想练习写作，现在经常写不下去，每天 30 分钟，希望 7 天完成一篇 1000 字文章。请制定计划。',
  },
];
const modes: { value: Mode; label: string }[] = [
  { value: 'chat', label: '聊聊目标' },
  { value: 'plan', label: '制定计划' },
  { value: 'review', label: '进度复盘' },
];
const nodeLabels: Record<string, string> = {
  context: '理解上下文',
  search: '检索资料',
  plan: '校验计划',
  respond: '生成回答',
};
const now = () => new Date().toISOString();

function Markdown({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        img: ({ alt, src }) => <span>[图片：{alt || src || '附件'}]</span>,
        a: ({ children, ...props }) => (
          <a {...props} target="_blank" rel="noopener noreferrer">
            {children}
          </a>
        ),
      }}
    >
      {text}
    </ReactMarkdown>
  );
}

export default function CoachPage() {
  const [summaries, setSummaries] = useState<Summary[]>([]);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<Mode>('chat');
  const [search, setSearch] = useState(false);
  const [runtime, setRuntime] = useState('demo');
  const [searchEnabled, setSearchEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pendingUser, setPendingUser] = useState('');
  const [stream, setStream] = useState('');
  const [traces, setTraces] = useState<Trace[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [showTrace, setShowTrace] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [sidebar, setSidebar] = useState(true);
  const [mobileTab, setMobileTab] = useState('chat');
  const [deleting, setDeleting] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const followBottom = useRef(true);
  const requestVersion = useRef(0);
  const pendingText = useRef('');
  const frameRef = useRef(0);
  const busyRef = useRef(false);
  const remember = (id: string) => {
    try {
      localStorage.setItem('coach.active', id);
    } catch {
      /* Storage is optional. */
    }
  };
  const updateConversation = useCallback((c: Conversation) => {
    setConversation(c);
    remember(c.id);
    setSummaries((prev) => [
      { id: c.id, title: c.title, updatedAt: c.updatedAt },
      ...prev.filter((p) => p.id !== c.id),
    ]);
  }, []);
  const loadConversation = async (id: string) => {
    const version = ++requestVersion.current;
    setLoading(true);
    setError('');
    setMobileNav(false);
    try {
      const c = await api<Conversation>(`/api/conversations?id=${id}`);
      if (version === requestVersion.current) {
        setConversation(c);
        remember(c.id);
        setTraces([]);
        setMetrics(null);
        setStream('');
        setPendingUser('');
      }
    } catch (e) {
      if (version === requestVersion.current) setError((e as Error).message);
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  };
  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const info = await api<{ mode: string; searchEnabled: boolean; conversations: Summary[] }>(
          '/api/bootstrap',
        );
        if (!mounted) return;
        setRuntime(info.mode);
        setSearchEnabled(info.searchEnabled);
        setSummaries(info.conversations);
        let remembered: string | null = null;
        try {
          remembered = localStorage.getItem('coach.active');
        } catch {
          /* optional */
        }
        const id =
          info.conversations.find((c) => c.id === remembered)?.id ?? info.conversations[0]?.id;
        if (id) {
          const c = await api<Conversation>(`/api/conversations?id=${id}`);
          if (mounted) setConversation(c);
        }
      } catch (e) {
        if (mounted) setError((e as Error).message);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
      abortRef.current?.abort();
      cancelAnimationFrame(frameRef.current);
    };
  }, []);
  useEffect(() => {
    if (followBottom.current && messagesRef.current)
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
  }, [stream, conversation?.messages.length, pendingUser]);
  const newConversation = () => {
    if (busyRef.current) return;
    ++requestVersion.current;
    setConversation(null);
    setInput('');
    setTraces([]);
    setMetrics(null);
    setError('');
    setNotice('');
    setMobileTab('chat');
    setMobileNav(false);
    setDeleting(false);
    setLoading(false);
    textareaRef.current?.focus();
  };
  const send = async (text = input, selectedMode = mode) => {
    if (!text.trim() || busyRef.current || loading || saving) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    setShowTrace(false);
    setTraces([]);
    setMetrics(null);
    setInput('');
    setPendingUser(text.trim());
    setStream('');
    pendingText.current = '';
    followBottom.current = true;
    const abort = new AbortController();
    abortRef.current = abort;
    try {
      const current =
        conversation ?? (await api<Conversation>('/api/conversations', { method: 'POST' }));
      if (!conversation) updateConversation(current);
      await streamChat(current.id, text.trim(), selectedMode, search, abort.signal, (event) => {
        if (event.type === 'delta') {
          pendingText.current += event.text;
          if (!frameRef.current)
            frameRef.current = requestAnimationFrame(() => {
              setStream(pendingText.current);
              frameRef.current = 0;
            });
        }
        if (event.type === 'trace')
          setTraces((prev) => [...prev.filter((t) => t.node !== event.trace.node), event.trace]);
        if (event.type === 'done') {
          cancelAnimationFrame(frameRef.current);
          frameRef.current = 0;
          updateConversation(event.conversation);
          setMetrics(event.metrics);
          setPendingUser('');
          setStream('');
          pendingText.current = '';
        }
      });
    } catch (e) {
      setInput(text);
      setPendingUser('');
      setStream('');
      if (abort.signal.aborted) setNotice('已停止生成，输入已恢复。未完成的回答不会保存。');
      else setError((e as Error).message);
    } finally {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
      busyRef.current = false;
      setBusy(false);
      abortRef.current = null;
    }
  };
  const onUpdate = async (
    p: Plan,
    action: 'adopt' | 'task',
    taskId?: string,
    done?: boolean,
    note?: string,
  ) => {
    if (!conversation || saving) return;
    setSaving(true);
    setError('');
    try {
      const c = await api<Conversation>('/api/plans', {
        method: 'PATCH',
        body: JSON.stringify({
          conversationId: conversation.id,
          planId: p.id,
          version: p.version,
          action,
          taskId,
          done,
          note,
        }),
      });
      updateConversation(c);
    } catch (e) {
      setError((e as Error).message);
      const c = await api<Conversation>(`/api/conversations?id=${conversation.id}`).catch(
        () => null,
      );
      if (c) updateConversation(c);
    } finally {
      setSaving(false);
    }
  };
  const removeConversation = async () => {
    if (!conversation) return;
    setSaving(true);
    try {
      await api(`/api/conversations?id=${conversation.id}`, { method: 'DELETE' });
      setSummaries((prev) => prev.filter((c) => c.id !== conversation.id));
      newConversation();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  const messages = conversation?.messages ?? [];
  const active = conversation?.plans.find((p) => p.status === 'active');
  const tasks = active?.milestones.flatMap((m) => m.tasks) ?? [];
  const latestAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
  const currentTraces = traces.length ? traces : (latestAssistant?.traces ?? []);
  const currentMetrics = metrics ?? latestAssistant?.metrics;
  return (
    <div
      className={`app ${sidebar ? '' : 'sidebar-closed'} ${mobileNav ? 'mobile-nav' : ''} mobile-${mobileTab}`}
    >
      {mobileNav && (
        <button
          className="nav-backdrop"
          aria-label="关闭目标导航"
          onClick={() => setMobileNav(false)}
        />
      )}
      <Helmet>
        <title>拾阶 · AI 兴趣教练</title>
        <meta
          name="description"
          content="把兴趣变成行动：与 AI 教练制定计划、记录进度、持续复盘。"
        />
      </Helmet>
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="拾阶首页">
          <span className="brand-mark">
            <Layers3 size={23} strokeWidth={2} />
          </span>
          <span>
            拾阶<small>INTEREST COACH</small>
          </span>
        </a>
        <button
          className="new-button"
          onClick={newConversation}
          disabled={busy || loading || saving}
        >
          <Plus size={17} /> 开启新目标 <kbd>＋</kbd>
        </button>
        <div className="nav-title">
          我的学习空间 <span>{summaries.length.toString().padStart(2, '0')}</span>
        </div>
        <nav className="conversation-list" aria-label="历史目标">
          {summaries.length ? (
            summaries.map((s) => (
              <button
                disabled={busy || loading || saving}
                key={s.id}
                className={conversation?.id === s.id ? 'selected' : ''}
                onClick={() => void loadConversation(s.id)}
              >
                <MessageSquare size={15} />
                <span>{s.title}</span>
                {conversation?.id === s.id && <span className="selection-dot" />}
              </button>
            ))
          ) : (
            <p className="no-history">新的可能，从第一次对话开始。</p>
          )}
        </nav>
        <div className="sidebar-bottom">
          <div className="workspace-note">
            <span className="green-dot" /> 当前浏览器的独立空间<p>目标、计划和记录自动保存</p>
          </div>
          <button onClick={() => setShowAbout(true)} className="about-button">
            <CircleHelp size={16} /> 关于拾阶 <ArrowUpRight size={14} />
          </button>
          <div className="user-badge">
            <span>我</span>
            <div>
              保持好奇<small>每一步，都算数</small>
            </div>
            <Sparkles size={16} />
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumbs">
            <button
              className="icon-button sidebar-toggle"
              aria-label="切换目标导航"
              onClick={() => {
                setSidebar(!sidebar);
                setMobileNav(!mobileNav);
              }}
            >
              {sidebar ? <PanelLeftClose size={17} /> : <PanelLeftOpen size={17} />}
            </button>
            <span>学习空间</span>
            <ChevronRight size={13} />
            <b>{conversation?.title || '新的开始'}</b>
          </div>
          <div className="top-actions">
            <span className={`runtime-badge ${runtime}`}>
              <span />
              {runtime === 'live' ? '模型已连接' : '离线演示'}
            </span>
            <button
              className={`icon-button ${showTrace ? 'active' : ''}`}
              aria-label="查看运行记录"
              onClick={() => setShowTrace(!showTrace)}
            >
              <Activity size={17} />
            </button>
            {conversation && (
              <>
                <button
                  className="icon-button"
                  aria-label="导出当前目标"
                  disabled={busy}
                  onClick={() => exportConversation(conversation)}
                >
                  <Download size={17} />
                </button>
                <button
                  className="icon-button"
                  aria-label="删除当前目标"
                  disabled={busy || saving}
                  onClick={() => setDeleting(!deleting)}
                >
                  <Trash2 size={16} />
                </button>
              </>
            )}
          </div>
        </header>
        <div className="mobile-tabs">
          <button
            className={mobileTab === 'chat' ? 'active' : ''}
            onClick={() => setMobileTab('chat')}
          >
            教练对话
          </button>
          <button
            className={mobileTab === 'plan' ? 'active' : ''}
            onClick={() => setMobileTab('plan')}
          >
            行动计划 {tasks.length ? `· ${tasks.filter((t) => t.done).length}/${tasks.length}` : ''}
          </button>
        </div>
        <div className="workspace-body">
          <main className="chat-panel">
            {deleting && (
              <div className="delete-confirm" role="alert">
                删除后将移除这个目标的对话和计划。
                <button onClick={() => void removeConversation()} disabled={saving}>
                  确认删除
                </button>
                <button onClick={() => setDeleting(false)}>取消</button>
              </div>
            )}
            {showTrace && (
              <section className="trace-panel" aria-label="运行记录">
                <div className="trace-heading">
                  <b>
                    <Activity size={15} /> 最近一次运行
                  </b>
                  <button
                    className="icon-button"
                    aria-label="关闭运行记录"
                    onClick={() => setShowTrace(false)}
                  >
                    <X size={14} />
                  </button>
                </div>
                <p>展示执行步骤和耗时，不展示模型的隐藏推理过程。</p>
                {currentTraces.length ? (
                  <div className="trace-nodes">
                    {currentTraces.map((t) => (
                      <div className={t.status} key={t.node}>
                        <span>
                          {t.status === 'running' ? (
                            <LoaderCircle size={13} className="spin" />
                          ) : t.status === 'error' ? (
                            <X size={13} />
                          ) : (
                            <Check size={13} />
                          )}
                        </span>
                        <section>
                          <b>{nodeLabels[t.node] ?? t.node}</b>
                          <small>{t.detail}</small>
                        </section>
                        <em>{t.ms !== undefined ? `${t.ms} ms` : '进行中'}</em>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="empty-trace">发送消息后，执行记录会出现在这里。</p>
                )}
                {currentMetrics && (
                  <div className="metric-grid">
                    <div>
                      <b>
                        {currentMetrics.firstTokenMs ?? '—'}
                        <small> ms</small>
                      </b>
                      <span>首段内容延迟</span>
                    </div>
                    <div>
                      <b>
                        {(currentMetrics.totalMs / 1000).toFixed(2)}
                        <small> s</small>
                      </b>
                      <span>总耗时</span>
                    </div>
                    <div>
                      <b>{currentMetrics.modelCalls}</b>
                      <span>模型调用</span>
                    </div>
                    <div>
                      <b>{currentMetrics.outputChars}</b>
                      <span>输出字符</span>
                    </div>
                  </div>
                )}
              </section>
            )}
            <div
              className="message-scroll"
              ref={messagesRef}
              onScroll={() => {
                const el = messagesRef.current;
                if (el)
                  followBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
              }}
            >
              {loading ? (
                <div className="loading-state">
                  <LoaderCircle className="spin" size={22} />
                  <p>正在打开学习空间…</p>
                </div>
              ) : !messages.length && !pendingUser ? (
                <div className="welcome">
                  <div className="eyebrow">
                    <span /> 给好奇心，一个开始
                  </div>
                  <h1>
                    把喜欢的事，
                    <br />
                    做成<span>擅长的事。</span>
                    <Sparkles className="hero-spark" size={28} strokeWidth={1.5} />
                  </h1>
                  <p className="hero-description">
                    你的 AI 兴趣教练，陪你找到方向、拆解目标。
                    <br />
                    从今天的一小步开始，看见持续进步的自己。
                  </p>
                  <div className="starter-heading">
                    <span>还没想好？从一个小目标开始</span>
                    <ArrowUpRight size={15} />
                  </div>
                  <div className="starter-grid">
                    {presets.map((p) => (
                      <button
                        className="starter-card"
                        key={p.title}
                        onClick={() => {
                          setInput(p.prompt);
                          setMode('plan');
                          textareaRef.current?.focus();
                        }}
                      >
                        <span className={`starter-icon ${p.className}`}>
                          <p.icon size={20} strokeWidth={1.7} />
                        </span>
                        <b>{p.title}</b>
                        <small>{p.subtitle}</small>
                        <ArrowUpRight className="card-arrow" size={16} />
                      </button>
                    ))}
                  </div>
                  <div className="welcome-footnote">
                    <CheckCheck size={15} />
                    <span>计划由你确认 · 进度随时记录 · 回来接着开始</span>
                  </div>
                </div>
              ) : (
                <div className="messages">
                  {messages.map((m) => (
                    <article className={`message ${m.role}`} key={m.id}>
                      <div className="message-avatar">
                        {m.role === 'assistant' ? <Layers3 size={16} /> : '我'}
                      </div>
                      <div className="message-body">
                        <div className="message-author">
                          {m.role === 'assistant' ? '拾阶教练' : '你'}
                          <time>
                            {new Date(m.createdAt).toLocaleTimeString('zh-CN', {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </time>
                        </div>
                        <div className="markdown">
                          <Markdown text={m.content} />
                        </div>
                        {Boolean(m.sources?.length) && (
                          <details className="sources">
                            <summary>
                              <Globe2 size={13} /> 参考来源 · {m.sources?.length}
                              <ChevronDown size={13} />
                            </summary>
                            {m.sources?.map((s, i) => (
                              <a
                                href={s.url}
                                key={`${i}-${s.url}`}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                {i + 1}. {s.title}
                                <ArrowUpRight size={12} />
                              </a>
                            ))}
                          </details>
                        )}
                      </div>
                    </article>
                  ))}
                  {pendingUser && (
                    <>
                      <article className="message user">
                        <div className="message-avatar">我</div>
                        <div className="message-body">
                          <div className="message-author">你</div>
                          <div className="markdown">
                            <Markdown text={pendingUser} />
                          </div>
                        </div>
                      </article>
                      <article className="message assistant streaming">
                        <div className="message-avatar">
                          <Layers3 size={16} />
                        </div>
                        <div className="message-body">
                          <div className="message-author">
                            拾阶教练
                            <span className="generating">
                              <span />{' '}
                              {traces.find((t) => t.status === 'running')?.detail ?? '正在准备'}
                            </span>
                          </div>
                          {stream ? (
                            <div className="markdown">
                              <Markdown text={stream} />
                            </div>
                          ) : (
                            <div className="thinking-dots" aria-label="正在生成">
                              <i />
                              <i />
                              <i />
                            </div>
                          )}
                        </div>
                      </article>
                    </>
                  )}
                </div>
              )}
            </div>
            <div className="composer-area">
              {error && (
                <div className="feedback error" role="alert">
                  <span>{error}</span>
                  <button
                    className="icon-button"
                    aria-label="关闭错误提示"
                    onClick={() => setError('')}
                  >
                    <X size={14} />
                  </button>
                </div>
              )}
              {notice && (
                <div className="feedback" role="status">
                  {notice}
                </div>
              )}
              <div className={`composer ${busy ? 'busy' : ''}`}>
                <div className="mode-tabs" role="group" aria-label="对话模式">
                  {modes.map((m) => (
                    <button
                      key={m.value}
                      className={mode === m.value ? 'active' : ''}
                      disabled={busy}
                      onClick={() => setMode(m.value)}
                    >
                      {m.value === 'chat' ? (
                        <MessageSquare size={13} />
                      ) : m.value === 'plan' ? (
                        <Target size={13} />
                      ) : (
                        <RefreshCw size={13} />
                      )}
                      {m.label}
                    </button>
                  ))}
                </div>
                <textarea
                  ref={textareaRef}
                  aria-label="告诉教练你的目标"
                  placeholder={
                    mode === 'plan'
                      ? '我想学什么？现在是什么水平？每天能投入多久？'
                      : mode === 'review'
                        ? '最近哪些任务有进展？哪里遇到了困难？'
                        : '说说你想学的事，或者最近的小困惑…'
                  }
                  value={input}
                  maxLength={4000}
                  disabled={loading || busy}
                  rows={2}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                />
                <div className="composer-toolbar">
                  <button
                    className={`search-toggle ${search ? 'enabled' : ''}`}
                    aria-pressed={search}
                    disabled={busy || !searchEnabled}
                    title={
                      searchEnabled
                        ? '允许本次请求联网检索资料'
                        : '配置 Tavily 并启用模型模式后可用'
                    }
                    onClick={() => setSearch(!search)}
                  >
                    <Globe2 size={14} /> 联网资料{search && <Check size={12} />}
                  </button>
                  <div>
                    <span className="input-hint">
                      {input.length > 3500
                        ? `${input.length}/4000`
                        : 'Enter 发送 · Shift + Enter 换行'}
                    </span>
                    {busy ? (
                      <button
                        className="send-button stop"
                        aria-label="停止生成"
                        onClick={() => abortRef.current?.abort()}
                      >
                        <Square size={15} fill="currentColor" />
                      </button>
                    ) : (
                      <button
                        className="send-button"
                        aria-label="发送消息"
                        disabled={!input.trim() || loading || saving}
                        onClick={() => void send()}
                      >
                        <ArrowUp size={20} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
              <p className="composer-caption">
                {runtime === 'demo'
                  ? '当前为离线演示：示例回答与计划用于体验流程，不调用大模型。'
                  : 'AI 建议仅供参考，请结合实际情况确认计划。'}
              </p>
            </div>
          </main>
          <PlanPanel
            plans={conversation?.plans ?? []}
            busy={busy || saving || loading}
            onUpdate={onUpdate}
            onStart={() => {
              setMode('plan');
              setMobileTab('chat');
              textareaRef.current?.focus();
            }}
          />
        </div>
      </div>
      {showAbout && (
        <div className="modal-backdrop" onClick={() => setShowAbout(false)}>
          <section
            className="about-modal"
            role="dialog"
            aria-modal="true"
            aria-label="关于拾阶"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="icon-button close-modal"
              aria-label="关闭"
              autoFocus
              onClick={() => setShowAbout(false)}
            >
              <X size={18} />
            </button>
            <span className="brand-mark">
              <Layers3 size={27} />
            </span>
            <h2>拾阶，陪你一步一步来。</h2>
            <p>通过对话明确目标，把计划拆成带有验收标准的任务，再用真实的完成记录进行复盘。</p>
            <h3>你的学习空间</h3>
            <p>
              数据保存在服务端，通过当前浏览器的会话识别。清除 Cookie
              或更换浏览器后，无法自动找回这个空间。重要记录可以随时导出。
            </p>
            <h3>两种运行方式</h3>
            <p>
              离线演示使用固定示例。模型模式需要管理员配置服务端模型凭据；联网资料需要 Tavily 配置。
            </p>
            <a
              href="https://github.com/aerpateabulaiti-ctrl"
              target="_blank"
              rel="noopener noreferrer"
            >
              开发者 GitHub <ArrowUpRight size={15} />
            </a>
          </section>
        </div>
      )}
    </div>
  );
}
