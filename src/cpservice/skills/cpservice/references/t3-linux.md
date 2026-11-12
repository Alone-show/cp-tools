# T3 Linux（Buildroot）：盘根 `unattended_installation.sh`（/Launcher）

> **适用**：Allwinner T3 / Buildroot 2016.11 / kernel `3.10.65` armv7l（实测机 `SPRING2_L`，固件 `CP_SPRING2_L_DEV-3993FF5C_LCD7-10_W1B0_LPDDR_CN_MDM_20261009`）。
> **工具**：桌面 `/Launcher`（Qt 5.9）的「设置 → U盘查看 → 右上角开关」；脚本路径 `/mnt/usb/sda1/unattended_installation.sh` 写死。
> **别名**：现场也叫「T3 Buildroot」「T3 Linux 桌面」；**不是** T3 安卓（`t3-android.md`），也不是 RK Debian（`rk-debian.md`，那边手动方式同样用 `unattended_installation.sh`，判定必须看 OS/工具）。
> **先读** `../SKILL.md`（判定、共享硬约束、验证主线）。

---

## 0. Runbook（例行验证只读这一节）

```bash
# 1) 判定
adb devices -l
adb shell 'id; head -3 /etc/os-release; uname -a; cat /Configs/system_info/system_info.ini'

# 2) 假挂载（Launcher 写死的真实路径；普通目录即可，不占 USB、adb 不掉）
assets/t3linux-trigger.sh stage <包目录>
assets/t3linux-trigger.sh run

# 3) 复现 Launcher 的 bash + stdin 调用（不经过 UI）
assets/t3linux-trigger.sh stdin-run

# 4) 取证（reboot 前一次抓全）
assets/t3linux-trigger.sh evidence
assets/verify.sh --t3linux /data/cp-unattended/<pkg>.log

# 5) 收尾
assets/t3linux-trigger.sh cleanup
```

- 证据三件套：脚本日志 `/data/cp-unattended/<pkg>.log` + 落点 `md5sum`/`ls -l` + `date -r` + `/data/Log/log.log`（Launcher 的 qDebug）。
- **GUI 触发要人工**：设置 → U盘查看 → 右上角开关；真 U 盘要 Host 角色，可能掉 adb（见 `../SKILL.md` §7.3）。
- 例行验证不解包；读包内脚本用 `unzip -p pkg.zip '*/unattended_installation.sh'`。

### 0.1 启动时序（服务模式必读）

`inittab → /etc/init.d/rcS → /etc/autorun.sh → /etc/launch_qt.sh → /etc/init.d/runqt → /data/app.sh`

实测 SPRING2_L 的 `rcS` 顺序是：先 `/etc/autorun.sh &`，后 `mount -t ext4 /dev/mmcblk0p1 /data`。`/data` 尚未挂载时 `/data/app.sh` 不存在，服务模式应用会丢；即使抢到，CFT 也可能在 `can0`/`servicemanager` 未就绪时启动，在 `CanInit` 崩溃。

验证第一条命令：

```bash
adb shell 'cat /etc/inittab; cat /etc/fstab; grep -n -E "autorun|mount -t ext4 /dev/mmcblk0p1 /data" /etc/init.d/rcS; grep -E "mmcblk0p1| /data " /proc/mounts; ls -l /data/app.sh; ls /sys/class/net'
assets/t3linux-trigger.sh bootcheck
```

- 新包在 `runqt` 里等 `/data/app.sh`（最多 30 s）再启动，或把 `autorun` 移到 `mount /data` 之后；不要假定 `/data` 已挂。
- 老包出现「进程时有时无」先查这条顺序，不要先杀进程/重跑应用。
- CFT 需要 `can0`；本机没有 `can0` 时启动即 `SIGSEGV`，应记「环境不满足/需目标机复测」，不是反复跑二进制。

---

## 1. 判定与触发链

先看系统，再看桌面：

```bash
adb shell 'head -3 /etc/os-release; uname -m; uname -r'          # Buildroot 2016.11 / armv7l / 3.10.65
adb shell 'ls -l /Launcher; pidof Launcher; ls -l /mdm/MDM'      # 桌面、MDM 在跑
adb shell 'getprop ro.board.platform'                            # 报 command not found ⇒ 不是安卓（正常）
```

