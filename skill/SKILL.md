---
name: specgate
description: specgate 的单一入口流程编排器。一次唤醒即自动探测当前进度（有无 spec.md / 契约 / 约束源 / 上次 lint 结果），判定处在哪一步，然后每步只抛给用户一个「是 / 否 / 选 A|B」的判断，其余（draft 起草、bridge 桥接、lint 门禁迭代、verify 认领、plan 切任务包）全部由 agent 执行，直到契约过闸并产出隔离任务包。当用户说「把需求做成验收契约 / 给需求做门禁 / 验收先行 / 审一下验收条件 / 这条能不能被测试验证 / 生成可测契约 / 把 OpenSpec 的 spec 转成契约 / 我在用 OpenSpec / 把需求过一道闸再写代码」或显式输入 /specgate 时调用。用户主动决定是否触发，不自动运行。
version: 2.0.0
type: workflow
---

# specgate · 单一入口的验收门禁编排器

> **本文件是执行剧本，不是给用户读的说明书。** 对用户永远只说三件事：
> **① 现在在哪一步 ② 为什么这一步必要 ③ 要他做的那个判断是什么。**
> 不要向用户抛命令、抛路径 A/B 理论、抛 YAML 字段——那些是你要做的事。

## 0. 定位（一句话）

specgate 是**一个 lint 检查内核 + 两个互斥前门**：在**写代码之前**判定每条验收条件「能不能被机器机械判定」，用**退出码**把不合格的需求挡在实现之外。工具本身**纯确定性、零模型**——`lint` 一次模型都不调。

**本 skill 只做编排**：探测状态 → 引导用户做判断 → 替用户执行命令 → 推进下一步。**绝不修改 specgate 的算法**（判据 / 词表 / 不变量 / 检查项都在工具仓库里，改动走修改单）。

### 与 OpenSpec 官方命令的分工（不重造）

| 环节 | 谁负责 |
|---|---|
| 需求澄清 / 探索 | **OpenSpec `/opsx:explore`**（skill 只建议，不重实现） |
| 生成 proposal + specs + design + tasks | **OpenSpec `/opsx:propose`**（skill 只衔接，不重实现） |
| 实现 / 归档 | **OpenSpec `/opsx:apply`、`/opsx:archive`** |
| 实现 vs 规格 还原度核查 | **OpenSpec `/opsx:verify`**（skill **不替代**） |
| **spec.md → 契约 → 可判定性门禁 → verify 认领 → 隔离任务包** | **本 skill（specgate）** |

> 官方没有的那一段就是本 skill 的全部职责：`bridge/draft` → `lint` → 认领 `verify` → `plan`。
> **specgate 只登记并校验 `verify` 的名称，从不执行任何验证工具，也不替代 `/opsx:verify`。**

---

## 1. 唤醒后第一件事：状态探测（只读，不改任何文件）

**不要先问用户「你有 spec.md 吗」——先自己看。** 运行：

```bash
printf 'spec.md          : '; ls -1 spec.md 2>/dev/null || echo '（无）'
printf 'contract.yaml    : '; ls -1 contract*.yaml 2>/dev/null || echo '（无）'
printf 'constraints.yaml : '; ls -1 constraints.yaml 2>/dev/null || echo '（无，工具会逐级向上找）'
printf '上次 review      : '; ls -1t *.review.md 2>/dev/null | head -1 || echo '（无）'
```

拿到结果后，对照下表**直接定位到某一个状态 S**，然后**只执行该状态的卡片**：

| 探测结果 | 落在 |
|---|---|
| 无 spec.md、无契约、无 review | **S0**（首次进来） |
| 有 spec.md、无契约 | **S2b**（桥接） |
| 有 contract.yaml、无 review | **S4**（门禁，还没跑过） |
| 有 review 且是「不通过」 | **S4**（门禁，继续迭代） |
| review 是「通过」、无 `specgate-plan/` | **S5 或 S6** |
| 有 `specgate-plan/` | **S7**（收尾） |

> 每次**只报一句**：「现在在 **S4 门禁**，因为契约有了但还没过闸；下一步要你决定 X。」

---

## 2. 状态机总览

```
S0 选型 ──→ S1 澄清 ──→ ┌ S2a 起草(draft)  ┐──→ S3 约束源 ──→ S4 门禁(lint 迭代)
                        └ S2b 桥接(bridge) ┘                        │
                                                                    ▼
                        S7 收尾 ←── S6 出包(plan) ←── S5 认领 verify
```

