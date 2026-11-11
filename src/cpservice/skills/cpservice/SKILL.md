---
name: cpservice
description: 按需求生成并验证 U 盘升级包：先判定 RK 安卓（CpService.xml / com.cpdevice.cpservice，21 个动作）、T3 安卓（E9631Service.xml / com.android.guard）、RK Debian（unattended_installation.sh / auto_unattended_installation + silentInstaller，udev 或工具窗口触发）还是 T3 Linux（Buildroot，盘根 unattended_installation.sh，/Launcher 设置→U盘查看→开关），再加载对应上下文出包并做真机验证。判定先看 OS；取证优先用 assets/debian-trigger.sh、assets/t3linux-trigger.sh、assets/verify.sh 一条命令，证据落 /var/log、/data 不落 /tmp。E9631Service, E9631Service.xml, CpService, CpService.xml, U盘升级, 升级包, 升级脚本, setup_cpservice.sh, setup_e9631service.sh, 刷机, adb, bootlogo, logo, 生成logo, bootanimation, install, copy, copyout, canuse_ver, runlimit, remount, 静默安装, 生成脚本, 验证, 验证报告, 证据, MDM, VanCoreT3, wifi 固件, cyw43438, RK, rk356x, rk3588, T3, cpservice, 真机验证, Debian, debian, RK Debian, T3 Linux, Buildroot, Launcher, U盘查看, unattended_installation, auto_unattended_installation, silentInstaller, udev, dpkg, /media/usb_disk, /mnt/installUsb, SPRING2-PRO, SPRING2_L, 服务模式, 启动时序, JobMonitor, CFT, VariableMonitor, can0, eglfs。
---

# E9631Service / CpService / RK Debian / T3 Linux 升级包：生成与验证

需求 → 判定（§1，1 次调用）→ 只读核查存量包（§6.2）→ 读 reference（§2）→ 出包（§3、§4）→ 自检（§6）→ 真机验证（§7）→ 报告（§7.6）。

> RK/T3 安卓的包是 xml 动作清单；RK Debian 是设备端脚本 + 两条触发链；T3 Linux 是盘根脚本 + Launcher 开关。判错平台，现场就是「插盘/点开关没反应」。

## 0. 主线

**0.1 一条命令优先**（别手打 adb、别为比对把整包解两遍）

| 平台 | 触发 | 取证 / 收尾 |
|---|---|---|
| RK Debian 手动 | `assets/debian-trigger.sh manual <包目录>` | `debian-trigger.sh evidence`；`verify.sh --debian /var/log/lw_install.log <pkg…>` |
| RK Debian 自动 | `assets/debian-trigger.sh udev <包目录>` | 同上 + `shot`；`cleanup` |
| RK 安卓 | `assets/rk-virtual-disk.sh setup`（无真盘）+ 触发 | `verify.sh --rk <log> <pkg…>` |
| T3 安卓 | `assets/trigger.sh` | `verify.sh --t3 <log> <pkg…>` |
| T3 Linux | `assets/t3linux-trigger.sh bootcheck` + `stage <包目录>` + `run`（或 `stdin-run`） | `verify.sh --t3linux /data/cp-unattended/<pkg>.log` |
| 整机线刷 | **不在这里**：走 `flash` skill（`/flash`，会清数据、只比版本号） | — |

**0.2 时间预算**：Android 一轮 ~2 min；Debian 一轮 ~3 min（安装 ~130 s + 重启 ~32 s）；T3 Linux 一轮 ~2 min（脚本 + 取证，含重启 ~3 min）；整机线刷（走 `flash` skill）一轮 10–25 min（整盘写入 + 首次开机）。超了就是走弯路。**不要为取证重复跑整包**；日志没留按 §7.8-5 反查。

**0.3 验证纪律（先定边界，再动手）**

- **先验证再出包**：待合入的设备端动作（`setprop`、命令、脚本）先在真机逐条跑通，记下命令 / `rc` / 回读；验证记录落盘后才打包，禁止「先出包、再拿包验证」。
- **合包按来源包形态**：来源包的 xml 动作原样搬（动作、顺序、参数不改写，不搬进 shell 脚本、不自造回读/重试/汇总）；必须增删动作时单列差异 + 理由，先征得同意再改。
- **安卓重启/刷机后按回线情况提示切 OTG**：见 §7.3（超时才提示，不写报告）。
- 一轮验证只回答「包内交付物是否按期望工作」；出现失败先记录证据，**不追根因、不杀/重启业务进程、不反复跑同一崩溃二进制**。根因分析是另一个请求。
- 单次只跑一轮整包；进程是否常驻用 0/15/60 s 采样判断，不靠一次 `ps` 或重启应用后的瞬时结果。
- 服务模式包（如 T3 Linux 用 `/data/app.sh` 替换 Launcher）按包内约定进程判可用性，**不把 Launcher/MDM 缺失一律判失败**；报告写清是桌面包还是服务模式包。
- 只能目视/拍照的 UI（T3 Linux `eglfs/mali`）不要用 `/dev/fb0` 抓屏下结论；没目视就写「未验证（需目视）」。

## 1. 判定平台（先 OS，再工具；1 次调用）

```bash
adb devices -l
adb shell 'head -3 /etc/os-release; uname -m'                                   # Debian 11 → RK Debian；Buildroot → T3 Linux
adb shell 'ls -l /unattended_installation.sh /customization.tar /usr/bin/silentInstaller 2>/dev/null'
adb shell 'ls -l /Launcher; cat /Configs/system_info/system_info.ini 2>/dev/null'  # Buildroot 桌面 + 固件版本
# 仅确认是 Android 后才跑（Debian/T3 Linux 上 getprop 是 shim 或不存在，不能当判据）
adb shell 'getprop ro.board.platform; getprop ro.hardware; getprop ro.build.version.sdk; pm path com.cpdevice.cpservice; pm path com.android.guard'
```