- 没有 `getprop`/`pm`/`am`/`logcat`；不要用安卓命令判平台。
- `/` 是 ext4 rw（`/dev/mmcblk0p7`），`/data` 是 ext4 rw（`/dev/mmcblk0p1`），`/tmp`、`/run` 是 tmpfs。

触发链（二进制反查 + 现场路径）：

1. Launcher → 设置 → `U盘查看`（`Setting/UI/udisk_setting.cpp`）。
2. 点右上角开关：`UDiskSetting::start_unattended_installation()` 起 `QProcess("bash")`，把 `"./" + 脚本路径 + "\n"` 写进 bash 的 **stdin**；Launcher 的 cwd 是 `/`。
3. 脚本路径写死：`/mnt/usb/sda1/unattended_installation.sh`。
4. 脚本执行完 bash 收不到 EOF（Launcher 未 closeWriteChannel），进程停在 stdin 上；旧包都在末尾 `reboot` 收尾。⇒ 出包默认 `DO_REBOOT=1`，调试才 `NO_REBOOT=1`。

挂载（mdev，不是 udev）：

- `mdev.conf` 对 `sd[a-z]([0-9])?` 调 `/etc/mdev/udisk_insert` → `mkdir -p /mnt/usb/$MDEV` → `/etc/mdev/do_mount`（vfat → ntfs-3g → exfat → 原样 mount）。
- 所以 **U 盘要有分区**：`sda1` → `/mnt/usb/sda1`；整盘无分区（`sda`）挂到 `/mnt/usb/sda`，Launcher 看不到。
- `/etc/udev/rules.d/auto_usb.rules` 里另有把整盘挂 `/mnt/usb/sda4` 的旧规则，**不是** Launcher 用的路径，别据此判断。
- 拔盘：`/etc/mdev/udisk_remove` 卸载并删目录。

---

## 2. 包结构

```text
<pkg>.zip（平铺）/
├── unattended_installation.sh        # 必须有；文件名/路径写死，不能改
├── data.tar.gz                       # 应用载荷（可能实际是未压缩 tar）
├── logo                              # 开机 LOGO / 动画首帧（5 MB raw）
├── bootlogo.bmp                      # boot-resource 分区的开机图
├── CPVideoPlayDemo / video_demo.yuv  # 开机动画播放器 + 视频
├── rcS / runqt / qt5.9.sh            # 定制启动脚本
└── touchscreen.rules                 # 触摸校准
```

- **平铺到 U 盘根**：`/mnt/usb/sda1/unattended_installation.sh`；套一层目录 = 点开关没反应。
- 现网示例 `lovol_install_服务模式(JK01101020000a)_20250423.zip` 里套了一层同名目录；现场要么解压后把目录内容拷到盘根，要么重新按平铺打包。
- 示例 zip 内 `unattended_installation.sh` 是 `0664`，不是 `0755`；`unzip -Z -l` 先看模式。验证时**先记“结构不通过”**，再假挂载测扁平后的载荷，报告分两行写，别用载荷通过掩盖原包不能直接用。
- 没有 xml、没有动作表、没有 APK 安装器；安装顺序就是脚本里的 `cp`/`tar`/`mount` 顺序。

---

## 3. 落点（写前先备份）

