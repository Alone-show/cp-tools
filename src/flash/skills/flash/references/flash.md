# 线刷整机固件：`flash.sh`（RK / T3，安卓 / Debian / Buildroot）

> 这是 skill `flash` 的参考页；主线 SOP 见 `../SKILL.md`。
> 整机镜像（`.img`）覆盖烧写，**会清数据**；不接受 OTA 差分包。
> 一条命令：`assets/flash.sh flash <img|url> [--expect-version V] [--quiet]` —— 判平台 → 进下载模式 → 刷 → 等回线 → 验证（只比版本号）→ 报告。

---

## 1. 工具与版本

| 芯片 | 工具 | 版本 | 命令 | 成功判据（原文） |
|---|---|---|---|---|
| RK | `assets/tools/rk_upgrade_tool`（或 PATH） | v2.22 | `UF <img>` | 输出含 `Download Firmware Success`，且不含 `Download Firmware Fail` |
| T3（全志） | `assets/tools/openixcli`（或 PATH） | 0.2.4 | `flash <img> -V true -m full_erase -a reboot` | 输出含 `All partitions flashed successfully` |

- 实际调用：`rk_upgrade_tool UF <img>`；`openixcli flash <img> -V true -m full_erase -a reboot`（`flash.sh` 自动带 bus/port）。
- 两个二进制都随 skill 放在 `assets/tools/`；解析顺序：`FLASH_TOOLS_DIR` → `assets/tools/` → `PATH` → `/usr/bin`，环境变量 `RK_UPGRADE_TOOL` / `OPENIXCLI` 可覆盖。
- 来源/版本/sha256 记在 `assets/tools/VERSIONS.md`。
- 工具退出码不可靠：**以成功判据为准**，rc=0 但没有成功串也算失败（RK 工具尤其如此）。

### 1.1 其他可用子命令（排查用，不要写进主流程）

```bash
rk_upgrade_tool -h                 # 全部命令：LD/SFI/EXF/PL/RD/SSD…
rk_upgrade_tool LD                 # 列 rockusb 设备（无设备时打印 failed to call context_enter!）
rk_upgrade_tool SFI <img>          # 看固件头/分区表，不连设备
openixcli scan                     # 列 FEL/FES 设备（无设备：Error: Device not found）
openixcli inspect <img>            # 看 IMAGEWTY 头，不连设备
```

## 2. 设备模式与 USB

> **全志 `awusb` 驱动冲突**：宿主机装了 Allwinner 工具包会带 `awusb.ko`（`/lib/modules/*/extra/`，alias 正好匹配 `1f3a:efe8`），**设备一进 FEL 就被内核按 modalias 自动加载并抢走**，`openixcli` 报 `USB transfer failed`。一次性拉黑：`pkexec sh -c 'echo blacklist awusb > /etc/modprobe.d/blacklist-awusb.conf && rmmod awusb'`；恢复：删文件 + `modprobe awusb`。

| 平台 | 系统态（adb） | 下载模式 | 进入方式 |
|---|---|---|---|
| RK 安卓 | `2207:0006`（adbd） | rockusb/loader | `adb reboot loader` |
| RK Debian | 同上 | rockusb/loader | `adb reboot loader` |
| T3 安卓 | adb | FEL（`1f3a:efe8`） | `adb shell reboot efex` |
| T3 Linux | adb | FEL（`1f3a:efe8`） | `adb shell "devmem 0x01c20508 32 0x5AA5A55A && sync && reboot"` |

- udev：RK 需要 `2207` 权限（`99-rk-rockusb-all.rules`，`MODE=0666`）；T3 需要 `1f3a:efe8`（`99-allwinner-aw-efex.rules`）。缺规则 → 工具报打不开设备，不是镜像问题。
- 进下载模式后 adb 一定掉线，`restart adb` 也看不到；用工具侧 `LD`/`scan` 判在不在下载模式。
- 多台 adb：必须 `--serial`；多台 rockusb：`--rk-index N`（`SD N` 切换）；多台 FEL：先拔到只剩一台。

## 3. 平台与镜像判定

