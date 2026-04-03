# Phase 2: Audio Enhancement

**对应需求:** 1.1 (Track Looping), 1.3 (Track Groups), 1.5 (Volume Control)

**依赖:** Phase 1

## 目标

完成音频模块的完整功能：循环控制、动态分组、音量 UI。

## 范围

### 2.1 Track Looping (需求 1.1)

- Loop 默认关闭
- 每条 track 有独立的 loop 按钮
- 支持系统锁定（`loopControlLocked: true` 时用户无法切换）
- 状态字段：`loopEnabled`, `loopControlVisible`, `loopControlLocked`

### 2.2 Track Groups / Sample Groups (需求 1.3)

- Track 可分配到 group
- Group 支持动态增删、重命名
- 每个 group 有独立颜色
- UI 展示为 dropdown 菜单，dropdown 名称可由 Unity 控制
- 受限时 dropdown 灰化或隐藏

```typescript
interface GroupState {
  groupId: string;
  label: string;
  color: string;
  visible: boolean;
  enabled: boolean;
  trackIds: string[];
}
```

### 2.3 Volume Control (需求 1.5)

- 音量 UI 可 show/hide/enable/disable
- 条件显示：`if (enabled && userPressedPlay) show()`
- 弹出式 UI，点击外部区域 → 停止播放 + 隐藏音量
- 对数映射（dB SPL → 0-1）
- 大尺寸 UI 支持 performative interaction
- 音量拖拽为 continuous value → 使用 startInteraction / endInteraction

## 验收标准

- [ ] Loop 按钮可开/关，默认关闭
- [ ] Loop 锁定状态下用户无法操作
- [ ] 动态创建/删除/重命名 group
- [ ] Track 可在 group 间移动
- [ ] Group dropdown UI 正确展示，受限时灰化
- [ ] Volume 弹出式 UI，对数映射
- [ ] 点击 volume 外部区域停止播放并关闭 volume
- [ ] Volume 交互发送 startInteraction / endInteraction 到 Unity
- [ ] Unity 可远程控制所有上述状态
