# Phase 9: Unique Receivers + Animated Map Movement

**对应反馈:** Unique receiver IDs, map movement from start position to target position

**依赖:** Phase 1, Phase 5

**优先级:** 当前新增教授反馈。优先处理现场稳定性和 Unity 数据量问题，再继续 optional 或视觉扩展。

## 背景

教授提出两个新的演出现场需求：

- 每个 receiver 必须唯一。如果出现重复 receiver ID，系统应自动在末尾追加数字。
- Unity 不能在每一帧发送用户位置，数据量太大。Unity 应只发送 starting position 和 target position，网页端通过 Socket.IO 下发的状态自行做插值动画，建议可循环约 20 秒。

当前系统中，receiver ID 由 URL 或输入框直接决定。服务端用 `receiverId` 作为 `Map` key，如果两个浏览器注册同一个 ID，后注册者会覆盖状态中的 `socketId`，但旧 socket 可能仍留在同一个 Socket.IO room，现场会出现命令投递和状态列表不一致的问题。

当前 map 状态来自 Phase 5，模型是单点 `playerPosX` / `playerPosY`。这适合低频定位和测试，但不适合 Unity 每帧推送连续运动。

## 目标

1. 服务端保证 receiver 的最终 ID 唯一，避免重复页面共享同一个控制目标。
2. receiver 断线重连时尽量保留原 ID，不因为普通刷新产生不必要后缀。
3. Unity / HTTP / Controller 能发送一次 map movement command，包含起点、终点、时长和是否循环。
4. receiver 浏览器本地用时间插值渲染 marker 运动，避免 WebSocket 高频位置消息。
5. 保留 Phase 5 的 instant map position 兼容能力，降低已有测试和临时调试流程的破坏面。

## 范围

### 9.1 Unique Receiver Identity

新增 receiver browser instance identity：

```typescript
interface ReceiverRegistration {
  receiverId: string;
  label?: string;
  clientInstanceId?: string;
}
```

行为：

- receiver 页面生成并持久化 `clientInstanceId` 到 `sessionStorage`，同一 tab 刷新可保留身份，不同 tab 仍会被视为不同 receiver。
- 注册时继续提交期望的 `receiverId`。
- 服务端分配最终 receiver ID：
  - 期望 ID 未被占用：直接使用，例如 `A`。
  - 期望 ID 已被同一个 `clientInstanceId` 的离线 receiver 占用：视为同一 tab 刷新/重连，继续使用原 ID。
  - 期望 ID 已被其他在线设备占用：追加数字，例如 `A2`、`A3`。
  - 已离线但仍在 retention window 内的 receiver 是否占用 ID，按 `clientInstanceId` 判断：同一实例可 reclaim，不同实例应分配新后缀，避免现场误覆盖。
- 服务端向 receiver 回传最终状态，receiver 页面应展示最终 `receiverId`。
- Controller 列表只展示最终唯一 ID。

实现注意：

- 必须清理旧 room membership，避免同一个 socket 从 `receiver:A` 改到 `receiver:A2` 后仍收到 `A` 的命令。
- `targetId = "*"` 语义不变。
- HTTP controller API 继续以最终 receiver ID 为控制目标。

### 9.2 Map Movement Command

扩展 `MapConfig`，新增可选 movement 状态：

```typescript
interface MapMovementConfig {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  startedAt: string;
  durationMs: number;
  loop: boolean;
}

interface MapConfig {
  visible: boolean;
  enabled: boolean;
  playerPosX: number;
  playerPosY: number;
  movement: MapMovementConfig | null;
}
```

推荐 Unity / HTTP payload：

```json
{
  "command": "set_module_state",
  "targetId": "receiver-a",
  "payload": {
    "module": "map",
    "patch": {
      "movement": {
        "fromX": 0.1,
        "fromY": 0.8,
        "toX": 0.9,
        "toY": 0.2,
        "durationMs": 20000,
        "loop": true
      }
    }
  }
}
```

行为：

