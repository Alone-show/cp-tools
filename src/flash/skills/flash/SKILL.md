---
name: flash
description: 整机线刷（全量覆盖）：把 CP 量产整机镜像 .img 刷进 RK（rk_upgrade_tool UF）或 T3（openixcli flash），用于换版本、救砖、跨系统重装；会清 userdata。流程：目标版本取订单「软件需求信息/OS版本」或 firmware_find 的 alist + minio 两条线刷直链 → flash.sh plan 预检 → flash.sh flash --quiet → 等回线（loader/FEL）→ 只比版本号，版本一致即通过；默认只刷量产版。订单链路里由模型触发，刷前一行说明。
---

# 整机线刷：从查版本到验收（一条主线，少走弯路）

> 与 `/cpservice`（U 盘升级包：装 deb/apk、换 logo / 换动画）**不是一回事**。这里是**整盘覆盖烧写**，会清 userdata。
> 参考页：`references/flash.md`（工具细节 / 设备模式 / 失败模式）；脚本：`assets/flash.sh`。
>
> **进入条件（gate，先看这条）**：只有下面两种情形才进来，其余一律不主动刷——
> 1. 用户给出订单（链接/编号）并要按订单处理：目标版本取订单 `软件需求信息/OS版本`（见 `/bpms`）；
> 2. 用户明确说「刷机 / 换版本 / 救砖」，或明确点名某个版本。
> 空口提「刷机」、只是聊到版本、或设备读不到当前版本（多台/离线）→ 都不进，先问清楚。
> 触发方式：订单链路里**由模型直接进入本 skill**，不需要用户再手输 `/flash`；但**刷前必须用一行说明「要刷的版本 + 会清 userdata」**（已获授权，不等确认）。

## 0. 何时用 / 不用

| 用它 | 别用（走 `/cpservice`） |
|---|---|
| 订单要求的版本与设备不一致（`/bpms` 把订单 `OS版本` 递过来） | 只装应用 / deb / 换开机 LOGO / 换动画 |
| 整机换版本（量产 ↔ DEV） | 改单个配置、加自启 |
| 救砖、系统起不来 | 打补丁、跑验证 |
| 跨系统重装（安卓 ↔ Debian ↔ Buildroot） | — |

**订单链路里先判「要不要刷」**（这一步是只读的，别跳）：

```bash
adb devices -l                                     # 只有一台才继续
adb -s <序列号> shell 'getprop ro.build.cp.version'                     # 安卓
adb -s <序列号> shell 'cat /etc/system_info/system_info.ini'            # RK Debian
adb -s <序列号> shell 'cat /Configs/system_info/system_info.ini'        # T3 Linux
# 与订单 OS版本 比对：一致 → 不刷，直接把结论交回 /bpms 继续出包；更低/跨系统 → 进 §1 刷
```

## 1. 刷前必须核对的 5 件事（缺一件就停，但不问用户）

1. **目标版本**：**优先取订单 `软件需求信息/OS版本`**（`/bpms` 递过来的那个串，去掉 `.img` 后缀），它是唯一权威版本——不要换成「最新量产」或别的版本。
   拿这个版本串去 `firmware_find`（`version=<串>`，`model`/`system`/`customer` 按订单归一）**只取线刷直链 `.img`**，不要 `_OTA.zip`；此时 `firmware_find` 只负责给链接，不参与选版本。
   订单里没有 `OS版本`、或该版本查不到直链（客户定制版）→ **停**，问清楚，不拿别的版本顶。
   同一版本会给两条链接：**`alist 线刷地址`（下载优先）** 和 **`OSS 线刷地址`（minio，备用）**；**汇报时两条都写出来**（alist 在前）。alist 上没有该版本时只给 minio，并说明一句。
   用户口头点名版本 / 明确说「最新」时，才用 `firmware_find` 直接取（`limit:1`）；**默认只取量产版（不带 `DEV-` 标识）**，只有用户明确说「要 DEV」时才传 `dev:true`。
