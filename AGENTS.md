# AGENTS.md — specgate 开发约定（AI 自主决策落档）

> 本文件记录实现中由 AI 自主决定的设计取舍，避免重复讨论。需求文档见仓库根 `README.md` 与交接文档。

## 项目定位（改代码前必读）

**一个 lint 检查内核 + 两个互斥前门。**

- **内核只有一个**：`lint` —— 判定契约里每条验收条件能不能被机械判定。
- **前门① `draft`**：没在用 OpenSpec 时，从需求文档起草契约（模板 + 提示词）。
- **前门② `bridge`**：已经在用 OpenSpec 时，把 `spec.md` 确定性解析成契约。
- **两个前门互斥**：`spec.md` 存在时它就是**唯一需求事实源**，**不允许再跑 draft**。
  两份需求源并存必然漂移（改了 spec 忘改 contract），门禁把的到底是哪一份也说不清。
- **边界**：specgate 只登记并校验 `verify` 的**名称**（在不在清单里），**不执行任何验证工具**，
  也**不替代**实现完成后的 `/opsx:verify`（AI 扫代码库做「实现 vs 规格」还原度核查，输出
  CRITICAL/WARNING/SUGGESTION 且不阻塞 archive；属 OpenSpec **扩展 profile**，默认 profile 不含，
  需 `openspec config profile` + `openspec update` 启用）。
- **三个「验证」分层，别再混**（对外文档统一按此口径）：
  ① 结构验证 = `openspec validate`（CLI，验格式/完整性，不跑代码）→
  ② 可判定性门禁 = specgate `lint`（验 then 能否被机械断言）→
  ③ 执行验证 = 真跑 `contract-test`/`unit`/`unit-visual`/`trace`。
  **specgate 只占 ②**，外加登记 ③ 的 `verify` 名字。

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
  - **缩进的枚举续行**（不是 `**XXX**` 开头的普通行）→ 去掉前导 `- ` 后，以空格拼接到**上一个 bullet**
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

### `--keep-verify` 与 `verify_source`（二轮·改动 9/T6）

`specgate bridge <spec.md> <out.yaml> --keep-verify`：

- 读旧 `out.yaml`，按 `accept[].id` 建 `id → 旧 verify` 映射；
- 对每条新 accept：**旧值存在、且旧值 ≠ 本次机器推断值** ⇒ 判为「人工改过」，保留旧值并标
  `verify_source: 'explicit'`；其余走机器推断；
- 最后给所有没标的补 `verify_source: 'inferred'`；
- 返回 `kept` 计数，CLI 输出「保留人工 verify 修正 N 条」。

**为什么用「不等」判人工修正**：没法可靠区分「人把它改成了这个值」和「机器推出来本就是这值」。
用「不等」判定，等价于只固化**人真正动过**的那几条；没改的仍随启发式规则演进，
且同一输入重复跑结果一致（幂等）。

**为什么保留而非覆盖**：机器推断是启发式，被人改过的那条，一定是有人知道机器判错了。
覆盖等于把人的判断丢掉。

### 关键决策（自主决定，记录于此）
- **`suspect` 不填**：确定性桥接无法判断「测试方能否据此写出断言」。留空 → lint 走词表层（向后兼容），符合「只加严不放宽」。`suspect` 由 draft 阶段的 AI 在人工/AI 填契约时标注。
- **`invariants` / `breaks` / `uses` / `states` 省略**：OpenSpec 不产出这些；留待 `lint` 反馈后由人/AI 在契约里补。v1 不臆造。
- **bridge 不调 lint**：职责分离——bridge 只产契约，文档指引「bridge 后跑 `specgate lint` 门禁」。这样桥接层本身保持纯确定性、可单测。
- **`given` 冗余**：user-login 等条目 `given` 重复了 requirement 描述（也进了 `intent`）。可接受——`given` 与 `intent` 语义不同（单条前提 vs 整体意图）。
- **缺场景的 requirement 跳过**：OpenSpec requirement 通常带 scenario；无 scenario 者不产生 accept 条目（避免空 when/then 触发结构/措辞误报），并在 stderr 提示。

### 测试
`test/samples/openspec-spec.md`（含 ADDED 多场景、MODIFIED、REMOVED）+ 生成的 `openspec-contract.yaml` 作为 fixture。端到端：`bridge → lint` 应通过（退出 0），verify 推断见上方优先级。

## 判据层改动（二轮·改动 2/3/4/5）

### 锚点扩充（改动 2）—— 顺序不敏感，任一命中即放行

在 `hasAnchor` 里新增四类，都放在 `return false` 之前：

1. **枚举映射-ASCII**：`/(^|[\s(（:：])\d+\s*[:：)]\s*[A-Za-z][A-Za-z0-9_]*/` —— 形如 `0: Success` / `1) NotFound`。
2. **枚举映射-中文**：对 `text.match(/\d+\s*[:：)]\s*[\u4e00-\u9fa5]+/g)` 每段取冒号后的名字，
   **仅当该名字不命中 `SUBJECTIVE_ZH` 任一词**才算锚点。挡「`1: 体验良好`」这种给废话编号的写法。
3. **带扩展名文件路径**：`/[\w./-]+\.(md|tsx?|jsx?|ya?ml|json|py|go|sh|css|html)\b/`
4. **英文 code 词**：`/\b(exit|status|error)\s*codes?\b/i`

### 反引号锚点（改动 3·T2b）—— 三重防伪装

对每个 `` `...` `` 片段取 inner，**依次**判断：

