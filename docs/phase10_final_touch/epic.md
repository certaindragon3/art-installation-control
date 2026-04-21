# Phase 10: Final Touch / Receiver-Led Sound Economy

**对应反馈:** Final touch notes, receiver UI screenshot, `SoundEconomy.cs`

**依赖:** Phase 8, Phase 9, Phase 5, Phase 6

**优先级:** 当前最终交付收口。Phase 10 只做音乐经济系统和 receiver 学生端 UI；`ColorHitGame.cs` 已拆到 Phase 11。

## 原始材料

- `source/final_touch.md` - 教授 final touch 文本反馈。
- `source/final_touch_UI(receiver).png` - 教授期待的 receiver 端基础 UI 参考。
- `source/SoundEconomy.cs` - 货币 / 音频消耗经济系统参考。
- `../phase11_color_challenge/source/ColorHitGame.cs` - 颜色计分玩法参考，Phase 11 再做。

这些 C# 文件应视为行为参考，不是要直接运行在当前 Web 项目里的代码。Web 版本的权威状态仍应放在 Node server 内存中，并继续遵守单副本部署约束。

## 已确认决策

- Phase 10 只实现 SoundEconomy；ColorHitGame 拆到 Phase 11。
- Receiver 播放走新增 `request_track_play` / `request_track_stop`，减少解释成本和绕过扣费的风险。
- Receiver 看到 controller 设置为 visible 的全部 tracks，不做随机 slots。
- Track cost 的 duration 来自自动生成的 manifest metadata，不手填 120 个 duration。
- Currency / inflation / game over 沿用教授 `SoundEconomy.cs` 默认逻辑。
- Track folder colors 从音频 folder / manifest category 推导，不恢复 group workflow。
- `/controller` 继续可直接访问，但 Home page 不暴露 controller 入口给学生。
- Controller 手动 play / pause 保持现状，作为 operator debug / demo / emergency control。
- Phase 9 movement 以当前协议为准，重点复核 `loop: true` 是否持续循环。
- 自动生成给 Unity 使用的 JSON cue 单段建议不超过 10 秒；runtime API 不全局硬拒绝更长 duration。

D9 production verification completed on 2026-04-20 with `agent-browser` against `https://artinstallation.certaindragon3.work`. Evidence is stored in `evidence/phase10-loop-movement-agent-browser.md`.

Phase 10 local implementation validation completed on 2026-04-20. Evidence is stored in `evidence/phase10-local-validation.md`.

## 背景

教授这次反馈把系统重心从“controller 远程播放 receiver 音频”转向“receiver 学生自己决定何时播放可见音轨”。Controller 的职责更接近：

1. 决定哪些 tracks 对学生可见。
2. 配置经济参数、地图、投票等模块。
3. 观察 receiver 状态和导出结果。
4. 保留手动 play / pause，方便 operator 调试和现场解释。

Receiver 的职责变成：

1. 根据自己的 currency / game state 做播放选择。
2. 只操作当前 UI 展示出的 visible tracks。
3. 在投票打开时维持现有投票交互，并暂停其他 receiver 操作。

正式演出流应让 receiver 发起播放请求，由 server 判断是否允许、扣费、更新状态并广播。

## 目标

1. 把 `SoundEconomy.cs` 的 currency + inflation + audio cost 规则迁移到服务端权威状态。
2. 重做 receiver 主 UI，使它接近教授截图：身份和颜色在顶部，可选状态区自适应，紧凑 track card 显示 cost / progress / play / loop。
3. 复核 track list payload，确保学生看到的 tracks 一定可播放，并且 cost 可由可靠 metadata 计算。
4. 复核 Phase 9 loop movement：`loop: true` 时 marker 应不断从 start 到 target 循环移动。
5. 从 Home page block / hide controller 入口，但保留 `/controller` 直接访问。

## 范围

### 10.1 Track Payload + Duration Metadata

