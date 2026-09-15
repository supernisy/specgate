---
name: specgate
description: 把用户需求转成「人能审、机器能消费」的验收契约（YAML），并用纯确定性 CLI 门禁判定每条验收条件是否可被机械判定；也能把 OpenSpec 的 spec.md 桥接成契约。当用户提出需求、要写验收标准、要生成可测契约、要「给需求做门禁 / 审一下验收条件 / 能不能被测试验证 / 把 OpenSpec 的 spec 转成契约 / 我在用 OpenSpec」，或显式输入 /specgate 时调用。用户主动决定是否触发，不自动运行。
version: 1.1.0
type: workflow
---

# specgate · 需求验收契约门禁

把「提需求的人（不读代码）」的需求，转成一份机器可消费的验收契约，并判定契约里每条验收条件**是否可被机械判定**。工具本身**纯确定性、零模型参与**——`lint` 阶段一次模型都不调。

**它就是一个 lint 检查内核 + 两个互斥前门**（`draft` / `bridge`），见下方「第 0 步」。

> ⚠️ 本 skill 只**编排**流程，绝不修改 specgate 工具本身的算法（判据/词表/不变量）。那部分在 specgate 仓库里，改动要走修改单。

## 何时调用（用户主动触发）

- 用户说：把需求做成验收契约 / 给需求做门禁 / 审一下验收条件 / 生成可测契约 / 这条能不能被测试验证
- 用户说：把 OpenSpec 的 spec 转成契约 / spec.md 怎么接验收 / 我在用 OpenSpec
- 用户显式输入 `/specgate`
- 用户抛来一段需求文档或文字，希望先过一道「能不能被机器验证」的闸再进入实现

不要自动运行；等用户明确要求或显式触发。

## 前置：确保 specgate 可用

运行自举脚本拿到工具根目录（记为 `$SG_HOME`）：

```
node <skill_dir>/scripts/ensure_specgate.mjs
```

- 脚本只向 stdout 打印**一行**：specgate 根目录，agent 捕获这一行作为 `$SG_HOME`。
- 定位优先级：`$SPEC_GATE_HOME` 环境变量 > `~/.workbuddy/specgate`（已克隆）> 自动 `git clone https://github.com/supernisy/specgate` 到缓存并 `npm install yaml`。
- 若脚本报告未找到 npm，请在 `$SG_HOME` 手动执行 `npm install yaml`（用你环境中的 npm；Node 22+）。

> 提示：运行本环境的 `node` 若不在 PATH，请用其绝对路径（形如 `C:\Users\super\.workbuddy\binaries\node\versions\<版本>\node.exe`，具体版本以本机 `binaries/node/versions/` 下的实际目录为准）替换下面所有 `node`。

## 第 0 步：先看需求从哪来 —— 这决定走哪条路

> specgate 是**一个 lint 内核 + 两个互斥前门**，同一份需求**只走一条**。
> 有 `spec.md` 就只走路径 B —— `spec.md` 是唯一需求事实源，再跑 `draft` 等于凭空多出
> 第二个需求源，之后改了 spec 忘改契约，门禁把的是哪份就说不清了。

| 情形 | 路线 | 契约怎么来 |
|---|---|---|
| 用户直接给需求文档，或一段需求文字 | **路径 A** | draft → 填契约 → lint → plan |
| 用户已有 OpenSpec 的 `spec.md` | **路径 B** | bridge → 补全 → lint → plan |
| 两边都不沾，但需求体量大 / 要管变更记录 | **先推荐 OpenSpec**（见下），再走路径 B | bridge |

> 边界别越：specgate **只登记并校验 `verify` 的名称**（在不在清单里），**不执行任何验证工具**，
> 也**不替代**实现完成后的 `/opsx:verify`（AI 扫代码库做「实现 vs 规格」还原度核查，
> 属 OpenSpec **扩展 profile**，默认不含）。
>
> **三个「验证」别混**：`openspec validate`（CLI）验**格式/完整性** → specgate `lint` 验**可判定性** →
> **跑测试**是 `contract-test`/`unit`/`unit-visual`/`trace`。specgate 只占中间那层，
> 外加登记第三层的 `verify` 名字。用户问「OpenSpec 有验证功能吗」时按这个三层口径答。

### 什么时候该主动推荐用户上 OpenSpec

OpenSpec 是「先写规格、再写代码」的需求管理工具，产物 `spec.md` 用固定语法描述需求（`### Requirement` + `#### Scenario` + `**WHEN**/**THEN**` 子弹）。关键好处是：**它的产物 specgate 能一条命令直接桥接成验收契约**，不用手工抄一遍。

命中以下任一条，就值得建议用户采用：

