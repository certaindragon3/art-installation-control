# Phase 8 收尾文档

**阶段名称：** Professor Feedback / Delivery Simplification  
**完成日期：** 2026-04-14  
**对应反馈：** Voting Monday delivery, ~120 audio files, remove track groups, slim interface  
**线上验证地址：** `https://artinstallation.certaindragon3.work`

## 1. 本阶段交付概览

Phase 8 已按教授最新反馈完成当前收口：

- Phase 7 optional 已暂停，不再作为当前 next step
- Controller 新增 `Visible Tracks` 工作流，用 track array 决定学生端可见音轨
- Receiver 主 UI 不再依赖 group dropdown，只展示当前 visible tracks
- 新增 `set_visible_tracks` command
- 隐藏 track 时服务端会同步 `playing: false`，避免 invisible audio 继续播放
- 音频 manifest workflow 已建立，可从 `client/public/audio` 自动生成 track library
- 当前 demo 音轨通过 overrides 保留 `track_01` / `track_02` 兼容性
- 教授后续给到约 120 个音频文件后，可保持文件名不变并运行 manifest 生成脚本

## 2. 主要代码变动

### 2.1 协议与服务端

- 新增 `SetVisibleTracksPayload`
- 新增 unified command: `set_visible_tracks`
- HTTP controller API 支持接收 `set_visible_tracks`
- Socket.IO command 分发复用同一套 server state
- `set_visible_tracks` 会：
  - 将 payload 内 trackIds 设置为 `visible: true`
  - 将其他 tracks 设置为 `visible: false`
  - 对被隐藏且正在播放的 tracks 设置 `playing: false`

涉及文件：

- `shared/wsTypes.ts`
- `server/controllerApi.ts`
- `server/wsServer.ts`
- `server/controllerApi.test.ts`

### 2.2 Controller UI

- 移除当前主流程中的 Group Management UI
- 新增 `Visible Tracks` selector
- 支持：
  - 单条 track checkbox show/hide
  - `Show All`
  - `Hide All`
  - `Broadcast This List`
- track 列表使用 scroll area，适配约 120 条音轨

涉及文件：

- `client/src/pages/Controller.tsx`

### 2.3 Receiver UI

- 主音轨区域只渲染 `track.visible === true` 的 tracks
- 不再按 group dropdown 组织学生端主入口
- 无 visible tracks 时显示空状态
- 投票打开时仍然冻结其他交互

涉及文件：

- `client/src/pages/Receiver.tsx`

### 2.4 Audio Manifest

- 新增 `corepack pnpm audio:manifest`
- 新增脚本从 `client/public/audio` 扫描音频文件
- 生成 `shared/trackManifest.generated.ts`
- 通过 `shared/trackManifest.overrides.json` 保留特殊 ID
- 默认新音频文件使用完整文件名作为 control string

涉及文件：

- `scripts/generate-audio-manifest.mjs`
- `shared/trackManifest.generated.ts`
- `shared/trackManifest.overrides.json`
- `docs/audio-manifest-workflow.md`
- `package.json`

## 3. API 更新

### `set_visible_tracks`

```json
{
  "command": "set_visible_tracks",
  "targetId": "*",
  "payload": {
    "trackIds": ["bell_01.wav", "voice_loop_A.mp3"]
  }
}
```

说明：

- `trackIds` 是当前要展示给学生的音轨控制字符串
- 不在数组内的 tracks 会隐藏
- 隐藏的 tracks 如果正在播放，会自动停止
- `targetId` 可使用单个 receiver id 或 `"*"`

## 4. 本地验证

已完成：

- `corepack pnpm audio:manifest`
- `corepack pnpm check`
- `corepack pnpm test`
- `corepack pnpm build`
- `corepack pnpm vitest run server/controllerApi.test.ts server/wsServer.test.ts`

测试结果：

- 全量测试通过：26 tests
- 生产构建通过
- 新增测试覆盖 `set_visible_tracks`，包括隐藏正在播放的 track 后 `playing: false`

## 5. 线上验证

验证环境：

- `https://artinstallation.certaindragon3.work`
- 单 receiver：`phase8-test`
- 工具：`agent-browser`

已验证：

- Home 页面可打开
- Controller 页面可连接
- Receiver 页面可注册并显示为 online
- Controller 显示 `Visible Tracks`
- Receiver 主 UI 显示 `Tracks`，没有 group dropdown
- 取消 `Womp Womp` 后：
  - Controller 显示 `2 tracks 1 shown`
  - Receiver 从 config v1 更新到 config v2
  - Receiver 只剩 `Boing`
- `Show All` 恢复两个 tracks
- 播放 `Womp Womp` 后执行 `Hide All`
  - Receiver 显示 `No tracks are currently available`
  - API 状态确认两条 tracks 均为 `visible: false`
  - API 状态确认两条 tracks 均为 `playing: false`
- Voting smoke test：
  - 下发 `phase8_smoke_vote`
  - Receiver 显示 vote buttons
  - Receiver 提交 `Yes`
  - `GET /api/controller/votes/export` 返回：
    - `submittedCount: 1`
    - `totalEligible: 1`
    - `missingReceiverIds: []`
    - `Yes` voteCount 为 1

验证后已对 `phase8-test` 执行 `reset_all_state`。

## 6. 注意事项

- `agent-browser` 打开 `http://artinstallation.certaindragon3.work/` 时 Chrome 返回 `ERR_BLOCKED_BY_CLIENT`，线上验证改用 HTTPS 地址完成。
- `agent-browser` 对部分 shadcn/Radix button ref click 偶尔未触发 React handler；验证时对这些按钮使用 DOM click 触发。业务状态和 API 结果均已确认成功。
- 线上仍必须保持单副本部署，因为 Socket.IO 状态和投票 session 存在内存中。

## 7. 后续建议

- 教授发送最终音频包后，将文件原样放入 `client/public/audio`，运行 `corepack pnpm audio:manifest`
- 若最终文件名包含大量空格或特殊字符，先用 manifest 结果抽查 URL 和 control string
- Wednesday meeting 时基于当前 `Visible Tracks` 工作流继续一起 slim interface，而不是恢复 group UI