| 落点 | 内容 | 说明 |
|---|---|---|
| `/logo` | raw LOGO（bgra） | 直接覆盖；root、644。**帧数看原机**：SPRING2_L 是 2 帧 4,915,200 B（`--logo-frames 2`）；1 帧 2,457,600 B；1280x800 翻倍 |
| `/CPVideoPlayDemo` + `/video_demo.yuv` | 开机动画 | `rcS` 里 `FRAMEBUFFER=/dev/fb1 /CPVideoPlayDemo -t 9`；1024x600 234 帧 → 215,654,400 B；**yuv 不旋转** |
| `/Configs/bootlogo.bmp` | 开机图 | 与 boot-resource 分区里的同名文件一起换 |
| `/dev/mmcblk0p2` → `/mnt/bootlogo.bmp` | boot-resource（vfat） | `mount -rw -t vfat /dev/mmcblk0p2 /mnt`，替换后 `sync` + `umount` |
| `/etc/init.d/rcS` | 启动主脚本 | 改错会起不来；先备份 |
| `/mdm/MDM` | MDM 二进制（ELF，root 755） | 进程在跑，**不能直接 `cp` 覆盖**（`Text file busy`）：`cp` 到 `/mdm/MDM.new` → `chmod 755` → `mv` 覆盖。素材 `vendor/MDM`（md5 见 `vendor/README.md`），包内根目录必须仍叫 `MDM` |
| `/etc/init.d/runqt` | 桌面启动 | 内部 `/data/app.sh &` |
| `/qt5.9.sh` | Qt 运行环境 | 触摸/eglfs 参数 |
| `/etc/udev/rules.d/touchscreen.rules` | 触摸校准 | libinput 矩阵，rotate 180 |
| `/data/app.sh` + 应用载荷 | 客户应用 | 常见做法：`tar xf data.tar.gz -C /data` |

- `/` 和 `/data` 都可写；boot-resource 只有 7 MB，写前确认镜像尺寸，别塞大文件。
- `/data/Log/log.log` 是 Launcher 的 qDebug 日志，GUI 触发痕迹在这里看。
- **服务模式进程**：`runqt` 被改成 `/data/app.sh` 时，`JobMonitor.out`、`CFT.out`、`VariableMonitor` 是常用三件套；CFT 依赖 `can0`，其余依赖 `/data` 已挂载和 `servicemanager`。`/data/app.sh` 必须等 `/data` 挂好再启动。

### 3.1 LOGO / 动画

生成命令与方向（`--rotate` / yuv）统一见 `../SKILL.md` §8.4，这里不重复。

- T3 Linux 正包必须带 `video_demo.yuv`（除明确不换动画），否则留着旧 CPDEVICE 动画。

---

## 4. 脚本约束

| 项 | 要求 |
|---|---|
| 解释器 | `#!/bin/bash`；设备 bash 4.3（`/bin/sh` 也指向 bash），可用 `[[ ]]`/数组/`set -Eeuo pipefail` |
| 身份 / cwd | root；cwd 是 `/` |
| 执行位 | **必须有 `+x`**：Launcher 是「bash 从 stdin 读一行 `./<路径>`」再执行，`chmod -x` 会报 `Permission denied`；adb push/解压到 ext4 常是 644，交付前 `chmod 755`（vfat 默认 755） |
| 参数 | **没有 `$1`**（Launcher 从 stdin 喂路径）；`$0` 可能是 `.//mnt/usb/sda1/unattended_installation.sh`，用 `dirname "$0"` 兜底 |
| stdin | **不要读 stdin**（会消费 Launcher 的输入）；不要用没参数的 `cat`/`read` |
| 日志 | `/data/cp-unattended/<pkg>.log`（`/tmp` 是 tmpfs，重启即空）；stdout 只放给人看的行 |
| 工具 | busybox：`md5sum`/`tar`/`gzip`/`unzip`/`flock`/`setsid`/`sync` 都有；没有 `getprop`/`pm` |
| 压缩包 | 示例 `data.tar.gz` 实际是非压缩 tar（`tar tzf` 报 not in gzip）→ 一律 `tar xf` |
| 并发 | `flock -n /run/cp-unattended.lock` |
| 重启 | 默认 `DO_REBOOT=1`；`NO_REBOOT=1` 可跳过；重启前 `sync` |
| 挂载 | boot-resource 挂**独立目录**（如 `/mnt/bootresource`），不要挂 `/mnt`——会遮住 `/mnt/usb/sda1`，后续复制/判定全失败；写完 `sync` + `umount` |
| 换行 | 不能有 CRLF（bash 报 `$'\r': command not found`） |

---

## 5. 出包模板

主脚本用 `assets/t3linux-setup-template.sh`（改顶部 `PKG_ID`/`TARBALL`/`COPY_FILES`/`LOGO`/`BOOTLOGO`/`DO_REBOOT`）。

最小包：

```text
20261105-SPRING2_L-静默安装包_20261105/
├── unattended_installation.sh
└── data.tar.gz
```

骨架（完整版见模板）：