- 需求超过 5 条，或一条需求下要分多个场景（正常 / 异常 / 边界）
- 需求会反复增删改，需要留下「本次加了什么 / 改了什么 / 删了什么」的记录（对应 `## ADDED / MODIFIED / REMOVED Requirements`）
- 多人协作，需求要能被不读代码的人 review
- 用户已经在用 OpenSpec，只是不知道下游还能接验收门禁

推荐话术（一两句就够，别长篇推销）：

> 你这份需求条数和场景都不少，建议用 OpenSpec 把规格写成 `spec.md`（`### Requirement` + `#### Scenario` + `**WHEN**/**THEN**`）。写完 specgate 能一条命令桥接成验收契约直接进门禁，不用手抄。

用户不想引入 OpenSpec 也完全没问题——路径 A 够用，门禁效果一样。**推荐点到为止，绝不阻塞流程。**

## 路径 A：需求 → 契约（五步）

约定：所有产物落在用户指定的**干净工作目录**（建议新建一个目录专门放本次契约）。

### A1. 准备需求文件

- 用户给的是文件路径 → 直接用。
- 用户粘贴的是文字 → 整段写入 `requirement.md`（**不要摘要**，门禁要看到原话）。

### A2. draft（产出空白模板 + 填写提示词，不调模型）

```
cd <工作目录>
node $SG_HOME/src/cli.js draft requirement.md
```

产出：
- `contract.draft.yaml` —— 空白契约模板（字段带注释）
- `draft.prompt.md` —— 已注入需求原文 + verify 清单 + `suspect` 填写要求 + 蜕变关系正反例

⚠️ `draft` 不调模型。AI 的参与在**下一步**。

### A3. 填写契约（AI 参与，落在 draft 阶段）

读 `draft.prompt.md`，严格遵守其「硬性约束」，逐条把需求转成验收条目，写进 `contract.yaml`：

- 每条 `accept` 必须标 `suspect`：
  - 测试方能据此写出断言 → `suspect: false`
  - 不能 → `suspect: true`
  - 判断标准是「**能不能写出断言**」，不是「用词是否克制」（`视觉度量差异不超过 1px` 用词不克制但可判定 ⇒ false；`体感上不卡顿` 平实但无法写断言 ⇒ true）
- 计算/聚合类（总价/计数/排序/分页…）必须写 `invariants`，且写「输入变了输出该怎么变」，不是恒真废话（如「总价必须是数字」比没有更糟）
- 不编造数值；拿不准的期望值登记进 `assumed_output`（只标期望值是推测的，不标输入）
- 参考 `contract.draft.yaml` 的字段注释

> 🔴 `suspect` 必须**落盘**在 `contract.yaml`。lint 时只读取、不重新判、不调模型——这样同一份契约跑一百次输出完全相同（确定性不变量）。

### A4. lint（迭代到通过，退出码 0）

```
node $SG_HOME/src/cli.js lint contract.yaml
```

- 退出 `0` = 通过；退出 `2` = 不通过。
- review 落在**契约旁边、按契约命名**：`contract.yaml` → `contract.review.md`。三层输出：
  - **【需要修改】** 8 项阻塞检查：结构 / verify 合法 / 措辞 / breaks 已批准 / manual 占比≤20% / invariants 有效 / 计算类有不变量 / 期望值已确认
  - **【需要你决策】** `assumed_output` 等需人签字的条目（归「决策」非「修改」）
  - **【提醒】** 能力边界 / 接口状态覆盖 / verify 分布（三项都只提醒，不阻塞退出码）
- 读 `contract.review.md`，按建议改 `contract.yaml`，重跑 `lint`，直到退出 `0`。
- ⚠️ 若约束源降级为 `builtin`，stderr 会弹告警块、review 顶部会有横幅：
  **本次通过 ≠ 项目约束下通过**（原因分 `not-found` / `parse-failed`；修好约束源再重跑）。
- ⚠️ `lint` 全程零模型、零网络、可复现。

### A5. plan（产出物理隔离的任务包）

```
node $SG_HOME/src/cli.js plan contract.yaml [outBase]
```

产出 `<outBase>/specgate-plan/`（默认当前目录）：
- `impl-task/` —— `contract.yaml` + `context.md`（实现方填代码库上下文）
- `test-task/` —— `contract.yaml` + `verify-tools.md` + `prompt.md`（测试方据此写断言）
- **隔离自检**：实现方源码路径不得泄漏进 `test-task`；命中即退出 `2`（§7.2）

## 路径 B：OpenSpec spec.md → 契约（四步）

### B1. 桥接（确定性解析，不调模型）

```
node $SG_HOME/src/cli.js bridge <spec.md> contract.yaml [--keep-verify]
```

省略输出路径则把契约打到 stdout。
**旧契约里有人工改过的 `verify` 想保住，加 `--keep-verify`** —— 它只保留「与本次机器推断**不同**」的值
（也就是人真动过的那些），其余照旧走机器推断，重复跑结果一致；CLI 会回报「保留人工 verify 修正 N 条」。

