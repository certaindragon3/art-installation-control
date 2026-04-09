# Phase 2 收尾文档

**阶段名称：** Audio Enhancement  
**完成日期：** 2026-04-09  
**对应需求：** 1.1 Track Looping, 1.3 Track Groups / Sample Groups, 1.5 Volume Control

## 1. 本阶段交付概览

Phase 2 已完成以下能力：

- 每条 track 支持独立 loop 状态，默认关闭
- loop 控件支持显示 / 隐藏 / 锁定
- group 支持动态创建、重命名、改色、隐藏、禁用、删除
- track 支持在 group 之间重新分配
- receiver 端支持 group dropdown 展示，受限时灰化或隐藏
- receiver 端支持 volume popup，播放时按条件显示
- 点击 volume popup 外部区域时，停止播放并关闭 volume UI
- volume 使用对数映射（dB 到 gain）
- volume 连续交互继续遵守 `startInteraction` / `endInteraction`
- Unity / controller / receiver 三侧都可驱动同一套 phase2 状态

## 2. 主要代码变动

### 2.1 服务端状态与协议

- 为 unified command 新增 `remove_group`
- 修复 `TrackState.groupId` 与 `GroupState.trackIds` 的双向同步
- 对 `volumeValue` 做 0~1 clamp，避免写入非法值
- receiver 端现在允许只对“自己”发送 `set_track_state`，用于 volume popup、loop 等本地交互回写

涉及文件：

- `shared/wsTypes.ts`
- `server/controllerApi.ts`
- `server/wsServer.ts`
- `shared/audio.ts`

### 2.2 Controller UI

控制端已从 phase1 的基础音轨面板升级为 phase2 控制台：

- 新增 group 管理区
- 每条 track 新增 group 选择
- 每条 track 新增 loop 开关、loop visible、loop locked
- 每条 track 新增 volume popup visible / enabled 状态控制
- 新建 track 默认 `volumeControlVisible = false`

涉及文件：

- `client/src/pages/Controller.tsx`

### 2.3 Receiver UI

receiver 页面已从只读状态展示器升级为真实的 phase2 交互端：

- 根据 `groups` 动态渲染 sample group dropdown
- 根据 `group.visible` / `group.enabled` 控制展示和灰化
- 根据 `loopControlVisible` / `loopControlLocked` 控制 loop 按钮
- 根据 `volumeControlVisible` / `volumeControlEnabled` 控制 volume popup
- 仅在 `playing && volumeControlVisible && volumeControlEnabled` 时打开 volume popup
- 点击 popup 外部区域后触发停播并关闭弹层

涉及文件：

- `client/src/pages/Receiver.tsx`

## 3. API / 协议更新

## 3.1 无新增 HTTP 路由

Phase 2 没有新增 HTTP endpoint，仍复用现有接口：

- `GET /api/controller/receivers`
- `POST /api/controller/command`
- `POST /api/controller/clear-offline`
- `GET /api/config`

本阶段的 API 更新体现在 `POST /api/controller/command` 可接受的 unified command 扩展上。

## 3.2 新增 Unified Command

### `remove_group`

用于删除一个 group，并将该 group 下的 track 复位为 `groupId: null`。

```json
{
  "command": "remove_group",
  "targetId": "receiver-a",
  "payload": {
    "groupId": "group_a"
  }
}
```

## 3.3 扩展 `set_track_state`

Phase 2 重点使用以下字段：

```json
{
  "command": "set_track_state",
  "targetId": "receiver-a",
  "payload": {
    "trackId": "track_01",
    "patch": {
      "groupId": "group_a",
      "loopEnabled": true,
      "loopControlVisible": true,
      "loopControlLocked": false,
      "volumeValue": 0.33,
      "volumeControlVisible": true,
      "volumeControlEnabled": true
    }
  }
}
```

字段说明：

- `groupId`: 将 track 归入某个 group，或设为 `null`
- `loopEnabled`: loop 开 / 关
- `loopControlVisible`: receiver 是否显示 loop 按钮
- `loopControlLocked`: receiver 是否允许点击 loop 按钮
- `volumeValue`: 0~1 归一化音量值
- `volumeControlVisible`: receiver 是否允许展示 volume popup
- `volumeControlEnabled`: volume 是否由 receiver UI 控制

## 3.4 扩展 `set_group_state`

