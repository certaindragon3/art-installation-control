# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

This file is the source of truth for repository-specific agent instructions.
[`AGENTS.md`](./AGENTS.md) should stay aligned with this file and carry the same operational guidance.

## 项目概述

多人互动艺术装置控制系统，基于 Vite + React + Express + Socket.IO。一个 Node 进程同时承担 HTTP + Socket.IO 服务端，以及在开发模式下的 Vite dev server proxy。

**重要约束：Socket.IO 状态存于内存，必须保持单副本部署（不可水平扩展）。**

## 常用命令

```bash
# 开发（tsx watch 模式，热重载）
corepack pnpm dev

# 类型检查
corepack pnpm check

# 构建（Vite 构建前端 + esbuild 打包服务端）
corepack pnpm build

# 生产启动
corepack pnpm start

# 格式化
corepack pnpm format

# 运行测试
corepack pnpm test

# 运行单个测试文件
pnpm vitest run server/wsServer.test.ts
```

## 架构

### 目录结构

- `server/` — Express + Socket.IO 服务端
  - `_core/index.ts` — 入口：读取环境变量并启动服务
  - `_core/app.ts` — 创建 Express app + HTTP server，挂载 WebSocket、HTTP API 和 Vite/静态资源
  - `_core/vite.ts` — 仅开发模式下动态 import，esbuild 打包时 external 排除
  - `wsServer.ts` — Socket.IO 逻辑：receiver/controller 状态管理、消息路由
  - `controllerApi.ts` — 面向 Unity/外部程序的 HTTP controller bridge
- `client/src/` — React 前端
  - `App.tsx` — 路由入口（wouter），三条路由：`/`、`/controller`、`/receiver/:id`
  - `pages/Controller.tsx` — 控制端：查看所有 receiver 状态、发送指令
  - `pages/Receiver.tsx` — 接收端：播放音频、展示颜色/文本
  - `hooks/useSocket.ts` — 统一封装 Socket.IO 连接，支持 `controller` 和 `receiver` 两种角色
- `shared/` — 前后端共享类型
  - `wsTypes.ts` — 所有 Socket.IO 事件名（`WS_EVENTS`）、消息类型定义、`AUDIO_URLS`
- `docs/`
  - `requirements-master.md` — 导师需求主文档（所有功能需求的 source of truth）
  - `phase0_deliverables/` — Phase 0 已交付内容（HTTP API 文档 + Unity 示例）
  - `phase1_architecture/` — Phase 1: 架构升级（unified command, state-driven, postToUnity, 动态 tracks）
  - `phase2_audio/` — Phase 2: 音频增强（looping, groups, volume）
  - `phase3_pulse_markers/` — Phase 3: Pulse/Tempo + Track Markers
  - `phase4_voting/` — Phase 4: 投票系统
  - `phase5_scoring_map/` — Phase 5: 计分 + 教室地图
  - `phase6_timing/` — Phase 6: Timing Challenge Mode
  - `phase7_optional/` — Phase 7: 可选功能（Filter, Recording）
  - `phase8_professor_feedback/` — Phase 8: 教授反馈后的交付收口（voting、120 音频文件 workflow、去 group、slim interface）
  - `phase9_receiver_map_feedback/` — Phase 9: receiver 唯一性 + 起点/终点 map 插值动画
  - `phase10_final_touch/` — Phase 10: final touch（receiver-led economy、学生端 UI、controller 访问隔离）
  - `phase11_color_challenge/` — Phase 11: ColorHitGame 计分挑战（从 Phase 10 拆出）

### 路径别名

- `@` → `client/src/`
- `@shared` → `shared/`

### 数据流

```
Controller (浏览器)
  → emit CONTROL_MESSAGE { type, targetId, payload }
  → Server applyCommand() 更新内存状态
  → emit RECEIVER_COMMAND 到目标 receiver 的 room
  → broadcastReceiverList() 通知所有 controller

Receiver (浏览器)
  → emit REGISTER_RECEIVER { receiverId, label }
  → Server 加入 room `receiver:{id}`
  → 收到 RECEIVER_COMMAND 通过 window CustomEvent 分发给页面组件
```

