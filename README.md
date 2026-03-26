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

仓库已经包含 `zbpack.json`，Zeabur 会使用下面的命令：

- Build: `corepack pnpm build`
- Start: `corepack pnpm start`

部署时请按下面顺序处理：

1. 在 Zeabur 创建一个 Node.js 服务并连接本仓库。
2. 不需要额外环境变量。
3. 把服务副本数保持为 `1`。
   说明：当前 Socket.IO 状态存在内存中，多副本会让 controller 和 receiver 看不到彼此。
4. 部署后先验证这几个点：
   - `GET /api/healthz`
   - `/controller` 和 `/receiver/:id` 的 WebSocket 能互通

## 说明

- 健康检查接口：`/api/healthz`

如果你后面要把 Socket.IO 改成多副本可扩展，需要接入 Redis adapter 或其他共享状态层。