教授反馈里的 “Double-check track list payload” 和 “Players always need to be able to play the tracks when shown” 应先处理，因为经济系统依赖可靠 track duration 和 playable 状态。

扩展 track manifest 或 runtime track state：

```typescript
interface TrackDefinition {
  trackId: string;
  label: string;
  url: string;
  durationSeconds: number;
  categoryId: string;
  categoryColor: string;
}
```

行为要求：

- `trackId` 必须继续和 `set_visible_tracks` payload 一致。
- 所有 visible tracks 必须有可访问的 `url`。
- 所有 visible tracks 默认应 `playable: true`，除非 receiver 已 game over、正在投票锁定，或 operator 显式禁用。
- Server 使用 manifest `durationSeconds` 计算 cost，不依赖浏览器临时读取 audio duration。
- `categoryId` 默认来自音频文件夹。
- `categoryColor` 由 category 稳定映射，用于 receiver track card accent。
- 不恢复旧的 group-based 操作流。

推荐实现：

- Audio manifest generator 自动读取 duration。
- 读取失败时输出 warning 和文件列表。
- Overrides 文件可手动修正个别 track 的 duration / category。
- 没有 duration 的 track 不进入 economy play flow，除非配置保守 fallback cost。

### 10.2 Server-Authoritative Sound Economy

将 `SoundEconomy.cs` 的逻辑移到 server：

```typescript
interface EconomyConfig {
  visible: boolean;
  enabled: boolean;
  currencySeconds: number;
  startingSeconds: number; // default 30
  earnRatePerSecond: number; // default 0.25
  refreshIntervalMs: number; // default 30000
  inflation: number; // default 1
  inflationGrowthPerSecond: number; // default 0.025
  inflationGrowsWhilePlaying: boolean; // default true
  currentTrackId: string | null;
  playStartedAt: string | null;
  playEndsAt: string | null;
  gameOver: boolean;
  lastUpdatedAt: string;
}
```

默认行为沿用教授 C#：

- Receiver 注册后获得 `startingSeconds = 30`。
- Economy 默认 `enabled = false`，教授显式开启后才进入正式 economy flow。
- Idle / silence 时 currency 按 `0.25 second per real second` 增长。
- Playing 时 currency 不增长。
- Inflation 从 `1` 开始，以 `0.025` 的秒级复利增长。
- `inflationGrowsWhilePlaying = true`，播放时 inflation 也增长。
- Cost = `basePrice * inflation`；若未配置 `basePrice`，runtime 可兼容回退到 `durationSeconds`。
- 目标调参是让默认配置在约 3 分钟内进入“等待也买不起任何 track”的破产区间。
- Currency 不足时 receiver game over。

Server 用 lazy evaluation 更新 currency / inflation：在收到命令、请求 snapshot、播放结束、定时清理等边界计算经过时间，不需要每帧 tick。

### 10.3 Receiver-Initiated Playback Protocol

新增正式 gameplay command：

```typescript
interface RequestTrackPlayPayload {
  trackId: string;
}

interface RequestTrackStopPayload {
  trackId: string;
}
```

示例：

```json
{
  "command": "request_track_play",
  "targetId": "receiver-a",
  "payload": { "trackId": "metal_hit_03.wav" }
}
```

播放请求校验：

- Economy enabled。
- Receiver 未 game over。
- Vote 当前未锁定 receiver 操作。
- Track 当前 visible。
- Track 有有效 URL 和 duration。
- Track playable / enabled。
- Receiver 当前没有其他 track 正在播放。
- Currency 扣除 cost 后不为负。

通过后：

- Server 扣费。
- 设置 `currentTrackId`。
- 设置该 track `playing: true`。
- 写入 `playStartedAt` / `playEndsAt`。
- 广播 receiver state。

拒绝后：

- 不播放音频。
- 若原因是 currency 不足，进入 game over。
- Receiver UI 显示无法播放或 game over 状态。

兼容：

- `set_track_state` 保留给 controller/debug。
- Receiver 不应能通过 `set_track_state playing:true` 绕过 economy。
- Controller 手动 play / pause 保持现状，用于你的现场解释和 emergency control。

