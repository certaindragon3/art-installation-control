# Phase 8: Professor Feedback / Delivery Simplification

**对应反馈:** Voting Monday delivery, ~120 audio files, remove track groups, slim interface

**依赖:** Phase 1, Phase 2, Phase 4

**优先级:** 当前最高优先级。Phase 7 optional 暂停，除非导师重新要求 Filter 或 Recording。

## 背景

导师最新反馈改变了后续交付重点：

- Voting system 需要先作为可测试交付物收口。
- 最终音频文件约 120 个，控制字符串应直接来自原始文件名，避免手动维护大量 track ID。
- Track groups 不再需要。控制端只需要发送一个 track name array，决定当前哪些 tracks 对学生可见，其余自动隐藏。
- Interface slimming 需要在 meeting 前尽量完成基础版本，meeting 时再一起做视觉和交互取舍。

## 目标

将项目从“继续堆叠可选功能”转为“围绕最终演出工作流收敛”：

1. Voting 可稳定交付和演示。
2. 音频库支持大量文件的低维护导入。
3. Receiver/Controller 音轨工作流从 group-based 简化为 visible-track-list-based。
4. UI 为 Wednesday 共同 slim-down 留出干净基础。

## 范围

### 8.1 Voting Delivery Closeout

- 重新验证 Phase 4 voting 的核心路径：
  - broadcast vote
  - targeted vote
  - dynamic options
  - one vote per receiver
  - allow / block revote
  - timeout auto close
  - missing voters
  - JSON export fallback
  - Unity aggregate result event
- 准备一份教授可直接使用的 voting test guide。
- 若线上版本不是最新，部署到 Zeabur 做多端 Socket.IO 验证。

### 8.2 Audio Manifest From Filenames

- 支持从上传/放入项目的音频文件生成 track definitions。
- 保持原始文件名不变。
- 控制字符串由文件名生成，避免手写 120 个字符串。
- 推荐规则：
  - `trackId` 默认使用完整文件名，例如 `metal_hit_03.wav` → `metal_hit_03.wav`
  - `label` 默认使用去扩展名后的 stem，例如 `metal_hit_03`
  - `url` 指向真实静态资源路径，例如 `/audio/metal_hit_03.wav`
- 生成结果应可被 `DEFAULT_TRACK_LIBRARY` 或同等运行时配置读取。
- 需要处理重复 stem、空格、特殊字符和不支持的扩展名。

### 8.3 Replace Groups With Visible Track Array

新增一个面向 Unity / Controller 的简化命令：

```json
{
  "command": "set_visible_tracks",
  "targetId": "*",
  "payload": {
    "trackIds": ["metal_hit_03", "voice_loop_a", "bell_short_01"]
  }
}
```

行为：

- `trackIds` 内的 tracks 设置为 `visible: true`。
- 不在 `trackIds` 内的 tracks 设置为 `visible: false`。
- 被隐藏且正在播放的 track 应停止播放，避免 invisible audio 继续响。
- 不要求删除已有 group 数据模型；先在新工作流中停用 group UI，降低破坏已有协议和测试的风险。
- 保留 `set_track_state` 作为底层精细控制能力。

### 8.4 Interface Slimming Baseline

- Controller UI：
  - Voting 面板优先保留并放在易访问位置。
  - 音轨管理从 group editor 改为 visible track selector。
  - 暂时隐藏或降级 group 管理入口。
  - 面向教授测试保留必要状态信息，不展示调试噪音。
- Receiver UI：
  - 只渲染当前 visible tracks。
  - 不再按 group dropdown 组织主要音轨入口。
  - 投票打开时继续冻结其他交互。
  - 保持音量、loop 等已完成能力，但不要让它们抢占主流程。

## 非目标

- 不继续开发 Phase 7 Filter Control。
- 不继续开发 Phase 7 Recording System。
- 不彻底删除 group 类型或旧协议，除非后续确认不会再需要兼容。
- 不在没有音频文件的情况下手写 120 条 track config。

## 验收标准

- [x] Voting 经过本地 `check` / `test` / `build` 验证。
- [x] Voting 有教授可直接执行的测试说明。
- [ ] Voting 在线上单副本 Zeabur 环境完成多端验证，若代码变更涉及部署或 Socket.IO 行为。
- [x] 音频 manifest 生成流程可从一批音频文件产出 track definitions。
- [x] 文件名到 control string 的规则写入文档。
- [x] `set_visible_tracks` 可通过 HTTP controller API 控制 receiver 可见音轨。
- [x] 隐藏 track 时会停止正在播放的音频。
- [x] Receiver 主 UI 不再依赖 group dropdown。
- [x] Controller 提供 visible track array / selector 工作流。
- [x] Phase 7 optional 在路线图中明确标记为 deferred。

## 测试建议

- Voting：
  - 开 3 个 receiver 页面和 1 个 controller 页面手测完整流程。
  - 验证未投票 receiver 出现在 export 结果里。
  - 验证 revote 关闭时第二次投票不会覆盖第一次选择。
- Audio manifest：
  - 用包含空格、大小写、重复 stem、非音频文件的小样本目录测试生成逻辑。
  - 确认生成的 URL 能被 production static server 访问。
- Visible tracks：
  - 对单个 receiver 和 `targetId: "*"` 分别测试。
  - 先播放一个 track，再通过 `set_visible_tracks` 隐藏它，确认 receiver 停播。
  - 确认旧的 `set_track_state` 仍可单独控制一条 track。

## 交付顺序

1. Voting closeout and guide.
2. `set_visible_tracks` protocol + server behavior + tests.
3. Receiver remove group-first presentation.
4. Controller visible track selector.
5. Audio manifest generator and docs.
6. Final interface slimming pass with professor feedback.