### Socket.IO 消息类型

`MessageType`: `audio_control` | `audio_playable` | `color_change` | `text_message`

`targetId = "*"` 表示广播给全部 receiver。

### Unity / 外部程序集成

当前对 Unity 的推荐接入方式不是直接驱动网页，而是调用 HTTP controller API：

- `GET /api/controller/receivers`
- `POST /api/controller/command`
- `POST /api/controller/clear-offline`

这些 HTTP 接口最终仍复用同一套内存状态和 Socket.IO 分发逻辑。

### 构建产物

- 前端构建到 `dist/public/`
- 服务端用 esbuild 打包到 `dist/index.js`，`--external:./vite` 防止 Vite 被误打包

## 开发路线图

项目按 Phase（Epic）分阶段推进，每个 phase 的设计文档在 `docs/phase{N}_xxx/epic.md`。

**当前开发顺序：Phase 1 → 2 → 3 → 4 → 5 → 6 → 8（教授反馈收口）→ 9（receiver 唯一性 + map movement）→ 10（final touch economy + receiver UI）→ 11（ColorHitGame score challenge）**

- Phase 1 是所有后续 phase 的基础，必须先完成
- Phase 2/3/4/5 互相独立，完成 Phase 1 后可并行
- Phase 6 依赖 Phase 3（pulse sync）
- Phase 7 为导师标注的 OPTIONAL / SUPER OPTIONAL 功能；根据教授最新反馈，当前明确 deferred，不作为 next step
- Phase 8 是当前最高优先级：先完成 voting 交付验证，再处理 120 音频文件自动 control string workflow，并用 visible track array 替代 group-based 操作流
- Phase 9 承接教授新增反馈：先保证 receiver 最终 ID 唯一，再把 map 控制从每帧位置推送改为 start/target/duration 的网页端插值动画
- Phase 10 承接 final touch 反馈：把音乐播放改为 receiver 主导的经济系统，服务端权威计算 currency / cost / game over，并按教授截图收敛 receiver UI；`ColorHitGame.cs` 已拆到 Phase 11
- Phase 11 承接教授 `ColorHitGame.cs`：独立实现颜色选择、timing reward、score penalty 和 game over，不阻塞 Phase 10

**每完成一个 phase：**

1. 确保类型检查 (`pnpm check`) 和测试 (`pnpm test`) 通过
2. 使用 `agent-browser` 对本 phase 的核心用户路径做浏览器烟测，并在 `closeout.md` 中记录测试过程和结果
3. 在该 phase 的 `epic.md` 中勾选验收标准
4. 更新该 phase 的 `closeout.md`，写清楚交付内容、API / 协议变动、验证证据和后续注意事项
5. 提交 commit 并标注 phase 编号

### Phase Closeout 写作规范

每个 phase 的 `closeout.md` 最终会被聚合成给教授 / Unity 侧使用的 API 手册，因此不能只写开发日志。Closeout 必须按“可对外阅读、可复制调用、可验证”的标准书写。

建议固定包含以下内容：