2. **会清数据**：userdata 全没；DEV↔量产、跨系统都算降级/重装。**刷机前不等待确认**（已获授权），只在下发前用一行说明「要刷的版本 + 会清数据」；若目标版本是 DEV 而用户没点名 DEV，停下说明并换量产版。
3. **单台设备**：`adb devices` 只有一台，或命令显式带 `--serial`；序列号写进命令。
4. **机型/客户/屏参一致**：镜像文件名里的机型、`LCD10/B0` 片段与设备 `Version=` 同构（如 `CP_SP2-10PRO_D_..._LCD10_B0_EU_...`）；订单链路里同时与订单 `基本信息/品名`、`软件需求信息/系统` 对齐，对不上就停（刷错=黑屏/变砖）。
5. **先查下载目录**：`~/Downloads/` 顶层若有同名 `.img` 且 size 与 OSS `Content-Length` 一致，**直接用本地路径**——不重新下载，也不另存第二份。`flash.sh plan <url>` 会打印「复用本地镜像」，命中即止。

> 刷完只把「版本前 → 后 + 是否回线」交回 `/bpms`；**不要在这里出 U 盘包**（出包/合并/验证是 `/cpservice`，上传是 `/bpms`）。

## 2. 标准流程（S1–S6，命令可直接复制；全程不等确认）

```bash
# S1 取最新量产版本 + 两条线刷直链
#    工具：firmware_find(model="SPRING2PRO", system="Debian", limit=5)
#    记录：版本串、构建日期、alist 线刷地址（优先）与 OSS 线刷地址（minio 备）

# S2 预检（只读：报平台、当前版本、期望版本、候选顺序、将执行的命令）
assets/flash.sh plan <alist-url> <minio-url> --serial <序列号>

# S3 刷写（不等确认；必须 full-access；后台 job 跑，日志默认落 ~/Downloads）
#    两条 URL 都传：alist 在前、minio 兜底（脚本也会自动把 alist 提到最前）
assets/flash.sh flash <alist-url> <minio-url> --serial <序列号> --expect-version <V1.xx> --quiet

# S4 等回线（用 job_output(wait) 收结果，别 sleep 盲等；超时才提示切 DEVICE，见 §4）

# S5 验收（只比版本号，见 §3）
#    注意：重装系统后 adb 序列号会变，先 `adb devices` 取当前序列号再用
adb -s <当前序列号> shell 'cat /etc/system_info/system_info.ini'      # RK Debian
adb -s <当前序列号> shell 'getprop ro.build.cp.version'               # 安卓

# S6 记录
#    版本（前 → 后）、boot_id、耗时、日志/报告路径
```

- 已缓存镜像可直接传本地路径（`~/Downloads/<镜像名>.img`），省下载。

**机械跑法（固定流程，别每一步重新决策）**

- 线刷**永远要 full-access**（工具要开 `/dev/bus/usb`）：从一开始就用完整权限跑。`~/Downloads` 本来就可写，**不要**因为「沙箱只读」把 `--cache-dir/--log` 改到工作区，也不要新建 `flashwork/` 之类的目录。
- `flash.sh` 现在会**先查下载目录**再下载；并在进下载模式**之前**预检 USB 可访问性，沙箱够不着就立刻退出（设备不动），不会把机器踢进 loader 才发现刷不了。
- 等待只有两种方式：后台跑 + `job_output(wait)`；或 `job_output` 每 10–20s 看一次增量。**禁止 `sleep 45/90/150` 盲等**——每个 `sleep` 都是一整次请求，换不到新信息。
- 里程碑同时写进日志文件，`tail -f <log>` 能看到 `…等 loader 12s` / `…等 adb 回线 45s` 这类阶段行，不必反复 `adb devices`/`lsusb`。
- 同一版本只刷一次；版本对上就收尾，重复刷不会「更像成功」。
- `plan` 输出里看三行：`当前版本`、`期望版本（按文件名）`、`工具：…`。对不上就别往下走。
- 需要先验证「下载+解析」而不刷：`--dry-run`（不进下载模式）。

