# Phase 6 收尾文档

**阶段名称：** Timing Challenge Mode  
**完成日期：** 2026-04-14  
**对应需求：** 5.1 Timing Challenge Mode  
**依赖：** Phase 3 Pulse / Tempo  
**线上验证地址：** `https://artinstallation.certaindragon3.work`

## 1. 本阶段交付概览

Phase 6 已完成以下能力：

- receiver 页面新增 Timing Challenge 卡片
- timing loading bar 使用红 → 绿 → 红渐变
- timing 目标中心线清晰显示
- hit window 根据 `targetCenter` 和 `timingTolerance` 可配置
- timing 进度与服务端 pulse clock 同步
- timing 进度会按 beat 周期循环，不会跑满后停在 `1`
- receiver 可重复按下 `Press On Beat` 进行多次挑战
- 每次按下会计算 `hit` / `miss`
- 每次按下会通过 Unity `interaction_event` 实时转发
- 服务端记录 timing attempt，可通过 HTTP 导出 JSON
- controller 页面新增 Timing Challenge 控制面板
- controller 支持 timing show/hide、enable/disable、target center、tolerance 和导出

当前设计边界：

- Timing Challenge 对齐的是共享 server pulse clock
- Timing Challenge **不是**对齐当前播放 track 的播放位置
- Track start 目前仍是立即触发，没有做 beat-quantized delayed start
- 如果教授确认 track-playback alignment 可跳过，这个限制可暂时忽略

## 2. 主要代码变动

### 2.1 协议与共享类型

- 扩展 `TimingConfig`
- 新增 `TimingInteractionValue`
- 新增 `TimingEventExport`
- 新增 `TimingExport`
- 新增默认 timing 参数：
  - `DEFAULT_TIMING_TARGET_CENTER = 0.5`
  - `DEFAULT_TIMING_TOLERANCE = 0.08`
- 新增 timing 工具函数：
  - `clampTimingTolerance()`
  - `resolveTimingValue()`
  - `evaluateTimingPress()`
- `resolveTimingValue()` 使用 `elapsed % intervalMs`，保证 timing bar 跨多个 beat 持续循环

涉及文件：

- `shared/wsTypes.ts`
- `shared/timing.test.ts`
- `server/wsServer.test.ts`

### 2.2 服务端

- `wsServer` 新增 timing attempt 内存日志
- receiver 发送 `submitTiming` interaction 后，服务端记录：
  - `receiverId`
  - `userId`
  - `label`
  - `timing`
  - `timingValue`
  - `targetCenter`
  - `timingTolerance`
  - `delta`
  - pulse metadata
  - timestamp
- timing attempt 会继续实时转发到 Unity room
- 新增 `assignTimingPatch()`，避免对 timing module 直接 `Object.assign`
- timing patch 会执行 clamp / normalization
- 新增 `getTimingExport()`
- `resetWebSocketState()` 会清空 timing attempt 日志，保证测试隔离

涉及文件：

- `server/wsServer.ts`
- `server/controllerApi.ts`
- `server/controllerApi.test.ts`

### 2.3 Controller UI

- 页面头部升级为 Phase 6
- 新增 Timing Challenge 面板
- 支持切换 timing visible / enabled
- 支持配置 `targetCenter`
- 支持配置 `timingTolerance`
- 支持 timing hit window 预览
- 支持导出 timing JSON
- timing 控制仍走统一 `set_module_state`

涉及文件：

- `client/src/pages/Controller.tsx`

### 2.4 Receiver UI

- 页面头部升级为 Phase 6
- 新增 Timing Challenge receiver 卡片
- 显示 Active / Locked 状态
- 显示 Pulse Synced / Pulse Idle 状态
- 显示 target center 与 tolerance
- 显示红绿红 loading bar
- 显示中心指示器 bar
- 显示当前 timing marker
- 显示当前 progress / delta / pulse sequence
- `Press On Beat` 可重复触发 challenge attempt
- 每次按下都会显示本次 `Hit` / `Miss` 结果
- 每次按下都会通过 `postInteraction()` 发出 Unity event