- **阶段元信息**：Phase 编号、阶段名称、完成日期、对应需求 / 教授反馈、依赖 phase、测试 URL 或本地 URL。
- **交付概览**：用结果导向描述“现在能做什么”，避免只写“改了某文件”。如果某能力有明确边界或暂不支持，也要写清楚。
- **主要文件**：列出本阶段真正影响行为的前端、服务端、共享类型、测试和教授文档文件。
- **API / 协议变动**：这是 closeout 的核心。必须明确新增、修改、兼容、废弃或无变化的接口。
- **HTTP API**：列出 endpoint、method、请求 body、响应关键字段、错误 / 边界行为。若没有新增 HTTP 路由，也要写“无新增 HTTP 路由，复用哪些现有入口”。
- **Socket.IO / Unified Command**：列出事件名、command 名、`targetId` 规则、payload schema、字段说明、默认值、clamp / normalization、广播行为和 receiver 回写限制。
- **状态快照变化**：如果 `ReceiverState`、`config`、track、module、vote、score、map 等结构变化，写出变化后的 JSON / TypeScript 摘要，并说明哪些接口会返回这些字段。
- **Unity / 外部程序集成说明**：写教授或 Unity 侧最应该复制的调用示例，优先给 `POST /api/controller/command` payload；说明推荐工作流和不推荐的旧方式。
- **兼容性与迁移**：记录 legacy 字段、别名、旧 payload 是否还支持、行为是否改变，以及教授现有脚本是否需要更新。
- **本地验证**：记录实际运行过的命令，至少覆盖相关范围的 `corepack pnpm check`、`corepack pnpm test`、必要时 `corepack pnpm build`。
- **agent-browser 浏览器验证**：每个 phase 收尾都要做。记录工具为 `agent-browser`，写明测试环境、URL、关键步骤、观察结果、涉及的 receiver id / vote id / track id，以及失败重试或环境限制。
- **部署 / 运行注意事项**：若涉及 Zeabur、生产构建、Socket.IO、跨设备、健康检查或反向代理，写明是否做了 Zeabur 验证；继续强调线上必须单副本。
- **未覆盖项和后续建议**：只写真实剩余风险，例如未做多设备人工联调、未验证真实音频包、某视觉细节需教授确认。

API 章节的书写要求：

- 给出可以直接复制的 JSON 示例，不要只描述字段名。
- 每个新增 command 至少包含一个最小可用 payload 和一个字段说明。
- 对 `targetId: "*"`、单 receiver id、server-assigned receiver id 的适用场景写清楚。
- 对时间、坐标、分数、音量、颜色等数值字段写清楚单位和范围。
- 对服务端自动行为写清楚，例如 clamp、默认值、自动停止播放、自动关闭投票、自动生成 `startedAt`。
- 如果本 phase 没有 API 变化，仍要写一个 “API Changes: None” 小节，并说明仅 UI / 文档 / 测试变化。
- 避免把内部实现细节放在 API 章节里；实现细节放在“主要代码变动”，API 章节面向教授和 Unity 调用方。

`agent-browser` 验证记录建议使用这个结构：

```markdown
## Browser Smoke Test

Tooling: `agent-browser`
Environment: `https://artinstallation.certaindragon3.work` or local dev URL
Date: YYYY-MM-DD

1. Opened `/receiver/<id>`.
   - Observed receiver connected and displayed expected state.
2. Opened `/controller`.
   - Observed receiver listed online.
3. Sent / triggered `<command>`.
   - Observed API returned `ok: true`.
   - Observed receiver UI changed from `<before>` to `<after>`.
4. Queried `<endpoint>`.
   - Confirmed snapshot includes `<field>`.