**直判（先 OS，再工具）**：`/etc/os-release` 是 Debian 11 + `unattendedinstallationtools` ⇒ RK Debian；是 Buildroot + `/Launcher` ⇒ T3 Linux；盘根 `CpService.xml` ⇒ RK 安卓；`E9631Service.xml` ⇒ T3 安卓；`auto_unattended_installation/` ⇒ Debian 自动。
盘根 `unattended_installation.sh` **不能单独判**：RK Debian 手动方式和 T3 Linux 同名，必须结合 OS/工具。

| 判据 | RK 安卓 | T3 安卓 | RK Debian | **T3 Linux（Buildroot）** |
|---|---|---|---|---|
| 系统 | Android 11+（SDK 30+） | Android 6.0.1（SDK 23） | Debian 11（bullseye） | **Buildroot 2016.11 / kernel 3.10.65 armv7l** |
| 工具 | `com.cpdevice.cpservice` → `CpService.xml`（21 动作） | `com.android.guard` → `E9631Service.xml`（9 动作） | udev `auto_unattended_installation@`+`silentInstaller`；手动 `Unattended_Installation_Tools`+`unattended_installation` | **桌面 `/Launcher`（UDiskSetting）** |
| 触发/盘根 | 卷枚举（真盘 / SD / `sm` 虚拟盘） | 广播（真盘或假挂载） | `/media/usb_disk`（udev）｜`/mnt/installUsb`（工具） | **GUI：设置→U盘查看→右上开关；`/mnt/usb/sda1/unattended_installation.sh`** |

- 机型名不是判据（同名机型跨芯片两条产线）；没连设备或只说机型 → 先问平台，验证项标「未验证」。
- `unattendedinstallationtools` 是 deb 包名不是进程名；Debian 两种方式互相独立，别当成一个进程。
- T3 Linux 没有 `getprop`/`pm`/`logcat`，不要拿安卓命令的结果当判据。

## 2. 加载对应上下文（必须；先读再写，只按它写）

| 平台 | 必读 | 内容 |
|---|---|---|
| RK 安卓 | `references/rk-android.md` | 21 动作、`params`/`param1`、落点、写权限、验证、坑 |
| T3 安卓 | `references/t3-android.md` | 9 动作、`srcfile`/`udiskfile`/`dstdir`、mksh 限制、假挂载、MDM/WiFi |
| RK Debian | `references/rk-debian.md` | **顶部 runbook**、两种方式、`:uisum`、脚本约束、dpkg/落点、验证、坑 |
| T3 Linux | `references/t3-linux.md` | **顶部 runbook**、Launcher 触发链、`/mnt/usb/sda1`、落点、bash 约束、假挂载验证、坑 |

平台能力差异只看 §5.2，别在 reference 里另立对照表。

## 3. 交付物

| 文件 | 位置 | 说明 |
|---|---|---|
| `CpService.xml` / `E9631Service.xml` | U 盘根目录 | 动作清单，插盘按序执行 |
| `auto_unattended_installation/` + 根 `unattended_installation.sh` | U 盘根目录 | Debian：udev 载荷目录（bash 启动脚本）/ 手动入口（POSIX sh，`$1`=盘根） |
| 根 `unattended_installation.sh` + 资源 | U 盘根目录 | T3 Linux：Launcher 写死 `/mnt/usb/sda1/unattended_installation.sh`；脚本要有 `+x` |
| 资源（apk / deb / `logo.img` / `bootlogo.bmp` / `logo` / `video_demo.yuv` / `bootanimation.zip` / bin / tar） | U 盘根目录 | xml 里只写文件名；logo 资源用 §8.4 生成；仅当需求明确要「中性」时用 §8.4 预置包 |
| 交付 zip | `~/Downloads/` | `…_YYYYMMDD.zip`（同日多次 `_YYYYMMDD-2`），**平铺不套目录** |

Debian 盘根必须直接有 `unattended_installation.sh`：套一层目录 = 工具找不到入口 = 插盘无反应。

## 4. 出包形态

- **A 纯 xml / B 薄壳 + 脚本**：模板与示例见 `rk-android.md` §5、`t3-android.md` §5。多步骤/要日志/要判定一律走 B：`copy`（RK `param1` 是目录）把脚本放进 `/data/local/tmp`，再 `cmd` 执行 `sh /data/local/tmp/setup_xxx.sh`（两 token、路径固定最稳）。
- **C Debian（没有 xml，脚本即包）**：

```text
<zip 根，平铺>/
├── auto_unattended_installation/            # 自动方式（udev）
│   ├── auto_unattended_installation.sh      # bash + :uisum
│   └── <小载荷>                              # 会整体复制到 /run（391 MB）
└── unattended_installation.sh               # 手动方式；双入口时 exec 到主脚本 + flock
```

自动：插盘 → `/media/usb_disk` → 拷 `/run` → `/run/silentInstaller` → `bash /run/auto_unattended_installation.sh`。
手动：GUI 点 Open 后插盘 → `/mnt/installUsb` → `sh <盘根>/unattended_installation.sh <盘根>`；**返回即卸载**，活要在脚本内干完。示例：雷沃包（根入口 + `customization.tar`）= 手动；`debian_auto_openssh_drop.zip` = 自动。细节 `rk-debian.md` §1–§2。

- **D T3 Linux（没有 xml，盘根脚本即包）**：

```text
<zip 根，平铺>/
├── unattended_installation.sh      # 必须；Launcher 写死 /mnt/usb/sda1/unattended_installation.sh
└── <资源>                          # tar / logo / bootlogo.bmp / 动画 / rcS / runqt…
```

触发：Launcher → 设置 → U盘查看 → 右上角开关；Launcher 起 `bash` 并把 `"./<脚本>"` 写进 stdin（**没有 `$1`、不要读 stdin、脚本要有 `+x`**）。细节 `t3-linux.md` §1–§5。

## 5. 硬约束

### 5.1 XML 与执行（仅 Android）