- `fromX` / `fromY` / `toX` / `toY` 全部按 normalized `0..1` 处理，并由服务端 clamp。
- `durationMs` 默认 `20000`，并设置合理上下限，避免 `0` 或极大值。
- `startedAt` 可由 payload 提供；未提供时服务端写入当前时间。
- `loop: true` 时 receiver 按 duration 循环从起点到终点。
- `loop: false` 时动画结束后停在目标点。
- instant position payload 仍然支持 `playerPosX` / `playerPosY` 或兼容字段 `x` / `y`。
- 收到新的 instant position 时，应清空 `movement`，作为手动定位/重置行为。
- 收到新的 movement 时，应同步更新 `playerPosX` / `playerPosY` 到 target position，保证 controller snapshot 能反映最终目标。

### 9.3 Receiver Map Animation

- `ClassroomMap` 支持传入 animated / resolved position。
- receiver 页面用 `requestAnimationFrame` 或等价 React hook 根据 `movement.startedAt`、`durationMs`、`loop` 计算当前位置。
- 插值先使用 linear interpolation，避免和 Unity 侧产生不可解释偏差。
- 页面显示当前起点、目标点、时长和 loop 状态，便于现场调试。
- 投票锁定等已有 receiver 行为不受影响。

### 9.4 Controller / Unity Documentation

- Controller UI 将 map 主流程从单点 slider 扩展为 start/end movement 控制：
  - start X / start Y
  - target X / target Y
  - duration seconds
  - loop toggle
  - send movement
  - stop movement / set instant position
- 更新教授可用命令文档，明确 Unity 不需要每帧推送位置。
- 文档中保留 instant position 示例，标注为 debug / manual placement。

## 非目标

- 不把插值改为服务端每帧广播。服务端只保存 movement config，receiver 本地按时间渲染。
- 不支持复杂路径、多段路径或曲线轨迹；本阶段只做 start to target。
- 不引入多人地图碰撞、路径规划或物理模拟。
- 不删除 Phase 5 的 `playerPosX` / `playerPosY`。
- 不改变单副本部署约束。

## 验收标准

- [x] 两个不同浏览器实例注册相同 receiver ID 时，最终 ID 自动变为唯一，例如 `screen-a` 和 `screen-a2`。
- [x] 同一浏览器实例刷新或断线重连时，优先保留原 receiver ID。
- [x] receiver 变更最终 ID 后不会残留在旧 Socket.IO room。
- [x] Controller receiver list 只显示最终唯一 ID，并能分别控制重复来源的 receiver。
- [x] HTTP `GET /api/controller/receivers` 返回最终唯一 ID。
- [x] `set_module_state` map patch 支持 `movement` payload。
- [x] movement 坐标越界值会在服务端 clamp 到 `0..1`。
- [x] movement 默认时长为约 20 秒，且可通过 payload 配置。
- [x] receiver map marker 能从起点插值到目标点。
- [x] `loop: true` 时动画持续循环；`loop: false` 时停在目标点。
- [x] instant position payload 仍可设置 `playerPosX` / `playerPosY`，并会停止当前 movement。
- [ ] Controller 提供 start / target / duration / loop 的 movement 控制入口。
- [x] 更新 Unity / HTTP 命令文档，教授能直接复制 payload 测试。
- [x] 本地 `pnpm check`、相关 `vitest` 和 `pnpm build` 通过。
- [ ] 若代码涉及 Socket.IO 或生产集成行为，完成单副本 Zeabur 多端验证。

## 测试建议

- Receiver uniqueness：
  - 用两个 socket client 同时注册相同 `receiverId`，断言状态列表包含两个不同 ID。
  - 用同一个 `clientInstanceId` 先注册、断线、再注册，断言 ID 不变。
  - 注册后向两个最终 ID 分别发命令，断言不会交叉收到命令。
- Map movement：
  - HTTP 和 Socket.IO 都发送 movement payload。
  - 测试 `durationMs` 缺省、越界和合法值。
  - 测试坐标 clamp。
  - 测试 instant position 清空 movement。
- Browser validation：
  - 开 1 个 controller 和 2 个 receiver 页面，手动制造重复 ID。
  - 发送 20 秒 loop movement，确认 marker 平滑运动且 WebSocket 不产生每帧位置消息。

## 交付顺序

1. Phase 9 epic and docs skeleton.
2. Receiver unique ID protocol + server allocation + tests.
3. Receiver client `clientInstanceId` persistence and final ID display.
4. Map movement shared types + server normalization + tests.
5. Receiver map interpolation rendering.
6. Controller movement controls.
7. Unity / HTTP command docs update.
8. Local validation, then Zeabur single-replica validation if Socket.IO behavior changed.
