# 走查：用户只答判断，skill 跑完整条链

> 本文件记录 **v2.0.0 skill 的真实执行证据**（命令与输出均为实跑，非示意）。
> 环境：Windows + Git Bash，Node 22.22.2，specgate 仓库工作区干净（commit `b69438c`）。
> 沙盒目录：`<TEMP>/sg-walkthrough/`（与工具仓库隔离，不影响 `src/**`）。

对照每条验收标准：**每条判断之后，skill 自己跑命令、解析输出、落文件**，用户全程不敲命令、不手改 YAML。

---

## 路线「结合」（已有 OpenSpec spec.md → bridge 起步）

### 用户要做的判断（全部，只有 5 个）

| # | 状态 | skill 问 | 用户答 |
|---|---|---|---|
| 1 | S0 选型 | 需求从哪来？ | 「已经有 spec.md」 |
| 2 | S1 澄清 | 库存不足时是「拒绝下单」还是「排队等补货」？ | 「拒绝，且购物车不变」 |
| 3 | S3 约束源 | 仓库根要放 `constraints.yaml` 吗？ | 「放」 |
| 4 | S4 门禁 | 有 1 条计算类缺 `invariants`，我按可加性/增量补上，同意吗？ | 「同意」 |
| 5 | S5 认领 | verify 是机器推的，逐条确认还是接受？ | 「确认」（给出 4 个真实取值） |
| 6 | S6 出包 | 任务包放哪？ | 「默认」 |

### skill 内部实际跑的命令与真实输出（证据）

**S2b · bridge 首次**（机器推断，全部兜底 `unit`）：

```
$ node <SG_HOME>/src/cli.js bridge spec.md contract.yaml
✓ 已生成契约：…\contract.yaml（4 条验收）
```
```yaml
  - id: order-submission-1
    then: 系统生成一笔待支付订单；订单号在全部订单中唯一
    verify: unit
    verify_source: inferred
  - id: stock-guard-1
    then: 下单被拒绝；购物车内容保持不变
    verify: unit
    verify_source: inferred
  - id: checkout-summary-1
    then: 结算页列出 2 件商品；合计金额等于 10 加 20
    verify: unit
    verify_source: inferred
  - id: payment-transition-1
    then: 订单由待支付转为已支付
    verify: unit
    verify_source: inferred
```

**S4 · 只 bridge + 补了 `suspect`，还没补 `invariants`**（门禁拦下，退出 2）：

```
$ node <SG_HOME>/src/cli.js lint bridge-only.yaml
契约 spec · 4 条验收条件
  约束源     project（项目 constraints.yaml）
  机械检查   ✓ ②verify 合法   ✓ ③措辞可判定   ✓ ⑤manual 占比   ✓ ⑥invariants 有效   ✗ ⑦计算类有不变量

  ✗ 1 处需要修改
      checkout-summary-1.then  计算类条目缺 invariants → 见 review.md

  ⚠ verify 分布（提醒，不影响退出码）
      verify 推断占比 4/4 = 100%（order-submission-1 stock-guard-1 checkout-summary-1 payment-transition-1）
      → 逐条显式化（重跑 bridge 带 --keep-verify）后消除

不通过（退出码 2）
```

> **这就是 S4 的典型一轮**：⑦ 是**阻塞项**（我改），⑪ 是**提醒项**（不阻塞，留到 S5）。

**S5 · 用户认领 verify 后**——按 skill 的修正版流程，**不重跑 bridge**，直接改 `contract.yaml`：

```yaml
  - id: order-submission-1   →  verify: contract-test   verify_source: explicit
  - id: stock-guard-1        →  verify: state-matrix    verify_source: explicit
  - id: checkout-summary-1   →  verify: unit-visual     verify_source: explicit
    invariants:
      - 按商品拆分后，各商品金额之和等于合计金额
      - 再增加一件金额为 X 的商品后，合计金额严格增加 X
  - id: payment-transition-1 →  verify: trace           verify_source: explicit
```

**S4 复跑 · 门禁通过（退出 0）**：

```
$ node <SG_HOME>/src/cli.js lint contract.yaml
契约 checkout · 4 条验收条件
  约束源     project（项目 constraints.yaml）
  manual     0/4 = 0%（上限 20%）
  机械检查   ✓ ②verify 合法   ✓ ③措辞可判定   ✓ ⑤manual 占比   ✓ ⑥invariants 有效   ✓ ⑦计算类有不变量

通过（退出码 0）
```
`contract.review.md`：
```markdown
# specgate review · checkout
> 约束源：项目 constraints.yaml
全部通过，无可修改项、无待决策项。
```

> ✅ **`⑪ verify 分布` 整行消失** —— 因为 4 条全是 `explicit`，`inferred` 占比为 0。
> 这正是「认领 verify」这一步的可观测收益。

**S6 · plan 出隔离任务包**：