1. 合法 XML：`&` → `&amp;`（`2>&1` → `2&gt;&amp;1`）；一条不合法整包不执行。
2. 顺序即执行：logo/安装 → remount（如允许）→ 拷贝/安装 → `sync` → `reboot`；`reboot` 只一条、放最后。
3. `params` 不能为空（RK 整条跳过，`remount` 也要非空）；xml 不写注释。
4. **路径带空格/括号必须整条加引号**：`sh -c 'sh "/storage/udisk(id=TEST)/x.sh"'`。不加引号时工具按 shell 语义执行会报 `syntax error: '(' unexpected`，脚本静默不跑、日志一行没有（实测白跑一轮）。
5. `canuse_ver` 默认不加（`contains`，不匹配后续全跳且不可恢复）。

Debian / T3 Linux 没有 xml、没有动作：顺序 = 脚本顺序，失败靠 `set -e` + `trap`。

### 5.2 平台差异（唯一对照表）

| 维度 | RK 安卓 | T3 安卓 | RK Debian | T3 Linux |
|---|---|---|---|---|
| 描述文件 | `CpService.xml` | `E9631Service.xml` | `auto_unattended_installation/auto_unattended_installation.sh`（+ 根入口） | 盘根 `unattended_installation.sh`（Launcher 写死路径） |
| 动作模型 | 21 个 action | 9 个 action | 无动作，脚本全权；`:uisum` 进 UI 摘要 | 无动作，脚本全权；stdout 进 Launcher 进程 |
| 设备端 shell | mksh，有 `awk`/`sqlite3` | mksh，**无 `awk`**、无 `cmd` | udev：bash；入口：sh（dash） | bash 4.3（`/bin/sh` 也是 bash）；busybox |
| 系统分区 | 动态分区 + verity，**默认不写 `/system`** | 可 remount（工具写死分区号） | rootfs **rw**：`dpkg`/`systemctl` 可用，改前备份 | `/`、`/data` ext4 rw；boot-resource 单独 mount |
| 重启 | `cmd reboot`（自动延后） | 异步，会打断安装 | 默认不重启，交给 UI「重启」按钮 | 默认 `reboot`（Launcher 的 bash 收不到 EOF） |

### 5.3 设备端脚本

- Android（mksh）：`#!/system/bin/sh`，不能用 bash（`<<<`、`[[ ]]`、数组），不能调 adb；路径带空格整条加引号。
- Debian：自动方式用 `#!/bin/bash`（可 `set -Eeuo pipefail`/`[[ ]]`/数组），手动入口必须 POSIX sh；两种方式都是 root，不要 `sudo`，显式设 PATH，日志双写 `/var/log/cp-unattended/<pkg>.log`。
- T3 Linux：`#!/bin/bash`（bash 4.3，可 `set -Eeuo pipefail`），root；**没有 `$1`**（Launcher 从 stdin 喂路径）；脚本要有 `+x`；禁止读 stdin；日志 `/data/cp-unattended/<pkg>.log`（`/tmp` 是 tmpfs）。
- 通用：日志双写 `/sdcard/<name>.log`（Android，退 `/data/local/tmp`）；支持 `NO_REBOOT=1`；`flock` 防双触发。

### 5.4 命名与打包

工具硬编码的文件名不能改：Android 的 `logo.img`、`bootanimation.zip`；Debian/T3 Linux 的 `unattended_installation.sh`、Debian 的 `auto_unattended_installation/auto_unattended_installation.sh`。T3 Linux 的脚本必须可执行（`chmod 755`），否则 Launcher 报 `Permission denied`；**zip 内也应为 0755**，打包后 `unzip -Z -l` 核对，不能只看解压后的模式。Debian 不随包 `silentInstaller`（会覆盖 `/usr/bin/` 的），不带无关 `eeprom_config.json`。zip 平铺；报告落 `~/Downloads/<包名>_verify_report.md`，别塞进包目录。

### 5.5 `reboot` 与 OTG

- Android：包里有 `cmd reboot`；回线超时才提示切 OTG（§7.3），`adb` 连不上**不等于**升级失败。
- Debian：工具窗口 `Open`/`Close` 写 `/sys/devices/platform/fe8a0000.usb2-phy/otg_mode`（host/otg），**切 host 会掉 adb**；有独立 Host 口就插 Host 口；脚本自动重启必须带 `.done` 标记防循环。
- T3 Linux：U 盘要 Host 角色（`/sys/bus/platform/devices/usbc0.2/{usb_host,usb_device}`），切 Host/重启都可能掉 adb；**别在需要 adb 时读 `usb_host`**（实测读完后设备从 USB 消失，疑似触发角色切换）。脚本默认 `reboot`，探测/验证用 `NO_REBOOT=1`。
- `adb wait-for-device` 一律加超时（`timeout 120`），别 `sleep` 硬等。

## 6. 本机自检

### 6.1 脚本与包

```bash
python3 -c "import xml.etree.ElementTree as ET; ET.parse('CpService.xml'); print('XML OK')"   # 或 E9631Service.xml
grep -n '&' CpService.xml; grep -n 'params=""' CpService.xml        # 裸 & 与 RK 空 params 都静默失败
bash -n auto_unattended_installation/*.sh; sh -n unattended_installation.sh; shellcheck -S warning *.sh
bash -n t3linux-setup-template.sh t3linux-trigger.sh; chmod 755 unattended_installation.sh   # T3 Linux：必须有 +x
grep -c $'\r' *.sh; grep -c '^:uisum' auto_unattended_installation/*.sh; du -sh auto_unattended_installation
tar tf data.tar.gz >/dev/null && echo 'tar 可读'   # 别信 .gz 后缀；T3 Linux 示例包就是未压缩 tar
find . -name '*~' -o -name '*.swp' -o -name '*.bak*' -o -name '#*#'   # 编辑器残留会被整目录拷进设备
```

**出包前 checklist（通用，两分钟，省一轮整包）**

- **动作先在真机逐条试跑**：新增/合入的 `setprop`、命令、脚本先单条执行，记 `rc` + 回读；回读留 ≥2 s（属性区有陈旧窗口，见 §7.8-11），验证记录落盘后才打包、才推假挂载。
- **保持来源形态**：合入外部包（xml 动作清单、脚本、配置）时原样搬——动作/顺序/参数不改写、不搬进另一层（如把 `cmd` 改写成脚本）、不自造回读/重试/汇总；确需增删动作，单列差异 + 理由并先征得同意。
- **路径引号**：带空格/括号的路径（`(id=XXXX)`、`Program Files`）整条加引号，见 §5.1-4。
- **只跑一轮整包**：形态（动作清单/脚本/平铺或套目录）定下来之前不打包；整包一轮为主，返工要能说清为什么。

