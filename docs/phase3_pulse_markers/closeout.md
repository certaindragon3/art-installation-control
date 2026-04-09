# Phase 3 收尾文档

**阶段名称：** Pulse / Tempo + Track Markers  
**完成日期：** 2026-04-09  
**对应需求：** 1.2 Pulse / Tempo, 1.4 Track Markers and Fill State  
**线上验证地址：** `https://artinstallation.certaindragon3.work`

## 1. 本阶段交付概览

Phase 3 已完成以下能力：

- 服务端负责生成 pulse，不依赖 Unity 本地计时
- pulse 支持 `active` 开关
- BPM 支持动态调整
- receiver 通过独立 `pulse` socket 事件接收节拍
- 每条 track 支持 `tempoFlashEnabled`
- 每条 track 支持 `fillTime`
- receiver 端为每条 track 展示节拍 marker 和 fill progress
- fill 达到 1 时触发 flash，并继续循环
- `reset_all_state` 会把 pulse 与 marker 相关状态恢复默认值

## 2. 主要代码变动

### 2.1 服务端

- 新增 `PulseEvent` 协议和 `WS_EVENTS.PULSE`
- 新增 `server/pulseScheduler.ts`，使用自校正 `setTimeout` 调度 pulse
- `wsServer` 按 receiver 维护 pulse loop
- `pulse` 模块状态变更后会立即重建或停止调度
- receiver 断线、过期移除、reset 时会清理 pulse loop，避免孤儿定时器

涉及文件：

- `shared/wsTypes.ts`
- `server/pulseScheduler.ts`
- `server/wsServer.ts`

### 2.2 Controller UI

- 新增 Pulse & Tempo 控制区
- 支持 `pulse.active`、`pulse.visible`、`pulse.bpm`
- 每条 track 新增 `tempoFlashEnabled`
- 每条 track 新增 `fillTime`

涉及文件：

- `client/src/pages/Controller.tsx`

### 2.3 Receiver UI

- 新增 pulse 状态卡片
- 新增 beat phase 进度展示
- 每条 track 新增 tempo marker
- 每条 track 新增 fill progress，并在完成时 flash
- receiver 端订阅 `pulse` 事件并用统一时钟驱动进度动画

涉及文件：

- `client/src/hooks/useSocket.ts`
- `client/src/pages/Receiver.tsx`

## 3. 协议更新

### 3.1 新增 Socket.IO 事件

```ts
PULSE: "pulse";
```

事件负载：

```json
{
  "receiverId": "receiver-a",
  "bpm": 240,
  "intervalMs": 250,
  "sequence": 3,
  "timestamp": 1775712123456
}
```

### 3.2 `pulse` 模块状态

通过 `set_module_state` 更新：

```json
{
  "command": "set_module_state",
  "targetId": "receiver-a",
  "payload": {
    "module": "pulse",
    "patch": {
      "visible": true,
      "enabled": true,
      "active": true,
      "bpm": 120
    }
  }
}
```

### 3.3 `set_track_state` 新增 Phase 3 字段

```json
{
  "command": "set_track_state",
  "targetId": "receiver-a",
  "payload": {
    "trackId": "track_01",
    "patch": {
      "tempoFlashEnabled": true,
      "fillTime": 0.5
    }
  }
}
```

字段说明：

- `tempoFlashEnabled`: 是否启用节拍 flash marker
- `fillTime`: fill 从 0 到 1 的目标秒数

## 4. 测试结果

## 4.1 本地验证

已完成：

- `corepack pnpm check`
- `corepack pnpm test`
- `corepack pnpm build`

新增测试覆盖：

- `server/pulseScheduler.test.ts`
- `server/controllerApi.test.ts`

验证内容包括：

- pulse 调度不会累计明显 drift
- BPM 动态调整后会按新 interval 继续广播
- pulse 停止后不再继续发送事件
- HTTP 控制命令能正确修改 `pulse`、`tempoFlashEnabled`、`fillTime`

## 4.2 线上烟测

测试日期：`2026-04-09`  
测试站点：`https://artinstallation.certaindragon3.work`

已确认：

- `GET /api/healthz` 返回 `200`
- `GET /api/config` 返回 `200`
- 站点根路径 `/` 返回 `200`
- 生产环境 Socket.IO 可成功连接并注册 receiver
- 线上 receiver 可收到 pulse 事件
- 线上 `set_module_state(module=pulse)` 生效
- 线上 `set_track_state(tempoFlashEnabled/fillTime)` 生效
- pulse 停止后事件流会终止

本次线上 smoke test 使用临时 receiver：

- `phase3smokemnr0zvd7`

关键结果：

- pulse 配置成功切到 `240 BPM`
- track `track_01` 成功写入 `tempoFlashEnabled: true`
- track `track_01` 成功写入 `fillTime: 0.5`
- 共收到 `18` 个 pulse
- 抽样间隔约为 `249ms ~ 251ms`
- stop 后未继续收到新增 pulse

清理结果：

- 通过 `POST /api/controller/clear-offline` 清除了本次以及之前调试留下的离线 smoke receivers

## 4.3 尚未覆盖的验证

本次线上验证以协议与运行时行为为主，尚未通过真实浏览器录屏或人工目视方式确认以下视觉细节：

- receiver 页面的 marker 闪烁是否符合预期视觉节奏
- fill progress 在低性能设备上的观感是否稳定
- 多台真实移动设备同时打开 receiver 时的主观同步感

如果后续要把 Phase 3 作为正式演示版本，建议补一轮多设备人工联调。

## 5. 验收结论

Phase 3 已达到代码、测试、构建和线上烟测通过的收尾标准，可以作为后续 Phase 6 Timing 功能的依赖基础继续推进。

## 6. 部署注意事项

- 当前 Socket.IO 状态仍保存在内存中，线上必须继续保持单副本部署
- Phase 3 已引入持续 pulse 定时器，更需要避免多副本造成多时钟并发广播
