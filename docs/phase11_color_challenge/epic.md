# Phase 11: Color Challenge / Score Game

**对应反馈:** `ColorHitGame.cs`

**依赖:** Phase 10

**优先级:** Phase 10 完成后再做。它是独立 score gameplay，不阻塞 receiver-led sound economy。

## 原始材料

- `source/ColorHitGame.cs` - 教授提供的 Unity/C# color hit game 参考。

## 背景

`ColorHitGame.cs` 和 `SoundEconomy.cs` 是两个不同玩法：

- Phase 10 的 `SoundEconomy` 决定学生如何用 currency 播放音乐。
- Phase 11 的 `ColorHitGame` 决定学生如何通过颜色选择获得或失去 score。

为了降低 Phase 10 风险，Color Challenge 独立成后续 phase。

## 目标

1. 将 `ColorHitGame.cs` 的 score / color choice / timing reward 迁移为 Web 版本。
2. Receiver 本地立即结算每轮并立即切到下一轮，避免把网络 RTT 暴露给玩家。
3. Server 负责 round / score / game over 的校验、追认、导出和对 controller / Unity 的状态广播。
4. Controller 可开启、关闭、重置或配置 Color Challenge。
5. Score 结果可被 Unity / external controller 观察或导出。

## 范围

### 11.1 Config Model

建议新增独立 module：

```typescript
interface ColorChallengeConfig {
  visible: boolean;
  enabled: boolean;
  score: number;
  startingScore: number;
  assignedColorId: string | null;
  palette: Array<{ colorId: string; label: string; color: string }>;
  choices: Array<{ colorId: string; label: string; color: string }>;
  correctChoiceIndex: number | null;
  iterationStartedAt: string | null;
  iterationDurationMs: number;
  minIntervalMs: number;
  maxIntervalMs: number;
  maxReward: number;
  minWrongPenalty: number;
  maxWrongPenalty: number;
  missPenalty: number;
  refreshAssignedColorEachIteration: boolean;
  gameOver: boolean;
}
```

### 11.2 Server Gameplay

- Receiver 注册后可获得初始 score。
- Receiver 本地生成每轮 two-choice round，并带 `roundId` / `submissionId` / `nextRound` 提交。
- Server 校验当前 round、计算 score 变化、记录 export event，并把最新状态广播回 controller / receiver。
- 若 payload 缺少 receiver-led 字段，server 仍保留 legacy server-generated round 作为兼容 fallback。
- 每轮 choices 中必须包含 assigned color。
- `iterationStartedAt` 和 `iterationDurationMs` 继续作为 round 时间基准。
- Score 计算公式保持不变：

```typescript
const t = clamp01((pressedAt - iterationStartedAt) / iterationDurationMs);
const greenness = 1 - Math.abs(2 * t - 1);
```

- 正确点击奖励 `maxReward * greenness`。
- 错误点击扣分 `lerp(minWrongPenalty, maxWrongPenalty, greenness)`。
- 超时扣 `missPenalty`。
- Score <= 0 时 game over。

### 11.3 Receiver UI

- 显示 assigned color。
- 显示 score。
- 显示 red-green-red timing bar 和 pointer。
- 显示两个颜色按钮。
- Game over 后隐藏交互或禁用按钮。
- UI 必须 mobile-first，不能和 Phase 10 track economy 挤在一起。

### 11.4 Controller UI

- 开启 / 关闭 challenge。
- Reset score / revive。
- 设置 palette。
- 设置 timing interval、reward、penalty。
- 查看每个 receiver score 和 game over 状态。

## 非目标

- 不阻塞 Phase 10。
- 不把 score game 和 sound economy 强行合并成一个 game over 状态，除非后续确认需要。
- 不直接运行 C# 代码。

## 验收标准

- [x] `ColorHitGame.cs` 已归档到 Phase 11 source。
- [x] Server 能为 receiver 生成合法 two-choice round。
- [x] 每轮 choices 至少一个是 assigned color。
- [x] Receiver pointer 在 iteration duration 内移动。
- [x] 正确点击按 greenness 奖励。
- [x] 错误点击按 greenness 扣分。
- [x] 超时扣 miss penalty。
- [x] Score <= 0 时 game over。
- [x] Controller 可 reset / revive。
- [x] 本地 `corepack pnpm check`、`corepack pnpm test`、`corepack pnpm build` 通过。

## 建议交付顺序

1. Shared types and default config。
2. Server round generation and score calculation。
3. Receiver mobile UI。
4. Controller controls。
5. Tests and local validation。
