# Phase 10 Decisions

这个文件记录已确认的 final touch 决策。Phase 10 的执行目标是减少现场解释成本和手工维护成本，优先把教授的 `SoundEconomy.cs` 逻辑稳定落到 Web 项目里。

## D1 Scope

**Decision: A. Phase 10 只做 SoundEconomy，ColorHitGame 拆到 Phase 11。**

Phase 10 专注：

- receiver-led playback。
- currency / inflation / cost / game over。
- mobile-first receiver track UI。
- track payload / duration / folder color metadata。
- Phase 9 loop movement 复核。

`ColorHitGame.cs` 拆到 `docs/phase11_color_challenge/`，避免 Phase 10 同时承担两个 gameplay system。

## D2 Playback Authority

**Decision: 新增 `request_track_play` / `request_track_stop`。**

虽然复用 `set_track_state` 的代码量更少，但它会把正式 gameplay 和 debug patch 混在一起。为了减少你后续解释成本，Phase 10 应新增语义明确的 receiver playback command：

```json
{
  "command": "request_track_play",
  "targetId": "receiver-a",
  "payload": { "trackId": "metal_hit_03.wav" }
}
```

理由：

- Receiver 点击 play 时，server 可以集中做 economy 校验、扣费、game over 判断。
- Controller 仍可保留原来的手动 play / pause，作为你的 debug / demo 工具。
- 代码语义更容易向教授解释：学生请求播放，server 判断能不能播放。

Implementation note:

- `set_track_state` 继续保留给 controller/debug。
- Receiver 来源的 `set_track_state playing:true` 不应绕过 economy；最好禁止 receiver 用它直接开播，或只允许在 economy disabled 时使用。

## D3 Track Offers

**Decision: A. Receiver 看到 controller 设为 visible 的全部 tracks。**

不做随机 slots。Controller 设置的 visible track list 就是学生可见列表。

UI 要求：

- Track card 必须做小，mobile-first。
- 手机上每条 track 应是紧凑横向卡片，而不是大面板。
- 多 track 时使用窄高度列表；优先保证 play、track name、cost、loop、progress 可见。
- 不恢复 group dropdown。

## D4 Track Cost Source

**Decision: 自动从 manifest / generator 写入 `durationSeconds`，减少手工维护。**

不要让你手动填 120 个 duration，也不要依赖浏览器把 duration 回传给 server。

推荐工程方案：

- Audio manifest generator 扫描音频文件。
- 尽量自动读取每个文件的 duration。
- 生成 `durationSeconds` 到 `trackManifest.generated.ts` 或等价 manifest。
- 若某个文件 duration 读取失败，生成器报 warning，并给出需要人工处理的文件列表。

Fallback：

- 单条 track 可允许 overrides 文件修正 duration。
- 没有 duration 的 track 不应进入 economy play flow，除非显式使用保守 fallback cost。

## D5 Currency Growth And Inflation

**Decision: 沿用教授 `SoundEconomy.cs` 逻辑。**

默认参数：

- `startingSeconds = 30`
- `earnRatePerSecond = 1`
- `refreshInterval = 30s`
- `inflationStart = 1`
- `inflationGrowthPerSecond = 0.02`
- `inflationGrowsWhilePlaying = true`

行为：

- Silence / idle 时 currency 增长。
- Playing 时 currency 不增长。
- Inflation 默认一直增长，包括播放时。
- Cost = track duration seconds * current inflation。
- 播放结束后刷新 visible/offered track UI 状态，但 Phase 10 不做随机 slots。

## D6 Game Over

**Decision: A. Currency 不足直接 game over。**

沿用教授参考：

- 播放请求扣费后若 currency 会变成负数，则 receiver game over。
- Game over 后停止音频。
- Game over 后禁用 track 操作。
- Controller 需要 reset / revive 操作，方便你现场恢复。

## D7 Track Folder Colors

**Decision: A. 从音频文件夹 / manifest category 推导颜色。**

实现方向：

- Manifest generator 记录 `categoryId`，默认来自音频文件所在 folder。
- `categoryColor` 由 category 稳定映射出来。
- Receiver track card 用 `categoryColor` 做 play button 或左侧 accent。
- 不恢复 group-based 操作流。

## D8 Controller Access

**Decision: 保留 `/controller` 直接地址；主页面 block / hide controller entry。**

这里不做 secret route，也不做 passcode。你的现场使用路径仍是 `/controller`。

实现要求：

- Home page 不再暴露明显的 Controller 入口给学生。
- 学生从首页只看到 receiver 入口或说明。
- 直接访问 `/controller` 仍可打开，方便你自己操作和解释。

## D9 Movement Loop Verification

**Decision: 以现有 Phase 9 协议为准，重点复核 `loop: true` 是否持续循环移动。**

目前代码层面的预期行为应是：

- `loop: true`：receiver 端用 elapsed modulo duration 计算 progress，marker 从 start 到 target 不断重复。
- `loop: false`：播放一次，停在 target。

Phase 10 要做的是验证而不是重新设计：

- 开 receiver 页面发送 movement。
- 确认 `loop: true` 反复从 start 移到 target。
- 确认没有 WebSocket 每帧推送位置。
- 若教授 payload 里出现 `loop_times`，文档中先映射为现有 `loop` boolean；finite loop 次数不作为 Phase 10 必做。

## D10 JSON Duration

**Decision: 工程上把自动生成给 Unity 使用的 JSON cue 控制在 10 秒以内；runtime API 不硬性全局拒绝更长 duration。**

解释：

- 教授的意思更像是“Unity 控制 JSON 不要太长，方便组织和触发”。
- 因此对自动生成 / 文档推荐的 cue JSON，单段 duration 应 `<= 10s`。
- 如果需要更长移动或效果：
  - 优先用 loop。
  - 或由 generator 拆成多个 `<=10s` segments。
- Server runtime 仍保留 Phase 9 的安全 clamp，避免手动测试时因为超过 10 秒直接失败。

这能兼顾教授的使用习惯和你的调试便利。

## D11 Controller Manual Playback

**Decision: C. 保持现状。**

Controller 手动 play / pause 不从 UI 删除，也不强制隐藏。

解释口径：

- 正式 student gameplay 使用 receiver-led economy。
- Controller 手动 play / pause 是 operator debug / demo / emergency control。
- 如果现场要减少误操作，之后可以再加 Advanced 折叠区，但 Phase 10 不要求。