```bash
#!/bin/bash
set -Eeuo pipefail
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
PKG_ID=demo; DO_REBOOT=1
LOG=/data/cp-unattended/$PKG_ID.log
USB="${1:-/mnt/usb/sda1}"; [ -d "$USB" ] || USB="$(cd "$(dirname "$0")" && pwd)"
mkdir -p /data/cp-unattended
say() { printf '%s %s\n' "$(date '+%F %T')" "$*" | tee -a "$LOG"; }
exec 9>/run/cp-unattended.lock; flock -n 9 || exit 0
say "start, usb root: $USB"
# cp/tar/logo/bootlogo 见模板
say "done"
if [ "${NO_REBOOT:-0}" != 1 ] && [ "$DO_REBOOT" = 1 ]; then sync; reboot; fi
```

---

## 6. 验证（T3 Linux）

### 6.1 认设备 / 环境

```bash
adb devices -l && adb shell id
adb shell 'head -3 /etc/os-release; uname -a; cat /Configs/system_info/system_info.ini'
adb shell 'pidof Launcher; ps | grep -E "/Launcher|/mdm/MDM" | grep -v grep'
adb shell 'ls -l /etc/mdev/udisk_insert /etc/mdev/do_mount; ls -l /mnt/usb 2>/dev/null'
assets/t3linux-trigger.sh bootcheck    # 启动链、/data 挂载、app.sh、can0、进程、core
```

### 6.2 假挂载 + 脚本级（最快、adb 不掉）

```bash
assets/t3linux-trigger.sh stage ./<包目录>
assets/t3linux-trigger.sh run
# 等价手写：
# adb shell 'rm -rf /mnt/usb/sda1; mkdir -p /mnt/usb/sda1'
# adb push ./<包目录>/. /mnt/usb/sda1/
# adb shell 'bash /mnt/usb/sda1/unattended_installation.sh >/data/cp-unattended/manual.log 2>&1'
```

`/mnt/usb/sda1` 是 Launcher 写死的路径，普通目录即可；**不要**在真盘挂载时删它（`t3linux-trigger.sh` 会先查 `/proc/mounts`）。

### 6.3 复现 Launcher 调用（bash + stdin）

```bash
assets/t3linux-trigger.sh stdin-run
# 等价：adb shell 'printf "%s\n" /mnt/usb/sda1/unattended_installation.sh | bash >/data/cp-unattended/manual.log 2>&1'
```

- 这条能验证「脚本不读 stdin、能在 stdin 模式下跑完」；脚本必须可执行（`t3linux-trigger.sh` 会 `chmod 755`）。真 UI 还会多一个**不关闭 stdin** 的 bash，脚本返回后它仍停着——所以现场以 `reboot` 收尾。

### 6.4 GUI（人工，需要真 U 盘）

1. U 盘（FAT32，带分区）插 Host 口；确认 `mount | grep /mnt/usb/sda1`。
2. Launcher → 设置 → `U盘查看` → 右上角开关 → 静默安装。
3. 取证：`tail -50 /data/Log/log.log`、`cat /data/cp-unattended/<pkg>.log`。
4. 只有 OTG 口时切 Host 会掉 adb；按 `../SKILL.md` §7.3 处理，别判失败。

实测注意（普通目录 / loop 镜像模拟时）：

- 页面可能看不到假挂载，或点开关后**页面卡住、adb 掉线**（Launcher 会切 USB 角色；它的 bash 收不到 EOF）。这是**边界行为**，不是脚本执行成功的证据。
- 判脚本有没有跑只看 `/data/cp-unattended/<pkg>.log` 与落点 md5；没有日志就是没执行（常见原因：不是真盘、脚本没 `+x`、路径被卸载）。
- 没有真盘就把 GUI 标「未验证（缺真盘/人工点击）」，不要用脚本级结果冒充 GUI 通过。

### 6.5 核验与收尾

跑 `assets/verify.sh --t3linux /data/cp-unattended/<pkg>.log [文件...]`，或手工（通用行见 `../SKILL.md` §7.4）：

