---
name: firmware
description: 查 CP 量产固件：先拉机型目录（规范名/别名/变体 + 系统/客户/尺寸/最新版本），模型选定机型后再按 系统 + 客户返回版本、构建日期、线刷/OTA 直链（alist 优先、minio 备用）。客户名（含中文公司名，如“纬尔”=VR）归本 skill 解析：以机型目录的 customers 为准，认不出就问用户，不要用知识库或工单反推。只做固件查找；工单/子任务/历史 bug 走 tickets。整机线刷会清数据，由用户用 /flash 显式触发，不在本 skill。默认只给量产版（DEV 需点名）。
---

# 固件查找

本 skill 只负责「找固件」：可用 `/firmware` 显式触发，也可直接用自然语言问。**机型不由工具猜**：先拿机型目录，由模型按证据（系统/客户/尺寸/最新版本）选定规范名，再查该机型的量产固件与线刷、OTA 直链。

**不负责**：TB 工单/任务号/子任务状态、历史 bug 是否修进正式版、TB 登录与看板同步。这些统一走 `tickets` skill（`ticket_search` / `ticket_bug_check` / `ticket_sync`）。

**整机线刷/清数据也不在本 skill**：由用户输入 `/flash` 显式触发；本 skill 只给直链，不执行刷写。

## 工具

| 工具 | 用途 |
|---|---|
| `firmware_models` | 机型目录：规范名、同族别名、变体，每个尺寸的系统/客户/任务数/最新归档版本 |
| `firmware_find` | 精确机型（+ `lcd`）+ 系统 + 客户 → 固件版本、构建日期、客户、线刷/OTA 直链 |
| `firmware_mcu` | MCU 版本（OS 镜像之外的独立一条线）→ 版本、构建日期、TB 阶段/完成日期/任务页、下载地址 |

## 参数与默认值

- 机型：**只认机型目录里的规范名 / 别名 / 变体名**（整串相等，符号与大小写无关），如 `RK / APOLLO2`、`APOLLO2-MIX`、`SP2-10MIX`。空格/符号差异与去尾 `A` 视为同一机型（`APOLLO2-7` ≡ `APOLLO2-7A`、`apollo 12 pro` ≡ `APOLLO2-12PRO`）；省略尺寸段（`spring2pro`）或认不出的名字不猜，`firmware_find` 返回目录（`status=needs_confirmation` + `candidates`），由模型选定后带精确名字重试。
- 尺寸（`lcd`）：机型跨多个屏幕尺寸时必须给（`APOLLO2` 同时有 `LCD7` / `LCD12`，`APOLLO2-7A` 是 `LCD7`）。接受 `LCD7`、`7`、`LCD7-12`；`LCD7` 能命中 `LCD7-12`，反之不行。
- **共享固件（只开这两组）**：`APOLLO2-7A` ≡ `APOLLO2-7` ≡ `RK / APOLLO2` 的 7 寸固件；`APOLLO2-12A` ≡ `APOLLO2-12` ≡ `RK / APOLLO2` 的 12 寸固件。查其中任一个都会同时给出另一边的版本（结果带 `firmwareSharing`、行首标 `[共享]`、note 写明关系），可以互刷；**客户仍然不能混刷**。10 寸、12PRO、12PLUS 不参与共享。
- 系统：安卓 / Android、Debian、BuildRoot；`linux` = Debian + BuildRoot。
- 客户：缺省 **CP**；`*` 或「所有客户」不限。同一机型的不同客户固件不能混刷。**未点名客户就按 CP 出结果，不要弹确认**（设备/记录上出现别家客户也一样，只在 `otherCustomers` 里提一句）。
- 其它：`version`、`mainline`、`stage`、`limit`（默认 5，最大 20）、`verify`、`all`、`source(auto|tb|alist)`。
- **DEV 构建默认不返回**：只给量产版（不带 `DEV-`/`DEV_`）。用户明确说要 DEV 时才传 `dev: true`，被过滤条数写在 `note` 里。
- 用户说「最新的」→ `limit: 1`。

### MCU 版本（`firmware_mcu`，与 OS 镜像两条线）

- **别拿 `firmware_find` 查 MCU**：OS 镜像是 `CP_<机型>_<A|D|R>_V…_LCD…`，MCU 是 `<族>_MCU_APP_V1.0.7_260924_190041`，产物在 alist `/PROD/MCU/<机型>/<版本>/`，不走 `/PROD/<芯片>/<系统>/`。
- **MCU 目录名 ≠ 机型规范名**：`SPRING2-10PRO` 的 MCU 目录是 `SPRING2-PRO`，而 `SPRING2 10 / 10S / 特别版` 才是 `SPRING2`；`APOLLO2` / `APOLLO2-PRO` / `APOLLO2-PLUS` 三族并存，`SPRING-12` 也被单列。工具按「族 + PRO/PLUS 变体」匹配，匹配不唯一会返回 `dirCandidates`，选定后再查。
- **默认只给 APP 包**；`kind: BOOT|BURN` 查 BOOT/BURN 产物。默认按构建日期倒序，`limit` 默认 5。
- **阶段与任务页来自 TB**（`liveChecked=false` 时只有 alist 结果，note 会说明）；`stage: "生产库归档"` 可只看已归档版本。
- 订单/评审里填 MCU 版本时，直接取这里的**完整版本串**（带 `_YYMMDD_HHMMSS`），不要只写 `V1.0.7`。

