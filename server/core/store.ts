import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import type { Conversation, Draft, Message, Plan, Summary } from '../../shared/contracts';

export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export class Store {
  readonly db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, owner TEXT NOT NULL, title TEXT NOT NULL, updated TEXT NOT NULL, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS owner_updated ON conversations(owner, updated DESC);
      CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, conversation TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE, owner TEXT NOT NULL, fingerprint TEXT NOT NULL, status TEXT NOT NULL, created TEXT NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS one_running_per_conversation ON runs(conversation) WHERE status='running';
      PRAGMA user_version=1;`);
    // This application runs as one Node process. Interrupted runs are never silently replayed.
    this.db.prepare("UPDATE runs SET status='interrupted' WHERE status='running'").run();
  }
  close() {
    this.db.close();
  }
  session(token: string | undefined) {
    const hash = (s: string) => createHash('sha256').update(s).digest('hex');
    if (token && /^[a-f0-9-]{36}$/.test(token)) {
      const id = hash(token);
      if (this.db.prepare('SELECT id FROM sessions WHERE id=? AND expires>?').get(id, Date.now()))
        return { id };
    }
    const fresh = randomUUID();
    const id = hash(fresh);
    this.db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());
    this.db.prepare('INSERT INTO sessions VALUES (?,?)').run(id, Date.now() + 30 * 86400000);
    return { id, token: fresh };
  }
  list(owner: string): Summary[] {
    return this.db
      .prepare(
        'SELECT id,title,updated AS updatedAt FROM conversations WHERE owner=? ORDER BY updated DESC LIMIT 100',
      )
      .all(owner) as Summary[];
  }
  create(owner: string): Conversation {
    if (this.list(owner).length >= 100)
      throw new AppError('LIMIT', '最多保留 100 个目标，请先删除不再使用的目标。');
    const c: Conversation = {
      id: randomUUID(),
      title: '新的学习目标',
      updatedAt: new Date().toISOString(),
      messages: [],
      plans: [],
    };
    this.db
      .prepare('INSERT INTO conversations VALUES (?,?,?,?,?)')
      .run(c.id, owner, c.title, c.updatedAt, JSON.stringify(c));
    return c;
  }
  get(owner: string, id: string): Conversation {
    const row = this.db
      .prepare('SELECT data FROM conversations WHERE id=? AND owner=?')
      .get(id, owner) as { data: string } | undefined;
    if (!row) throw new AppError('NOT_FOUND', '未找到这个目标。', 404);
    return JSON.parse(row.data) as Conversation;
  }
  private save(owner: string, c: Conversation) {
    c.updatedAt = new Date().toISOString();
    this.db
      .prepare('UPDATE conversations SET title=?, updated=?, data=? WHERE id=? AND owner=?')
      .run(c.title, c.updatedAt, JSON.stringify(c), c.id, owner);
  }
  reserve(owner: string, id: string, requestId: string, fingerprint: string) {
    const c = this.get(owner, id);
    if (c.messages.length >= 200)
      throw new AppError('LIMIT', '该目标已达到 100 轮对话，请新建目标。');
    const previous = this.db.prepare('SELECT * FROM runs WHERE id=?').get(requestId);
    if (previous)
      throw new AppError('DUPLICATE', '这次请求已提交，请刷新查看结果或重新发送。', 409);
    try {
      this.db
        .prepare('INSERT INTO runs VALUES (?,?,?,?,?,?)')
        .run(requestId, id, owner, fingerprint, 'running', new Date().toISOString());
    } catch {
      throw new AppError('BUSY', '这个目标正在生成回答，请稍后再试。', 409);
    }
    return c;
  }
  finish(
    owner: string,
    id: string,
    runId: string,
    user: Message,
    assistant: Message,
    draft?: Draft,
  ): Conversation {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      // Read again: preserve any task check-ins made while the model was streaming.
      const c = this.get(owner, id);
      c.messages.push(user, assistant);
      if (c.messages.length === 2) c.title = user.content.slice(0, 30);
      if (draft)
        c.plans.push({
          ...draft,
          id: randomUUID(),
          version: 0,
          status: 'draft',
          createdAt: new Date().toISOString(),
          milestones: draft.milestones.map((m) => ({
            ...m,
            tasks: m.tasks.map((t) => ({
              ...t,
              id: randomUUID(),
              done: false,
              note: '',
              completedAt: null,
            })),
          })),
        });
      this.save(owner, c);
      this.db
        .prepare("UPDATE runs SET status='done' WHERE id=? AND owner=? AND status='running'")
        .run(runId, owner);
      this.db.exec('COMMIT');
      return c;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
  fail(owner: string, runId: string, status: 'failed' | 'cancelled') {
    this.db
      .prepare("UPDATE runs SET status=? WHERE id=? AND owner=? AND status='running'")
      .run(status, runId, owner);
  }
  updatePlan(
    owner: string,
    id: string,
    planId: string,
    version: number,
    action: 'adopt' | 'task',
    taskId?: string,
    done?: boolean,
    note?: string,
  ) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const c = this.get(owner, id);
      const p = c.plans.find((p) => p.id === planId);
      if (!p) throw new AppError('NOT_FOUND', '未找到计划。', 404);
      if (p.version !== version)
        throw new AppError('CONFLICT', '计划已在其他页面更新，请刷新后重试。', 409);
      if (action === 'adopt') {
        if (p.status !== 'draft') throw new AppError('STATE', '只能确认草案。', 409);
        for (const old of c.plans)
          if (old.status === 'active') {
            old.status = 'archived';
            old.version++;
          }
        p.status = 'active';
      } else {
        if (p.status !== 'active')
          throw new AppError('STATE', '请先确认计划，再记录完成情况。', 409);
        const task = p.milestones.flatMap((m) => m.tasks).find((t) => t.id === taskId);
        if (!task || typeof done !== 'boolean') throw new AppError('TASK', '任务参数不正确。');
        task.done = done;
        task.completedAt = done ? new Date().toISOString() : null;
        if (note !== undefined) task.note = note;
      }
      p.version++;
      this.save(owner, c);
      this.db.exec('COMMIT');
      return c;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
  delete(owner: string, id: string) {
    this.get(owner, id);
    if (this.db.prepare("SELECT id FROM runs WHERE conversation=? AND status='running'").get(id))
      throw new AppError('BUSY', '生成完成后再删除。', 409);
    this.db.prepare('DELETE FROM conversations WHERE id=? AND owner=?').run(id, owner);
  }
}
