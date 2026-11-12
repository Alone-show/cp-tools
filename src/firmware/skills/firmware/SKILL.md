---
name: firmware
description: 查量产固件、线刷与 OTA 直链、机型写法与系统。只做固件查找；工单任务号、子任务状态、历史 bug 是否修复请用 tickets skill。固件, firmware, 线刷, OTA, 量产版本, 量产固件, DEV, 发版, alist, minio, 机型, 系统, 客户。
---

# 固件查找

本 skill 只负责「找固件」：可用 `/firmware` 显式触发，也可直接用自然语言问。按机型 / 系统 / 客户定位量产固件，给线刷与 OTA 直链，并处理机型写法归一等歧义。

**不负责**：TB 工单/任务号/子任务状态、历史 bug 是否修进正式版、TB 登录与看板同步。这些统一走 `tickets` skill（`ticket_search` / `ticket_bug_check` / `ticket_sync`）。

## 工具

| 工具 | 用途 |
|---|---|
| `firmware_find` | 机型 + 系统 + 客户 → 固件版本、构建日期、客户、线刷/OTA 直链 |
| `firmware_models` | TB 看板里的机型族、同族别名、变体；机型写法拿不准时先查这里 |

## 参数与默认值

- 机型：自由写法均可（`spring2pro`、`SP2-10PRO`、`apollo 12 pro`、`瑞芯微 / APOLLO 12 PRO`、`T3 / SPRING2`）。
- 系统：安卓 / Android、Debian、BuildRoot；`linux` = Debian + BuildRoot。
- 客户：缺省 **CP**；`*` 或「所有客户」不限。同一机型的不同客户固件不能混刷。
- 其它：`version`、`mainline`、`stage`、`limit`（默认 5，最大 20）、`verify`、`all`、`source(auto|tb|alist)`。
- **DEV 构建默认不返回**：只给量产版（不带 `DEV-`/`DEV_`）。用户明确说要 DEV 时才传 `dev: true`，被过滤条数写在 `note` 里。
- 用户说「最新的」→ `limit: 1`。

## 流程

1. 查询直接调 `firmware_find`；每次调用都会实时核对 TB（补拉版本父任务详情）并实时扫描 alist `/PROD`，约 3–8 秒，不需要先同步。`liveChecked=false` 表示实时核对失败（如未登录），此时按 note 里的快照时间说明，不要当最新结果。
2. 机型歧义（`status=needs_confirmation`）时列候选（含 variants），请用户确认后再查，不要猜。
3. 结果里同一版本在 TB 与 alist 都有时，两条线刷直链都要给：`OSS 线刷地址`（minio/next）与 `alist 线刷地址`（alist 优先下载）；`stage=生产库归档` 才是量产归档。
4. 输出：机型、系统、版本、构建日期、客户、线刷/OTA 链接，并标注来源（`[实时]` TB / `[alist]` / `[tb+alist]`）；转述 `note`、`otherCustomers`、`pending`。
5. `firmware_models` 传 `alist: true` 可附 alist 产品目录概览；TB 看板索引由 tickets 维护，若提示找不到索引，让用户先 `/tickets sync`（只影响机型族与阶段，alist 结果仍可用）。

## 数据与边界

- 只看固件：不根据 TB 子任务或 commit log 判断「问题是否解决」；这类问题转 `tickets`。
- 共享缓存：与 `tickets` 共用 `.tbfw`（`board-<projectId>.json`、`token.json`）与 alist 缓存；本 skill 只读，不写索引。
- 不要用 bash 直接读 `.tbfw` 或手工拼 alist 路径；一律走工具。
- alist 不可达时 `firmware_find` 会降级到 TB/本地快照，按返回的 `note` 说明。
