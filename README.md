# Art Installation Control

English | [中文](#中文说明)

Art Installation Control is a real-time multi-device control system built for interactive installations. It provides one controller interface and multiple receiver endpoints, with state synchronized through `Express + Socket.IO`.

The project is designed for scenarios such as:

- interactive exhibitions
- installation control rooms
- synchronized audio and visual triggers
- message broadcasting to multiple display terminals

## Overview

This repository contains both the frontend and backend:

- `Vite + React` for the UI
- `Express` for the HTTP server
- `Socket.IO` for real-time communication
- an in-memory receiver registry for fast state updates

The application exposes three main routes:

- `/` for the landing page
- `/controller` for the operator dashboard
- `/receiver/:id` for each receiver terminal

Health checks are available at:

- `/api/healthz`

## How It Works

The system uses a simple controller-receiver model:

1. A receiver opens `/receiver/:id` and registers itself with the server.
2. The controller opens `/controller` and receives the live receiver list.
3. The controller sends commands to one receiver or broadcasts to all receivers.
4. The server keeps the latest receiver state in memory and pushes updates through Socket.IO.

Supported command types:

- audio play / pause
- audio enabled / disabled
- icon color change
- text message broadcast or targeted message

## Tech Stack

- React 19
- Vite 7
- TypeScript
- Express 4
- Socket.IO 4
- pnpm
- Docker for deployment control on Zeabur

## Project Structure

```text
.
├── client/          # Vite frontend
├── server/          # Express + Socket.IO backend
├── shared/          # Shared types and constants
├── patches/         # pnpm patched dependencies
├── Dockerfile       # Recommended deployment path for Zeabur
└── zbpack.json      # Zeabur build/start commands
```

## Local Development

Requirements:

- Node.js 22
- pnpm via Corepack

Install dependencies:

```bash
corepack enable
corepack pnpm install
```

Start development mode:

```bash
corepack pnpm dev
```

The development server runs the Express app with Vite middleware, so both frontend and backend are served together.

## Production Build

Build the application:

```bash
corepack pnpm build
```

Start the production server:

```bash
corepack pnpm start
```

## Environment Variables

This version has no required custom environment variables.

At runtime, the platform only needs to provide:

- `PORT`

Zeabur injects `PORT` automatically.

## Deployment

### Recommended: Docker on Zeabur

This repository includes a root-level [`Dockerfile`](./Dockerfile). This is the recommended deployment method on Zeabur.

Why Docker is recommended here:

- the project is not a pure static Vite site
- it needs an Express server for `/api/healthz`
- it needs Socket.IO for real-time communication
- Zeabur may otherwise detect `vite` and try to deploy it as a static site through Caddy

With Docker, the platform follows the exact runtime defined by the repository:

- install dependencies
- build frontend and backend
- run `node dist/index.js`

### Zeabur Notes

- Keep `Output Directory` empty if Zeabur exposes that field.
- Do not deploy this project as a static site.
- Keep the service replica count at `1`.

Current receiver and controller state is stored in memory. If you run multiple replicas, different clients may connect to different instances and stop seeing each other correctly.

If you need horizontal scaling later, add a shared state layer such as a Socket.IO Redis adapter.

### Non-Docker Deployment

If your platform correctly supports long-running Node services, these commands are enough:

- Install: `corepack pnpm install`
- Build: `corepack pnpm build`
- Start: `corepack pnpm start`

## Verification Checklist

After deployment, verify the following:

1. `GET /api/healthz` returns `{"ok":true}`
2. `/controller` loads successfully
3. `/receiver/:id` loads successfully
4. A receiver appears in the controller list after connecting
5. Audio, color, and text commands reach the target receiver

## Scripts

- `corepack pnpm dev` starts the development server
- `corepack pnpm build` builds the backend into `dist/index.js` and frontend assets into `dist/public`
- `corepack pnpm start` runs the production server
- `corepack pnpm check` runs TypeScript type checking
- `corepack pnpm test` runs tests
- `corepack pnpm format` formats the repository with Prettier

## Notes

- Receiver state is stored in memory and survives temporary reconnects during the lifetime of the process.
- Audio playback depends on browser autoplay behavior and device permissions.
- The current system is intentionally simple and optimized for single-instance deployment.

## 中文说明

Art Installation Control 是一个面向互动艺术装置的实时多终端控制系统。它提供一个控制端界面和多个接收端页面，通过 `Express + Socket.IO` 实现状态同步和指令分发。

它适合以下场景：

- 互动展览
- 装置控制台
- 音频与视觉联动触发
- 多终端消息广播

## 项目概览

这个仓库同时包含前端和后端：

- 使用 `Vite + React` 构建界面
- 使用 `Express` 提供 HTTP 服务
- 使用 `Socket.IO` 做实时通信
- 使用内存中的 receiver 注册表维护当前状态

项目的主要路由如下：

- `/` 首页
- `/controller` 控制端页面
- `/receiver/:id` 接收端页面

健康检查接口：

- `/api/healthz`

## 工作方式

系统采用 controller-receiver 模型：

1. 接收端打开 `/receiver/:id` 并向服务端注册自己。
2. 控制端打开 `/controller`，实时获取在线接收端列表。
3. 控制端可以向单个接收端发送指令，也可以广播给全部接收端。
4. 服务端在内存中保存最新接收端状态，并通过 Socket.IO 推送更新。

当前支持的指令类型包括：

- 音频播放 / 暂停
- 音频启用 / 禁用
- 图标颜色切换
- 文本消息单播或广播

## 技术栈

- React 19
- Vite 7
- TypeScript
- Express 4
- Socket.IO 4
- pnpm
- Docker，用于在 Zeabur 上稳定控制部署行为

## 目录结构

```text
.
├── client/          # Vite 前端
├── server/          # Express + Socket.IO 后端
├── shared/          # 共享类型与常量
├── patches/         # pnpm patched dependencies
├── Dockerfile       # Zeabur 推荐部署方式
└── zbpack.json      # Zeabur build/start 命令
```

## 本地开发

环境要求：

- Node.js 22
- 通过 Corepack 使用 pnpm

安装依赖：

```bash
corepack enable
corepack pnpm install
```

启动开发模式：

```bash
corepack pnpm dev
```

开发模式下会启动 Express，并通过 Vite middleware 同时提供前端和后端服务。

## 生产构建

构建项目：

```bash
corepack pnpm build
```

启动生产服务：

```bash
corepack pnpm start
```

## 环境变量

当前版本没有必须手动配置的自定义环境变量。

运行时平台只需要提供：

- `PORT`

在 Zeabur 上，`PORT` 会自动注入。

## 部署说明

### 推荐方式：在 Zeabur 上使用 Docker

仓库根目录包含 [`Dockerfile`](./Dockerfile)，这是当前在 Zeabur 上最推荐的部署方式。

原因很直接：

- 这个项目不是纯静态 Vite 网站
- 它需要 Express 提供 `/api/healthz`
- 它需要 Socket.IO 提供实时通信
- 如果让平台只根据 `vite` 自动识别，可能会被当成静态站点交给 Caddy 处理

使用 Docker 后，平台会严格按仓库定义的方式运行：

- 安装依赖
- 构建前后端产物
- 执行 `node dist/index.js`

### Zeabur 注意事项

- 如果 Zeabur 控制台里有 `Output Directory`，请保持为空。
- 不要把这个项目按静态站点部署。
- 服务副本数保持为 `1`。

当前 receiver 和 controller 状态都保存在内存中。如果开多个副本，不同客户端可能会连接到不同实例，导致彼此状态不一致。

如果后续需要横向扩容，建议接入共享状态层，例如 Socket.IO Redis adapter。

### 非 Docker 部署

如果目标平台能正确支持长期运行的 Node 服务，也可以直接使用下面的命令：

- Install: `corepack pnpm install`
- Build: `corepack pnpm build`
- Start: `corepack pnpm start`

## 部署后检查清单

部署完成后，建议依次验证：

1. `GET /api/healthz` 返回 `{"ok":true}`
2. `/controller` 可以正常打开
3. `/receiver/:id` 可以正常打开
4. 接收端连接后会出现在控制端列表里
5. 音频、颜色、文本消息都能正确到达目标接收端

## 可用脚本

- `corepack pnpm dev` 启动开发服务器
- `corepack pnpm build` 构建后端入口到 `dist/index.js`，并构建前端静态资源到 `dist/public`
- `corepack pnpm start` 启动生产服务器
- `corepack pnpm check` 执行 TypeScript 类型检查
- `corepack pnpm test` 运行测试
- `corepack pnpm format` 使用 Prettier 格式化仓库

## 说明

- 接收端状态保存在内存中，在单个进程生命周期内可保留并支持短暂重连。
- 音频播放是否成功，取决于浏览器的 autoplay 策略和设备权限。
- 当前系统刻意保持简单，优先面向单实例部署场景。