```
$ node <SG_HOME>/src/cli.js plan contract.yaml
✓ 已产出两个任务包（物理隔离）：
   impl-task/  → …\specgate-plan\impl-task  （含 contract.yaml + context.md）
   test-task/  → …\specgate-plan\test-task  （含 contract.yaml + verify-tools.md + prompt.md）
✓ 隔离自检通过：test-task 内不含任何实现方源码路径。
```
```
specgate-plan/
├── impl-task/   context.md  contract.yaml
└── test-task/   contract.yaml  prompt.md  verify-tools.md   ← 没有 context.md ✅
```

**最终状态**：4 条 accept 的 `verify_source` **全 `explicit`** + `lint` **退出 0** + `plan` **出包成功**。

---

## 路线「纯 SpecGate」（无 OpenSpec → draft 起步）

### 用户要做的判断

| # | 状态 | skill 问 | 用户答 |
|---|---|---|---|
| 1 | S0 选型 | 需求从哪来？ | 「贴给你」（原文写入 `requirement.md`） |
| 2 | S2a 起草 | 我按这套 `suspect` 标注填，同意吗？ | 「同意」 |
| 3 | S4 门禁 | 决策层有 1 条期望值要你拍板 | 「确认无误」 |

### 真实输出

**S2a · draft（不调模型）**：

```
$ node <SG_HOME>/src/cli.js draft requirement.md
✓ 已生成：
   …\contract.draft.yaml
   …\draft.prompt.md
verify 清单来源：project（9 种）
```

> 📌 实测 `draft` 产出**恰好两个文件**：`contract.draft.yaml` + `draft.prompt.md`。

**S4 · lint（用仓库自带已填好的契约）**：

```
$ node <SG_HOME>/src/cli.js lint contract.yaml
契约 login-page · 4 条验收条件
  约束源     project（项目 constraints.yaml）
  manual     0/4 = 0%（上限 20%）
  接口状态   已声明 2/6 种
  机械检查   ✓ ②verify 合法   ✓ ③措辞可判定   ✓ ⑤manual 占比   ✓ ⑥invariants 有效   ✓ ⑦计算类有不变量

  需要你决策 1 处
      [期望值待确认] A4  字段：loading 持续时长
          ⚠️ 这几个期望值是推测的，不是你说过的
          → 确认无误后从 assumed_output 里删掉这几个字段

  ⚠ 接口状态覆盖（提醒，不影响退出码）
      状态「partial」「forbidden」「loading」「race」未声明 …
  ⚠ verify 分布（提醒，不影响退出码）
      A2 措辞是 UI/交互，但 verify=unit 不是视觉手段 → 建议改成 geo / ax / unit-visual / trace 之一

通过（退出码 0）
```

> **这条同时展示了两层**：`【需要你决策】`（`assumed_output` 期望值待确认 → 抛给用户，S4）与
> `【提醒】`（状态覆盖 ⑩ + verify 分布 ⑪ → 不阻塞退出码，S5 处理）。与「结合」路线走**同一套十一项检查**。

**S6 · plan**：与路线「结合」输出一致，退出 0。

---

## 本次走查暴露的两个真实陷阱（已写入 SKILL.md 红线）

| 陷阱 | 实测证据 | 正确做法 |
|---|---|---|
| **重跑 `bridge` 会冲掉 `suspect` / `invariants`** | 在契约里手工加 `suspect: false` 后重跑 `bridge --keep-verify` → 重跑后 `grep suspect` **无结果**；CLI 只报「保留人工 verify 修正 N 条」 | `spec.md` 没变时**不要重跑 bridge**，直接编辑 `contract.yaml`；必须重跑时先另存这两类字段再回填 |
| **`verify_source: explicit` 只在「值 ≠ 机器推断」时成立** | 手工把 `verify_source` 写成 `explicit` 但 `verify` 值仍是 `contract-test`（= 机器推断值）→ 重跑后**被重置为 `inferred`** | 想彻底消除 `inferred`，用户必须给出**与推断不同**的 verify 取值 |

---

## 验收对照

| 验收标准 | 结果 |
|---|---|
| 单入口跑通「结合」路线，最终全 `explicit` + 退出 0 + 出包 | ✅ 见上「路线结合」 |
| 纯 SpecGate 路线同 | ✅ 见上「路线纯 SpecGate」 |
| 不重造 OpenSpec | ✅ skill 只做 `bridge/draft → lint → 认领 → plan`，澄清/探索交 `/opsx:explore`，不实现 `propose/apply/archive`，不替代 `/opsx:verify` |
| 每步有「在哪一步 / 为什么」 | ✅ SKILL.md 每个状态卡都有【我做什么】【你要判断】【为什么】+ §6 一句话话术 |
| 不违反红线 | ✅ 未改 `src/**`；未触发任何 GitHub 远端写操作；`suspect` 落盘；前门互斥；重跑 bridge 带 `--keep-verify` |
| 附 walkthrough 证据 | ✅ 本文件 |
