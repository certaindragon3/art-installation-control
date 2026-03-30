# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

This file is intentionally kept aligned with [`CLAUDE.md`](./CLAUDE.md).
If the two files ever drift, treat [`CLAUDE.md`](./CLAUDE.md) as the source of truth and sync the same update back to `AGENTS.md`.

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
  - `unity-controller-api.md` — Unity 接入说明，优先推荐 HTTP API
  - `examples/UnityArtInstallationController.cs` — Unity `UnityWebRequest` 最小示例

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

## 部署

- 平台：Zeabur，使用根目录 `Dockerfile`
- 端口由平台注入 `PORT` 环境变量，默认 3000
- 健康检查：`GET /api/healthz`
- 副本数必须保持为 1
