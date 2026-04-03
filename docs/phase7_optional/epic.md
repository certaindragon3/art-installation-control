# Phase 7: Optional Features

**对应需求:** 1.6 (Filter Control — SUPER OPTIONAL), 6.1 (Recording — OPTIONAL)

**依赖:** Phase 2 (audio)

## 目标

实现导师标注为可选的功能模块。

## 范围

### 7.1 Filter Control (需求 1.6 — SUPER OPTIONAL)

- 2D 控制 pad：X → resonance (Q), Y → frequency (对数)
- Dropdown 选择 filter 类型：lowpass / highpass / bandpass
- 可激活/停用
- 启用时 UI 重新布局

```typescript
interface FilterConfig {
  filterVisible: boolean;
  filterEnabled: boolean;
  filterType: "lowpass" | "highpass" | "bandpass";
  filterPadX: number;  // 0-1, resonance
  filterPadY: number;  // 0-1, frequency (log scale)
}
```

### 7.2 Recording System (需求 6.1 — OPTIONAL)

- 录制交互事件、timing/button 数据、audio 状态变化
- 支持 start / stop 命令
- 导出 JSON

```typescript
interface RecordConfig {
  recordEnabled: boolean;
  recordState: "idle" | "recording";
}
```

## 验收标准

- [ ] 2D pad X/Y 控制 resonance/frequency
- [ ] Filter 类型切换正常
- [ ] Filter pad 为 continuous value，使用 startInteraction / endInteraction
- [ ] Recording start/stop 正常
- [ ] 录制数据可导出为 JSON

## 测试建议（无 Unity 客户端）

- Filter 先本地验证 2D pad 映射、filter type 切换，以及连续交互只发 `startInteraction` / `endInteraction`。
- Recording 重点测开始、停止、重复开始停止、空记录导出和长时记录导出。
- 用浏览器假 Unity 监听事件流，确认 filter 和 recording 事件格式稳定。
- Optional 功能不必每做完一个就上线，可以等确定要交付时再统一部署到 Zeabur 验证。
