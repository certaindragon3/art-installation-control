# Phase 5: Scoring + Spatial Map

**对应需求:** 3.1 (Per-Player Score), 2.1 (Classroom Map Display)

**依赖:** Phase 1

## 目标

实现计分系统和教室地图 2D 定位。

## 范围

### 5.1 Per-Player Score (需求 3.1)

- 每个 player 有独立分数
- 分数可：激活/停用/重置/直接设置
- UI 可 show/hide

```typescript
interface ScoreConfig {
  scoreVisible: boolean;
  scoreEnabled: boolean;
  scoreValue: number;
}
```

- 重置命令：`{ command: "score_reset" }`

### 5.2 Classroom Map Display (需求 2.1)

- UI 区域展示教室地图
- 2D 定位，normalized 坐标（x: 0-1, y: 0-1）
- 位置可由 Unity/Controller 控制

```typescript
interface MapConfig {
  mapVisible: boolean;
  playerPosX: number;  // 0-1
  playerPosY: number;  // 0-1
}
```

## 验收标准

- [ ] Score 显示/隐藏/启用/禁用正常
- [ ] Score 可直接设置任意值
- [ ] Score 重置命令生效
- [ ] 教室地图 2D 展示
- [ ] Normalized 坐标 (0-1) 定位准确
- [ ] Unity 可远程控制 score 和 map position

## 测试建议（无 Unity 客户端）

- 本地联调 controller 和 receiver，验证 score 的 show/hide/enable/disable/reset，以及地图位置更新是否实时可见。
- 对 map 坐标做边界测试，至少覆盖 `0`、`1`、中间值和越界输入被如何处理。
- 用 HTTP 或 socket 命令直接推送 score/map 状态，确认不依赖 Unity 也能完整回归。
- 这一 phase 可先本地验证为主，如果后面马上做 Phase 6，可以合并到下一次 Zeabur 联测。
