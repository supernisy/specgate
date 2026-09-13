# AGENTS.md — specgate 开发约定（AI 自主决策落档）

> 本文件记录实现中由 AI 自主决定的设计取舍，避免重复讨论。需求文档见仓库根 `README.md` 与交接文档。

## 桥接层（OpenSpec spec.md → contract.yaml）

实现于 `src/bridge.js` + `src/cli.js` 的 `bridge` 子命令。**纯确定性解析，零模型参与**，与 specgate 整体「lint 不调模型」立场一致。

### 命令形态
```
specgate bridge <spec.md> [out.yaml]
```
- 位置参数，不用 flag（与 draft/lint/plan 一致）。
- `out.yaml` 省略时把契约打到 stdout；否则写到该路径。
- 退出码：0 成功 / 1 用法或 IO 错误。

### 字段映射规则（交接文档第三节）
- `### Requirement: <name>` → 一组 `accept` 条目；`id` = `kebab(name)` + `-` + 场景序号（1-based），如 `user-login-1`。
- `#### Scenario` 下的子弹：
  - `- **WHEN**` → `when`；其后 `- **AND**` 续到 `when`
  - `- **THEN**` → `then`；其后 `- **AND**` 续到 `then`
  - `- **GIVEN**` → `given`
  - `- **WHY**` → 丢弃（需求理由不进契约正文）
- requirement 描述段 → `given`（无 GIVEN 子弹时）与 `intent`（所有 requirement 描述拼接）。
- `out_of_scope`：非空。**`## REMOVED Requirements`** 段存在时，列出那些被移除的需求名；否则给一条「以 spec 为准」的合成说明。

### `verify` 推断（确定性关键词启发式，从 constraints.yaml 的 9 个合法值中选）
优先级（命中即返回，避免被后续宽词带偏）：
1. `trace`：状态迁移/状态机/迁移/migrat
2. `state-matrix`：4xx/5xx/状态码/慢响应/空响应 + 接口/response 上下文
3. `contract-test`：接口/api/endpoint/http/response/rest/graphql/openapi/url/契约（**不含裸 `request`**——会误伤「requests a reset」这类非 API 表述）
4. `type`：类型系统/编译期/schema 校验
5. `geo`：像素/几何/1px/坐标；`ax`：角色/语义/骨架/指纹；`unit-visual`：渲染/UI/按钮/点击/显示/样式
6. 默认 `unit`（性能/吞吐等无专用 verify，交人工在 lint 反馈后修正）

### 关键决策（自主决定，记录于此）
- **`suspect` 不填**：确定性桥接无法判断「测试方能否据此写出断言」。留空 → lint 走词表层（向后兼容），符合「只加严不放宽」。`suspect` 由 draft 阶段的 AI 在人工/AI 填契约时标注。
- **`invariants` / `breaks` / `uses` / `states` 省略**：OpenSpec 不产出这些；留待 `lint` 反馈后由人/AI 在契约里补。v1 不臆造。
- **bridge 不调 lint**：职责分离——bridge 只产契约，文档指引「bridge 后跑 `specgate lint` 门禁」。这样桥接层本身保持纯确定性、可单测。
- **`given` 冗余**：user-login 等条目 `given` 重复了 requirement 描述（也进了 `intent`）。可接受——`given` 与 `intent` 语义不同（单条前提 vs 整体意图）。
- **缺场景的 requirement 跳过**：OpenSpec requirement 通常带 scenario；无 scenario 者不产生 accept 条目（避免空 when/then 触发结构/措辞误报），并在 stderr 提示。

### 测试
`test/samples/openspec-spec.md`（含 ADDED 多场景、MODIFIED、REMOVED）+ 生成的 `openspec-contract.yaml` 作为 fixture。端到端：`bridge → lint` 应通过（退出 0），verify 推断见上方优先级。
