# 线刷整机固件：`flash.sh`（RK / T3，安卓 / Debian / Buildroot）

> **这不是 U 盘升级包**（§3–§8 那条线）：这里是整机镜像（`.img`）覆盖烧写，**会清数据**。
> 一条命令：`assets/flash.sh flash <img|url> [--expect-version V]` —— 判平台 → 进下载模式 → 刷 → 等回线 → 验证 → 报告。
> 先读 `../SKILL.md` §11（主线）和 §7.3（OTG）。

---

## 1. 工具与版本

| 芯片 | 工具 | 版本 | 命令 | 成功判据（原文） |
|---|---|---|---|---|
| RK | `assets/tools/rk_upgrade_tool`（或 PATH） | v2.22 | `UF <img>` | 输出含 `Download Firmware Success`，且不含 `Download Firmware Fail` |
| T3（全志） | `assets/tools/openixcli`（或 PATH） | 0.2.4 | `flash <img> -V true -m full_erase -a reboot` | 输出含 `All partitions flashed successfully` |

- 实际调用：`rk_upgrade_tool UF <img>`；`openixcli flash <img> -V true -m full_erase -a reboot`（`flash.sh` 自动带 bus/port）。
- 两个二进制都随插件放在 `assets/tools/`；`flash.sh` 解析顺序：`FLASH_TOOLS_DIR` → `assets/tools/` → `PATH` → `/usr/bin`，环境变量 `RK_UPGRADE_TOOL` / `OPENIXCLI` 可覆盖。
- `openixcli` 由 `~/Downloads/OpenixCLI.zip` 源码构建（`cargo build --release`，依赖 libusb）；来源/版本/sha256 记在 `assets/tools/VERSIONS.md`。
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

> **全志 `awusb` 驱动冲突**：宿主机装了 Allwinner 工具包会带 `awusb.ko`（`/lib/modules/*/extra/`，alias 正好匹配 `1f3a:efe8`），**设备一进 FEL 就被内核按 modalias 自动加载并抢走**，`openixcli` 报 `USB transfer failed`。一次性拉黑：`pkexec sh -c 'echo blacklist awusb > /etc/modprobe.d/blacklist-awusb.conf && rmmod awusb'`；恢复：删文件 + `modprobe awusb`。只 `rmmod` 不拉黑，下次进 FEL 还会自动加载。

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
- **镜像字母**（文件名第 3 段）：`A`=安卓、`D`=Debian、`R`=BuildRoot、`L`=Linux；只是系统标记，**同芯片内可跨系统刷**（例：`CP_SP2-10MIX_A_V1.17_…img` 刷 Debian 设备）——`flash.sh` 默认放行并打一行提示，不要求确认。
- **芯片必须一致**：按镜像头判（RK `RKFW`/`RKAF`、T3 `IMAGEWTY`），与设备芯片不符直接拒；`--force-platform-mismatch` 不跳过这条。

## 4. `flash.sh` 用法

```bash
assets/flash.sh doctor                          # 环境自检：adb/工具/udev/空间/设备/下载模式
assets/flash.sh plan   <img|url>                # 只读预检：平台、刷前版本、期望版本、将执行的命令
assets/flash.sh flash  <img|url>                # 刷 + 验证（默认直接执行）
assets/flash.sh flash  <oss .img 直链> --expect-version V1.15
assets/flash.sh verify --expect-version V1.15   # 只验证
```

| 参数 | 说明 |
|---|---|
| `--serial S` | 多台 adb 时指定；单台自动选 |
| `--platform rk\|t3` | 判不出平台时强制 |
| `--expect-version V` | 期望版本；缺省从镜像文件名推导（整串优先，退回 `V1.15` / `DEV-XXXXXXXX` 片段） |
| `--exact` | 版本必须完全相等 |
| `--no-version-check` / `--no-reboot-check` | 跳过版本 / boot_id 断言 |
| `--expect 'prop:k=v'` | 设备 `getprop k` 必须等于 `v` |
| `--check 'cmd'` | 设备端命令 rc=0 才通过（远端跑 `{ cmd; } && echo __PASS__`，绕开这套 adb 不回传 rc 的问题） |
| `--pkg P` / `--unit U` / `--proc N` | 安卓 `pm path`；Debian `systemctl is-active`；T3 Linux `pidof` |
| `--sha256 H` | 镜像校验；不一致直接退出 3，不刷 |
| `--timeout-flash S` / `--timeout-boot S` | 默认 2700 / 600 秒 |
| `--rk-index N` | 多台 rockusb 时 `rk_upgrade_tool SD N` |
| `--force-platform-mismatch` | 兼容旧用法：只跳过跨系统提示（芯片一致本来就直接刷；芯片不一致仍拒） |

