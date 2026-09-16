# 拾阶 · AI 兴趣教练

把兴趣拆成可执行的学习计划，通过真实打卡记录持续复盘。个人全栈项目，重点展示 React 流式交互、服务端 Agent 工作流、数据一致性和可验证的工程实现。

## 先体验

```bash
# Node.js 24，pnpm 10.26
pnpm install --frozen-lockfile
pnpm dev
```

打开 `http://localhost:3000`。默认是**离线演示**：无需 API Key，使用明确标识的固定示例，能够体验计划生成、确认、打卡、复盘、取消生成和持久化。演示回答不代表真实大模型效果。

1. 点击「把 React 学扎实」，输入框会带入目标和时间预算。
2. 选择「制定计划」并发送，观察实时响应与右上角运行记录。
3. 在右侧检查草案，点击「确认并开始」。
4. 完成任务、记录收获，切换「进度复盘」后发送消息。
5. 刷新或重启服务，目标与完成记录仍然保留。

## 已实现

| 能力 | 具体实现 |
| --- | --- |
| 流式对话 | 服务端 SSE 转发模型内容；增量 UTF-8 解析；requestAnimationFrame 合并渲染；用户向上阅读时不强制滚动 |
| Agent 工作流 | 真正使用 LangGraph StateGraph：上下文 → 可选检索 → 可选计划生成 → 流式回答；带条件分支和取消信号 |
| 计划约束 | Zod 校验结构、任务唯一性和时间预算；模型输出无效时最多修复一次 |
| 人工确认 | 草案确认后才可打卡；新计划确认时归档旧计划；保留任务证据和版本历史 |
| 持久化 | Node 内置 SQLite，WAL、事务、唯一运行约束、乐观版本检查；服务重启后恢复数据 |
| 请求边界 | HttpOnly 浏览器会话、同源校验、请求大小校验、并发上限、单会话限流、幂等请求 ID |
| 可观测性 | 节点状态与耗时、首段内容延迟、总耗时、输出字符数、模型/搜索调用次数；结构化服务端日志不记录聊天正文 |
| 体验 | 响应式三栏、移动端对话/计划切换、Markdown、安全外链、中文输入法保护、取消生成、错误恢复、导出与删除 |
| 验证 | 合约测试、SQLite 重启与并发测试、API 流式与隔离测试、真实 HTTP 模型适配器测试、离线工作流评测、CI |

## 接入真实模型

将 `.env.example` 复制为 `.env.local`，填入**你自己的**服务端配置：

```dotenv
COACH_MODE=live
LLM_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
LLM_API_KEY=在本地填写
LLM_MODEL=你的模型或推理接入点ID
TAVILY_API_KEY=可选的联网搜索密钥
```

重启服务。适配器使用兼容 Chat Completions 的 `/chat/completions` 接口、`stream: true` 和计划阶段的 JSON 输出；实际模型必须支持这些能力。`TAVILY_API_KEY` 配置后可在输入框启用联网资料。检索失败会明确降级，不会生成假的搜索结果。模型调用失败会显示错误，不会悄悄切换成演示回答。

前端不会读取模型密钥，也不会直接导入服务端模块。发布前检查 `.gitignore`，不要上传 `.env.local` 或 `.data`。旧项目中的凭据应由持有人在对应服务控制台轮换。

## 验证命令

```bash
pnpm typecheck
pnpm test
pnpm eval
pnpm scan:secrets
pnpm build
pnpm start
```

服务启动后，在另一个终端运行 `pnpm smoke`，验证生产 HTTP 链路中的会话、流式计划、确认、打卡、复盘和重新读取。该脚本仅在演示模式执行，并清理自身创建的测试目标。

`pnpm build` 还会检查服务端发布文件确实存在、能够加载，并扫描浏览器产物中的服务端标识，防止只生成前端页面却遗漏后端的构建回归。

`pnpm eval` 是离线确定性工作流回归，验证路由、结构、流式事件和搜索降级，**不是大模型准确率测评**。`tests/provider.test.ts` 使用本地 HTTP 服务验证真实适配器协议，不消耗外部模型额度。

## 工程结构

```text
src/routes/             React 页面、计划组件、响应式样式
src/lib/client.ts       HTTP 客户端、SSE 消费、导出
shared/contracts.ts     前后端数据契约与 Zod 校验
shared/sse.ts           增量 SSE 解析器
server/modern.server.ts Modern.js 自定义 BFF 入口
server/core/api.ts      HTTP 边界、会话、限流、流式生命周期
server/core/graph.ts    LangGraph 工作流与节点追踪
server/core/provider.ts 演示和真实模型适配器、Tavily 检索
server/core/store.ts    SQLite 事务、所有权与计划状态转换
tests/                  功能、协议、隔离与数据一致性测试
scripts/evaluate.ts     离线回归用例
docs/                   架构与需求文档
```

## 部署与边界

开发与部署都使用 Node.js 24。项目锁定 Modern.js 2.69.4，并固定与 LangGraph 1.0.5 兼容的 checkpoint 版本，避免旧框架项目安装时出现传递依赖漂移。

```bash
docker build -t interest-coach .
docker run --rm -p 3000:3000 -v coach-data:/app/.data interest-coach
```

这是一套**单 Node 进程、有持久磁盘**的应用。SQLite 文件放在 `.data/coach.sqlite`，部署需要持久卷；请勿用临时磁盘的 Serverless 多副本直接部署。HTTPS 环境设置 `COOKIE_SECURE=true`，并将 `COACH_ORIGIN` 设为浏览器访问来源（例如 `https://coach.example.com`，无尾部斜杠）。反向代理需关闭 SSE 缓冲，并将读超时设为至少 100 秒。

浏览器会话是匿名空间隔离，不是完整账号系统；清除 Cookie 后无法自动认领原空间，当前不支持跨设备登录。当前内存限流及并发计数仅在单进程内有效，不能代替公网入口的 IP 限流和用户配额。没有压测数据，不宣称支持高并发或生产级多租户。SQLite 在部分 Node 24 版本会显示实验特性提示。

当前尚未实现：OAuth 登录、分布式队列、流式断点续传、向量知识库、多模型自动路由。增加这些功能前，应先明确需求与验证成本。

## 深入阅读

- [架构与取舍](docs/architecture.md)：一次请求如何完成，工作流边界、数据一致性与安全设计
- [需求与升级范围](docs/requirements.md)：用户流程与验收标准

开发者：[aerpateabulaiti-ctrl](https://github.com/aerpateabulaiti-ctrl)