### 6.2 只读核查存量包（别解整包：180 MB 解一次 = 秒级 I/O + 数百 MB 工作区）

```bash
unzip -l pkg.zip                                                          # 结构 / 是否套目录
unzip -Z -l pkg.zip | grep -E 'unattended_installation.sh|data.tar.gz'    # Unix mode：T3 Linux 入口应为 0755
unzip -p pkg.zip '*customization.tar' | tar -tvf -                       # 成员表，不落盘
unzip -p pkg.zip '*customization.tar' | tar -xOf - customization/Installer.sh  # 只看一个文件
dpkg-deb -I pkg/**/*.deb; unzip -p a.zip '*/x.tar' | md5sum              # 多版本只比 md5
```

再核对：**先判包形态**——T3 Linux 盘根入口是否直接存在、zip 内模式是否 0755、是否套目录；形态不合格先记「结构不通过」，再解压/假挂载验证载荷，别用扁平后的成功掩盖原包不能直接用。然后核对脚本引用的每个资源是否真在包里（`grep -o '/customization/[^ ]*' Installer.sh` 逐个 `ls`）、`md5sum` 留档、`.swp`/`*~` 残留、同日多版本谁最新。

## 7. 真机验证

### 7.1 前置

```bash
adb shell 'uptime; date'                                                  # 基线；无电池 RTC 从 1970/2022 起算
adb shell 'cat /etc/os-release | head -3; dpkg -l unattendedinstallationtools | tail -1; cat /sys/devices/platform/fe8a0000.usb2-phy/otg_mode'
adb shell 'pkill -x silentInstaller; rm -rf /media/usb_disk /mnt/installUsb /run/auto_unattended_installation.sh'
adb shell 'head -3 /etc/os-release; cat /Configs/system_info/system_info.ini; pidof Launcher'   # T3 Linux
adb shell 'cat /etc/inittab; cat /etc/fstab; grep -n -E "autorun|mount -t ext4 /dev/mmcblk0p1 /data" /etc/init.d/rcS'  # 启动链/挂载顺序
adb shell 'grep -E "mmcblk0p1| /data " /proc/mounts; ls -l /data/app.sh 2>/dev/null; ls /sys/class/net'  # /data 与 can0
```

Debian 装之前先备份（回滚靠它）：`cp /etc/lightdm/lightdm.conf /etc/rsyslog.conf /userdata/verify_bak/`、`dpkg --get-selections > /userdata/verify_bak/dpkg.selections`、`dd if=/dev/block/by-name/logo of=/userdata/verify_bak/logo.part bs=1M`。Android 的 logo/动画备份见 `rk-android.md` §7。 T3 Linux 换 LOGO/bootlogo 前把 `/logo`、`/Configs/bootlogo.bmp` 和 boot-resource 里的 `bootlogo.bmp` 备份到 `/data/cp-unattended/`。

### 7.2 一轮整包（只跑一轮）

- Android：有盘就「工具整包 + 真实重启」跑一轮，重启后按 §7.4 核验；再跑一轮屏蔽 reboot 的整包是白跑（每轮 314 MB + 两次 `pm install`）。
- Debian：模拟挂载跑（adb 不掉）见 SKILL §7.7；含 `reboot` 的包提前和用户约好 OTG/重启。
- T3 Linux：先 `bootcheck` 看启动链/`/data`/`can0`；假挂载 `/mnt/usb/sda1` 跑探针见 §7.9；GUI 触发人工；含 `reboot` 提前约时间（U 盘占 Host、adb 会掉）。
- RK 触发后 3–4 s 删卷根 `CpService.xml`（先解析后执行，还避免重启循环）；要屏蔽 reboot 用 `NO_REBOOT=1` 或 PATH 影子 `reboot` 并写明。

### 7.3 重启与 OTG（唯一权威）

**通用规则：安卓默认 OTG Host。** RK 安卓、T3 安卓都一样——**刷机（线刷 / U 盘整包）或重启后 OTG 口是 Host，adb 不会自己回来；不是刷坏，也不是升级失败**。处理只有一步：在设备上把 OTG 切到 DEVICE（T3 安卓切完 `cat /sys/devices/soc.0/usbc0.2/otg_role` 应读回 `usb_device`），再 `timeout 120 adb wait-for-device` + 轮询 `lsusb | grep -iE '2207|1f3a'` 等回线。判成败看安装时间 / 落点 md5 / `uptime` 归零，不看 adb 是否秒回。

1. **提示时机：等回线，超时才提示。** `reboot` / 刷写发出后**不预先提示**，先按超时等 adb；**只有超时仍未回线、且 `lsusb` 上看不到 loader/FEL（`2207`/`1f3a`）时**，才在对话里提示「在设备上切 OTG 到 DEVICE」，然后继续等。用 harness 的普通消息提示即可（不加自定义按钮/浮层），**不写进报告**；`adb` 掉线不等于失败。下载模式期间（正在刷 / 正在进 loader）不提示。
2. Debian：切 host 读盘同样会掉 adb；实测 `otg_mode=otg` 重启后 adb 常能自己回来，仍要复核 `uptime`。
3. T3 Linux：U 盘要 Host 角色（`usbc0.2/{usb_host,usb_device}`），切 Host/重启都可能掉 adb；**别在需要 adb 时读 `usb_host`**（实测读完后设备从 USB 消失，疑似触发角色切换）。重启后看 `lsusb | grep -i 1f3a`、`uptime` 归零，再按第 1 条等回线、超时才提示。

### 7.4 核验（共用项）