退出码：`0` 通过 / `2` 用法 / `3` 前置（无设备、无工具、镜像不符、进不了下载模式）/ `4` 刷写失败 / `5` 验证不通过 / `6` 超时。

产物：日志 `~/Downloads/<镜像名>_flash_<时间>.log`；报告 `~/Downloads/<镜像名>_flash_report_<时间>.md`（断言表 + 刷前/刷后版本 + boot_id + 未验证项）。

## 5. 验证口径

- **版本**：安卓读 `ro.build.cp.version`（退回 `ro.build.display.id`）；RK Debian 读 `/etc/system_info/system_info.ini` 的 `Version=`（退回 `uname -r`）；T3 Linux 读 `/Configs/system_info/system_info.ini`。CP 文件名前缀与设备 `Version=` 一致（例：`CP_SP2-10PRO_D_V1.15_LCD10_B0_EU_20260724`）。
- **真重启**：刷前/刷后 `cat /proc/sys/kernel/random/boot_id` 必须不同；相同说明没重启到新系统（或刷写没生效）。
- **可用性证据**（默认 WARN，不判死）：安卓 `mResumedActivity`；Debian `systemctl is-system-running`（degraded 时列出 failed 单元名，抓业务服务）；T3 Linux `pidof Launcher`（服务模式包可能没有）。
- 客户功能（摄像头/CAN/网络/应用）不在默认断言里：要验就加 `--check`/`--pkg`/`--unit`/`--proc`。
- 开机 LOGO、桌面实际显示只能目视；报告里单列「未验证」。

## 6. 失败模式对照

| 现象 | 原因 | 处理 |
|---|---|---|
| `failed to call context_enter!` / `No found any rockusb device` | 设备不在 loader/maskrom | 回系统 `adb reboot loader`；或按住 recovery 上电进 maskrom |
| `invalid tag of firmware` / `wrong hash of firmware` | 镜像不是 RKFW（拿成/截断/别的芯片） | `rk_upgrade_tool SFI <img>` 看头部；换正确镜像 |
| `Image is larger than partition size` | 镜像与 parameter 不匹配（型号/分区表不同） | 停，换对应型号/客户镜像 |
| `openixcli: Error: Device not found` | 不在 FEL（efex 没成功） | 确认 `reboot efex`（T3 安卓）或 devmem（T3 Linux），必要时重上电 |
| `openixcli: Failed to open device: USB transfer failed`，内核日志里 FEL 设备反复 `USB disconnect` | 宿主机加载了全志 `awusb` 驱动（alias `usb:v1F3ApEFE8d*`，**FEL 设备出现时按 modalias 自动加载**），抢走 1f3a:efe8 | 一次性：`pkexec sh -c 'echo blacklist awusb > /etc/modprobe.d/blacklist-awusb.conf && rmmod awusb'`；恢复全志工具：删该文件 + `modprobe awusb`（脚本 `doctor`/`flash` 会先拦） |
| `openixcli: ... firmware ...` 解析失败 | 不是 IMAGEWTY 整机镜像（例如 OTA zip） | 用 OSS 的 `.img`，别用 `_OTA.zip` |
| `udev` 无权限：`LIBUSB_ERROR_ACCESS` | 缺 2207 / 1f3a 规则 | 装 `references/flash.md` §2 的 udev 规则或 `sudo` 跑一次 |
| 刷完 adb 不回来（安卓，RK/T3） | 见 SKILL §7.3（安卓默认 Host，不是刷坏） | 先在设备上切到 DEVICE 等回线；超过 `BOOT_TIMEOUT` 再看工具输出，必要时重新进 loader |
| 版本断言失败 | 镜像与设备不匹配 / 缓存里是旧镜像 | 核对 sha256 与文件名；清 `~/Downloads/fw-cache/` 重下 |

## 6.1 沙箱与路径

- 线刷工具要直接开 USB 设备节点：dsh 的 workspace-write 沙箱会隐藏 `/dev/bus/usb`，工具报 `failed to call context_enter!`（不是驱动/权限问题）——用 full-access 运行。
- 日志/报告默认落 `~/Downloads`；沙箱只读时用 `--log` / `--report`（或 `DL_DIR=`）指到工作区。

## 7. 纪律

1. 刷前核对：**设备序列号、机型/客户、芯片**（跨系统不用确认，芯片必须一致）；错一个就停（数据会没）。
2. 一次只刷一台；进下载模式后不碰 USB，不切 OTG。
3. 失败即停：保留日志和工具输出，不自动重试；重试要重新进 loader。
4. 刷完先看 `boot_id` 与版本，再看业务；`adb` 掉线不等于失败，超时提示见 §7.3。
5. 报告落 `~/Downloads/`，别塞进升级包目录。