| 状态 | 一句话 | **要用户做的判断** |
|---|---|---|
| S0 | 选前门 | 需求从哪来？ |
| S1 | 澄清到能写断言 | 这几个歧义点选哪个？ |
| S2a | draft 起草 + 填契约 | 我按这套标注填，同意吗？ |
| S2b | bridge 桥接 + 补全 | 旧 verify 要保住吗？ |
| S3 | 确认约束源 | 要不要放 constraints.yaml？ |
| S4 | lint 迭代到退出 0 | 改法同意吗 / 决策项怎么定？ |
| S5 | 认领 verify | 逐条确认还是接受推断？ |
| S6 | plan 切隔离任务包 | 任务包放哪？ |
| S7 | 收尾交付 | 要不要接 CI 门禁？ |

---

## 3. 逐态执行卡

### S0 · 选型

**我做什么**：已有的探测结果 + 问一句需求来源。

**你要判断**（三选一）：
1. 直接贴需求原文 / 给需求文件路径 → **走 A**
2. 已经有 OpenSpec 的 `spec.md` → **走 B**
3. 需求条数多、场景多、要管增删改记录 → 我建议先上 OpenSpec，再走 B

**为什么**：**前门互斥，同一份需求只走一条。** `spec.md` 在，它就是唯一需求事实源；再 `draft` 一份等于凭空多出第二个需求源，改了 spec 忘改契约，门禁把的到底是哪份就说不清。

**判定规则（不要问"要不要用 OpenSpec"这种空问题，命中才提，且点到为止）**：需求 > 5 条、或一条需求要分多场景（正常/异常/边界）、或要留变更记录、或多人协作要被不读代码的人 review —— 命中任一才建议，且明确告诉用户「不采用也行，路径 A 效果一样」。

**我执行**：进入 S1。

---

### S1 · 澄清到「能写出断言」

**我做什么**：读需求，找出**无法转成可判定断言**的歧义点（含糊名词、缺失边界、未定的期望值、没说清的正常/异常分支）。

**你要判断**：我把歧义点压成 **1~3 个具体问题**（每个都是「选 A 还是 B」或「填一个数/状态名」），你回答即可。

> 例：「登录失败时，是『提示错误』还是『返回 401 且不建会话』？」——不是「你这需求写清楚点」。

**为什么**：门禁拦的是「写不出断言」，而写不出断言多半不是措辞问题，是**需求本身没定**。在成本最低的此刻定掉，后面实现和测试都不用猜。

**衔接 OpenSpec**：若用户在用 OpenSpec 且还没澄清过，建议先跑 `/opsx:explore`；澄清产物会进 `spec.md`，本 skill 不去重实现。

**我执行**：澄清完成 → 按 S0 的选择进 **S2a** 或 **S2b**。

---

### S2a · draft 起草 → 填契约（路径 A）

**我做什么**：
1. 把需求原文**整段**写入 `requirement.md`（**不摘要**——门禁要看到原话）。
2. 跑 `draft`（**不调模型**）：
   ```bash
   node <SG_HOME>/src/cli.js draft requirement.md
   ```
   产出**恰好两个文件**：`contract.draft.yaml`（空白模板，带字段注释）+ `draft.prompt.md`（已注入需求原文 + verify 清单 + 蜕变关系正反例）。
3. 读 `draft.prompt.md` 的「硬性约束」，逐条把需求转成验收条目，写出 `contract.yaml`。

**你要判断**：我把**每条 `accept` 的 `suspect` 标注**列给你（哪几条我认为测试方写不出断言、为什么），问一句「按这套填，同意吗？」。

**为什么**：`suspect` 是**判据一的第一级**，必须由 AI 在起草时逐条判断、**落盘**进 YAML；`lint` 只读不判、不调模型——这样同一份契约跑一百次输出完全相同。

**填写规则（照做，别自创）**：
- 每条 `accept` 必标 `suspect`：能写出断言 → `false`；不能 → `true`。
  判据是「**测试方能不能写出断言**」，**不是**「用词克不克制」。
  （`视觉度量差异不超过 1px` 用词不克制但可判定 ⇒ `false`；`体感上不卡顿` 平实但写不出断言 ⇒ `true`）
- 计算/聚合类（总价/计数/排序/分页…）必须写 `invariants`，且写「**输入变了输出该怎么变**」（增量/幂等/单调/可加/对称），**不是恒真废话**（「总价必须是数字」比没有更糟）。
- **不编造数值**；期望值拿不准 → 登记 `assumed_output`（只标推测的期望值，不标输入），交 S4 的「决策」层让用户签字。
- 字段注释以 `contract.draft.yaml` 为准。

**我执行**：写出 `contract.yaml` → 进 S3。

