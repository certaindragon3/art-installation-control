# Phase 3: Pulse/Tempo + Track Markers

**对应需求:** 1.2 (Pulse/Tempo), 1.4 (Track Markers and Fill State)

**依赖:** Phase 1

## 目标

实现服务端节拍广播和 track 可视化标记。

## 范围

### 3.1 Pulse / Tempo (需求 1.2)

- 服务端生成 pulse 广播（避免 Unity 侧累积延迟）
- BPM 可配置
- Pulse 可激活/停用
- 广播消息为单字符即可（轻量）

**实现：** 使用 `setTimeout` 递归 + drift 补偿的自校正定时器：

```typescript
function startPulse(bpm: number) {
  const intervalMs = 60000 / bpm;
  let expected = Date.now() + intervalMs;
  function tick() {
    const drift = Date.now() - expected;
    io.emit("pulse", { timestamp: Date.now() });
    expected += intervalMs;
    setTimeout(tick, Math.max(0, intervalMs - drift));
  }
  setTimeout(tick, intervalMs);
}
```

状态字段：`pulseEnabled`, `pulseBpm`

### 3.2 Track Markers & Fill State (需求 1.4)

每条 track 展示：
- Tempo-synced 闪烁标记（与 pulse 同步）
- 可填充 UI 元素（slider/progress 风格），在 `fillTime` 秒内从 0 填充到 1
- Flash 与 fill 同步：fillable 到达 1 时触发 flash

状态字段：`tempoFlashEnabled`, `fillTime`（秒）

## 验收标准

- [ ] Pulse 广播按 BPM 精确运行，累积误差 < 5ms / 分钟
- [ ] BPM 可动态调整
- [ ] Pulse 可开关
- [ ] 每条 track 有闪烁标记，与 pulse 同步
- [ ] Fill bar 动画在 fillTime 内完成 0→1
- [ ] Fill 到达 1 时触发 flash
- [ ] fillTime 可由 Unity/Controller 配置

## 测试建议（无 Unity 客户端）

- 写服务端定时器测试，直接统计 pulse 间隔和长时间 drift，不要只靠肉眼看闪烁。
- 在浏览器开多个 receiver 页面，观察 pulse、flash、fill bar 是否同步，重点看切标签页或性能波动时是否漂移。
- 用 controller 或 HTTP 命令动态修改 BPM、开关 pulse、修改 `fillTime`，确认旧动画会被正确取消并重建。
- 这一 phase 做完建议部署到 Zeabur，再做多设备同步测试，因为公网 websocket 更容易暴露节拍漂移问题。
