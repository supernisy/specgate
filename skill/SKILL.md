---
name: specgate
description: 把用户需求转成「人能审、机器能消费」的验收契约（YAML），并用纯确定性 CLI 门禁判定每条验收条件是否可被机械判定。当用户提出需求、要写验收标准、要生成可测契约、要「给需求做门禁 / 审一下验收条件 / 能不能被测试验证」，或显式输入 /specgate 时调用。用户主动决定是否触发，不自动运行。
version: 1.0.0
type: workflow
---

# specgate · 需求验收契约门禁

把「提需求的人（不读代码）」的需求，转成一份机器可消费的验收契约，并判定契约里每条验收条件**是否可被机械判定**。工具本身**纯确定性、零模型参与**——`lint` 阶段一次模型都不调。

> ⚠️ 本 skill 只**编排**流程，绝不修改 specgate 工具本身的算法（判据/词表/不变量）。那部分在 specgate 仓库里，改动要走修改单。

## 何时调用（用户主动触发）

- 用户说：把需求做成验收契约 / 给需求做门禁 / 审一下验收条件 / 生成可测契约 / 这条能不能被测试验证
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

> 提示：运行本环境的 `node` 若不在 PATH，请用其绝对路径（如 `C:\Users\super\.workbuddy\binaries\node\versions\22.22.2-2\node.exe`）替换下面所有 `node`。

## 全流程（需求 → 产物）

约定：所有产物落在用户指定的**干净工作目录**（建议新建一个目录专门放本次契约）。

### 1. 准备需求文件

- 用户给的是文件路径 → 直接用。
- 用户粘贴的是文字 → 整段写入 `requirement.md`（**不要摘要**，门禁要看到原话）。

### 2. draft（产出空白模板 + 填写提示词，不调模型）

```
cd <工作目录>
node $SG_HOME/src/cli.js draft requirement.md
```

产出：
- `contract.draft.yaml` —— 空白契约模板（字段带注释）
- `draft.prompt.md` —— 已注入需求原文 + verify 清单 + `suspect` 填写要求 + 蜕变关系正反例

⚠️ `draft` 不调模型。AI 的参与在**下一步**。

### 3. 填写契约（AI 参与，落在 draft 阶段）

读 `draft.prompt.md`，严格遵守其「硬性约束」，逐条把需求转成验收条目，写进 `contract.yaml`：

- 每条 `accept` 必须标 `suspect`：
  - 测试方能据此写出断言 → `suspect: false`
  - 不能 → `suspect: true`
  - 判断标准是「**能不能写出断言**」，不是「用词是否克制」（`视觉度量差异不超过 1px` 用词不克制但可判定 ⇒ false；`体感上不卡顿` 平实但无法写断言 ⇒ true）
- 计算/聚合类（总价/计数/排序/分页…）必须写 `invariants`，且写「输入变了输出该怎么变」，不是恒真废话（如「总价必须是数字」比没有更糟）
- 不编造数值；拿不准的期望值登记进 `assumed_output`（只标期望值是推测的，不标输入）
- 参考 `contract.draft.yaml` 的字段注释

> 🔴 `suspect` 必须**落盘**在 `contract.yaml`。lint 时只读取、不重新判、不调模型——这样同一份契约跑一百次输出完全相同（确定性不变量）。

### 4. lint（迭代到通过，退出码 0）

```
node $SG_HOME/src/cli.js lint contract.yaml
```

- 退出 `0` = 通过；退出 `2` = 不通过（同时写 `review.md`）
- `review.md` 三层输出：
  - **【需要修改】** 8 项阻塞检查：结构 / verify 合法 / 措辞 / breaks 已批准 / manual 占比≤20% / invariants 有效 / 计算类有不变量 / 期望值已确认
  - **【需要你决策】** `assumed_output` 等需人签字的条目（归「决策」非「修改」）
  - **【提醒】** 能力边界 / 接口状态覆盖（仅提醒，不阻塞退出码）
- 读 `review.md`，按建议改 `contract.yaml`，重跑 `lint`，直到退出 `0`。
- ⚠️ `lint` 全程零模型、零网络、可复现。

### 5. plan（产出物理隔离的任务包）

```
node $SG_HOME/src/cli.js plan contract.yaml [outBase]
```

产出 `<outBase>/specgate-plan/`（默认当前目录）：
- `impl-task/` —— `contract.yaml` + `context.md`（实现方填代码库上下文）
- `test-task/` —— `contract.yaml` + `verify-tools.md` + `prompt.md`（测试方据此写断言）
- **隔离自检**：实现方源码路径不得泄漏进 `test-task`；命中即退出 `2`（§7.2）

## 交付给用户

跑完后，用中文告诉用户：

1. **产物清单与路径**：`contract.yaml`（验收契约）、`review.md`（门禁结论与改写建议）、`specgate-plan/`（两个任务包）。
2. **怎么用**：
   - 实现方 → 看 `impl-task/contract.yaml`，并在 `context.md` 填代码库上下文
   - 测试方 → 看 `test-task/contract.yaml` + `prompt.md`，按 `verify` 写断言
   - 之后重跑门禁：`node $SG_HOME/src/cli.js lint contract.yaml`
3. **两判据一句话**：措辞两级化（`suspect` 加严 + 主观词表兜底，无锚点才拦）；蜕变关系（变动词之后遍历所有切分点，恒真断言在输出侧即阻塞）。
4. 若用户对某条有疑问，直接改 `contract.yaml` 后重跑 `lint` 即可，门禁会重新判定。

## 注意事项

- **不要绕过门禁**：别因为某条难写断言就删条目；应改写措辞使其可判定。
- **不要改工具算法**：判据/词表/不变量在 specgate 仓库里，本 skill 只编排。
- **lint 无模型**：`suspect` 标注必须由 AI 在 draft 阶段写好进 YAML，lint 时不得现调模型。
- 失败（退出 2）是正常的——那是门禁在拦「不可验」的需求，按 `review.md` 改即可。