- 系统：`/etc/os-release` 含 Debian → RK Debian；含 Buildroot → T3 Linux；否则安卓，`ro.board.platform` 以 `rk` 开头或 `pm path com.cpdevice.cpservice` 有值 → RK 安卓，否则 T3 安卓。
- 刷后**重新判平台**：镜像可能换系统（安卓 ↔ Debian），刷前平台不能复用。
- **镜像字母**（文件名第 3 段）：`A`=安卓、`D`=Debian、`R`=BuildRoot、`L`=Linux；只是系统标记，**同芯片内可跨系统刷**；`flash.sh` 默认放行并打一行提示。
- **芯片必须一致**：按镜像头判（RK `RKFW`/`RKAF`、T3 `IMAGEWTY`），不符直接拒；`--force-platform-mismatch` 不跳过这条。

## 4. `flash.sh` 用法

```bash
assets/flash.sh doctor                          # 环境自检：adb/工具/udev/空间/设备/下载模式
assets/flash.sh plan   <img|url>                # 只读预检：平台、刷前版本、期望版本、将执行的命令
assets/flash.sh flash  <img|url> --quiet        # 刷 + 验证（--quiet 只留里程碑）
assets/flash.sh flash  <img|url> --dry-run      # 只预检（含下载），不进下载模式、不刷写
assets/flash.sh verify --expect-version V1.16   # 只验证（设备已起系统）
```

| 参数 | 说明 |
|---|---|
| `--serial S` | 多台 adb 时指定；单台自动选 |
| `--platform rk\|t3` | 判不出平台时强制 |
| `--expect-version V` | 期望版本；缺省从镜像文件名推导（整串优先，退回 `V1.16` / `DEV-XXXXXXXX` 片段） |
| `--exact` | 版本必须完全相等 |
| `--quiet` / `-q` | 只输出里程碑（下载/进下载模式/刷写结论/验证），进度条不刷屏；日志仍全量 |
| `--dry-run` | 解析（含下载）镜像 + 判平台 + 比芯片/版本，打印将执行的命令后退出 |
| `--no-version-check` / `--no-reboot-check` | 跳过版本 / boot_id 检查（boot_id 默认只是旁证） |
| `--expect 'prop:k=v'` | 设备 `getprop k` 必须等于 `v` |
| `--check 'cmd'` | 设备端命令 rc=0 才通过（远端跑 `{ cmd; } && echo __PASS__`，绕开这套 adb 不回传 rc 的问题） |
| `--pkg P` / `--unit U` / `--proc N` | 安卓 `pm path`；Debian `systemctl is-active`；T3 Linux `pidof` |
| `--sha256 H` | 镜像校验；不一致直接退出 3，不刷 |
| `--timeout-flash S` / `--timeout-boot S` | 默认 2700 / 600 秒 |
| `--rk-index N` | 多台 rockusb 时 `rk_upgrade_tool SD N` |

- URL 下载：**先查下载目录再下**——`precheck_local` 按 URL basename 查 `~/Downloads/` 顶层，size 与远端 `Content-Length` 一致就复用（打印 `复用本地镜像：<path>`），只返回路径、**不复制不另存**；没命中才下载到 `~/Downloads/`（不建子目录），断点续传，过程只打两行（`下载中` / `下载完成 … B`）。
- 进度可观测：`wait_download_mode` / `wait_adb` 每 10–20s 打一行 `…等 loader Ns（USB: 2207:350a）`、`…等 adb 回线 Ns`；里程碑同时写进 `$LOG`，`tail -f` 即可跟进度。
- `download_firmware` 的 stdout 只输出最终路径（过程消息走 stderr）——20261109 修：曾因 `say` 写 stdout 被 `$(...)` 捕获，`set -Eeuo pipefail` 下 sha256sum 报错后**静默 exit 1**，表现为「下载完就退」。

退出码：`0` 通过 / `2` 用法 / `3` 前置（无设备、无工具、镜像不符、进不了下载模式）/ `4` 刷写失败 / `5` 验证不通过 / `6` 超时。

产物：日志 `~/Downloads/<镜像名>_flash_<时间>.log`（唯一默认产物）；md 报告默认不生成，只在你显式传 `--report <路径>` 时才写。

## 5. 验收口径（只比版本号）

| 平台 | 版本来源 | 通过判据 |
|---|---|---|
| RK Debian | `/etc/system_info/system_info.ini` 的 `Version=` | 与 `--expect-version` / 镜像文件名前缀一致 |
| RK 安卓 / T3 安卓 | `ro.build.cp.version`（退回 `ro.build.display.id`） | 同上 |
| T3 Linux | `/Configs/system_info/system_info.ini` 的 `Version=` | 同上 |