### 10.4 Receiver UI Final Touch

基于截图，receiver 页面应调整为学生可直接理解的 mobile-first 主体验。

布局：

- 深色 full-screen receiver surface。
- 顶部显示 icon / assigned color / player label。
- 中部 optional status 区：
  - 可展示 map、currency、score display 或 text。
  - 内容为空时不渲染。
  - 自适应高度，避免挤压 track list。
- Vote UI 保持当前独立投票流，不放进 optional status 区。
- Track list 是手机优先的紧凑列表。

Track card 要求：

- 高度小，适配手机单手浏览。
- 显示 `Cost: N seconds`。
- 显示 play button。
- 显示 track name，长文件名要截断或换行但不能撑破布局。
- 显示 progress / fill bar。
- 显示 loop toggle。
- 用 `categoryColor` 做视觉区分。

Poll / vote：

- 当前 vote UI 保留。
- 需要复核多选项在手机 viewport 内不溢出。
- Vote 打开时继续锁定其他 receiver 操作。

### 10.5 Controller Final Flow

Controller 不再是正式演出流里“替学生播放音乐”的主角色，但保持手动控制能力。

保留：

- Receiver list and status。
- Visible track selector。
- Tracks, markers, volume, manual play / pause。
- Voting control。
- Map movement control。

新增：

- Economy enable / disable。
- Reset / revive receiver economy。
- Starting seconds。
- Earn rate。
- Inflation growth。
- Inflation grows while playing。
- Refresh interval display / reset behavior。
- Game over status。

不做：

- 不隐藏 controller manual play / pause。
- 不恢复 group editor 作为主要 workflow。
- 不做 passcode / secret route。

### 10.6 Controller Entry Block On Home

教授反馈：“Don't expose the controller to students.”

本 phase 的决策是：`/controller` 保留直接访问，但 Home page 不显示 controller 入口。

行为：

- 学生从 `/` 不应看到 obvious controller card / button。
- Operator 直接输入 `/controller` 仍可进入。
- 不做账号系统。
- 不做 secret controller route。

### 10.7 Phase 9 Loop Movement Verification

Phase 10 不重新设计 movement。需要复核：

- `loop: true` 时 receiver marker 是否不断从 start 移到 target。
- `loop: false` 时 receiver marker 是否停在 target。
- 浏览器端插值是否仍是本地 `requestAnimationFrame` / time-based rendering。
- Socket.IO 不应每帧发送 position。

如果 Unity 侧需要 final touch style payload，可以文档化最小映射，但 Phase 10 不实现 finite `loop_times`：

```json
{
  "student id": "receiver-a",
  "start_position": { "x": 0.1, "y": 0.8 },
  "end_position": { "x": 0.9, "y": 0.2 },
  "interpolation_time": 5,
  "loop_times": 0
}
```

映射建议：

- `student id` -> `targetId`。
- `start_position` -> `movement.fromX/fromY`。
- `end_position` -> `movement.toX/toY`。
- `interpolation_time` seconds -> `durationMs`。
- `loop_times: 0` -> `loop: false`。
- `loop_times > 0` -> 先映射为 `loop: true`，finite loops defer。

### 10.8 Unity JSON Duration Guidance

教授的 “No more than 10 seconds for each created Json” 作为生成 JSON cue 的工程约束处理。

规则：

- 自动生成给 Unity 使用的 cue JSON，单段 duration 应 `<= 10s`。
- 如果一个 movement / cue 要持续更久：
  - 优先用 `loop: true`。
  - 或由 generator 拆成多个 `<=10s` segments。
- Server runtime 不全局硬拒绝超过 10 秒的 duration，避免破坏手动调试和已有 Phase 9 控制。
- 文档示例默认使用 `durationMs <= 10000`。

## 非目标