## 链接怎么给

- **`next.cpinnov.run` 与 `alist.cpinnov.run` 是同一份存储的两个入口，内容同步**：next 有的版本 alist 一定有，反之亦然。两条路径可以直接互换。
- 结果里的 `固件下载地址` 是 **TB 任务归档记录里存的那条链接**（常常指向 next），**不是 alist 存在性的证据**。不要因为它是 next 就断言「alist 没收录」「只有 next 有」。
- 同一版本两边都有时两条线刷直链都要给：`OSS 线刷地址`（minio）+ `alist 线刷地址`（alist，优先下载），目录页给 `alist 下载页`。
- 只拿到 next/minio 链接时，补一句「alist 同步同一目录，可互换」，不要写成缺失。
- `note` 里出现「alist 已扫描但没匹配到该机型的版本目录」时，按 **匹配问题** 转述（机型目录写法不同），不要说成 alist 没有该版本。
- 不要用 bash/curl 探测 alist 判断有没有文件：内网 `10.16.18.x` 走本机代理会 TLS 断开（需 `--noproxy '*'`），而且 alist 目录是 SPA，任何路径都回 200 HTML。存在性以工具返回为准。

## 流程

1. **第一步：拿机型目录**。`firmware_models`（传用户说法做过滤，未命中会给相近候选），或直接 `firmware_find(model=<用户说法>)`——后者在不是规范名/别名/变体名时返回 `status=needs_confirmation` + `candidates`。目录条目自带 `systems`、`customers`、`lcds`、`latest`，**由模型按这些证据选**：系统对齐、客户对齐（缺省 CP）、尺寸对齐（7 寸看 `LCD7`，12 寸看 `LCD12`）。目录来自看板快照（`indexAgeHours` 给出快照年龄），不联网、秒回；刚归档的版本可能还没进快照，第二步会实时补上。
2. **第二步：带精确机型查询**。`firmware_find(model="RK / APOLLO2", lcd="LCD7", system="Debian")`。这时才实时核对 TB（补拉版本父任务详情）并扫描 alist `/PROD`，约 3–8 秒，不需要先同步。`liveChecked=false` 表示实时核对失败（如未登录），按 note 里的快照时间说明；`alist` 字段是本次扫描实况（`ok/rows/requests/reason`）。
3. 命中后按共享规则自动合并另一边的固件（`firmwareSharing` / `[共享]` 行）；汇报时说清「哪些行来自共享机型」，不要把共享行当成用户点名机型的原生版本。
4. 只有**证据不足**（同名跨芯片、客户/尺寸都对不上、目录里两条都像）时才回问用户，列候选让他定；不要自行猜测。
5. 链接按上面「链接怎么给」给（alist 优先 + minio/next 备用，两边都有就都列）；`stage=生产库归档` 才是量产归档。
6. 输出：机型、系统、尺寸、版本、构建日期、客户、线刷/OTA 链接，并标注来源（`[实时]` TB / `[alist]` / `[tb+alist]`）；转述 `note`、`otherCustomers`、`pending`。`status=empty` 时会带 `candidates`（该机型其它尺寸/客户），换 `customer` 或 `lcd` 重试，不必再拉一次目录。
7. `firmware_models` 传 `alist: true` 可附 alist 产品目录概览；TB 看板索引由 tickets 维护，若提示找不到索引，让用户先 `/tickets sync`（只影响机型族与阶段，alist 结果仍可用）。

## 数据与边界

- 只看固件：不根据 TB 子任务或 commit log 判断「问题是否解决」；这类问题转 `tickets`。
- 机型匹配是**语义判断**：看目录里的系统、客户、尺寸、最新版本做取舍；工具只保证「不猜」，猜错由模型负责。
- 共享固件的边界是**写死的两组**（7A↔7、12A↔12），不要自行扩展到 10 寸或 12PRO/12PLUS。
- 共享缓存：与 `tickets` 共用 `.tbfw`（`board-<projectId>.json`、`token.json`）与 alist 缓存；本 skill 只读，不写索引。
- 不要用 bash 直接读 `.tbfw` 或手工拼 alist 路径；一律走工具。
- alist 不可达时 `firmware_find` 会降级到 TB/本地快照，按返回的 `note` 说明。