## 3. 验收口径：只比版本号

| 平台 | 版本来源 | 通过 |
|---|---|---|
| RK Debian | `/etc/system_info/system_info.ini` 的 `Version=` | 与期望版本一致 |
| RK 安卓 / T3 安卓 | `ro.build.cp.version` | 同上 |
| T3 Linux | `/Configs/system_info/system_info.ini` | 同上 |

- **版本号一致 = 通过**，收尾。`flash.sh` 会同时记录 `boot_id`（真重启）与 systemd/Launcher 状态，这些**只是旁证，不阻塞**。
- **不截图、不验 UI / 开机 LOGO / 桌面**，也不跑摄像头/CAN/网络之类的业务功能。有人要验这些，另开任务，不在本 skill 结论里。
- 版本不一致才算不通过：先核对 sha256 与文件名，再考虑重刷；不要为了「看起来像成功」反复刷。

## 4. 回线与 OTG（唯一权威）

- 进下载模式后 **adb 一定掉线**，`lsusb` 看 `2207`（RK）/ `1f3a`（T3）才说明在下载模式；这期间**不提示切换**。
- 刷完等回线；**超过 `--timeout-boot`（默认 600s）仍未回线**，才提示用户在设备上把 OTG 切到 DEVICE（安卓默认 Host，不是刷坏），然后 `timeout 120 adb wait-for-device`。
- `adb` 掉线 ≠ 刷写失败：判成败看工具输出（`Download Firmware Success` / `All partitions flashed successfully`）与回线后的版本号。
- **回线序列号会变**：重装系统后 RK 的 adb 序列号会重新生成（实测刷前 `hhhhhhhhh123` → 刷后 `b0a9ef123cd5859f`）。**禁止用刷前序列号死等回线**。`flash.sh` 已自动接管：旧序列号不在、且只剩一台 adb 设备（或多台中只有一台是刷前没见过的）时，直接切到新序列号并打印「adb 序列号变更：A → B」；手工 verify 前先 `adb devices` 取当前序列号。

## 5. 失败模式速查（详情见 `references/flash.md` §6）

| 现象 | 多半是 |
|---|---|
| `failed to call context_enter!` | 设备不在 loader；或沙箱没 USB 权限（用 full-access） |
| `invalid tag of firmware` | 拿成 OTA zip / 别的芯片镜像 |
| `openixcli: Device not found` | 没进 FEL（`reboot efex` 没成功） |
| `USB transfer failed` + disconnect | 宿主机 `awusb` 抢 FEL 设备（一次性拉黑） |
| 刷完 adb 不回线 | OTG 在 Host，切 DEVICE 再等 |
| 回线超时但日志里已 `Download Firmware Success` | 十有八九是**序列号变了**（新系统重新生成），`adb devices` 取新序列号再 verify，别重刷 |
| 下载失败 / 脚本 exit 35 且日志为空 | 本机全局代理破坏 alist TLS；用 `--noproxy '*'` 或让 `flash.sh` 走（已内置直连） |
| alist 直链 403 / 下回来是几百字节 JSON | 链接过期或 alist 密钥轮换；`flash.sh` 会自动回落 minio（日志里有「换下一个候选」），不必手工重试 |
| 两个源都失败 | 看日志里每条候选的错误；先确认网络/权限，再重新 `firmware_find` 取新链接，别复用旧 `sign` |
| 版本对不上 | 镜像/文件名不匹配，或缓存里是旧镜像 |

## 6. 省时省 token 跑法

