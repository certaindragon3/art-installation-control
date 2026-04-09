# Phase 5 收尾文档

**阶段名称：** Scoring + Spatial Map  
**完成日期：** 2026-04-09  
**对应需求：** 3.1 Per-Player Score, 2.1 Classroom Map Display  
**线上验证地址：** `https://artinstallation.certaindragon3.work`

## 1. 本阶段交付概览

Phase 5 已完成以下能力：

- 每个 receiver 拥有独立的分数状态
- 分数支持 show/hide、enable/disable、直接设置任意数值、单独 reset
- receiver 页面新增 score 展示区域
- controller 页面新增分数控制面板
- 每个 receiver 拥有独立的 classroom map 状态
- 地图支持 show/hide、enable/disable、实时更新 normalized 2D 坐标
- receiver 页面新增地图可视化区域
- controller 页面新增地图控制与实时预览面板
- Unity / HTTP / Socket.IO 都可复用同一套 score/map 状态流
- map 越界输入会在服务端统一 clamp 到 `0..1`

## 2. 主要代码变动

### 2.1 协议与共享类型

- 新增 `score_reset` unified command
- 新增 `ScoreResetPayload`
- 新增 `clampNormalizedCoordinate()` 共享工具，统一 map 坐标边界行为
- 默认配置中的 `score` / `map` 状态纳入 phase 5 自动化回归断言

涉及文件：

- `shared/wsTypes.ts`
- `server/wsServer.test.ts`

### 2.2 服务端

- `controllerApi` 接受 `score_reset`
- `wsServer` 为 `score` / `map` 模块添加专门 patch 逻辑，而不是直接 `Object.assign`
- `score` 支持兼容字段 `scoreVisible` / `scoreEnabled` / `scoreValue`
- `map` 支持兼容字段 `mapVisible` / `mapEnabled` / `x` / `y`
- `map.playerPosX` 与 `map.playerPosY` 统一执行服务端 clamp
- `score_reset` 只重置分数值，不清空 `visible` / `enabled`

涉及文件：

- `server/controllerApi.ts`
- `server/wsServer.ts`
- `server/controllerApi.test.ts`

### 2.3 Controller UI

- 页面头部和文案升级为 Phase 5
- 新增 Per-Player Score 面板
- 支持 score 的 visible / enabled 切换
- 支持分数直接输入、增减和 reset
- 新增 Classroom Map 面板
- 支持 map 的 visible / enabled 切换
- 支持前端 X / Y 使用 `0-100` 尺度的 slider + number input 控制
- 支持若干快捷位置 preset
- 支持对当前 receiver 的地图实时预览
- receiver 列表卡片补充 score / map 摘要

涉及文件：

- `client/src/pages/Controller.tsx`
- `client/src/components/ClassroomMap.tsx`

### 2.4 Receiver UI

- 页面头部文案升级为 Phase 5
- 新增 score 展示卡片
- 新增 classroom map 展示卡片
- map 使用共享 `ClassroomMap` 组件，保证 controller / receiver 映射一致
- map 展示使用 `0-100` 可读尺度（与 controller 一致），但底层状态仍为 normalized
- score / map 仍受投票锁定态影响，保持与 phase 4 行为一致

涉及文件：

- `client/src/pages/Receiver.tsx`
- `client/src/components/ClassroomMap.tsx`

## 3. API 与协议更新

## 3.1 `set_module_state` 新增正式支持的 Score / Map Patch

controller / Unity / HTTP 可继续通过统一命令入口控制 score 和 map。

### Score

```json
{
  "command": "set_module_state",
  "targetId": "receiver-a",
  "payload": {
    "module": "score",
    "patch": {
      "visible": true,
      "enabled": true,
      "value": 12
    }
  }
}
```

兼容字段：

- `scoreVisible`
- `scoreEnabled`
- `scoreValue`

### Map

```json
{
  "command": "set_module_state",
  "targetId": "receiver-a",
  "payload": {
    "module": "map",
    "patch": {
      "visible": true,
      "enabled": true,
      "playerPosX": 0.32,
      "playerPosY": 0.74
    }
  }
}
```

