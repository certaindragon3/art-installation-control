# Phase 6: Timing Challenge Mode

**对应需求:** 5.1 (Timing Challenge Mode)

**依赖:** Phase 1, Phase 3 (pulse sync)

## 目标

实现节奏挑战模式，用户需在正确时间点按下按钮。

## 范围

### 6.1 Timing Challenge (需求 5.1)

- Loading bar：红 → 绿 → 红 渐变
- 中心指示器 bar
- 用户按压结果实时发送到 Unity
- 结果也可导出为 JSON

```typescript
interface TimingConfig {
  timingVisible: boolean;
  timingEnabled: boolean;
  timingValue: number;      // 0-1, current position
  targetCenter: number;     // 0-1, sweet spot
  timingTolerance: number;  // tolerance range
}
```

用户事件：

```typescript
interface TimingEvent {
  userId: string;
  timing: boolean;       // hit or miss
  timestamp: number;
}
```

## 验收标准

- [ ] Loading bar 红绿红渐变动画正确
- [ ] 中心指示器清晰可见
- [ ] 按压结果实时发送到 Unity
- [ ] tolerance 可配置
- [ ] 结果可导出为 JSON
- [ ] 与 pulse（Phase 3）同步