---

### S2b · bridge 桥接 → 补全（路径 B）

**我做什么**：
1. 跑桥接（确定性解析，**不调模型**）：
   ```bash
   node <SG_HOME>/src/cli.js bridge <spec.md> contract.yaml [--keep-verify]
   ```
2. 补全桥接层**故意不填**的部分，写出 `contract.yaml`。

**你要判断**：若这次是**重跑**（已有契约里 `verify` 被人改过），问一句「**旧契约里人工改过的 verify，要保住吗？**」→ 是则加 `--keep-verify`。

**为什么**：`--keep-verify` 只保留「与本次机器推断**不同**」的那些值——也就是**人真动过**的（人被改过的那条，一定有人知道机器判错了；覆盖等于把人的判断丢掉）。没改的仍随启发式演进，重复跑结果一致（幂等）。CLI 会回报「保留人工 verify 修正 N 条」。

> 🔴 **重跑 bridge 必带 `--keep-verify`**，否则人工修正会被机器推断冲掉。

**必补三样（一步都省不掉）**：
- **`suspect`** —— 桥接**故意留空**（确定性解析无法判断「测试方能否写出断言」）。逐条按 S2a 的同一套标准标注。**这是不可省的一步。**
- **`invariants`** —— 桥接不臆造。计算/聚合类必补（写「输入变了输出怎么变」）。
- **措辞** —— OpenSpec 的 `THEN` 常偏口语，按判据一改写成可判定表述。

**顺带确认**：桥接会给每条打 `verify_source`（`inferred` 机器推的 / `explicit` 人改过的），检查⑪ 会报 inferred 占比——留到 S5 处理。

**我执行**：写出 `contract.yaml` → 进 S3。

---

### S3 · 确认约束源（别在 builtin 上误判通过）

**我做什么**：跑一次 `lint` 前先看约束源——工具会从契约目录**逐级向上、遇 `.git` 即停**找 `constraints.yaml`。若降级为 `builtin`，**stderr 会弹告警块、review 顶部挂横幅**。

**你要判断**：「**要不要在仓库根放一份 `constraints.yaml`？**」→ 放 / 不放（先跑着看）。

**为什么**：核心句式是「**本次通过 ≠ 项目约束下通过**」。builtin 用的是内置 verify 清单，可能与项目真实能力不符——门禁结论会失真。降级原因分两种：`not-found`（一路找到仓库根都没有）、`parse-failed`（找到了但 YAML 解析失败）。

**我执行**：用户要放 → 从工具仓库的 `constraints.yaml` 复制一份骨架到仓库根（`verify_tools` 九种取值 + `manual.max_ratio: 0.2`），让用户按项目实际增删；用户不放 → 照跑，但**必须在最终交付里明确标注「本次是 builtin 结论」**。→ 进 S4。

---

### S4 · 门禁 lint（迭代到退出 0）

**我做什么**：
```bash
node <SG_HOME>/src/cli.js lint contract.yaml
```
- 退出 **0** = 通过 → 进 S5。
- 退出 **2** = 不通过 → 读**契约旁边、按契约命名**的 `<契约名>.review.md`（`contract.yaml` → `contract.review.md`），按建议改 `contract.yaml`，**重跑，循环**。
- 退出 **1** = 用法/IO 错误 → 检查路径与 YAML 格式。

**review 三层，处理方式不同**：

| 层 | 内容 | 谁定 |
|---|---|---|
| **【需要修改】** | 8 项阻塞检查（结构 / verify 合法 / 措辞 / breaks 已批准 / manual≤20% / invariants 有效 / 计算类有不变量 / 期望值已确认） | **我改**，改完向用户报一句 |
| **【需要你决策】** | `assumed_output`、`breaks.approved` 等人签字项 | **必须抛给用户** |
| **【提醒】** | 能力边界 / 接口状态覆盖 / verify 分布（⑪） | **不阻塞退出码**，留到 S5 |

**你要判断**（合并成一个问题问，别挤牙膏）：
> 「**① 阻塞的 N 条我按 review 建议改写，同意吗？② 决策层这 M 条要你拍板：<逐条列出>。**」

**为什么**：门禁的价值就在「**改判据内的措辞，而不是删条目**」。阻塞项是机器已判定不合格，属确定性结论，我直接改最高效；决策项是机器**不确定**、必须人签字的（工具不替人决策），只能你定。