涉及文件：

- `client/src/pages/Receiver.tsx`

### 2.5 辅助文档

新增教授测试用 payload 文档：

- `docs/professor-plug-and-play-commands.md`
- `docs/polling-system-payloads.md`

说明：

- 这两份文档是教授/Unity 侧测试用的 copy-paste command sheet
- 不替代完整 API reference
- 重点覆盖当前工作流测试 payload

## 3. API 与协议更新

## 3.1 `TimingConfig`

当前 receiver config 中包含：

```json
{
  "timing": {
    "visible": true,
    "enabled": true,
    "timingValue": 0,
    "targetCenter": 0.5,
    "timingTolerance": 0.08,
    "startedAt": null,
    "durationMs": null,
    "remainingMs": null
  }
}
```

字段说明：

- `visible`: 是否显示 receiver timing UI
- `enabled`: 是否允许 receiver 按下 timing 按钮
- `timingValue`: pulse 不可用时的 fallback progress
- `targetCenter`: 命中窗口中心，范围 `0..1`
- `timingTolerance`: 命中窗口半径，服务端 clamp 到 `0..0.5`
- `startedAt` / `durationMs` / `remainingMs`: 预留给后续 timed challenge session

## 3.2 `set_module_state` 控制 Timing

controller / Unity / HTTP 可通过统一命令入口控制 timing：

```json
{
  "command": "set_module_state",
  "targetId": "receiver-a",
  "payload": {
    "module": "timing",
    "patch": {
      "visible": true,
      "enabled": true,
      "targetCenter": 0.5,
      "timingTolerance": 0.08
    }
  }
}
```

兼容字段：

- `timingVisible`
- `timingEnabled`
- `center`
- `tosingTolerance`

说明：

- `targetCenter` 会被 clamp 到 `0..1`
- `timingTolerance` 会被 clamp 到 `0..0.5`
- 如果 pulse active，receiver 使用 pulse 计算实时 progress
- 如果 pulse inactive，receiver 使用 `timingValue` 作为 fallback

## 3.3 Unity Timing Event

receiver 每次按下 `Press On Beat` 后，会通过现有 `interaction_event` 转发给 Unity：

```json
{
  "sourceRole": "receiver",
  "receiverId": "receiver-a",
  "action": "submitTiming",
  "element": "receiver:timing_button",
  "value": {
    "timing": true,
    "timingValue": 0.52,
    "targetCenter": 0.5,
    "timingTolerance": 0.08,
    "delta": 0.02,
    "pulseSequence": 12,
    "pulseIntervalMs": 666.6666666667,
    "pulseActive": true
  },
  "timestamp": "2026-04-14T10:00:00.000Z"
}
```

字段说明：

- `timing`: `true` 表示 hit，`false` 表示 miss
- `timingValue`: 用户按下瞬间的 normalized beat progress
- `delta`: `abs(timingValue - targetCenter)`
- `pulseSequence`: 当前 pulse sequence
- `pulseIntervalMs`: 当前 beat interval
- `pulseActive`: 本次判定是否基于 live pulse

## 3.4 新增 HTTP 导出接口

### `GET /api/controller/timing/export`

返回服务端当前内存中记录的 timing attempts：

```json
{
  "ok": true,
  "timing": {
    "generatedAt": "2026-04-14T10:05:00.000Z",
    "totalAttempts": 2,
    "hits": 1,
    "misses": 1,
    "attempts": [
      {
        "userId": "receiver-a",
        "receiverId": "receiver-a",
        "label": "Receiver A",
        "timestamp": 1776160800000,
        "isoTimestamp": "2026-04-14T10:00:00.000Z",
        "timing": true,
        "timingValue": 0.52,
        "targetCenter": 0.5,
        "timingTolerance": 0.08,
        "delta": 0.02,
        "pulseSequence": 12,
        "pulseIntervalMs": 666.6666666667,
        "pulseActive": true
      }
    ]
  }
}
```

说明：

- 导出结果来自当前 Node 进程内存
- Zeabur 部署必须保持单副本
- 服务重启后内存日志会清空