- **不截图、不验 UI / 开机 LOGO / 桌面，也不跑客户业务功能**；需要额外断言时显式加 `--check`/`--pkg`/`--unit`/`--proc`。
- `boot_id`（真重启）、`systemd is-system-running` / `mResumedActivity` / `pidof Launcher` 一律记 `INFO`：只作旁证，不阻塞。
- 版本不一致 = 不通过（exit 5）；先核对 sha256 与文件名，别急着重刷。

## 6. 失败模式对照

| 现象 | 原因 | 处理 |
|---|---|---|
| `failed to call context_enter!` | 沙箱看不到 `/dev/bus/usb`（不是驱动问题） | 用 full-access 重跑；preflight 会在进 loader **之前**就拦下，设备不会被动 |
| `No found any rockusb device` | 设备不在 loader/maskrom | 回系统 `adb reboot loader`；再跑一次 |
| `invalid tag of firmware` / `wrong hash of firmware` | 镜像不是 RKFW（拿成/截断/别的芯片） | `rk_upgrade_tool SFI <img>` 看头部；换正确镜像 |
| `Image is larger than partition size` | 镜像与 parameter 不匹配（型号/分区表不同） | 停，换对应型号/客户镜像 |
| `openixcli: Error: Device not found` | 不在 FEL（efex 没成功） | 确认 `reboot efex` / devmem，必要时重上电 |
| `USB transfer failed`，FEL 设备反复 disconnect | 宿主机 `awusb` 抢设备 | 见 §2 一次性拉黑 |
| 解析失败 / `invalid tag` | 用了 `_OTA.zip` | 用 OSS 的 `.img` |
| 刷完 adb 不回来（安卓） | 安卓默认 OTG Host，不是刷坏 | 设备上切 DEVICE 再等回线（SKILL §4） |
| 刷完 adb 回线但序列号变了 / 等旧序列号到 600s 超时 | 重装系统后 RK adb 序列号重新生成（实测 `hhhhhhhhh123` → `b0a9ef123cd5859f`） | 不要用刷前序列号等；`adb devices` 取新序列号再 verify。`flash.sh` 已自动接管新序列号 |
| 下载失败 / exit 35 且日志 0 字节 | 本机全局代理（`https_proxy=127.0.0.1:7897`）破坏 alist TLS | `flash.sh` 的 `curl_fw` 对 alist 已强制 `--noproxy '*'`；手工 curl 也加 `--noproxy '*'` |
| 版本断言失败 | 镜像与设备不匹配 / 缓存里是旧镜像 | 核对 sha256 与文件名；删掉 `~/Downloads/` 里的旧同名镜像重下 |

## 6.1 沙箱与路径

- 线刷工具要直接开 USB 设备节点：dsh 的 workspace-write 沙箱会隐藏 `/dev/bus/usb`，工具报 `failed to call context_enter!`（不是驱动/权限问题）——用 full-access 运行。
- 线刷**恒需 full-access**，因此 `~/Downloads` 本来就可写：日志/镜像一律留在 `~/Downloads` 顶层，**不要**把 `--cache-dir/--log` 迁到工作区，也不要新建 `flashwork/` 之类临时目录。
- 进下载模式**之前**有 preflight（`preflight_usb`）：沙箱够不着 USB 时 `rk_upgrade_tool LD` 只回 `failed to call context_enter!`，此时直接 `exit 3` 并提示用 full-access——**设备不会被重启**，可原样重跑（20261109 之前是先把设备踢进 loader、再等 90s 才发现刷不了）。

## 7. 纪律

1. 刷前核对：**设备序列号、机型/客户、芯片**（跨系统不用确认，芯片必须一致）；错一个就停（数据会没）。核对是自己做，**不向用户要确认**。
2. 默认只刷**量产版**（不带 `DEV-` 标识）；只有用户点名 DEV 才用 `dev:true` 的固件结果。
3. 一次只刷一台；进下载模式后不碰 USB，不切 OTG。
4. 失败即停：保留日志和工具输出，不自动重试；重试要重新进 loader。
5. 刷完只比版本号即算完成；`boot_id`/systemd 记为旁证，不额外验证 UI。
6. 报告落 `~/Downloads/`，别塞进升级包目录。
7. 镜像**只留一份**：先用下载目录里已有的（先查再下），别另存副本；日志/报告同样只落 `~/Downloads`。