| 检查项 | 命令 | 通过判据 |
|---|---|---|
| 工具执行 | Android：logcat 过滤（RK：`logcat -d -s _Command:V \| grep -- '--xml---action---'`，详见 `rk-android.md` §7 / `t3-android.md` §5）；Debian：`journalctl -b --no-pager` + `/run/auto_unattended_installation.log` | 有 action 行、无解析异常（重启前有效） |
| 脚本日志 | `cat /var/log/cp-unattended/<pkg>.log`、`/data/cp-unattended/<pkg>.log` 或 `/sdcard/<name>.log` | `start, usb root:`、无 `skip missing`、`… Success`、结尾 `done`（老包不写日志 → §7.8-5） |
| 本轮跑完 | `dpkg-query -W` / `dumpsys package <pkg>` / `ls -l` + `date -r`（T3 Linux 没有 `--full-time`） | **时间戳**在本轮窗口内（别只比 md5） |
| 文件到位 | `md5sum`（设备 vs 包内） | 一致 |
| **可用性（必查）** | 安卓：`am start`/`monkey -p` 后 `dumpsys activity activities \| grep mResumedActivity`、`pidof <pkg>`、`logcat -d \| grep -F "FATAL EXCEPTION"`；Debian：`systemctl show -p UnitFileState,ActiveState,Result,ExecMainStatus,NRestarts <unit>`；T3 Linux：按包设计取进程集（桌面=Launcher/MDM；服务模式=`JobMonitor.out`/`CFT.out`/`VariableMonitor` 等）+ `ps` + 目视 | 见下「可用性判据」；客户应用/系统服务/桌面起不来 = 不通过 |
| 残留 | `ls /data/*.apk /data/local/tmp/usbroot`、`/media/usb_disk`、`/run/…`、`/mnt/usb/sda1` | 无 |
| 重启回来（OTG） | `adb devices -l`、`lsusb \| grep -iE '2207\|1f3a'`、`uptime` | 切回后 adb 出现；超时按 §7.3 提示用户切 DEVICE（不写报告） |
| UI（仅 Debian 自动方式） | `ffmpeg -f x11grab` 截屏 | 摘要区 `:uisum…`、结束 `退出码:0`；**手动方式没有摘要，不用截图**（eglfs 机型还可能全黑） |

**可用性判据**（四平台共用；`is-active` 一刀切会误杀，实测就踩过）：

- **常驻服务**（`Type=simple` 长期跑）：`ActiveState=active`，且 `NRestarts` 不持续增长（停在 1 次属正常）。
- **一次性 / oneshot**（如 `cpwelcome`，播完就退出）：`UnitFileState=enabled` + `Result=success` + `ExecMainStatus=0`；`inactive/dead` 是**正常**的。
- **被其它单元拉起**（如 `lovolrun` 由 `cpfeh` 启动）：`ActiveState=active` 即可，`UnitFileState=disabled` 是**正常**的；证据里写清"谁拉起的"（journal 行）。
- **安卓应用**：有 Launcher Activity → 启动后 `mResumedActivity` 命中包名；**无 Activity 的服务型**（如 `com.android.guard`、VanCoreT3）→ `dumpsys activity services <pkg>` 有记录或 `pidof` 非空。两种情况都要求 logcat 无该包的 `FATAL EXCEPTION`。
- **T3 Linux 桌面/服务**：桌面包看 `pidof Launcher`、`pidof MDM`；服务模式包看包内约定的进程（如 `JobMonitor.out`、`CFT.out`、`VariableMonitor`）。服务模式替换 Launcher 时，Launcher/MDM 不在是**可能正常**的，报告写清包设计，不要一律判失败。
- **T3 Linux UI**：`eglfs/mali` 下 `/dev/fb0` 可能仍显示开机帧/黑屏，不能据此判 UI 成败；必须目视或拍照，否则标「未验证（需目视）」。

### 7.5 收尾

```bash
adb shell 'rm -f /storage/*/CpService.xml; rm -rf /data/local/tmp/usbroot /data/local/tmp/probe_*; setprop persist.cps.xml.run.time 0'
adb shell 'pkill -x silentInstaller; rm -rf /media/usb_disk /mnt/installUsb /run/auto_unattended_installation.sh /run/silentInstaller /run/temp_copy'
adb shell 'rm -rf /mnt/usb/sda1; rm -f /data/cp-unattended/probe*'   # T3 Linux 假挂载/探针日志；真盘挂载时不要删 /mnt/usb/sda1，客户日志别清
```

`emulated` 被 eject 后 `/storage/emulated/0` 报 `Transport endpoint is not connected`：`adb shell 'sm mount emulated\;0'` 或重启。

### 7.6 报告（精简版：包内有什么 → 期望 → 实际）

判据只有三列：**包里有什么交付物、期望是什么状态、实际是什么状态**。模板 `assets/verify-report.md`，落 `~/Downloads/<包名>_verify_report.md`。

1. **不写安装过程**：不出现 `cp`/`tar`/`apt`/"先拷后解再装"这类叙事，也不按 step 罗列安装器动作；主语是**包内交付物**（apk / deb / service unit / logo.img / 动画 / 资源）。
2. **必含可用性**：每次报告都要有「安卓客户应用能启动」「系统服务能起来」「T3 Linux 桌面或服务模式约定进程常驻」「重启后仍可用」结论（按平台取），判据见 §7.4；起不来就是**不通过**，不许只写"已安装"。T3 Linux `eglfs/mali` 的 UI 只能目视/拍照，没看就写「未验证」。
3. **默认精简**：主表 ≤12 行、每行一句证据（md5 / 时间戳 / systemctl 输出 / 日志行）；只有出异常才加「附录：异常详情」，正常情况不写。
4. 没跑的写「未验证（原因）」，别写成通过；只目视的（开机 LOGO）单列；风险压一句。
5. **证据 reboot 前抓完**（§7.8）；可用性的"重启后"那行例外，重启回来再抓一次。

### 7.7 RK Debian 真机流程

细节见 `rk-debian.md` §7；主线用资产，别手打：