**改写的唯一正确姿势**：
- 断言难写 → **改写措辞使其可判定**，🔴 **绝不删条目**。
- 「友好/稳定/流畅/快」这类 → 换成带**锚点**的表述（错误码 `E1001`、`200ms` 内、退出码 `0: Success`、''`getUserList()`'' 这类真标识符、`config/app.yaml` 这类带扩展名路径、倒序/重定向到/移除 这类布尔与顺序词）。
- 恒真废话（不报错 / 是数字类型 / 达到预期）→ 换成**蜕变关系**（新增一件后总价严格增加 / 相同入参连续两次结果完全相同 / 范围扩大结果不减少）。

**我执行**：迭代到退出 `0` → 进 S5。

---

### S5 · 认领 verify（把机器推断变成人的显式选择）

**我做什么**：看 review 的【提醒】里 **⑪ verify 分布**——尤其是 `inferred` 占比。

**你要判断**：「**逐条确认 `verify` 取值，还是接受机器推断？**」→ 逐条确认 / 接受。

**为什么**：走 bridge 时 `verify` 是**关键词启发式**推的，⑪ 只产**提醒、绝不阻塞退出码**——因为「手段选得合不合适」需要人判断（同一句话在不同项目里可能真该用 `unit`），工具只提示「你**可能**选错了」，不替人拍板。

**我执行**：
- 用户选**逐条确认** → 我把每条 `verify` 与它的 `when` / `then` 并列成一张清单，用户改哪条我改哪条——**直接在 `contract.yaml` 里改 `verify` 并标 `verify_source: explicit`** → 重跑 `lint` 确认仍退出 0。
- 用户选**接受** → 保留 `inferred`，但在交付说明里标注「verify 为机器推断，未逐条确认」。
- 若 ⑪ 报 **ui-mismatch**（UI 措辞配了非视觉手段）→ 提示应改 `geo` / `ax` / `unit-visual` / `trace` 之一，交用户定。

> 🔴 **陷阱 1：不要为了改 verify 去重跑 `bridge`。** `bridge` **只保留 `verify`**，会冲掉 `suspect` / `invariants` / 人工改过的措辞（实测：重跑后 `suspect` 全部丢失）。只要 `spec.md` 没变，认领 verify 就直接编辑 `contract.yaml`。
> 🔴 **陷阱 2：`verify_source: explicit` 只在「值与机器推断**不同**」时才算数。** 手写 `explicit` 但值与推断相同 ⇒ 仍按 `inferred` 处理，⑪ 会继续提醒（不阻塞退出码）。
> ✅ **只有 `spec.md` 本身改了**才重跑 bridge：重跑前**先把 `suspect` / `invariants` 另存**，跑完 `bridge --keep-verify` 再把它们合并回去。

→ 进 S6。

---

### S6 · 出包 plan（两个物理隔离的任务包）

**我做什么**：
```bash
node <SG_HOME>/src/cli.js plan contract.yaml [outBase]
```
产出 `specgate-plan/`（默认当前目录）：
- `impl-task/` —— `contract.yaml` + `context.md`（实现方填代码库上下文）
- `test-task/` —— `contract.yaml` + `verify-tools.md` + `prompt.md`（测试方据此写断言）
- **隔离自检**：实现方源码路径不得泄漏进 `test-task`，命中即退出 `2`。

**你要判断**：「**任务包放到哪？**」默认 `./specgate-plan/`，或你指定 `outBase`。

**为什么**：隔离自检把「测试方偷看实现」这件事变成**机械可判**的失败条件——测试方只拿契约不看代码，验收才可信。`context.md` **只在首次生成**，已存在则保留；要**实现方填完真实源码路径后重跑 `plan`**，隔离自检才真正生效。

**我执行**：出包成功 → 进 S7。若退出 2（隔离泄漏）→ 把泄漏路径列给用户，问「改 `context.md` 里的路径表述，还是确认这些文件不该出现在实现上下文里？」

---

### S7 · 收尾交付

**我做什么**：用中文向用户交付四件事（**不要罗列命令**）：

1. **产物清单与路径**：`contract.yaml`（验收契约）、`<契约名>.review.md`（门禁结论与改写建议）、`specgate-plan/`（两个任务包）。
2. **谁看哪个**：
   - 实现方 → `impl-task/contract.yaml`，并填 `context.md` 的代码库上下文
   - 测试方 → `test-task/contract.yaml` + `prompt.md`，按 `verify` 取值写断言
3. **走 B 路线要额外说明**：契约是桥接生成的，`suspect` 和 `invariants` 是**后补**的，请重点复核这两处是否符合本意；以后维护 `spec.md` 再跑一次 `bridge --keep-verify` + `lint` 即可。
4. **约束源状态**：若不是项目约束下通过（builtin），必须显式标注。