## 3.5 现有快照接口返回 Phase 6 状态

以下现有接口的 config snapshot 现在包含完整 `timing`：

- `GET /api/config`
- `GET /api/controller/receivers`
- `POST /api/controller/command` 的 `receivers`
- Socket.IO `receiver_state_update`

## 4. 测试结果

## 4.1 本地验证

Phase 6 实现期间已执行：

- `corepack pnpm check`
- `corepack pnpm test`
- `corepack pnpm build`

后续 timing bar 循环修复后已再次执行：

- `corepack pnpm check`
- `corepack pnpm test`

结果：

- TypeScript 检查通过
- `vitest` 全量通过
- 生产构建通过
- Vite 仍提示主包 chunk size 超过 `500 kB`，但构建成功；本次 Phase 6 未引入新的构建失败项

新增测试覆盖：

- `shared/timing.test.ts`
- `server/controllerApi.test.ts`
- `server/wsServer.test.ts`

本地已验证：

- 默认 receiver config 包含 timing 状态
- pulse-synced press 在 tolerance 边界上判定为 hit
- tolerance 刚好超出时判定为 miss
- pulse inactive 时使用 fallback `timingValue`
- timing progress 跨多个 beat interval 会继续循环，不会停在 `1`
- HTTP 可设置 timing module state
- receiver timing attempt 会转发到 Unity socket
- timing attempt 会写入服务端日志
- `GET /api/controller/timing/export` 返回 hits / misses / attempts

## 4.2 线上验证状态

按仓库 Zeabur 测试策略，Phase 6 涉及：

- Socket.IO timing event
- pulse sync
- receiver/controller 集成边界
- 生产构建链路
- 多设备网络环境下的时序表现

因此 Phase 6 完成后应进行 Zeabur 真机联测。

当前 closeout 记录的是本地完整验证结果；线上真机联测仍建议补做：

- 保持 Zeabur 单副本
- 打开 `/controller`
- 打开至少一个 `/receiver/:id`
- 启动 pulse
- 启用 timing challenge
- 连续点击 `Press On Beat`
- 确认 timing bar 按 beat 循环
- 确认 Unity socket 或导出接口可收到 attempts
- 执行 `GET /api/controller/timing/export`

## 5. 已知限制与后续建议

### 5.1 Timing 对齐对象

当前 timing challenge 对齐的是 server pulse clock，不是当前播放 track 的 audio playback position。

这意味着：

- 它适合测试“用户是否跟共享节拍按下按钮”
- 它不保证当前播放 track 的实际音频相位与 timing bar 完全一致
- 它不做 track start quantization

如果后续需要 track-level beat alignment，需要新增：

- track playback start scheduling
- beat-quantized delayed start
- audio playback clock / phase tracking
- 每个 track 与 pulse 的 offset 管理

### 5.2 Timing Session 生命周期

当前实现记录 attempts，但没有单独的 timing session ID。

如果后续需要按轮次导出，可增加：

- `timingSessionId`
- start / stop timing session command
- per-session export
- clear timing attempts command

### 5.3 持久化

Timing attempts 当前存于内存，与 Socket.IO receiver state 一致。

如果后续需要长期保存，应接入数据库或 recording phase。

## 6. 对外测试文档

教授/Unity 侧可优先参考：

- `docs/professor-plug-and-play-commands.md`

其中包含：

- pulse payload
- timing payload
- timing export
- track regrouping
- map payload
- reset

Polling / voting 单独参考：

- `docs/polling-system-payloads.md`

## 7. 收尾结论

Phase 6 已完成 Timing Challenge Mode 的核心交付：

- receiver 可见的 timing bar
- target indicator
- tolerance 配置
- pulse-synced 判定
- 可重复 hit/miss attempt
- Unity 实时事件
- JSON export fallback

当前可作为 Phase 7 或后续 polish 的基础继续推进。

需要注意的是：如果教授后续明确要求“根据当前 track 播放位置做 beat alignment”，那是新的功能范围，不属于当前 Phase 6 已实现的 timing challenge。