```

如果浏览器环境出现限制，例如 HTTP 被拦截、按钮 click 需要 DOM fallback、音频自动播放被浏览器策略阻止，必须在 closeout 的注意事项中写清楚，同时说明最终验证用了什么替代路径。

**需求主文档：** `docs/requirements-master.md` — 导师原始需求，是所有 epic 设计的 source of truth。

## 部署

- 平台：Zeabur，使用根目录 `Dockerfile`
- 端口由平台注入 `PORT` 环境变量，默认 3000
- 健康检查：`GET /api/healthz`
- 副本数必须保持为 1

### Zeabur 测试策略（Agent）

- agent 应自主判断是否需要把变更部署到 Zeabur 做验证，而不是每次都等待用户显式要求。
- 若改动涉及以下任一类，默认应视为值得上 Zeabur 测试：
  - 生产构建、启动流程、`Dockerfile`、`dist/` 产物或静态资源托管行为
  - `PORT`、环境变量、健康检查、Express 挂载路径、Vite proxy、server/client 集成边界
  - Socket.IO 连接、跨设备联调、房间广播、断线重连、线上网络环境相关问题
  - 仅在生产环境、反向代理后、或 Zeabur 容器环境中才可能暴露的问题
- 若改动只涉及纯文档、纯样式文案、与部署环境无关的小型重构，且本地验证已足够覆盖，则不必默认上 Zeabur。
- 在决定上 Zeabur 前，agent 仍应先完成本地可执行验证，至少优先运行相关范围内的 `pnpm check`、`pnpm test`、`pnpm build` 或最小必要验证，避免把明显会失败的版本直接部署。
- 若判断需要 Zeabur 测试，agent 应在汇报中明确说明触发原因，例如“该改动依赖生产构建链路”或“该问题只可能在 Zeabur 网络环境复现”。
- 任何 Zeabur 部署测试都必须继续遵守单副本约束，不得建议或配置多副本。

## 前端组件约定

- 前端新增或重构 UI 时，优先复用 `client/src/components/ui/` 里的 `shadcn/ui` 组件，不要手写重复的基础组件。
- 当前项目已配置 `@shadcn` registry，风格以 `components.json` 为准（`new-york`、`neutral`、CSS variables）。
- 当前项目额外启用了 `@diceui`、`@kibo-ui`、`@cult-ui`、`@magicui`、`@motion-primitives`、`@react-bits` 作为补充 registry。
- 组件选择上优先顺序为：基础表单/可访问性看 `@shadcn`、`@diceui`、`@kibo-ui`；更强的动效和视觉表达看 `@cult-ui`、`@magicui`、`@motion-primitives`、`@react-bits`。
- 需要新增 `shadcn` 组件、示例或命令时，不要凭记忆手写。若当前 agent 自带的 `shadcn` MCP 无法可靠识别第三方 registry，优先改用本机 `Claude Code CLI` 查询。
- 如果需求超出 `shadcn` 现成组件范围，应先用 `shadcn` 组件搭骨架，再只对必要部分做定制化样式或行为扩展。

## Claude Code UI 工作流

- 只要任务的核心是 UI 设计、视觉探索、页面改版、动效方案选择、组件选型，默认先使用 `Claude Code CLI` 进行设计，而不是直接开始手写界面。
- 本仓库里的 `Claude Code` 已验证可通过 `shadcn` MCP 查询第三方 registry；因此凡是需要搜索 `@diceui`、`@kibo-ui`、`@cult-ui`、`@magicui`、`@motion-primitives`、`@react-bits` 时，优先使用 `Claude Code CLI`。
- 运行 `Claude Code CLI` 时必须从仓库根目录执行，确保它读取当前项目的 `components.json` 与 `.claude/settings.local.json`。
- 推荐命令：

```bash
# 查看 Claude Code CLI 用法
claude --help

# 确认 shadcn MCP 已连接
claude mcp list

# 单次非交互式 UI 设计/组件探索
claude -p "Use the shadcn MCP in this project to search @shadcn @diceui @kibo-ui @cult-ui @magicui @motion-primitives @react-bits for components suitable for <task>. Return a concise UI direction, candidate components, and exact add command arguments."

# 进入交互式会话，适合多轮 UI 迭代
claude
```

- 使用 `Claude Code` 产出 UI 方案时，至少要求它返回：
  1. 视觉方向或布局方案
  2. 命中的 registry 和组件名
  3. 具体 `add` 命令参数
  4. 最终建议的组件组合方式
- `Claude Code` 给出的组件方案仍需遵守本仓库的既有视觉语言；基础结构优先 `@shadcn`、`@diceui`、`@kibo-ui`，更强视觉表达再按需引入 `@cult-ui`、`@magicui`、`@motion-primitives`、`@react-bits`。
