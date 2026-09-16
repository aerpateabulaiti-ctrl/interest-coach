import { useEffect, useState } from 'react';
import { Target, Check, ArrowUpRight, Clock3, CheckCheck, PenLine } from 'lucide-react';
import type { Plan } from '../../shared/contracts';
export default function PlanPanel({
  plans,
  busy,
  onUpdate,
  onStart,
}: {
  plans: Plan[];
  busy: boolean;
  onUpdate: (
    p: Plan,
    action: 'adopt' | 'task',
    taskId?: string,
    done?: boolean,
    note?: string,
  ) => Promise<void>;
  onStart: () => void;
}) {
  const [selected, setSelected] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const latestId = plans.at(-1)?.id;
  useEffect(() => {
    setSelected(latestId ?? '');
    setEditing(null);
  }, [latestId]);
  const p = plans.find((p) => p.id === selected) ?? plans.at(-1);
  const tasks = p?.milestones.flatMap((m) => m.tasks) ?? [];
  const completed = tasks.filter((t) => t.done).length;
  return (
    <aside className="plan-panel">
      <div className="panel-title">
        <span>
          <Target size={18} /> 我的行动计划
        </span>
        <span className="tiny-pill">PLAN</span>
      </div>
      {!p ? (
        <>
          <div className="empty-plan-art" aria-hidden="true">
            <div className="art-sheet">
              <span />
              <span />
              <span />
              <div>
                <Check size={17} />
              </div>
            </div>
            <div className="art-star">✦</div>
          </div>
          <h3 className="empty-title">每个目标，都有下一步</h3>
          <p className="empty-description">
            和教练聊聊你想做的事，
            <br />
            把一个大目标拆成可执行的小任务。
          </p>
          <div className="journey">
            <div>
              <span>1</span>
              <section>
                <b>说出你的目标</b>
                <p>兴趣、起点、每天可投入的时间</p>
              </section>
            </div>
            <div>
              <span>2</span>
              <section>
                <b>确认专属计划</b>
                <p>先看清任务与时间，再决定开始</p>
              </section>
            </div>
            <div>
              <span>3</span>
              <section>
                <b>完成、记录、复盘</b>
                <p>用真实产出看见自己的进步</p>
              </section>
            </div>
          </div>
          <button className="outline-button full" onClick={onStart} disabled={busy}>
            开始制定计划 <ArrowUpRight size={15} />
          </button>
          <div className="small-quote">
            “不必一下走很远，
            <br />
            今天比昨天多走一步就好。”
          </div>
        </>
      ) : (
        <div className="plan-content">
          {plans.length > 1 && (
            <label className="plan-select">
              计划版本
              <select value={p.id} onChange={(e) => setSelected(e.target.value)}>
                {[...plans].reverse().map((v, i) => (
                  <option value={v.id} key={v.id}>
                    第 {plans.length - i} 版 ·{' '}
                    {v.status === 'draft' ? '待确认' : v.status === 'active' ? '进行中' : '已归档'}
                  </option>
                ))}
              </select>
            </label>
          )}
          <span className={`status-label ${p.status}`}>
            {p.status === 'draft' ? '待你确认' : p.status === 'active' ? '正在进行' : '历史计划'}
          </span>
          <h2>{p.title}</h2>
          <p className="plan-goal">{p.goal}</p>
          <div className="plan-time">
            <span>
              <Clock3 size={14} /> {p.durationDays} 天
            </span>
            <span>每天 {p.dailyMinutes} 分钟</span>
          </div>
          <div className="progress-label">
            <span>完成进度</span>
            <b>
              {completed} / {tasks.length}
            </b>
          </div>
          <div
            className="progress-track"
            role="progressbar"
            aria-label="任务完成进度"
            aria-valuenow={completed}
            aria-valuemin={0}
            aria-valuemax={tasks.length}
          >
            <span style={{ width: `${tasks.length ? (completed / tasks.length) * 100 : 0}%` }} />
          </div>
          {p.status === 'draft' && (
            <button
              className="primary-button full adopt"
              disabled={busy}
              onClick={() => void onUpdate(p, 'adopt')}
            >
              <CheckCheck size={16} /> 确认并开始
            </button>
          )}
          {p.status === 'draft' && (
            <p className="draft-hint">确认后才会成为当前计划；原计划将保留为历史版本。</p>
          )}
          {p.milestones.map((m, i) => (
            <section className="milestone" key={`${p.id}-${i}`}>
              <h3>{m.title}</h3>
              {m.tasks.map((t) => (
                <div className={`task ${t.done ? 'completed' : ''}`} key={t.id}>
                  <div className="task-main">
                    <button
                      className="check-button"
                      aria-label={`${t.done ? '撤销完成' : '完成任务'}：${t.title}`}
                      aria-pressed={t.done}
                      disabled={busy || p.status !== 'active'}
                      onClick={() => void onUpdate(p, 'task', t.id, !t.done)}
                    >
                      {t.done && <Check size={13} />}
                    </button>
                    <div>
                      <b>{t.title}</b>
                      <span>{t.minutes} 分钟</span>
                    </div>
                  </div>
                  <p>{t.evidence}</p>
                  {t.note && <blockquote>{t.note}</blockquote>}
                  {p.status === 'active' && (
                    <button
                      className="text-button note-button"
                      disabled={busy}
                      onClick={() => {
                        setEditing(editing === t.id ? null : t.id);
                        setNote(t.note);
                      }}
                    >
                      <PenLine size={12} /> {t.note ? '编辑记录' : '记录收获'}
                    </button>
                  )}
                  {editing === t.id && (
                    <div className="note-editor">
                      <textarea
                        aria-label="任务收获"
                        placeholder="留下产出、实际用时或遇到的问题…"
                        value={note}
                        maxLength={500}
                        onChange={(e) => setNote(e.target.value)}
                      />
                      <button
                        className="outline-button"
                        disabled={busy}
                        onClick={async () => {
                          await onUpdate(p, 'task', t.id, t.done, note);
                          setEditing(null);
                        }}
                      >
                        保存记录
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </section>
          ))}
        </div>
      )}
    </aside>
  );
}