兼容字段：

- `mapVisible`
- `mapEnabled`
- `x`
- `y`

坐标尺度约定：

- 前端交互尺度：`0-100`
- 后端存储与传输尺度：`0-1` normalized
- 前端在提交时做换算，服务端继续按 `0..1` clamp

说明：

- `playerPosX` / `playerPosY` 会在服务端 clamp 到 `0..1`
- `x` / `y` 兼容旧式或 Unity 侧更简短的 payload 结构

## 3.2 新增 `score_reset`

用于把目标 receiver 的当前分数重置为 `0`：

```json
{
  "command": "score_reset",
  "targetId": "receiver-a",
  "payload": {}
}
```

说明：

- 只重置 `score.value`
- 不会修改 `score.visible`
- 不会修改 `score.enabled`

## 3.3 现有快照接口返回的 Phase 5 状态

以下现有接口的 config snapshot 现在包含完整 `score` / `map`：

- `GET /api/config`
- `GET /api/controller/receivers`
- `POST /api/controller/command` 的 `receivers`
- Socket.IO `receiver_state_update`

示例：

```json
{
  "score": {
    "visible": true,
    "enabled": true,
    "value": 12
  },
  "map": {
    "visible": true,
    "enabled": true,
    "playerPosX": 0.32,
    "playerPosY": 0.74
  }
}
```

## 4. 测试结果

## 4.1 本地完整验证

已执行：

- `corepack pnpm check`
- `corepack pnpm test`
- `corepack pnpm build`

结果：

- TypeScript 检查通过
- `vitest` 全量通过：`24` tests passed
- 生产构建通过
- Vite 仍提示主包 chunk size 超过 `500 kB`，但构建成功；本次 Phase 5 未引入新的构建失败项

本地新增回归覆盖：

- `server/wsServer.test.ts`
- `server/controllerApi.test.ts`

本地已验证：

- 默认 config 包含 score / map
- HTTP 可设置 score
- HTTP 可设置 map
- map 越界输入会被 clamp
- Socket.IO controller 命令可更新 map
- `score_reset` 生效

## 4.2 线上烟测

测试日期：`2026-04-09`  
测试站点：`https://artinstallation.certaindragon3.work`

已确认：

- `GET /api/healthz` 返回 `200`
- `GET /api/config` 返回 `200`
- `/controller` 返回 `200`
- `/receiver/phase5-doc-check` 返回 `200`
- 生产环境 Socket.IO 可成功连接并注册临时 receiver
- 生产环境可通过 HTTP 下发 `score` 状态
- 生产环境可通过 HTTP 下发 `map` 状态
- 生产环境 map 越界值被服务端正确 clamp 到 `0..1`
- 生产环境可通过 controller socket 下发 `map` 更新
- 生产环境 `score_reset` 生效
- `clear-offline` 可清理本次 smoke test 的临时 receiver

本次线上 smoke test 使用临时 receiver：

- `phase5smoke_mnr4cf8m`

关键结果：

```json
{
  "scoreAfterHttp": {
    "visible": true,
    "enabled": true,
    "value": 12
  },
  "mapAfterClamp": {
    "visible": true,
    "enabled": true,
    "playerPosX": 1,
    "playerPosY": 0
  },
  "mapAfterSocket": {
    "visible": true,
    "enabled": true,
    "playerPosX": 0.32,
    "playerPosY": 0.74
  },
  "scoreAfterReset": {
    "visible": true,
    "enabled": true,
    "value": 0
  }
}
```

清理结果：

- `POST /api/controller/clear-offline` 已移除 `phase5smoke_mnr4cf8m`

## 5. 阶段结论

Phase 5 已达到代码、测试、生产构建与线上烟测通过的收尾标准。

当前可作为后续 Phase 6 的稳定基础继续推进，尤其是：

- phase 6 可以直接复用已有的 score / map config snapshot 结构
- controller / receiver 的 phase 5 面板已与 Unity interaction 埋点保持一致
- 线上单副本 Zeabur 部署下，score / map 的 HTTP + Socket.IO 状态链路已完成验证