1. 手动入口：`assets/debian-trigger.sh manual <包目录>`（stage 到 `/mnt/installUsb` + 跑守护进程同一条命令，输出落 `/var/log/lw_install.log`）。
2. 自动链：`assets/debian-trigger.sh udev <包目录>`（模拟 `/media/usb_disk` + 包装脚本 → `silentInstaller`）。
3. 取证：`assets/debian-trigger.sh evidence` → `assets/verify.sh --debian /var/log/lw_install.log <pkg…>`；自动方式另截 `shot`。

### 7.8 取证硬规则（踩过的坑）

1. **日志落持久路径**：`/var/log/`、`/userdata/`、`/usr/local/share/`。**禁止 `/tmp`**——Debian 开机 bootclean 清空，重启后整段 stdout 消失。
2. **一次抓全**：reboot 前用一条 `adb shell 'a; b; c'` 或 `debian-trigger.sh evidence`，别一条条打。
3. **systemd 查询带 `--no-pager` 或 `| cat`**：`systemctl show|status` 在 adb pty 下会进 less，卡 60 s 不动。
4. **包自带 reboot 时 `adb` 会假 `rc=0` 提前返回**，拿不到脚本 rc：只看 `dpkg.log`/`apt history.log`/时间戳，别判失败、别重跑。
5. **旧包没有自写日志**：用 `/var/log/dpkg.log`（装了哪些包、几点）+ `/var/log/apt/history.log`（apt 事务是否整组被拒，如降级 `E: Packages were downgraded and -y was used without --allow-downgrades`）+ 落点 `ls -l --full-time` 反查。
6. 只取设备端可见落点：分区 hash、文件 md5、服务状态、进程、日志；视觉类（LOGO/动画）单列「仅目视」。
7. T3 Linux：日志落 `/data/cp-unattended/`（`/tmp` 是 tmpfs）；Launcher 的 bash 收不到 EOF、不会自己结束，**别等 UI 回 idle**；GUI 触发痕迹看 `/data/Log/log.log`；脚本要 `+x`，否则 stdin 模式报 `Permission denied`。
8. **不杀/不重启业务进程**：验证只读；进程变化用 0/15/60 s 采样 + core + `dmesg` 判断，不要 kill 后重拉。确需重拉先征得同意，结束后重启恢复。
9. **先查启动依赖**：T3 Linux 的 `/data` 由 `rcS` 挂载，`/etc/autorun.sh` 可能先跑；先看 `/proc/mounts`、`/data/app.sh`、`can0`。CFT 在 `CanInit` 崩溃时先查 `can0`，别反复跑二进制。
10. **失败即停**：一项不过就写报告；验证不是排障，不把「为什么」扩成主任务。
11. **属性/配置回读有陈旧窗口**：`setprop` 后 1–2 s 内 `getprop` 可能仍读到旧值或空值（实测 `persist.hw.modem.nsim` 0→1，立即读仍是 0，2 s 后才变 1）；判定前 `sleep 2`，以 `/data/property/<name>` 终值为准。**别用单次回读判失败**，更别据此推成权限/沙箱问题（本次差点误判成 SELinux 拒绝，白查 9 分钟）。
12. **无电池 RTC 的设备每次重启时钟归零**（1970/2022 起算）：`mtime`、日志时间跨重启不可比，判断先后一律用 `uptime` 对齐；只比属性值和文件内容，别拿 mtime 推「有服务在覆盖」。
13. **复制/落盘失败先查挂载**：`cp` 报目标不存在、脚本里 `[ -d ]` 突然判假、目录「看着空了」，先看 `/proc/mounts`——挂到上级目录会遮蔽整棵子树。实测 T3 Linux 包先 `mount /dev/mmcblk0p2 /mnt` 再装应用，Launcher 的盘路径 `/mnt/usb/sda1` 被遮住，日志只剩一句 `app目录不存在`（遮蔽按路径生效，真 U 盘挂同一路径也一样）。挂载点用独立目录（如 `/mnt/bootresource`），写完 `sync` + `umount`。

### 7.9 T3 Linux 真机流程

细节见 `t3-linux.md` §6；主线用资产，别手打：

1. 启动链：`assets/t3linux-trigger.sh bootcheck`（`inittab`/`rcS` 的 `autorun` 与 `/data` mount 顺序、`/proc/mounts`、`/data/app.sh`、`can0`、进程）；先确认 `/data` 在 `app.sh` 启动前已挂载。
2. 探针：`assets/t3linux-trigger.sh probe`（建最小包 → stage 到 `/mnt/usb/sda1` → 跑 → 校验 md5）。
3. 正包：`assets/t3linux-trigger.sh stage <包目录>` → `run`；再跑一次 `stdin-run` 复现 Launcher 的 `bash` + stdin 调用。
4. 取证：`assets/t3linux-trigger.sh evidence` → `assets/verify.sh --t3linux /data/cp-unattended/<pkg>.log`；GUI 触发起因看 `/data/Log/log.log`；服务模式另看 `can0`、`/data` 挂载、core 和 0/15/60 s 进程采样。
5. GUI（人工）：设置 → U盘查看 → 右上角开关；真 U 盘要 Host，重启/掉 adb 就按 §7.3 提示用户切 DEVICE。假挂载可能不显示/点了卡住，没真盘就标「未验证」。
6. 收尾：`assets/t3linux-trigger.sh cleanup`。

## 8. 需求 → 写法

### 8.1 Android

见 `rk-android.md` §5 / `t3-android.md` §5：`install`、`copy`、`logo`/`bootlogo`、`bootanimation`、写 `/system`（RK 拒绝、T3 先 remount）、`canuse_ver`、`runlimit`。

### 8.2 RK Debian

| 需求 | 写法 |
|---|---|
| 装 deb | `dpkg -i --force-overwrite <deb>`，或 `apt install -y --allow-downgrades <deb>`（**不带 `--allow-downgrades` 遇降级整组拒绝，一个都不装**）；装完 `dpkg-query -W` 核对 |
| 推文件/目录 | `cp -a` + md5 校验 + `chown` |
| 改服务/自启 | 备份 → 改 → `systemctl daemon-reload` → `enable/restart` |
| 换开机 LOGO | `dd if=logo.img of=/dev/block/by-name/logo`（不是安卓的 `logo` 动作） |
| 装完重启 | 默认交给 UI「重启」按钮；自动重启用 `DO_REBOOT=1` + `.done` 标记 |
| 只跑一次 / 大载荷 | `ONLY_ONCE=1`（`/var/lib/cp-unattended/<pkg>.done`）+ `flock`；大载荷放 U 盘根 |
| 清临时物 | `rm -rf /customization /customization.tar`（`rm` 不带 `-r` 静默失败，172 MB 留在 `/`） |

