# Phase 1: Architecture Upgrade

**对应需求:** 0 (Networking), 7 (Global Reset), 8 (Unified Command), 9 (General Architecture)

## 目标

将现有简单消息系统重构为 state-driven + unified command 架构，为后续所有功能模块奠定基础。

## 范围

### 1.1 Unified Command Structure

重构 `ControlMessage` 为统一格式：

```typescript
interface UnifiedCommand {
  command: string;        // e.g. "update_track", "show_vote", "reset_all_state"
  targetId: string;       // receiver ID or "*"
  payload: Record<string, unknown>;
  timestamp: string;
}
```

替代现有的 `type + payload` 模式，向后兼容现有 HTTP API。

### 1.2 State-Driven Receiver Config

服务端维护完整的 receiver config JSON，下发给每个 receiver：

```typescript
interface ReceiverConfig {
  tracks: TrackState[];
  groups: GroupState[];
  pulse: PulseConfig;
  vote: VoteConfig | null;
  score: ScoreConfig;
  map: MapConfig;
  timing: TimingConfig;
  // ... 每个模块都有 visible / enabled 字段
}
```

- Config JSON 带 TTL，1 分钟过期后 receiver 需重新请求
- 所有模块支持 show / hide / enable / disable / reset

### 1.3 动态 Track 列表

替代硬编码的 `track1` / `track2`：

```typescript
interface TrackState {
  trackId: string;
  label: string;
  url: string;              // 预先上传到服务器的音频文件路径
  playing: boolean;
  playable: boolean;
  loopEnabled: boolean;
  loopControlVisible: boolean;
  loopControlLocked: boolean;
  volumeValue: number;
  volumeControlVisible: boolean;
  volumeControlEnabled: boolean;
  tempoFlashEnabled: boolean;
  fillTime: number;
  groupId: string | null;
}
```

### 1.4 postToUnity 机制

**技术选型：Unity 作为 Socket.IO client（`socket.io-client-csharp` 库）**

新增角色 `unity`，与 `controller` / `receiver` 并列：

```
Receiver (学生交互)
  → emit INTERACTION_EVENT
  → Server 转发到 unity room

Unity
  → emit CONTROL_MESSAGE（与 controller 等同权限）
  → Server 更新状态 + 转发给 receiver
```

前端封装 `usePostToUnity` hook：

- **离散事件**（按钮点击）：立即发送 `{ action, element, value, timestamp }`
- **连续事件**（音量/滑块）：仅发送 `startInteraction` + `endInteraction`（含 startValue, endValue, interactionDuration）

> **交付文档须注明：** Unity 端需安装 `socket.io-client-csharp` NuGet 包，文档需提供接入示例。

#### Unity 接入示例

1. Unity 通过 HTTP 调用 `POST /api/unity/register`
2. 读取响应中的 `socketServerUrl`、`socketPath` 和事件名
3. 使用 `socket.io-client-csharp` NuGet 包建立 Socket.IO 连接
4. 连接成功后 emit `register_unity`
5. 监听 `interaction_event` 获取网页交互事件，emit `control_message` 回传控制命令

```csharp
using SocketIOClient;

var registerInfo = await httpClient.PostAsync("/api/unity/register", null);
var socket = new SocketIO(socketServerUrl, new SocketIOOptions
{
    Path = socketPath,
    Transport = SocketIOClient.Transport.TransportProtocol.WebSocket
});

socket.OnConnected += async (_, _) =>
{
    await socket.EmitAsync("register_unity");
};

socket.On("interaction_event", response =>
{
    var interactionJson = response.GetValue().ToString();
    UnityEngine.Debug.Log($"Web interaction: {interactionJson}");
});

await socket.ConnectAsync();
```

### 1.5 Global Reset

实现 `{ command: "reset_all_state" }`，重置所有模块状态到默认值。

### 1.6 HTTP API 升级

保留现有 HTTP 端点向后兼容，新增：
- `POST /api/unity/register` — Unity 通过 HTTP 获取 Socket.IO 连接信息
- `GET /api/config` — 获取当前全局配置

## 验收标准

- [x] 统一 `{ command, targetId, payload }` 消息格式，旧格式自动迁移
- [x] Receiver 状态为 state-driven，服务端下发完整 config JSON
- [x] Config JSON 支持 1 分钟 TTL 过期
- [x] Track 列表动态化，支持增删改
- [x] Unity 可通过 Socket.IO 连接并实时接收 interaction events
- [x] 前端每个交互元素都通过 `postToUnity` 发送事件
- [x] Continuous values 仅发 startInteraction / endInteraction
- [x] `reset_all_state` 命令正常工作
- [x] 现有功能（audio play/pause, color, text）在新架构下回归通过
- [x] 类型检查 (`pnpm check`) 通过
- [x] 现有测试通过

## 测试建议（无 Unity 客户端）

- 本地打开一个 `/controller` 和至少两个 `/receiver/:id` 页面，确认注册、掉线重连、广播和单播都正常。
- 用浏览器 DevTools 或自写临时页面连接 `register_unity`，仅监听 `interaction_event`，验证 `postToUnity` 是否发出离散事件和 `startInteraction` / `endInteraction`。
- 用 HTTP 接口 `POST /api/controller/command`、`GET /api/config`、`POST /api/unity/register` 做回归测试，不依赖 Unity 也能覆盖协议层。
- 部署到 Zeabur 后至少再测一次 TTL 过期重拉、移动网络下的 Socket 重连，以及单副本部署是否保持正常。
