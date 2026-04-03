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

**开发顺序：Phase 1 → 2 → 3 → 4 → 5 → 6 → 7（可选）**

- Phase 1 是所有后续 phase 的基础，必须先完成
- Phase 2/3/4/5 互相独立，完成 Phase 1 后可并行
- Phase 6 依赖 Phase 3（pulse sync）
- Phase 7 为导师标注的 OPTIONAL / SUPER OPTIONAL 功能，排在最后

**每完成一个 phase：**
1. 确保类型检查 (`pnpm check`) 和测试 (`pnpm test`) 通过
2. 在该 phase 的 `epic.md` 中勾选验收标准
3. 提交 commit 并标注 phase 编号

**需求主文档：** `docs/requirements-master.md` — 导师原始需求，是所有 epic 设计的 source of truth。

## 部署

- 平台：Zeabur，使用根目录 `Dockerfile`
- 端口由平台注入 `PORT` 环境变量，默认 3000
- 健康检查：`GET /api/healthz`
- 副本数必须保持为 1

## 前端组件约定

- 前端新增或重构 UI 时，优先复用 `client/src/components/ui/` 里的 `shadcn/ui` 组件，不要手写重复的基础组件。
- 当前项目已配置 `@shadcn` registry，风格以 `components.json` 为准（`new-york`、`neutral`、CSS variables）。
- 当前项目额外启用了 `@diceui`、`@kibo-ui`、`@cult-ui`、`@magicui`、`@motion-primitives`、`@react-bits` 作为补充 registry。
- 组件选择上优先顺序为：基础表单/可访问性看 `@shadcn`、`@diceui`、`@kibo-ui`；更强的动效和视觉表达看 `@cult-ui`、`@magicui`、`@motion-primitives`、`@react-bits`。
- 需要新增 `shadcn` 组件、示例或命令时，优先使用 `shadcn` MCP 工具能力，例如查询 registry、查看示例、生成 add command，而不是凭记忆手写。
- 如果需求超出 `shadcn` 现成组件范围，应先用 `shadcn` 组件搭骨架，再只对必要部分做定制化样式或行为扩展。
