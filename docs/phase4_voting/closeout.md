# Phase 4 收尾文档

**阶段名称：** Voting System  
**完成日期：** 2026-04-09  
**对应需求：** 4.1 Vote Window, 4.2 Vote Submission, 4.3 Vote Reset / Revision  
**线上验证地址：** `https://artinstallation.certaindragon3.work`

## 1. 本阶段交付概览

Phase 4 已完成以下能力：

- controller 可创建投票并下发到指定 receiver 或全部 receiver
- receiver 在投票显示期间冻结其他交互，只保留投票操作
- 投票题目支持自定义文本
- 投票选项支持动态数量
- 每个 receiver 默认一人一票
- `allowRevote` 开启时可修改选择
- `visibilityDuration` 到时后自动关闭投票
- 服务端汇总结果并通过 Unity 事件批量发送
- 汇总结果包含未投票 receiver 列表
- `vote_reset_all` 可清空当前投票选择
- controller 提供 JSON 导出 fallback

## 2. 主要代码变动

### 2.1 协议与共享类型

- 扩展 `VoteConfig`，补齐 `voteId`、`question`、`visibilityDuration`、`allowRevote`、`submittedAt`
- 新增 `VoteSubmission`
- 新增 `VoteSessionExport`
- 新增 `WS_EVENTS.SUBMIT_VOTE`
- 统一了投票结果导出的结构，便于 controller 和 Unity 共用

涉及文件：

- `shared/wsTypes.ts`

### 2.2 服务端

- `wsServer` 新增投票 session 生命周期管理
- 服务端按 `voteId` 聚合提交结果，而不是只保存在单个 receiver 页面
- 支持超时自动关闭投票
- 关闭投票后通过 Unity `interaction_event` 发送聚合结果
- 支持 `vote_reset_all`
- 支持 `GET /api/controller/votes/export`
- 清理离线 receiver 时会同步从投票 session 中移除，避免导出结果残留脏数据

涉及文件：

- `server/wsServer.ts`
- `server/controllerApi.ts`

### 2.3 Controller UI

- 新增 Voting Orchestration 面板
- 支持编辑问题文本、动态选项、可见时长、revote 开关
- 支持向当前 receiver 发起投票
- 支持广播投票
- 支持重置投票
- 支持导出 JSON
- 支持从当前 `receivers` 状态推导简要统计结果

涉及文件：

- `client/src/pages/Controller.tsx`

### 2.4 Receiver UI

- 新增投票锁定界面
- 投票显示期间其余交互区域整体置灰并禁用
- 支持动态渲染选项按钮
- 选项点击后通过 `submit_vote` 提交到服务端
- 同时继续通过 `postInteraction` 把用户点击回传给 Unity

涉及文件：

- `client/src/pages/Receiver.tsx`
- `client/src/hooks/useSocket.ts`

## 3. API 与协议更新

## 3.1 新增 Socket.IO 事件

### `submit_vote`

receiver 提交投票时发送：

```json
{
  "voteId": "vote_003",
  "selectedOptionId": "option_2"
}
```

## 3.2 `set_vote_state`

controller / Unity 通过统一命令下发投票：

```json
{
  "command": "set_vote_state",
  "targetId": "receiver-a",
  "payload": {
    "vote": {
      "voteId": "vote_003",
      "question": "Which rule should be active next?",
      "options": [
        { "id": "option_1", "label": "Rule A" },
        { "id": "option_2", "label": "Rule B" },
        { "id": "option_3", "label": "Rule C" }
      ],
      "visible": true,
      "enabled": true,
      "visibilityDuration": 15,
      "allowRevote": true,
      "selectedOptionId": null,
      "submittedAt": null
    }
  }
}
```

兼容字段：

- `voteQuestion`
- `voteOptions`
- `voteVisible`
- `voteAllowRevote`

## 3.3 `vote_reset_all`

清空目标 receiver 当前投票选择：

```json
{
  "command": "vote_reset_all",
  "targetId": "receiver-a",
  "payload": {}
}
```

说明：

- 不删除当前投票题面
- 只清空 `selectedOptionId` 与 `submittedAt`

## 3.4 新增 HTTP 导出接口

### `GET /api/controller/votes/export`

返回历史和当前投票的聚合结果：

