# Art Installation Control

一个基于 `Vite + React + Express + Socket.IO` 的多人互动艺术装置控制系统。

## 本地开发

```bash
corepack pnpm install
corepack pnpm dev
```

## 生产构建

```bash
corepack pnpm build
corepack pnpm start
```

## 环境变量

当前版本没有必需环境变量。

运行时只需要平台提供 `PORT`，Zeabur 会自动注入，不需要手动配置。

## Zeabur 部署

仓库同时包含 `zbpack.json` 和 `Dockerfile`。

- 默认建议让 Zeabur 直接使用根目录 `Dockerfile` 部署，这样可以避免被识别成 Vite 静态站点。
- 如果 Zeabur 明确使用 Node.js provider，再使用下面的命令：

- Build: `corepack pnpm build`
- Start: `corepack pnpm start`

部署时请按下面顺序处理：

1. 在 Zeabur 创建一个 Node.js 服务并连接本仓库。
2. 如果控制台里存在 `Output Directory`，保持为空，不要填写 `dist` 或 `dist/public`。
3. 如果当前服务无法清空 `Output Directory`，新建一个服务并让它按仓库根目录 `Dockerfile` 部署。
4. 不需要额外环境变量。
5. 把服务副本数保持为 `1`。
   说明：当前 Socket.IO 状态存在内存中，多副本会让 controller 和 receiver 看不到彼此。
6. 部署后先验证这几个点：
   - `GET /api/healthz`
   - `/controller` 和 `/receiver/:id` 的 WebSocket 能互通

## 说明

- 健康检查接口：`/api/healthz`

如果你后面要把 Socket.IO 改成多副本可扩展，需要接入 Redis adapter 或其他共享状态层。