### 8.3 T3 Linux

| 需求 | 写法 |
|---|---|
| 装应用 | `tar xf data.tar.gz -C /data`，或 `cp` 二进制后改 `/data/app.sh` / `/etc/init.d/runqt` |
| 换开机 LOGO | `cp logo /logo`（5 MB raw，权限 644） |
| 换 bootlogo | `cp bootlogo.bmp /Configs/` + `mount -t vfat /dev/mmcblk0p2 /mnt` 替换 `bootlogo.bmp` 后 `sync`/`umount` |
| 换开机动画 | `CPVideoPlayDemo` + `video_demo.yuv`（`rcS` 里 `-t 9`） |
| 改自启 | 备份 `/etc/init.d/rcS`、`/etc/init.d/runqt` 后再改 |
| 装完重启 | 默认 `DO_REBOOT=1`；调试 `NO_REBOOT=1` |
| 只跑一次 | `ONLY_ONCE=1`（`/data/cp-unattended/<pkg>.done`）+ `flock` |
| 大载荷 | 放 U 盘根，脚本运行时从 `$USB` 读，别整包拷进 `/data` |

### 8.4 生成 LOGO 资源（四平台，必须用脚本）

**红线：开机 logo / bootlogo / 开机动画资源只准由 `assets/generate-bootlogo.sh` 生成；脚本已验过，产物直接进包，不再手工核尺寸/字节数。**
- 禁止手绘、PS/PIL 拼字、手工 `ffmpeg`、手工 `cat` 拼帧、手工改尺寸/颜色/字节数。
- 客户已有字标图，先要图（问一句），不要自己"参照样式"造字。
- 上游 `assets/vendor/generate_bootlogo.sh` 原样保留（交互式），只作对照，不直接改。

```bash
assets/generate-bootlogo.sh --image logo.png --chip T3 --system Linux --name <客户> --out ~/Downloads
#   --rotate       180°（hflip,vflip）：只转 bootlogo.bmp / logo（哪些机型加见下）
#   --logo-frames  T3 Linux 的 logo 帧数：原机 /logo 是 2 帧（4,915,200 B）时传 2，默认 1
#   --no-video     跳过 video_demo.yuv（仅明确不换开机动画时用）
#   --assets-only  只出媒体，不出 xml / 安装脚本（往已有包里塞）
```

**方向（通用规则，只在这里写）**

- `/logo`、`bootlogo.bmp`：**存储 = 显示图旋转 180°**（`--rotate` = `hflip,vflip`），屏上才是正的。
- `video_demo.yuv` **不旋转**：视频层（`CPVideoPlayDemo` / fb1）方向与 logo 层不同；脚本 yuv 分支本身不带翻转，别"顺手修"。
- **SPRING1 / SPRING2 / SPRING2PRO（含 `SPRING2_L`、`SPRING2_PRO` 等变体）屏幕 180°：识别到这三款就传 `--rotate`**；脚本按参数直出，不硬判机型。

| 芯片_系统 | 产物 | 装包动作 |
|---|---|---|
| RK_Android | `logo.img` + `CpService.xml` | `logo` 动作，`params` 必须叫 `logo.img`（见 rk-android.md §3.2） |
| RK_Linux | `logo.img` + `unattended_installation.sh` | `dd if=logo.img of=/dev/block/by-name/logo`（§8.2） |
| T3_Android | `bootlogo.bmp` + `E9631Service.xml` | `bootlogo` 动作，`params` 必须是 `bootlogo.bmp` |
| T3_Linux | `bootlogo.bmp` + `logo` + `video_demo.yuv` + `unattended_installation.sh` | `/logo`、`/Configs/bootlogo.bmp` + `/dev/mmcblk0p2`（§8.3） |

- **预置「中性」包（RK 安卓）**：`assets/presets/rk-android-neutral/` = `logo.img`（1024x600，3,686,966 B）+ `bootanimation.zip`（单帧）+ `CpService.xml`（`logo → bootanimation → sync → sleep 5 → reboot`）。
  - **只在需求原话明确要「中性」**（中性 logo/动画/开机图）时用；「客户没给图」「随便/默认/通用一点」都不算中性 → 走上面的生成器，或先问。
  - 还需 RK 安卓（`com.cpdevice.cpservice`）+ 屏幕 1024x600（`adb shell wm size`）。1280x800 / 客户品牌图 / T3 或 Debian / 要真多帧动画 / 调试轮免重启（`NO_REBOOT=1`）一律不用。
  - 组合需求（如装 apk + 中性 logo）只借 `logo.img` + `bootanimation.zip`，xml 按需求重写；用了就在交付说明里点明用的是预置包。
  - 设备侧触发：插盘 → `ACTION_MEDIA_MOUNTED` → 工具枚举真实卷 → 读卷根 `CpService.xml` → 顺序执行；`reboot` 后 adb 掉线按 §7.3 等回线。
- **预置「中性」Linux logo**：`assets/presets/linux-neutral/` = `logo.png`（1024x600 源图）+ `logo`（bgra 2 帧，R180）+ `bootlogo.bmp`（R180），三件套已按现场方向出好。
  - 只在需求明确要「中性 / Linux 通用 logo」且客户没给品牌图时用；给了品牌图一律用客户的图走生成器。
  - 只适用 Linux：T3 Linux 直接平铺进包根；RK Linux / RK Debian 用 `logo.png` 重出 `logo.img`。安卓用 `rk-android-neutral`。
  - 不含 `video_demo.yuv`（215 MB）：要换开机动画从 `logo.png` 现出。
  - 用了就在交付说明里点明「中性 Linux logo」。