映射规则（完整版见仓库 `AGENTS.md`）：

| OpenSpec `spec.md` | `contract.yaml` |
|---|---|
| `### Requirement: <name>` + `#### Scenario: <name>` | 一组 `accept` 条目，`id` = 需求名 kebab + 场景序号（`user-login-1`） |
| `- **GIVEN** …` | `given` |
| `- **WHEN** …`（后续 `- **AND**` 续到 when） | `when` |
| `- **THEN** …`（后续 `- **AND**` 续到 then） | `then` |
| `- **WHY** …` | 丢弃（需求理由不进契约正文） |
| `## REMOVED Requirements` | `out_of_scope` 列出被移除的需求名 |
| （spec 里没有这个字段） | `verify` —— 桥接层用**关键词启发式**从 `constraints.yaml` 的合法取值推断：状态迁移→`trace`、接口异常→`state-matrix`、接口/API→`contract-test`、UI→`unit-visual`…兜底 `unit` |

> 桥接同时给每条 `accept` 打 `verify_source`：`inferred`（机器推的）/ `explicit`（人改过的）。
> 检查⑪ 会报出 inferred 占比，提示逐条确认后再消除。

### B2. 补全桥接层填不了的部分（关键，别跳）

桥接是纯确定性解析，**只搬它能搬的**。以下必须由 AI 补：

- **`suspect` 一定为空** —— 桥接**故意留空**（确定性解析无法判断「测试方能否写出断言」）。逐条按 A3 的同一套标准标注，这是不可省的一步。
- **`invariants` / `breaks` / `uses` / `states` 也一定为空** —— OpenSpec 不产出这些，桥接不臆造。计算/聚合类条目必须补 `invariants`（写「输入变了输出怎么变」）。
- **措辞** —— OpenSpec 的 `THEN` 常写得偏口语，需按判据一改写成可判定表述。

> 想拿现成的填写提示词，可先跑一次 `draft`（需要一份 `requirement.md`），把 `draft.prompt.md` 当参考；但桥接路线不是必须。

### B3. 进门禁

```
node $SG_HOME/src/cli.js lint contract.yaml
```

与手写契约走**同一套十一项检查**，读 `contract.review.md` 迭代到退出 `0`。

### B4. 切任务包

```
node $SG_HOME/src/cli.js plan contract.yaml [outBase]
```

同 A5。

## 交付给用户

跑完后，用中文告诉用户：

1. **产物清单与路径**：`contract.yaml`（验收契约）、`<契约名>.review.md`（门禁结论与改写建议）、`specgate-plan/`（两个任务包）。
2. **怎么用**：
   - 实现方 → 看 `impl-task/contract.yaml`，并在 `context.md` 填代码库上下文
   - 测试方 → 看 `test-task/contract.yaml` + `prompt.md`，按 `verify` 写断言
   - 之后重跑门禁：`node $SG_HOME/src/cli.js lint contract.yaml`
3. **两判据一句话**：措辞两级化（`suspect` 加严 + 主观词表兜底，无锚点才拦）；蜕变关系（变动词之后遍历所有切分点，恒真断言在输出侧即阻塞）。
4. 若用户对某条有疑问，直接改 `contract.yaml` 后重跑 `lint` 即可，门禁会重新判定。

**走路径 B 时额外说明**：契约是桥接生成的，`suspect` 和 `invariants` 是**后补**的，建议用户重点复核这两处是否符合本意；并可以顺带提一句「以后维护 spec.md 再跑一次 `bridge` + `lint` 就行」。

## 注意事项

- **前门互斥**：有 `spec.md` 就只走 bridge，没 OpenSpec 才走 draft。**绝不两条都跑**——
  两个需求源并存必然漂移（改了 spec 忘改契约）。
- **不要绕过门禁**：别因为某条难写断言就删条目；应改写措辞使其可判定。
- **不要改工具算法**：判据/词表/不变量在 specgate 仓库里，本 skill 只编排。
- **lint 无模型**：`suspect` 标注必须由 AI 在 draft（或桥接后的补全）阶段写好进 YAML，lint 时不得现调模型。
- **桥接 ≠ 全自动**：`bridge` 只做结构搬运，补 `suspect`/`invariants` 的活一步都省不掉。别把桥出的契约直接丢进 lint 就交付。
- **不替工具跑验证**：specgate 只登记并校验 `verify` 的名称，不执行验证工具，也不替代实现后的 `/opsx:verify`。
- **推荐 OpenSpec 要克制**：只在真的合适时提，且明确告诉用户「不采用也行」。不与用户争论工具选型。
- 失败（退出 2）是正常的——那是门禁在拦「不可验」的需求，按 `<契约名>.review.md` 改即可。
