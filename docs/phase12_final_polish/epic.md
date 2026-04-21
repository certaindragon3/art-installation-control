# Phase 12: Final Polish / Demo Fixes

**对应反馈:** `docs/final_fix.md`

**依赖:** Phase 10, Phase 11

**优先级:** 当前最终交付收口。Phase 12 不再新增大玩法，而是集中处理教授现场反馈里的可复现问题、UI 收口和导出补强。

## 原始材料

- `../final_fix.md` - 教授最新收尾反馈列表。
- `../phase10_final_touch/closeout.md` - receiver-led economy 已交付行为基线。
- `../phase11_color_challenge/closeout.md` - Color Challenge 已交付行为基线。

暂不纳入本 phase 的外部依赖：

- 教授后续发送的 `~40` 个音频样本。
- 教授后续发送的教室地图 `.jpg`。
- 线下 meeting / 演示安排本身。

这些输入尚未到仓库，Phase 12 先把当前代码和现有素材能独立完成的部分收口。

## 背景

Phase 10 和 Phase 11 已把 economy 与 Color Challenge 两套玩法落到统一的 Web / Socket.IO 架构里，但 `final_fix.md` 说明现场演示仍有几类问题：

1. Color Challenge 的 timing bar 仍像“按 round duration 推进的填充条”，不够像教授想要的快速往返移动 marker。
2. Color Challenge 目前只有颜色判断，没有把“颜色选择”和“声音/track”绑定起来。
3. Receiver 顶部和 track 区仍暴露了若干不必要的 `Disabled` 状态，economy 关闭时 UI 解释成本偏高。
4. Economy 开关和 receiver 是否能播放 track 仍耦合，导致 economy off 时 student 端也失去可播放能力。
5. Controller 侧 map movement 的可视化和表单同步还不够可靠，容易让人误以为 remap/通信链路有问题。
6. 已有 scoreboard export 需要按“现场直接下载 economy + score system 成绩”的口径重新核对和暴露。
7. Visible tracks 现在总按 manifest 原始顺序显示，缺少随机化。

Phase 12 的目标是把这些问题一次性收敛到“可演示、可导出、可解释”的状态，而不是再开新的大系统。

## 目标

1. 把 Color Challenge 的 timing UI 改成独立于 round duration 的快速往返移动 bar，并支持每轮随机起始位置。
2. 让 Color Challenge 每轮和实际音频 track 建立绑定：正确选项来自当前可用 track 池，错误选项来自其它 track；receiver 能直接看到本轮目标 track 名称。
3. 清理 receiver UI 中与现场使用无关的 `Disabled` 文案，特别是 economy off 时的顶部状态卡和 challenge 说明文案。
4. 彻底解除 “economy enabled” 与 “receiver 能否播放 track” 的硬耦合；economy 关闭时只是不走扣费 / currency 判定，不应该把 track 功能整体关掉。
5. 复核 controller map movement 的表单同步和可视化，避免出现“参数已到 server，但 controller 看起来没动”的假阴性。
6. 明确并验证成绩下载路径，确保 operator 能下载包含 economy remaining seconds 与 score-system score 的结果文件。
7. 把 receiver 端 visible tracks 展示顺序改为乱序，而不是按文件夹和 manifest 固定顺序排列。

## 范围

### 12.1 Color Challenge Moving Bar V2

Color Challenge 的移动条需要从“随 round 线性推进”改成“更快的左右往返 marker”，且不与 `iterationDurationMs` 绑定。

建议模型：

```typescript
interface ColorChallengeRoundSnapshot {
  iterationId: string;
  assignedColorId: string;
  choices: ColorChallengeChoice[];
  correctChoiceIndex: number;
  iterationStartedAt: string;
  iterationDurationMs: number;
  barCycleDurationMs: number;
  barStartProgress: number;
}
```

行为要求：

- `iterationDurationMs` 只决定本轮超时，不决定 marker 速度。
- `barCycleDurationMs` 决定 marker 从左到右再回到左的循环速度。
- `barStartProgress` 在每轮创建时随机生成，用于实现随机出生位置。
- 正确 / 错误结算仍基于 marker 的当前位置计算 `greenness`，不再直接等于 `elapsed / iterationDurationMs`。
- Receiver 本地 optimistic round 和 server authoritative round 必须使用同一套 round snapshot 字段，避免 RTT 后结果漂移。

### 12.2 Track-Linked Color Choices

Color Challenge 每轮要和真实音频 track 建立绑定，而不是只显示颜色。

建议数据形状：

```typescript
interface ColorChallengeChoice extends ColorChallengeColor {
  trackId?: string | null;
  trackLabel?: string | null;
  trackUrl?: string | null;
}

interface ColorChallengeConfig {
  assignedTrackId: string | null;
  assignedTrackLabel: string | null;
  assignedTrackUrl: string | null;
  choices: ColorChallengeChoice[];
}
```

行为要求：