- 图片只接受 **1024x600 / 1280x800**（ffprobe 判，与上游一致）；脚本末尾自检不通过就不会产出。
- 生成的安装脚本是**最小版**：RK Linux 按 `/mnt/installUsb` 硬编码（工具窗口方式；要手动入口 `$1` 形式按 §4 C 改写）；T3 Linux 无日志、无 `NO_REBOOT`，正式包用 `assets/t3linux-setup-template.sh` 补齐。
- 输出目录 `<out>/<CHIP>_<SYSTEM>_<name>_<YYYYMMDD>`，产物平铺进包根。

## 9. 文件索引

| 文件 | 用途 |
|---|---|
| `references/*.md` | 四平台事实与验证命令（按平台只加载一份） |
| `assets/verify.sh` | 主机核验（`--rk` / `--t3` / `--debian` / `--t3linux` / `auto`） |
| `assets/debian-trigger.sh` | Debian 触发与取证：`manual` / `udev` / `evidence` / `script` / `shot` / `status` / `cleanup` |
| `assets/debian-setup-template.sh` / `assets/debian-entry-template.sh` | Debian 主脚本（bash + `:uisum`）/ 手动入口（sh） |
| `assets/cpservice-setup-template.sh` / `assets/setup-template.sh` | Android 设备端脚本骨架（RK / T3） |
| `assets/t3linux-setup-template.sh` / `assets/t3linux-trigger.sh` | T3 Linux 盘根脚本骨架 / 触发与取证（bootcheck / stage / run / stdin-run / probe / evidence / cleanup） |
| `assets/probe-cpservice.xml` / `assets/probe-collect.sh` / `assets/probe.xml` / `assets/trigger.sh` / `assets/rk-virtual-disk.sh` | 探针与触发（RK 虚拟盘 / T3 假挂载） |
| `assets/add-icon-device.sh` / `assets/verify-report.md` / `assets/update-mdm-wifi.sh` | 桌面图标 / 报告模板 / T3 MDM+WiFi；skill 目录 `vendor/` 只复用 `VanCoreT3-*.apk` |
| `assets/generate-bootlogo.sh` | logo 资源生成驱动（§8.4）：`--image`/`--chip`/`--system`/`--rotate`/`--logo-frames`/`--no-video`/`--assets-only` |
| `assets/presets/rk-android-neutral/` | 预置「中性」logo/动画包（RK 安卓，**仅在明确要求中性时用**）：`logo.img` + `bootanimation.zip` + `CpService.xml` + `README.md` |
| `assets/presets/linux-neutral/` | 预置「中性」Linux 开机 logo（**仅明确要求中性时用**）：`logo.png`（源图）+ `logo`（2 帧 R180）+ `bootlogo.bmp`（R180）+ `README.md` |
| `assets/vendor/generate_bootlogo.sh` | 上游 `CP_Generate_Bootlogo` 原样副本（交互式，输出写在自己目录）；驱动的一致性基准 |

## 10. 边界与拒绝项

- **RK 安卓默认不写 `/system`**（动态分区 + verity）：客户坚持就说明风险，改 overlay 或单独走 `adb remount`。
- **RK 安卓假挂载无效**：没真盘先用 `assets/rk-virtual-disk.sh` 造虚拟盘，再不行退回脚本级验证并标注。
- **验完立刻清卷根 xml**：带 `install`+`reboot` 的 xml 留在会自动挂载的卷上 → 每次开机都重启。
- **Debian 没有 xml/动作**：别把 `install`/`copy`/`logo` 套过来；rootfs 可写也不等于随便写（备份 + 幂等 + 可回滚），`/oem` 只读。
- **Debian 两种方式可能同时触发**：包必须 `flock` + 幂等；手动方式依赖 GUI，工具没开插盘无反应；脚本返回即卸载盘根。
- **Debian 默认不自重启**：脚本 `reboot` + 盘不拔 → 再触发 → 重启循环；必须重启就写标记。
- **T3 Linux 没有 xml/动作**：别把 `install`/`copy`/`logo` 套过来；脚本名和 `/mnt/usb/sda1` 写死，套目录/没分区/没 `+x` 都是「点开关没反应」。
- **T3 Linux 的 Launcher 不会自己结束**：bash 收不到 EOF，出包默认 `reboot`；探针/验证用 `NO_REBOOT=1`，别等 UI 回 idle。
- **T3 Linux 的 boot-resource 很小**：换 `bootlogo.bmp` 前备份，写坏会影响开机；LOGO/桌面只能目视的项单列。
- **OTG 是重启/刷机的边界**：超时仍不回线时按 §7.3 提示用户切 DEVICE；别把 adb 掉线判成失败。四平台固件/脚本细节不要互套。
- **验证不是排障**：不杀业务进程、不反复跑崩溃二进制、不重启应用抓日志；先记录 core/进程/日志再下结论。一项不过即停，报告写「不通过/未验证」。
- **T3 Linux 启动时序**：`rcS` 先 `/etc/autorun.sh &`、后 `mount -t ext4 /dev/mmcblk0p1 /data`；`runqt` 可能抢在 `/data` 挂载前执行 `/data/app.sh`。新包要 wait `/data/app.sh` 或调整顺序；老包进程不齐先查 `/proc/mounts` 和启动链。
- **T3 Linux 服务模式**：`runqt` 改成 `/data/app.sh` 后，Launcher/MDM 不常驻是设计可能；可用性按包内约定进程判，不套桌面包判据。
- **T3 Linux UI**：`eglfs/mali` 的 `/dev/fb0` 抓屏不等于实际 UI；只能目视/拍照，否则写「未验证」。

## 11. 整机线刷（不在这里）

整机 `.img` 覆盖烧写（会清 userdata、跨系统重装、救砖）走独立 skill **`flash`**（命令 `/flash`）：
线刷脚本、线刷事实页与烧写工具都已迁到 `src/flash/`，验收口径也简化成「只比版本号」。
本 skill 只负责 U 盘升级包（装应用/换 logo/换动画），别再在这里找线刷脚本。