- 不做 Phase 11 ColorHitGame。
- 不做水平扩展；Socket.IO 内存状态仍为单副本。
- 不把 C# 作为权威运行时；C# 仅作为 Web 实现参考。
- 不做 controller 登录、passcode 或 secret route。
- 不恢复 group-based 操作流。
- 不把 map movement 改回每帧推送。
- 不重写当前 voting UI。
- 不删除 controller 手动 play / pause。

## 验收标准

- [x] Phase 10 source files 已归档到 `docs/phase10_final_touch/source/`。
- [x] `ColorHitGame.cs` 已拆到 `docs/phase11_color_challenge/source/`。
- [x] Track payload 中所有 visible tracks 都有有效 `trackId`、`label`、`url`、`durationSeconds`、`categoryId`、`categoryColor`。
- [x] Track duration 可由 server 读取，用于 cost 计算。
- [x] Receiver 上显示的 track 一定可播放，除非 vote lock、game over 或明确 disabled。
- [x] Receiver 点击 play 使用 `request_track_play`，由 server 做 economy 校验和扣费。
- [x] Receiver 不能通过 `set_track_state playing:true` 绕过 economy。
- [x] Currency 只在 idle / silence 时增长。
- [x] Inflation 随时间增长，且默认播放时也增长。
- [x] Cost 显示为 seconds，且与 server 扣费一致。
- [x] Currency 不足时 receiver game over，音频停止，track 操作禁用。
- [x] Controller 能 reset / revive receiver economy。
- [x] Receiver UI 是 mobile-first 紧凑 track list。
- [x] Vote UI 仍可覆盖并锁定其他 receiver 操作。
- [x] Poll / vote 在移动和桌面视口内不溢出。
- [x] Home page 不暴露 controller 入口。
- [x] `/controller` 直接访问仍可用。
- [x] Controller 手动 play / pause 保持可用。
- [x] Phase 9 duplicate receiver ID 行为重新验证。
- [x] Phase 9 `loop: true` movement 重新验证为持续循环移动。
- [x] 自动生成 / 文档推荐的 Unity cue JSON 单段不超过 10 秒。
- [x] 本地 `corepack pnpm check`、`corepack pnpm test`、`corepack pnpm build` 通过。
- [x] 若实现涉及 Socket.IO、生产路由或 Home/Controller 路由行为，完成单副本 Zeabur 多端验证。

## 测试建议

- Economy unit tests：
  - idle 10 秒后 currency 增长约 10。
  - playing 10 秒时 currency 不增长。
  - inflation 在 idle 和 playing 时都增长。
  - cost = duration \* inflation。
  - cost 恰好等于 currency 时允许播放。
  - cost 超过 currency 时 game over。
  - game over 后不能播放任何 track。
- Socket tests：
  - receiver 发起 `request_track_play`，controller 只观察状态更新。
  - receiver 不能播放 hidden / missing duration / not playable track。
  - receiver 不能通过 `set_track_state playing:true` 绕过 economy。
  - vote 打开时 receiver track 操作被锁定。
- UI tests：
  - receiver phone viewport。
  - receiver desktop / projected viewport。
  - 10+ visible tracks 时列表仍可用。
  - 长 track name 不撑破卡片。
  - vote options 多于两项时仍 fit screen。
  - optional status 区为空时不占位。
- Integration tests：
  - 2 个 receiver 同时玩 economy，currency 独立。
  - controller broadcast visible track list 后，两个 receiver 都看到对应 tracks。
  - duplicate receiver ID 仍自动分配唯一最终 ID。
  - movement `loop: true` 持续循环，`loop: false` 停在 target。

## 交付顺序

1. Phase 10 / Phase 11 文档拆分和路线图更新。
2. Track manifest duration + category metadata。
3. Server economy model。
4. `request_track_play` / `request_track_stop` protocol。
5. Receiver mobile-first economy UI。
6. Controller economy controls。
7. Home page block / hide controller entry。
8. Phase 9 loop movement verification。
9. Unity JSON duration guidance update。
10. Local validation, then Zeabur single-replica multi-device validation if code changed.
