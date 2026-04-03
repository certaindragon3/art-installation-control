# Phase 4: Voting System

**对应需求:** 4.1 (Vote Window), 4.2 (Vote Submission), 4.3 (Vote Reset/Revision)

**依赖:** Phase 1

## 目标

完整的投票系统，支持实时投票、结果汇总、发送到 Unity。

## 范围

### 4.1 Vote Window (需求 4.1)

- 投票窗口由 Unity/Controller 触发
- 弹出时冻结其他所有交互
- 支持自定义问题文本
- 支持动态数量的选项
- 多选按钮式布局（优于 Google Forms）
- `visibilityDuration` 超时自动关闭

```typescript
interface VoteConfig {
  voteVisible: boolean;
  voteId: string;
  voteQuestion: string;
  voteOptions: string[];
  visibilityDuration: number;  // seconds
  voteAllowRevote: boolean;
}
```

### 4.2 Vote Submission (需求 4.2)

- 每个选项按钮点击 → 调用 postToUnity
- 每人一票，可修改（revote enabled 时）
- 结果汇总后批量发送到 Unity
- 需标记未投票的用户
- 备选：手动下载 JSON fallback

```typescript
interface VoteSubmission {
  userId: string;
  voteId: string;
  selectedOption: number;  // option index
}
```

### 4.3 Vote Reset / Revision (需求 4.3)

- 重置所有投票：`{ command: "vote_reset_all" }`
- 允许/禁止修改票：`voteAllowRevote: boolean`

## 验收标准

- [ ] 投票窗口弹出时冻结其他交互
- [ ] 自定义问题文本 + 动态选项数正确渲染
- [ ] 每人一票限制生效
- [ ] revote 启用时可修改选择
- [ ] visibilityDuration 超时自动关闭
- [ ] 投票结果汇总后批量发送到 Unity
- [ ] 未投票用户被标记
- [ ] vote_reset_all 正常工作
- [ ] JSON 导出 fallback 可用

## 测试建议（无 Unity 客户端）

- 本地至少开三个 receiver 页面模拟多人投票，验证冻结其他交互、单人单票、允许 revote、超时自动关闭。
- 用一个浏览器标签页模拟 Unity socket client，只监听投票相关 `interaction_event` 或汇总事件，确认服务端聚合数据格式正确。
- 为“未投票用户标记”“重置全部投票”“JSON 导出”补测试，避免只验证 happy path。
- 投票是明显的并发场景，完成后建议部署到 Zeabur 进行真机多端联测。