Phase 2 的 group 管理通过 `set_group_state` 完成：

```json
{
  "command": "set_group_state",
  "targetId": "receiver-a",
  "payload": {
    "groupId": "group_a",
    "patch": {
      "label": "Percussion",
      "color": "#22c55e",
      "visible": true,
      "enabled": true,
      "trackIds": ["track_01", "track_02"]
    }
  }
}
```

字段说明：

- `label`: dropdown 名称
- `color`: group 颜色
- `visible`: 是否显示该 group
- `enabled`: 是否允许交互
- `trackIds`: 可选，批量指定该 group 当前包含的 tracks

## 3.5 Legacy 兼容性

以下旧消息格式仍然继续兼容：

- `audio_control`
- `audio_playable`
- `color_change`
- `text_message`

其中 `audio_playable: false` 仍会自动归一化为：

```json
{
  "playable": false,
  "playing": false
}
```

## 3.6 Receiver 侧 Socket 回写能力

Phase 2 新增了一条重要约束：

- receiver socket 允许发送 `set_track_state`
- 但只允许操作自己的 `receiverId`
- 不允许 receiver 广播，也不允许修改其他 receiver

这项能力是为了支持：

- receiver 侧 volume popup 拖拽
- receiver 侧 loop 切换
- 点击 volume 外部区域后的停播回写

## 4. 数据模型补充

### 4.1 TrackState（Phase 2 相关字段）

```ts
interface TrackState {
  trackId: string;
  label: string;
  url: string;
  playing: boolean;
  playable: boolean;
  loopEnabled: boolean;
  loopControlVisible: boolean;
  loopControlLocked: boolean;
  volumeValue: number;
  volumeControlVisible: boolean;
  volumeControlEnabled: boolean;
  groupId: string | null;
}
```

### 4.2 GroupState

```ts
interface GroupState {
  groupId: string;
  label: string;
  color: string;
  visible: boolean;
  enabled: boolean;
  trackIds: string[];
}
```

## 5. 行为约定

### 5.1 Loop

- 默认 `loopEnabled = false`
- 若 `loopControlVisible = false`，receiver 不显示 loop UI
- 若 `loopControlLocked = true`，receiver 显示但不可点

### 5.2 Group

- group 列表是动态的，不做固定数量限制
- 若 `group.visible = false`，receiver 不显示该 dropdown 项
- 若 `group.enabled = false`，receiver 显示但灰化不可交互

### 5.3 Volume

- `volumeValue` 存储为 0~1 归一化值
- 播放时只有在 `volumeControlVisible && volumeControlEnabled` 下才打开 popup
- popup 外部点击会触发停播
- 映射逻辑为 `-60dB ~ 0dB` 的对数映射，再转换成 audio gain

## 6. 测试与验证

## 6.1 本地验证

以下命令均已通过：

```bash
corepack pnpm check
corepack pnpm test
corepack pnpm build
corepack pnpm start
```

其中：

- 测试总数：17
- 新增 phase2 相关测试覆盖：
  - shared audio helper
  - phase2 loop / group / volume HTTP 集成
  - broadcast + legacy `audio_playable`
  - receiver-scoped websocket 回写

## 6.2 Zeabur 验证

已在 Zeabur 环境完成验证：

- `GET /api/healthz` 返回 `{"ok":true}`
- `/controller` 正常返回 `200`
- `/receiver/:id` 正常返回 `200`
- 线上前端静态资源与本地 phase2 构建 hash 一致
- 使用真实 Socket.IO 客户端注册临时 receiver 后：
  - 成功创建 group
  - 成功下发 phase2 track 状态
  - 成功执行 receiver-scoped `set_track_state`
  - `/api/controller/receivers` 能看到同步后的 configVersion

## 7. 已知限制

- volume popup 的最终体验仍受浏览器 autoplay 策略影响
- 真机上的 performative interaction 手感仍建议继续人工回归测试
- 当前状态仍完全存于内存，Zeabur 必须保持单副本

## 8. 对后续阶段的影响

Phase 2 已为后续阶段提供稳定基础：

- Phase 3 可直接在现有动态 track 模型上加入 pulse / marker / fill
- Phase 4 可复用 receiver 侧状态驱动 UI 机制
- Phase 5/6 可继续沿用 `visible / enabled / config snapshot / interaction_event`
- group、loop、volume 已进入 `reset_all_state` 复位范围