1. inner 不含 `[A-Za-z]` → 跳过（不算锚点）；
2. inner 含中文 → 跳过（中文文案应走引号锚点，防 `` `友好` `` 绕过）；
3. inner 按非字母切词、小写，若这些词**全部**落在 `SUBJECTIVE_EN` 里 → 跳过（防 `` `fast` ``）；
4. 否则 `return true`（真标识符 / 命令，如 `` `getUserList()` ``、`` `/opsx:continue <name>` ``）。

**为什么必须防伪装**：反引号是 Markdown 里的通用强调手段，不加限制就等于开了个
「把主观词包起来就放行」的后门——比不做锚点更糟。

### 恒真断言（改动 4/5·T3）

- `src/words.js` **只新增** `TAUTOLOGY_PATTERNS`，旧表一字未动。
- 接入点在 `checkWording` 的 `COMPOSITE_PATTERNS` 循环**之后**，push 进同一个 `hits`，
  reason 形如 `恒真断言「…」`。
- **不新增独立门控**：沿用 `wordBlock = hits.length > 0 && !anchor`。
  新开一条更严的路径会破坏「有锚点即放行」这条底线。

> ⚠️ **`TAUTOLOGY_PATTERNS` 里绝不要加 `/[不非]空/`**。
> 「…而非空列表」是可机械判定的布尔断言，误伤它比漏判更糟。
> `test/spec.test.mjs` 有一条守门用例专门断言该模式表不含此片段。

## 检查层改动（二轮·改动 10/11）

### ⑦ 放宽（改动 10）

`checkComputeHasInvariant` 现在认两条路，任一成立即通过：

1. 显式 `invariants` 非空（原有）；
2. `checkInvariant(a.then).ok === true` —— THEN 本身就是有效的蜕变关系。

**理由**：走 `bridge` 时 `spec.md` 是唯一需求事实源，逼用户把不变量再抄进派生契约等于制造第二份真相。
但「THEN 得真的是有效蜕变关系」这条不能松，所以只在它成立时才放行。

### ⑪ verify 分布（改动 11·T4）

`checkVerifyDistribution(doc)` **只产 `warnings`，绝不进 `blocking` / `issues`，不改退出码**。两组信号：

- **inferred 占比**：仅统计带 `verify_source` 的 accept；只要有 `inferred` 就产一条 `line`，
  并提示「逐条显式化（重跑 bridge 带 `--keep-verify`）后消除」。
- **ui-mismatch**：`VISUAL_WORDS`（展示/列表/按钮/页面/样式/卡片/菜单/加载态）或
  `INTERACT_WORDS`（点击/hover/滚动/切换/状态迁移）命中，**且** `verify` 不属于
  `{geo, ax, unit-visual, trace}` 时产出，建议改这四类之一。

挂到 `warnings` 数组（`id: '⑪'`, `name: 'verify 分布'`）；`renderTerminal` 与 `renderReview`
的 warnings 循环各补一个 `if (w.id === '⑪')` 分支输出 `it.line`。

**为什么是提醒而非阻塞**：「手段选得合不合适」需要人判断——同一句话在不同项目里可能真该用 `unit`。
工具只提示「你可能选错了」，不替人拍板。

## 约束层与 CLI 改动（二轮·改动 6/7/8）

### 逐级向上找 `constraints.yaml`（改动 6·T5a）

`collectUpwardCandidates(startDir)`：从契约目录起逐级向上，**遇含 `.git` 的目录即停**
（仓库边界），最多 12 级；末尾再兜底 cwd。

**为什么以 `.git` 为界**：越过仓库根继续向上找，会把「用户家目录」或「上层无关项目」的约束文件
误当成本项目的，比找不到更糟。

两条降级路径都**带 reason 返回**，不再静默：

- 找到文件但解析失败 → `{ ...BUILTIN, reason: 'parse-failed', path: p }`
- 一路没找到 → `{ ...BUILTIN, reason: 'not-found' }`

`BUILTIN.source` 仍为 `'builtin'`；命中项目文件时 `source: 'project'`。

### 降级告警（改动 7·T5b）

`cli.js` 在 `loadConstraints` 之后、`runLint` 之前判 `source === 'builtin'`：

- 向 **stderr** 打醒目告警块（分隔线 + 区分 `parse-failed` / `not-found` 的文案）；
- 生成 `degradeBanner` markdown 横幅，拼到 review 内容**最前面**；
- 告警**绝不进 stdout**（stdout 要保持可被程序消费）。

核心句式：**本次通过 ≠ 项目约束下通过**。

### review 按契约名落盘 + 写失败不改退出码（改动 8·T7）

- `reviewPath = resolve(dirname(filePath), basename(filePath).replace(/\.ya?ml$/i, '') + '.review.md')`
  —— 不再写 cwd 下固定名的 `review.md`。
  **理由**：同一 change 下常有多份 capability 契约，固定文件名会互相覆盖，最后只剩一份。
- `writeReview(content)` 内部 try/catch：成功打印路径，**失败只向 stderr 告警并保留原退出码（0/2）**。
  **理由**：CI 靠退出码判阻塞，写盘失败不该把一个「不通过」变成「错误退出」而绕过闸门。
- 结构早退分支与正常分支**都**改用 `reviewPath` / `writeReview`，并都拼上 `degradeBanner`。

## 文档口径（二轮统一）

全部文档（`README.md` / `skill/SKILL.md` / `AGENTS.md` / `GUIDE.md` / `NOTES.md`）统一为：

- 定位：**一个 lint 检查内核 + 两个互斥前门**；
- **十一项检查**（不再是十项）；review 文件名 **`<契约名>.review.md`**；
- `bridge` 支持 **`--keep-verify`**；specgate **不执行验证工具**、**不替代 `/opsx:verify`**。
