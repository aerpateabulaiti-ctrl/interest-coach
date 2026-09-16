import { z } from 'zod';

export const modeSchema = z.enum(['chat', 'plan', 'review']);
export type Mode = z.infer<typeof modeSchema>;
export const draftSchema = z
  .object({
    title: z.string().min(2).max(80),
    goal: z.string().min(5).max(400),
    durationDays: z.number().int().min(1).max(90),
    dailyMinutes: z.number().int().min(5).max(180),
    milestones: z
      .array(
        z.object({
          title: z.string().min(2).max(100),
          tasks: z
            .array(
              z.object({
                title: z.string().min(2).max(140),
                minutes: z.number().int().min(5).max(180),
                evidence: z.string().min(2).max(240),
              }),
            )
            .min(1)
            .max(5),
        }),
      )
      .min(1)
      .max(4),
  })
  .strict()
  .superRefine((p, ctx) => {
    const tasks = p.milestones.flatMap((m) => m.tasks);
    if (tasks.reduce((n, t) => n + t.minutes, 0) > p.durationDays * p.dailyMinutes)
      ctx.addIssue({ code: 'custom', message: '任务总用时超过可用时间预算' });
    if (new Set(tasks.map((t) => t.title)).size !== tasks.length)
      ctx.addIssue({ code: 'custom', message: '任务名称必须唯一' });
  });
export type Draft = z.infer<typeof draftSchema>;
export type Source = { title: string; url: string; content: string };
export type Trace = {
  node: string;
  status: 'running' | 'done' | 'error';
  ms?: number;
  detail: string;
};
export type Metrics = {
  totalMs: number;
  firstTokenMs: number | null;
  outputChars: number;
  modelCalls: number;
  searchCalls: number;
};
export type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  sources?: Source[];
  traces?: Trace[];
  metrics?: Metrics;
};
export type Plan = Omit<Draft, 'milestones'> & {
  id: string;
  version: number;
  status: 'draft' | 'active' | 'archived';
  createdAt: string;
  milestones: {
    title: string;
    tasks: {
      id: string;
      title: string;
      minutes: number;
      evidence: string;
      done: boolean;
      note: string;
      completedAt: string | null;
    }[];
  }[];
};
export type Conversation = {
  id: string;
  title: string;
  updatedAt: string;
  messages: Message[];
  plans: Plan[];
};
export type Summary = Pick<Conversation, 'id' | 'title' | 'updatedAt'>;
export type StreamEvent =
  | { type: 'start'; runId: string }
  | { type: 'trace'; trace: Trace }
  | { type: 'delta'; text: string }
  | { type: 'sources'; sources: Source[] }
  | { type: 'plan'; plan: Plan }
  | { type: 'done'; conversation: Conversation; metrics: Metrics }
  | { type: 'error'; message: string; code: string };
export const chatSchema = z
  .object({
    conversationId: z.string().uuid(),
    requestId: z.string().uuid(),
    message: z.string().trim().min(1).max(4000),
    mode: modeSchema,
    search: z.boolean().default(false),
  })
  .strict();
export const updatePlanSchema = z
  .object({
    conversationId: z.string().uuid(),
    planId: z.string().uuid(),
    version: z.number().int().nonnegative(),
    action: z.enum(['adopt', 'task']),
    taskId: z.string().uuid().optional(),
    done: z.boolean().optional(),
    note: z.string().max(500).optional(),
  })
  .strict();