| 检查项 | 命令 | 通过判据 |
|---|---|---|
| 脚本执行 | `cat /data/cp-unattended/<pkg>.log` | 有 `start, usb root:`、无 skip、结尾 `done` |
| 落点 | `md5sum <文件>`、`ls -l` + `date -r` | 与包内一致，时间戳在本轮（设备没有 `--full-time`） |
| LOGO | `md5sum /logo` 或仅目视 | 与包内一致 / 画面正确 |
| bootlogo | 只读挂 `/dev/mmcblk0p2` 比 `bootlogo.bmp` | md5 一致（挂完记得 umount） |
| 启动依赖 | `grep -E "mmcblk0p1\| /data " /proc/mounts; ls -l /data/app.sh; ls /sys/class/net` | `/data` 已挂、`app.sh` 可执行；CFT 需要 `can0` |
| 桌面/服务 | 桌面包：`pidof Launcher`、`ps \| grep /mdm/MDM`；服务模式：`pidof JobMonitor.out CFT.out VariableMonitor` 或包内约定进程 | 进程在；服务模式不要求 Launcher/MDM 在 |
| 进程稳定性 | 0/15/60 s 各采样一次 `ps` + `/data/*.core` | 三轮都在；中途消失/新 core = 不通过 |
| 残留 | `ls /mnt/usb/sda1`、`ls /data/*.tar.gz` | 无假挂载/临时包 |

```bash
assets/t3linux-trigger.sh cleanup
adb shell 'rm -rf /mnt/usb/sda1; rm -f /data/cp-unattended/probe*'   # 客户包日志保留
```

截图（可选；设备没有 `screencap`）：`adb shell 'dd if=/dev/fb0 of=/data/fb.raw bs=4096 count=1200'`，拉回后**先看前 600 行，再看后 600 行**（双缓冲，当前帧不一定在后半；实测前半是 LOVOL 开机帧）。转换示例：`dd if=fb.raw of=fb2.raw bs=4096 count=600`，再 `ffmpeg -f rawvideo -pixel_format bgra -s 1024x600 -i fb2.raw -vf "hflip,vflip" -frames:v 1 shot.png`。SPRING2_L 是 1024x600/32bpp、屏旋转 180；其他机型先看 `/sys/class/graphics/fb0/virtual_size`。

> **eglfs/mali 警告**：服务模式/客户 Qt 应用走 `eglfs` 时，`/dev/fb0` 可能仍是开机帧或黑屏，抓屏**不能**作为 UI 成败证据；必须目视/拍照，否则标「未验证（需目视）」。

---

## 7. 坑表