```json
{
  "ok": true,
  "votes": [
    {
      "voteId": "vote_003",
      "question": "Which rule should be active next?",
      "options": [
        { "optionId": "option_1", "label": "Rule A", "voteCount": 1 },
        { "optionId": "option_2", "label": "Rule B", "voteCount": 2 }
      ],
      "allowRevote": true,
      "visibilityDuration": 15,
      "openedAt": "2026-04-09T06:11:21.000Z",
      "closesAt": "2026-04-09T06:11:23.000Z",
      "closedAt": "2026-04-09T06:11:23.000Z",
      "closeReason": "timeout",
      "isActive": false,
      "submittedCount": 3,
      "totalEligible": 4,
      "missingReceiverIds": ["receiver-d"],
      "eligibleReceivers": [
        {
          "receiverId": "receiver-a",
          "label": "Receiver A",
          "connected": true,
          "hasVoted": true
        }
      ]
    }
  ]
}
```

## 3.5 Unity 聚合结果事件

投票关闭后，服务端会向 Unity room 发出：

```json
{
  "sourceRole": "controller",
  "receiverId": null,
  "action": "voteResults",
  "element": "vote:results",
  "value": {
    "voteId": "vote_003",
    "submittedCount": 3,
    "totalEligible": 4,
    "missingReceiverIds": ["receiver-d"]
  },
  "timestamp": "2026-04-09T06:11:23.000Z"
}
```

## 4. 测试结果

## 4.1 本地验证

已完成：

- `corepack pnpm check`
- `corepack pnpm test`
- `corepack pnpm build`

新增测试覆盖：

- `server/controllerApi.test.ts`
- `server/wsServer.test.ts`

本地已验证：

- 自定义题目和动态选项能写入状态
- receiver 提交投票后状态会回写 `selectedOptionId`
- `allowRevote=false` 时不可重复提交覆盖
- `vote_reset_all` 会清空当前投票选择
- timeout 到时会自动关闭投票
- Unity 会收到聚合结果事件
- 导出接口会返回已关闭投票的结果和未投票列表

## 4.2 线上烟测

测试日期：`2026-04-09`  
测试站点：`https://artinstallation.certaindragon3.work`

已确认：

- `GET /api/healthz` 返回 `200`
- `GET /api/config` 返回 `200`
- `GET /api/controller/votes/export` 返回 `200`
- `/` 返回 `200`
- `/controller` 返回 `200`
- `/receiver/phase4-doc-check` 返回 `200`
- 生产环境 Socket.IO 可成功连接并注册 receiver
- 生产环境可通过 `set_vote_state` 向指定 receiver 下发投票
- 生产环境 receiver 可通过 `submit_vote` 提交投票
- timeout 到时后 Unity 可收到 `voteResults`
- 导出接口包含刚完成的线上 smoke vote
- `clear-offline` 可清除临时 smoke receiver

本次线上 smoke test 使用临时 receiver：

- `phase4smoke_mnr2wiqh`

本次线上 smoke test 使用临时 vote：

- `vote_phase4_smoke_mnr2wiqh`

关键结果：

- 初始 receiver `configVersion = 1`
- 投票打开后 `configVersion = 2`
- 提交后 `configVersion = 3`
- 线上投票题目为 `Smoke vote question?`
- 选项数为 `2`
- 时长配置为 `2s`
- 最终提交选项为 `option_2`
- Unity 聚合结果 `submittedCount = 1`
- Unity 聚合结果 `totalEligible = 1`
- Unity 聚合结果 `closeReason = "timeout"`
- 导出结果与 Unity 聚合结果一致
- `POST /api/controller/clear-offline` 成功清除该临时 receiver

## 4.3 尚未覆盖的线上验证

本次线上验证以 API、Socket.IO 与投票生命周期为主，尚未覆盖：

- 多个真实移动设备同时投票时的主观流畅度
- controller 页面中实时统计区域的人工可视验证
- receiver 页面冻结态在不同屏幕尺寸上的最终观感
- 广播投票到真实多端后的现场联调体验

如果后续要把 Phase 4 作为正式演示版本，建议再补一轮多设备真机联调。

## 5. 验收结论

Phase 4 已达到代码、测试、构建和线上烟测通过的收尾标准，可以作为后续 Phase 5 / Phase 6 的稳定基础继续推进。

## 6. 部署注意事项

- 当前 Socket.IO 与投票 session 状态仍全部保存在内存中，线上必须继续保持单副本部署
- `vote_reset_all` 与投票导出都依赖单实例内存状态，多副本会导致结果分裂
- 线上 smoke test 已验证 Zeabur 生产环境下 HTTP + Socket.IO + 导出链路正常