- 正确 track 优先从当前 `visible && enabled && playable && url` 的 tracks 中选择。
- 错误 track 从其它可用 track 中选择，必须与正确 track 不同。
- 若可用 track 不足以生成合法 pair，round 仍可退回颜色-only，但要保证 UI 不崩。
- Receiver 的 “Your Color” 区块要显示本轮目标 track 名称。
- 点击颜色按钮时，receiver 端要能播放该按钮绑定的音频（本地反馈），同时继续走现有 score submission。
- Export 结果需要把每次 round 的 choice-track 信息带出去，方便教授复盘。

### 12.3 Receiver UI Cleanup + Economy Decoupling

本 phase 要把 receiver 端从“开发者状态面板”继续收敛成“学生可直接使用”的界面。

具体要求：

- economy 关闭时，顶部 economy 状态卡不显示 `Disabled`，最好整块不渲染。
- `Tracks` 区在 economy off 时仍允许播放，只是不走 economy 扣费 / game over。
- `request_track_play` / `request_track_stop` 的 server 逻辑要区分：
  - economy on：走现有 currency / cost / game over 判定。
  - economy off：只校验 track 是否可见、可用、未被 vote 锁定，然后直接播放 / 停止。
- Timing 或 economy 未使用时，不额外展示 `Disabled` 提示块。
- Color Challenge 卡片移除长解释文案，让按钮更早进入首屏。
- Assigned color 视觉块放大，优先显示目标颜色与目标 track 名称。

### 12.4 Visible Track Shuffle

Receiver 看到的 visible tracks 需要乱序显示。

要求：

- 不再按 manifest 原始顺序或 category 固定顺序展示。
- 乱序结果在一次可见 track 集合内应保持稳定，避免每次状态广播都抖动重排。
- 当 visible track 集合发生实质变化时，可以重新洗牌。

### 12.5 Controller Map Movement Verification

Phase 9 的 movement 协议本身已交付，但 controller 自己的可视化和草稿同步要继续修正，避免误判。

本 phase 需要确认：

- Controller 在收到 `config.map.movement` 后，预览图也能按 `startedAt` / `durationMs` / `loop` 做本地插值，而不是只显示终点。
- Map movement draft 不应只在切换 receiver 时初始化；当当前 receiver 的 map snapshot 被外部命令更新时，也要同步显示最新参数。
- 继续兼容 `fromX/fromY/toX/toY` 与 `startX/startY/targetX/targetY`。
- 若本次核对发现问题只在 controller 预览层，不改 Phase 9 runtime 协议本身。

### 12.6 Score Download Verification

教授要求“下载 Economy 剩余秒数和 Score system 成绩”。

本 phase 的原则：

- 优先复用现有 `GET /api/controller/scoreboard/export`，不重复造接口。
- 若当前 controller 文案或下载入口不够清楚，则调整为更明确的 scoreboard 下载入口。
- 导出文件至少应包含：
  - `economyRemainingSeconds`
  - `economyEnabled`
  - `economyGameOver`
  - `manualScoreValue`
  - `scoreSystemScore`
  - `scoreSystemEnabled`
  - `scoreSystemGameOver`

## 非目标

- 不在本 phase 内导入教授尚未提交到仓库的新音频包或新地图图片。
- 不重做 Phase 9 map 协议，只修正当前 controller / receiver 侧的实现与可视化问题。
- 不把 economy 与 Color Challenge 合并成单一 `gameOver`。
- 不新增账号系统、权限系统或多副本部署方案。

## 验收标准

- [x] `docs/final_fix.md` 已归档为 Phase 12 source of truth。
- [x] Color Challenge 使用独立往返 marker，而不是 round-duration fill bar。
- [x] 每轮 marker 起始位置随机。
- [x] Receiver 的 assigned color 区块更大，并显示目标 track 名称。
- [x] 颜色按钮与真实 track 绑定，且 export 中能看到 round 的 track 信息。
- [x] Economy 关闭时 receiver 顶部不再显示 `Disabled` economy 卡片。
- [x] Economy off 时 receiver 仍可播放 visible tracks。
- [x] Receiver 页面移除多余的 `Disabled` / ColorChallenge 解释性文案。
- [x] Visible tracks 以稳定乱序显示。
- [x] Controller map preview 能跟随 movement 插值；当前 receiver 的 movement draft 会随最新 snapshot 同步。
- [x] Controller 可明确下载包含 economy + score-system 数据的 scoreboard 文件。
- [x] 相关范围 `corepack pnpm check`、`corepack pnpm test` 通过。
- [x] 若 phase 在本轮完成，补齐 `closeout.md` 与 browser smoke evidence。

## 建议交付顺序

1. 新增 Phase 12 epic，冻结范围。
2. 扩展 shared types / round snapshot，完成 Color Challenge V2 协议。
3. 更新 server round generation、submission validation、export shape 和 economy decoupling。
4. 更新 receiver UI 与本地音频反馈。
5. 更新 controller map preview / draft sync 与 scoreboard 文案。
6. 跑测试、烟测，并补 closeout。