| 现象 | 原因 | 处理 |
|---|---|---|
| 点开关没反应 | 盘根没有 `unattended_installation.sh`，或脚本在子目录 | 平铺到盘根；文件名不能改 |
| Launcher 看不到盘 | U 盘无分区（挂到 `/mnt/usb/sda`）；或被旧 udev 规则挂到 `/mnt/usb/sda4` | 用带分区的 FAT32 盘；以 `/mnt/usb/sda1` 为准 |
| 点开关报 `Permission denied` | 脚本没有执行位（adb push/解压成 644） | `chmod 755 unattended_installation.sh`；交付前检查 |
| 脚本不执行 / 报语法错 | CRLF、解释器不兼容 | 统一 `#!/bin/bash` + 去 CRLF；`bash -n` 自检 |
| 脚本卡住 / 行为怪异 | 脚本读了 stdin（Launcher 的输入） | 脚本内禁止无参 `read`/`cat` |
| 安装完 UI 一直停着 | Launcher 的 bash 收不到 EOF | 默认 `DO_REBOOT=1` 收尾；调试 `NO_REBOOT=1` 并在报告注明 |
| 点开关后页面卡住 + adb 掉线 | Launcher 切 USB 角色 + bash 不收 EOF | 属预期边界；要恢复 adb 就切回 DEVICE/重启，别判脚本失败 |
| 假挂载在「U盘查看」里看不到 | 页面只认真实挂载/真盘 | 用真盘验证 GUI；脚本级用 §6.2 假挂载 |
| 重启后 adb 不回来 | U 盘占 Host 角色 / 重启重新枚举（SKILL §7.3） | 超时仍不回线才提示切 DEVICE（不写报告）；`timeout 120 adb wait-for-device`；不判失败 |
| bootlogo 换了没生效 | 只改了 `/Configs`，没改 boot-resource 分区 | 两个都换：`/Configs/bootlogo.bmp` + `/dev/mmcblk0p2` 里的 `bootlogo.bmp` |
| logo 屏上颠倒/镜像 | 存储方向错（不是 180°） | 用生成器 `--rotate` 重出（SKILL §8.4） |
| 开机动画还是旧 CPDEVICE | 包里没带 `video_demo.yuv` | 生成器默认出；正包必须带，别只换静态图 |
| `/logo` 尺寸/帧数与原机不一致 | 原机 2 帧，脚本默认 1 帧 | `--logo-frames 2` 出双帧；禁止手工 `cat` 拼帧 |
| 复制失败 / 日志只有一句 `app目录不存在` | 前面的 `mount /dev/mmcblk0p2 /mnt` 把 `/mnt/usb/sda1` 遮住了 | 挂载点改独立目录 + `sync`/`umount`；复制失败先看 `/proc/mounts`（SKILL §7.8-13） |
| `tar: not in gzip format` | 名为 `.tar.gz` 的其实是未压缩 tar | 用 `tar xf`；交付前 `tar tf` 自检 |
| 日志重启后为空 | 写到 `/tmp`（tmpfs） | 一律 `/data/cp-unattended/` |
| 中文文件名乱码 | 打包/挂载编码 | UTF-8 打包；mdev 已带 `utf8=1`/`iocharset` |
| 时间对不上 | 无电池 RTC 从 1970 起 | 用 `uptime` 反推本轮窗口 |
| 读 `usbc0.2/usb_host` 后掉 adb | 疑似触发 USB 角色切换 | 需要 adb 时别读这个属性；先切回 DEVICE |
| 服务模式应用时有时无 / 启动失败 | `rcS` 先 `autorun` 后 `mount /data`，`runqt` 抢跑 | 查 `/proc/mounts` 与 `data/app.sh`；新包在 `runqt` 等 `/data/app.sh` 或调整顺序 |
| `CFT.out` 启动即 `SIGSEGV`（`CanInit`） | 无 `can0` 或 CAN 未就绪 | 先 `ls /sys/class/net`；无 `can0` 记环境不满足，有 `can0` 再查二进制，不反复跑 |
| 服务模式包 Launcher/MDM 不在 | `runqt` 改成 `/data/app.sh`，桌面被替换 | 按包设计判约定进程，不套桌面包判据 |
| `/dev/fb0` 一直是 LOVOL/黑屏 | eglfs/mali 不经 fb0 呈现 | 目视/拍照；不要用 fb0 判 UI 失败 |
| 换 MDM 报 `Text file busy` / 换完 MDM 没起 | 直接 `cp` 覆盖正在运行的 `/mdm/MDM` | 走 `cp`→`MDM.new`、`chmod 755`、`mv` 覆盖；备旧文件到 `/data/cp-unattended/` 便于回滚 |
| 验证中杀进程后状态更乱 | 验证越界成排障 | 只读采样；确需重拉先征得同意，结束后重启恢复 |

---

## 8. 参考

- 示例包：`~/customizationData/archive/雷沃/lovol_install_服务模式(JK01101020000a)_20250423.zip`（`unattended_installation.sh` + `data.tar.gz` + logo/bootlogo/动画/rcS/runqt/qt5.9/touchscreen.rules，末尾 `reboot`，无日志、无 md5）。
- 示例里的 `data.tar.gz` 实际是未压缩 tar（首字节 `./`；`tar tzf` 报 not in gzip，`tar tvf` 可读），脚本里 `cp` 到 `/data` 后 `tar xvf`。
- 现成素材：`vendor/MDM`（T3 Buildroot 的 `/mdm/MDM`，md5 与替换写法见 `vendor/README.md`）；`vendor/fw_cyw43438.bin` + `nvram_cyw43438.txt`（只用于**安卓** T3 的 WiFi，Buildroot 侧不要套）。
- 平台差异与 OTG 处置：`../SKILL.md` §5.2、§7.3；T3 安卓见 `t3-android.md`；RK Debian 见 `rk-debian.md`。