1. **只读本 skill**：别为线刷加载 `/cpservice`（那是 U 盘包的完整流程）。
2. **先 plan 后 flash**：`plan` 是只读的，一次就能拿到平台/当前版本/期望版本；不要手工 `getprop`/`uname`/到处找 version 文件（RK Debian 就一个 `system_info.ini`）。
3. **`--quiet` + 后台 job**：进度条有上百行，别灌进对话。等待用后台 job + `job_output(wait)`；中途看进度用 `job_output` 每 10–20s 取增量（里程碑已写进日志，`tail -f <log>` 亦可）。**不要 `sleep` 盲等**，也不要用 `adb devices`/`lsusb`/`tail` 反复「看一眼」。
4. **不做事后补验**：版本对上就结束；不截图、不抓屏、不翻 failed unit（需要时 `systemctl --failed` 一条即可）。
5. 失败即停：保留日志，不自动重试。
6. **只留一份、不再套目录**：镜像和日志都直接落 `~/Downloads` 顶层，不建 `fw-cache/` 之类的子目录；日志也不往工作区留副本。

## 7. 产物

| 产物 | 位置 |
|---|---|
| 刷写日志 | `~/Downloads/<镜像名>_flash_<时间>.log` |
| 镜像缓存 | `~/Downloads/<镜像名>.img`（可复用，注意 sha256） |

**不生成报告**：验收结论只在终端打（版本前 → 后 + 日志路径）。确实要 md 报告时显式加 `--report <路径>`。

## 8. 本机两个必踩坑（脚本已内置，别手搓绕过）

1. **全局代理会打断下载**：本机 `https_proxy=http_proxy=127.0.0.1:7897`，经代理访问 `alist.cpinnov.run` 会 TLS 握手失败（`curl: (35) ... unexpected eof`），表现为「下载失败」或脚本 exit 35、日志 0 字节。
   `flash.sh` 的 `curl_fw` 已处理：alist 域名**强制 `--noproxy '*'` 直连**；其他域名先走代理，遇到 5/6/7/35/52/56/60 再直连重试一次。
   **约束**：手工 `curl` / 其他工具下载 alist 镜像时必须带 `--noproxy '*'`；不要为了绕开报错去 `unset` 一大堆环境变量当常规做法（脚本里已封装）。
2. **刷完回线的 adb 序列号会变**：重装系统后 RK 序列号重新生成（实测 `hhhhhhhhh123` → `b0a9ef123cd5859f`）。旧逻辑等旧序列号会一路等到 `--timeout-boot` 600s 超时，再被判「不通过」——这是误判。
   `flash.sh` 已处理：回线时若旧序列号不在且只剩一台 adb 设备（或多台里只有一台是刷前没见过的），自动接管新序列号并打印「adb 序列号变更：A → B」。
   **约束**：不要用刷前序列号做 verify；verify 前先 `adb devices`，或直接跑 `flash.sh verify --serial <当前序列号>`（不带 `--serial` 也会自动选唯一设备）。

## 附录：`flash.sh` 参数

| 参数 | 说明 |
|---|---|
| `--serial S` | 多台 adb 时指定 |
| `--expect-version V` | 期望版本；缺省从镜像文件名推导 |
| `--exact` | 版本必须完全相等 |
| `--quiet` / `-q` | 只留里程碑；日志仍全量 |
| `--dry-run` | 只预检（含下载），不进下载模式 |
| `--sha256 H` | 镜像校验，不一致退出 3 |
| `--cache-dir D` | 下载缓存目录 |
| `--log F` | 日志路径（默认 `~/Downloads`） |
| `--report F` | 可选：额外写 md 报告；默认不生成 |
| `--no-version-check` / `--no-reboot-check` | 跳过版本检查 / boot_id 记录 |
| `--check 'cmd'` / `--pkg P` / `--unit U` / `--proc N` | 额外断言（默认不做） |
| `--timeout-flash S` / `--timeout-boot S` | 默认 2700 / 600 秒 |
| `--rk-index N` | 多台 rockusb 时 `rk_upgrade_tool SD N` |
