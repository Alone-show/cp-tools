---
name: tickets
description: 查 TB 工单与历史 bug：按现象找任务号（含无子任务的 ITR/缺陷单）、看子任务已解决/待解决、判断 bug 是否修进客户正式版并比对其它机型。工单, 任务号, 缺陷, 子任务, 已解决, 待解决, 暂挂起, 已拒绝, 历史bug, 修复, 回归, 正式版, DO, ITR, Teambition, 同步, 登录。
---

# 工单与历史 bug 查验

可用 `/tickets` 显式触发，也可直接用自然语言问。两条能力线，数据都在 Teambition「【研发部】CI/CD 发版流程」看板与 alist `/PROD` 的 commit 日志里：

1. **工单现象**：`ticket_search` —— 按现象找工单/任务号、看谁跟的、解决没有、属于哪个版本。
2. **历史 bug**：`ticket_bug_check` / `ticket_bug_models` / `ticket_bug_log` / `ticket_bug_matrix` —— 判断 bug 是否已修复、是否进入客户正式版、其它机型/系统/芯片有没有同步。

**只负责工单与 bug**：固件版本、线刷/OTA 直链走 `firmware` skill（`firmware_find` / `firmware_models`）。

## 工具

| 工具 | 用途 |
|---|---|
| `ticket_search` | 按现象/关键词搜 TB：任务号 `#uniqueId`、标题、阶段、状态、日期、执行人、链接、所属版本；`scope=tasks` 覆盖全部任务，`scope=issues` 看版本子任务状态 |
| `ticket_sync` | 拉 TB 看板 + 子任务，重建本地索引（60–90 秒；`issues:false` 只拉任务） |
| `ticket_login` | 刷新 TB 登录凭据（与 firmware 共用同一份 token） |
| `ticket_bug_check` | bug 现象 → 疑似修复提交、是否进客户正式版、跨机型/系统/芯片覆盖；附 TB 子任务证据 |
| `ticket_bug_models` | alist 产品线的机型探测（`SPRING2PRO → SP2-10PRO`） |
| `ticket_bug_log` | 原样列出某范围的 PROD 提交标题 |
| `ticket_bug_matrix` | 给定 hash / DO 号 / 标题，输出产品线覆盖矩阵 |
| `ticket_bug_sync` | 同步 alist `/PROD` 的 commit 索引（只读） |

## 查「哪个工单 / 任务号是多少」

直接用 `ticket_search`，**不需要 sync、不要读 `.tbfw`**：

- `scope` 默认 `auto`：给了 `model` 走版本子任务口径，只给现象词走全部工单口径。
- 现象词取 2–4 个实词（如「两个卡 上不去网」）。命中 0 条时，用同义词再试一次（出现两张 / 无法上网 / 双卡），仍为空再 `source: "index"`。
- 结果里 `#6685` 这种就是 TB 任务号（`uniqueId`）；标题只有 `ITR:` 前缀、没有数字时如实说明，不要编造 ITR 编号。
- 子任务状态口径：已解决 / 待解决 / 暂挂起 / 已拒绝；「完成待验证」仍算待解决。
- 默认不限客户（工单可能没有客户字段）；`issues` 口径仍默认 CP，`otherCustomers` 要转述。

## 查「这个问题解决没有 / 修进正式版没有」

1. 先 `ticket_search`（TB 业务状态），需要代码层结论时同轮 `ticket_bug_check`（代码证据），回答里分开写。
2. `ticket_bug_check` 结论是「疑似」，需研发复核代码；日志只有标题没有 diff。
3. 其它机型/系统是否同步：`ticket_bug_matrix`；要看原文标题用 `ticket_bug_log`。
4. TB 状态不等于代码已修复：代码已发版但 TB 未关闭、TB 已解决但日志未命中，都要按工具返回的 `notes` 提示。

## 参数与默认值

- 机型：`spring2pro`、`SP2-10PRO`、`apollo 12 pro`；`ticket_bug_*` 的机型写法由 `ticket_bug_models` 归一。
- 系统：Android / Debian / BuildRoot；`linux` = Debian + BuildRoot。
- 客户：`ticket_bug_*` 默认 CP；`ticket_search` 的 tasks 口径不限客户。
- `source`: `auto`（默认）/`live`（强制实时）/`index`（全量索引，需先 `ticket_sync`）。
- `ticket_bug_sync` 首次使用先跑；只看某型号可用 `only` 收窄。

## 数据与边界

- 与 `firmware` 共用 `.tbfw`（`token.json`、`board-<projectId>.json`、`subtasks-<projectId>.json`）与 `.fixfinder`；本 skill 是唯一写方。
- 不要用 bash 直接读 `.tbfw` / `.fixfinder` / `token.json`，也不要手工拼 alist 路径；一律走工具。
- TB 登录态失效时先 `ticket_login`；`ticket_sync` 返回 `needs_auth` 就说明原因并引导登录。
- 全量历史 / 完整状态才需要 `ticket_sync` 后用 `source: "index"`；日常查询不必 sync。