**你要判断**：「**要不要把 `lint` 挂进 CI 当门禁？**」（即每次改动需求/契约自动跑一次，退出码非 0 就挡 PR）→ 要 / 不要。

**为什么**：契约一旦进了 CI，门禁就从「跑一次」变成「持续生效」——需求被改坏时在 PR 上被拦住，而不是等上线后靠人肉感觉。

---

## 4. 红线（继承，任何状态都不许破）

1. **lint 零模型可复现**：`suspect` 必须由 AI 在起草/补全阶段写好**落盘**进 YAML；`lint` 时只读、不重判、不调模型。
2. **前门互斥**：有 `spec.md` 只走 `bridge`，没有才走 `draft`。**绝不两条都跑。**
3. **不执行验证工具、不替代 `/opsx:verify`**：只登记并校验 `verify` 的名称。
4. **难写断言 → 改写措辞，不删条目。**
5. **期望值拿不准 → 登记 `assumed_output` 交确认**，不编造数值。
6. **skill 只编排、不改算法**：判据/词表/不变量/检查项在工具仓库，改动走修改单。
7. **重跑 `bridge` 必带 `--keep-verify`，且必须先把 `suspect`/`invariants` 另存后回填**——`bridge` 只保留 `verify`，其余一律重生成（实测会丢失 `suspect`）。
8. **不触发任何 GitHub 远端写操作**；不改工具仓库 `src/**`。

---

## 5. 能力清单对齐（执行时必须落到的真实行为）

| 能力 | 对齐点 |
|---|---|
| 四子命令 | `draft` / `lint` / `plan` / `bridge`，**位置参数不用 flag**（`--keep-verify` 是唯一例外） |
| `draft` 产物 | **恰好两个**：`contract.draft.yaml` + `draft.prompt.md`；**不调模型** |
| `bridge` | 打 `verify_source`（`inferred`/`explicit`）；`--keep-verify` 保人工修正 |
| `lint` | **十一项检查** + 退出码 **0/2/1** + 按契约名落 `<契约名>.review.md` + 约束源降级告警（stderr 告警块 + review 顶部横幅） |
| `plan` | 出 `specgate-plan/{impl-task,test-task}` 两个物理隔离包 + 隔离自检 |
| 三层「验证」口径 | `openspec validate` 验格式 → **specgate `lint` 验可判定性** → 跑测试是 `contract-test`/`unit`/`unit-visual`/`trace`。specgate 只占中间层并登记第三层的名字 |

---

## 6. 一句话话术（每个状态对用户先说这句）

- S0：「你的需求是从哪来的——直接贴给我，还是已经有 OpenSpec 的 spec.md？」
- S1：「有 N 个点需要你定，第 1 个：……」
- S2a：「我按这套 `suspect` 标注填好了，你扫一眼同不同意。」
- S2b：「旧契约里人工改过的 verify，这次要保住吗？」
- S3：「这个仓库根还没有 `constraints.yaml`，要放一份吗？不放的话结论只能用内置清单。」
- S4：「阻塞 N 条我按 review 改了；另有 M 条要你拍板：……」
- S5：「verify 是机器推的，要逐条确认还是先接受？」
- S6：「任务包放默认目录还是你指定？」
- S7：「要不要把 `lint` 挂进 CI，以后改动自动挡？」

---

## 附：确保 specgate 可用（每个会话只跑一次）

```bash
node <skill_dir>/scripts/ensure_specgate.mjs
```

- 只向 stdout 打印**一行**：specgate 根目录 → 捕获为 `$SG_HOME`（本 skill 里所有 `<SG_HOME>` 都指它）。
- 定位优先级：`$SPEC_GATE_HOME` > 已克隆缓存（`~/.workbuddy/specgate` / `~/.codebuddy/specgate`，都不存在则用中立目录 `~/.specgate`）> 自动 `git clone https://github.com/supernisy/specgate` 并 `npm install yaml`。
- 加 `--pull` 可把**自管缓存**刷新到 `origin/HEAD`（浅克隆下 `fetch` + `reset --hard`，比 `pull` 可靠）；`$SPEC_GATE_HOME` 指向的用户克隆**绝不改动**。
- 若报告未找到 npm，请在 `$SG_HOME` 手动 `npm install yaml`（Node 22+）。

> 若本环境的 `node` 不在 PATH，用其绝对路径（形如 `C:\Users\super\.workbuddy\binaries\node\versions\<版本>\node.exe`）替换上面所有 `node`。

---

## 附：真实对话走查

用户只答判断、其余全自动的真实链路证据见 `examples/walkthrough.md`。
