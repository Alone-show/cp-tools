# RK Debian：U 盘静默安装（自动 udev / 手动 GUI）

> **适用**：Rockchip RK356x / RK3588 的 Debian 11（bullseye，`/etc/os-release` 可查）。
> **实测机**：`SPRING2-PRO` / `CPdevice Spring2 Mix Board` / Debian 11 / kernel `5.10.160` aarch64 / adb root。
> **工具**：`unattendedinstallationtools` 1.0.4（`dpkg -l` 可查）；同一个包里装了两套安装方式，启动脚本名不同，见 §1。
> **依据**：设备上 `dpkg -L unattendedinstallationtools`、两个 Qt 工具的反查（`silentInstaller`、`Unattended_Installation_Tools`）、雷沃现网包（手动方式）与 `debian_auto_openssh_drop.zip`（自动方式）。
> **先读** `../SKILL.md`（判定、共享硬约束、验证主线）；RK 安卓用 `rk-android.md`，T3 安卓用 `t3-android.md`，T3 Linux（Buildroot）用 `t3-linux.md`（同名 `unattended_installation.sh`，判定看 OS/工具）。

---

## 目录

- [0. Runbook（例行验证只读这一节；细节在 §1 之后）](#0-runbook例行验证只读这一节细节在-1-之后)
- [1. 判定与两种安装方式](#1-判定与两种安装方式)
- [2. 包结构与两种方式](#2-包结构与两种方式)
- [3. `silentInstaller` 的 UI 协议](#3-silentinstaller-的-ui-协议)
- [4. 脚本约束（Debian 与安卓完全不同）](#4-脚本约束debian-与安卓完全不同)
- [5. 落点与系统操作](#5-落点与系统操作)
- [6. 出包模板](#6-出包模板)
- [7. 验证命令（Debian）](#7-验证命令debian)
- [8. 坑表](#8-坑表)
- [9. 参考](#9-参考)

## 0. Runbook（例行验证只读这一节；细节在 §1 之后）

```bash
# 1) 判定：盘根 unattended_installation.sh + customization.tar ⇒ 手动方式
adb shell 'head -3 /etc/os-release; ls -l /mnt/installUsb/unattended_installation.sh'

# 2) 备份（装之前；回滚靠它）
adb shell 'mkdir -p /userdata/verify_bak; cp /etc/lightdm/lightdm.conf /etc/rsyslog.conf /userdata/verify_bak/;
           dpkg --get-selections > /userdata/verify_bak/dpkg.selections;
           dd if=/dev/block/by-name/logo of=/userdata/verify_bak/logo.part bs=1M'

# 3) 一条命令跑（日志落 /var/log，绝不落 /tmp；包自带 reboot 时 rc 不可信）
assets/debian-trigger.sh manual <包目录>
# 等价手写：adb shell 'sh /mnt/installUsb/unattended_installation.sh /mnt/installUsb >/var/log/lw_install.log 2>&1'

# 4) 取证（reboot 前一次抓全；重启后 uptime 归零再抓后态）
assets/debian-trigger.sh evidence
assets/verify.sh --debian /var/log/lw_install.log <pkg…>

# 5) 收尾
assets/debian-trigger.sh cleanup
adb shell 'rm -rf /customization /customization.tar /usr/local/share/verify-demo'
```

- 证据三件套：`/var/log/lw_install.log`（本次 stdout）+ `/var/log/dpkg.log` + `/var/log/apt/history.log`。
- 四个落点：镜像/分区 hash、文件 md5、服务状态、进程。
- 例行验证**不解包**；要读包内脚本用 `tar -xOf customization.tar customization/Installer.sh`。

---

## 1. 判定与两种安装方式

两种方式，**触发方式不同、启动脚本名也不同**：

| 方式 | 触发 | 启动脚本（工具写死） | 挂载点 | UI / 输出 |
|---|---|---|---|---|
| 自动（udev） | 插盘，udev 规则拉起 `auto_unattended_installation@<dev>` | `auto_unattended_installation/auto_unattended_installation.sh` | `/media/usb_disk` | `silentInstaller`「静默配置工具」，`:uisum` 进摘要 |
| 手动（GUI） | 打开 `Unattended_Installation_Tools`、点 `Open` 切 host，再插盘 | 盘根 `unattended_installation.sh` | `/mnt/installUsb` | 工具窗口文本框（普通 stdout） |

同一块 RK 板子既可能跑安卓（见 `rk-android.md`）也可能跑 Debian，**先看 OS 再看工具**：

```bash
adb shell 'cat /etc/os-release | head -3; uname -m; uname -r'          # Debian 11 / aarch64
adb shell 'dpkg -l unattendedinstallationtools 2>/dev/null | tail -1'  # 1.0.4
adb shell 'ls -l /usr/bin/silentInstaller /etc/udev/rules.d/10-auto_unattended_installation.rules'
adb shell 'getprop ro.board.platform; pm path com.cpdevice.cpservice'  # Debian 上是 shim/无输出，不能当安卓证据
```

1.0.4 的包内文件（判定就靠这几个）：

```text
/etc/udev/rules.d/10-auto_unattended_installation.rules
/usr/bin/{Unattended_Installation_Tools,auto_unattended_installation.sh,auto_unattended_installation_mount,silentInstaller,unattended_installation,unattended_installation.sh}
/usr/lib/systemd/system/auto_unattended_{installation,uninstallation}@.service
/usr/share/applications/unattendedinstallationtools.desktop
```

先分清名字——**包名不是进程名**，两套方式各有自己的进程/脚本：

| 名字 | 是什么 | 谁在跑 |
|---|---|---|
| `unattendedinstallationtools` | deb 包名 | 不是进程 |
| `Unattended_Installation_Tools` | 手动方式 Qt GUI（root） | PID 4198 那条（`sudo …`） |
| `unattended_installation` | 手动方式守护进程 | 扫 `/dev`、挂 `/mnt/installUsb`、执行 `sh … $1` |
| `auto_unattended_installation@<dev>.service` | 自动方式的 systemd 实例 | 只在插盘时出现，非常驻 |
| `auto_unattended_installation_mount` | bash 脚本 | 挂 `/media/usb_disk` |
| `auto_unattended_installation.sh` | bash 包装脚本 | 拷到 `/run`、拉起 `silentInstaller` |
| `silentInstaller` | 自动方式 Qt UI | 执行 `/run/auto_unattended_installation.sh` |

两种方式互相独立：手动方式看工具窗口和 `/mnt/installUsb`，自动方式看 `silentInstaller` 和 `/media/usb_disk`；一条方式的启动脚本不会自动被另一条执行。

### 1.1 自动方式（udev，插盘即跑）

```text
sd[a-z]* add → systemctl restart auto_unattended_installation@%k.service
  → /usr/bin/auto_unattended_installation_mount  挂到 /media/usb_disk（uid/gid=linaro，iocharset=utf8）
  → /usr/bin/auto_unattended_installation.sh
       · cp -r /media/usb_disk/auto_unattended_installation/* → /run/temp_copy → mv 到 /run/
       · U 盘根有 eeprom_config.json 且目录里没有 → 也拷到 /run/
       · cp /usr/bin/silentInstaller → /run/（U 盘根有同名文件时用 U 盘的，危险，见 §8）
       · 只有 /run/auto_unattended_installation.sh 或 /run/eeprom_config.json 存在才启动
  → /run/silentInstaller（Qt「静默配置工具」，appDir=/run）
       · 有 /run/eeprom_config.json 先配 EEPROM（有超时），否则「eeprom 无需配置」
       · /bin/bash /run/auto_unattended_installation.sh   ← 真正干活的是这个
```

- 挂载点是 **`/media/usb_disk`**（脚本里写死），`/run` 是 **391 MB tmpfs**，载荷会整体复制进去。
- remove 事件会跑 `auto_unattended_uninstallation@`（同一个 mount 脚本）→ 卸载并删掉 `/media/usb_disk`。
- 包装脚本只记自己的日志：`/run/auto_unattended_installation.log`；`silentInstaller` 的界面输出没有落盘。

### 1.2 手动方式（GUI 点击触发）

```text
/usr/bin/unattended_installation.sh → sudo Unattended_Installation_Tools（Qt，root）
  → 守护进程 /usr/bin/unattended_installation（root，随 GUI 常驻）
  → 点 Open 切 host、插盘 → 守护进程发现块设备 → mount 到 /mnt/installUsb
  → system("sh /mnt/installUsb/unattended_installation.sh /mnt/installUsb")
       · 脚本 stdout 进 GUI 文本框（不是 :uisum 协议）
```

- **工具没开就不触发**：这不是系统级 udev，`Unattended_Installation_Tools` 打开（桌面图标或 `/usr/bin/unattended_installation.sh`）才会拉起守护进程。实测杀掉 GUI/守护进程后，新出现 `/dev/sdz3` 8 s 内无任何动作；重新点开 GUI，守护进程立即处理已有/新插入的分区。
- 守护进程只扫 `/dev/sd*` 且名字长度 > 3（**分区**，如 `sda1`；整盘 `sda` 不处理）→ 挂载 `/mnt/installUsb` → `system("sh /mnt/installUsb/unattended_installation.sh /mnt/installUsb")` → **脚本返回后立即卸载**。脚本必须在运行期间完成读写/拷贝，不能指望盘一直挂着。
- 实测手动链**只认盘根 `unattended_installation.sh`**：盘根只放 `auto_unattended_installation.sh` 时不会执行。
- 现场说的「Unattended_Installation 4198 进程」就是 `sudo Unattended_Installation_Tools` 这条 GUI；真正扫盘/挂载/执行上面命令的是它的子进程 `/usr/bin/unattended_installation`（root，随 GUI 常驻）。
- 工具窗口的 `Open` / `Close` 按钮写 `/sys/devices/platform/fe8a0000.usb2-phy/otg_mode`（`host` / `otg`），GUI 启动时默认写 `otg`——只有 OTG 口时**不切 host，U 盘不枚举**；有独立 Host 口就插 Host 口。切 host 掉 adb 见 SKILL §7.3。
- 脚本 stdout 会进 GUI 文本框（实测 `STDOUT-LINE:/mnt/installUsb`），但没有落盘；要留证据自己写日志。
- 老固件/老包的盘根可能是 `/mnt/usb/sda1`（雷沃服务模式包就是这么写死的），脚本要兜底扫描。

---

## 2. 包结构与两种方式

```text
<zip 根，平铺>/
├── auto_unattended_installation/            # 自动方式
│   ├── auto_unattended_installation.sh      # 启动脚本：bash + :uisum
│   └── <小载荷>                              # 会整体进 /run，别超过 ~200 MB
└── unattended_installation.sh               # 手动方式；双入口时 exec 到主脚本
```

- **自动方式**：只放 `auto_unattended_installation/`。目录名和启动脚本名被工具写死，不能改；插盘即跑。
- **手动方式**：只放盘根 `unattended_installation.sh`。启动脚本名被工具写死，必须能被 `sh`（dash）执行，`$1` 是盘根；先点开 GUI（守护进程随 GUI 启动），之后插盘触发，工具没开时插盘无反应（实测）。
- **双入口**（两种都要时）：根 `unattended_installation.sh` 只做 `exec /bin/bash "$USB/auto_unattended_installation/auto_unattended_installation.sh" "$USB"`，载荷只放一份。两种方式可能同时被触发（工具守护进程 + udev），主脚本必须 `flock`，第二个进程直接 `exit 0`。

**载荷位置**：

- 小文件放 `auto_unattended_installation/`（自动方式会复制到 `/run`，脚本目录就是 `/run`）。
- 大文件（tar、镜像、几十 MB 的 deb）放 U 盘根，脚本运行时从 `/media/usb_disk`（自动）或 `$1`（手动）读，避免撑爆 `/run`。

---

## 3. `silentInstaller` 的 UI 协议

- 脚本 stdout 每一行：以 **`:uisum`** 开头的，去掉前 6 个字符、trim 后进窗口上方摘要区；其余行进下方日志区。
- 脚本结束时工具自己打印 `:uisum已经完成工作,退出码:N`；**N 就是脚本退出码**，失败要 `exit 1`（`set -e` + `trap` 报错）。
- 窗口按钮：`重启`（`QProcess::startDetached("reboot")`）/`取消`。**脚本默认不要自己 reboot**，交给这个按钮；确实要自动重启，见 §5 的标记文件。
- EEPROM：U 盘根或 `auto_unattended_installation/` 里出现 `eeprom_config.json` 会先走 EEPROM 配置（等 `/run/eeprom_config_done`、`/run/eeprom_config_result`，有超时），配完才跑脚本。不配 EEPROM 的包**不要**带这个文件。
- 常见报错文案：`脚本文件不存在: …`（`/run/auto_unattended_installation.sh` 不在）、`启动失败,权限不足或文件不存在`、`脚本崩溃`、`错误输出: …`。

---

## 4. 脚本约束（Debian 与安卓完全不同）

| 项 | 自动方式启动脚本 | 手动方式启动脚本 |
|---|---|---|
| 解释器 | `/bin/bash`（5.x，可用 `[[ ]]`、数组、`set -Eeuo pipefail`） | `sh`（dash，POSIX only） |
| 运行身份 | root（systemd） | root（GUI 是 `sudo` 起来的） |
| 工作目录 | `/`（不要依赖 cwd） | `/`（同上） |
| 盘根 | `/media/usb_disk` | `$1`（通常是 `/mnt/installUsb`） |
| 输出 | `:uisum…` 进摘要，其余进日志区 | 纯文本进 GUI 文本框 |

- **PATH**：systemd 环境很干净，脚本里显式 `PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`。
- **日志**：自己双写 `/var/log/cp-unattended/<pkg>.log`（root 可写、重启不丢），stdout 只放给人看的行。
- **幂等**：`dpkg -i`、`cp` 都可重复；需要「只跑一次」用 `/var/lib/cp-unattended/<pkg>.done` 标记（重启后仍在）。
- **并发**：udev 可能对 `sda`、`sda1` 各触发一次，双入口还会叠加守护进程；`flock -n /run/cp-unattended.lock`。
- **手动方式返回即卸载**：守护进程在脚本退出后立刻卸载 `/mnt/installUsb`（实测），需要保留的文件必须在脚本内拷走。
- **不要 sudo**（已经是 root）；不要 CRLF（`\r` 会让 bash 报 `command not found`）。
- 写 `/home/linaro` 下的文件要 `chown 1000:1000`；写 `/etc`、`/usr` 前先备份原文件。

---

## 5. 落点与系统操作

- 根分区 `/`（`/dev/mmcblk0p8`）是 **ext4 rw**：`dpkg -i`、`systemctl`、改 `/etc` 都可以，但改完要可回滚（备份 + 幂等）。
- `/oem` 是 ro squashfs，不要往里写；`/userdata` 是独立数据分区。
- 分区符号链接齐全：`/dev/block/by-name/{uboot,misc,boot,recovery,logo,backup,userdata,rootfs}`；换开机 LOGO 走 `dd if=logo.img of=/dev/block/by-name/logo`（和 RK 安卓的 `logo` 动作不是一回事）；`logo.img` 用 `assets/generate-bootlogo.sh --chip RK --system Linux` 生成（`../SKILL.md` §8.4）。
- 装 deb：先 `dpkg -i --force-overwrite <deb>`；依赖不全时 `apt -f install -y`（离线现场慎用，可能没源）。
- 起服务：`systemctl daemon-reload` → `systemctl enable/restart <unit>`；桌面自启走 `/etc/xdg/autostart` 或 lightdm/xfce 配置，改前备份。
- 需要重启：优先交给 `silentInstaller` 的「重启」按钮；脚本自动重启必须配 `/var/lib/cp-unattended/<pkg>.done` 标记，否则盘不拔会每次 udev 再跑（重启循环）。

---

## 6. 出包模板

主脚本用 `assets/debian-setup-template.sh`（改顶部 `PKG_ID`/`DEB_LIST`/`COPY_FILES`/`COPY_DIRS`/`DO_REBOOT`），手动入口用 `assets/debian-entry-template.sh`。

最小 udev 包：

```text
20261105-<机型>-静默安装包_20261105/
├── auto_unattended_installation/
│   ├── auto_unattended_installation.sh
│   └── app_1.0.0_arm64.deb
└── unattended_installation.sh        # 双入口时加
```

主脚本骨架（完整版见模板）：

```bash
#!/bin/bash
set -Eeuo pipefail
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
PKG_ID=demo; DEB_LIST="app_1.0.0_arm64.deb"; COPY_FILES=""; DO_REBOOT=0
LOG=/var/log/cp-unattended/$PKG_ID.log
ui() { printf ':uisum%s\n' "$*"; printf '%s %s\n' "$(date '+%F %T')" "$*" >>"$LOG"; }
say() { printf '%s %s\n' "$(date '+%F %T')" "$*" >>"$LOG"; }
exec 9>/run/cp-unattended.lock; flock -n 9 || exit 0
ui "开始静默安装 $PKG_ID"
# install_deb / copy_file / copy_dir 见模板
ui "成功"
```

---

## 7. 验证命令（Debian）

### 7.1 认设备 / 两种方式

```bash
adb devices -l && adb shell id
adb shell 'cat /etc/os-release | head -3; dpkg -l unattendedinstallationtools | tail -1'
adb shell 'ls -l /usr/bin/silentInstaller /usr/bin/auto_unattended_installation.sh /etc/udev/rules.d/10-auto_unattended_installation.rules'
adb shell 'cat /sys/devices/platform/fe8a0000.usb2-phy/otg_mode; systemctl cat auto_unattended_installation@.service | head -8'
adb shell 'ps -ef | grep -E "unattended|silentInstaller" | grep -v grep'      # 工具窗口/守护进程在不在
```

### 7.2 脚本级（不经过 UI，最快）

```bash
adb shell 'mkdir -p /usr/local/share/verify-demo'; adb push ./<包目录>/. /usr/local/share/verify-demo/
adb shell 'bash /usr/local/share/verify-demo/auto_unattended_installation/auto_unattended_installation.sh >/var/log/lw_install.log 2>&1; echo rc=$?'
adb shell 'cat /var/log/lw_install.log; cat /var/log/cp-unattended/<pkg>.log'
```

证据落 `/var/log/`（或 `/userdata/`）：**`/tmp` 开机被 bootclean 清空**，写 `/tmp` 重启后只剩空文件。

### 7.3 自动方式（模拟挂载，推荐；adb 不掉）

包装脚本只认路径、不查挂载表，`/media/usb_disk` 用普通目录即可：

```bash
adb shell 'pkill -x silentInstaller; rm -rf /media/usb_disk; mkdir -p /media/usb_disk'
adb push ./<包目录>/. /media/usb_disk/
adb shell 'DISPLAY=:0 setsid -f /usr/bin/auto_unattended_installation.sh </dev/null >/var/log/auto_unattended_wrapper.log 2>&1'
sleep 3
adb shell 'ls -l /run/auto_unattended_installation.sh /run/silentInstaller; ps -ef | grep -E "silentInstaller|auto_unattended_installation" | grep -v grep'
adb shell 'cat /run/auto_unattended_installation.log; cat /var/log/cp-unattended/<pkg>.log'
adb shell 'DISPLAY=:0 ffmpeg -loglevel error -f x11grab -video_size 1024x600 -i :0.0 -frames:v 1 -update 1 -y /var/log/gui.png'
adb pull /var/log/gui.png ./evidence/
adb shell 'pkill -x silentInstaller'
```

- 期望：`/run/auto_unattended_installation.sh` 存在，进程里有 `/bin/bash /run/auto_unattended_installation.sh`，UI 摘要区有 `:uisum…`，结束显示退出码 0。
- 包装脚本在**前台**跑 silentInstaller，会一直挂着等你关窗口：用 `setsid -f` 脱离 adb 会话（`nohup … &` 会随 adb shell 退出被杀），验完 `pkill -x silentInstaller`。

### 7.4 手动方式（守护进程；没真盘也能 adb-only 验）

一条命令跑（= 守护进程实际执行的那条）：

```bash
assets/debian-trigger.sh manual <包目录>
```

等价手写（日志落 `/var/log`，不落 `/tmp`）：

```bash
adb shell 'rm -rf /mnt/installUsb; mkdir -p /mnt/installUsb'
adb push ./<包目录>/. /mnt/installUsb/
adb shell 'sh /mnt/installUsb/unattended_installation.sh /mnt/installUsb >/var/log/lw_install.log 2>&1; echo rc=$?'
```

- **包末尾自带 `reboot` 时，`adb shell` 会被重启打断、以 `rc=0` 提前返回**，stdout 也可能断在这里：别判失败，也别重跑整包，成败按 §7.4.1 判。
- 脚本返回后守护进程立即卸载 `/mnt/installUsb`，证据必须在返回前抓完。

### 7.4.1 reboot 前一次抓全 + 老包没有日志怎么判

一条 shell 抓全（`assets/debian-trigger.sh evidence` 就是这套）：

```bash
adb shell 'echo "== 本次装了啥（dpkg）=="; grep -E "install |upgrade |remove " /var/log/dpkg.log | tail -20
echo "== apt 事务 =="; tail -20 /var/log/apt/history.log
echo "== 落点 =="; md5sum /etc/lightdm/lightdm.conf /dev/block/by-name/logo 2>/dev/null; ls -l --full-time /usr/local/share/cpseq /usr/local/bin/cpfeh 2>/dev/null | head
echo "== 服务 =="; systemctl is-enabled cpwelcome lovolrun 2>/dev/null; systemctl is-active lovolrun 2>/dev/null
echo "== 残留/容量 =="; du -sh /customization /customization.tar 2>/dev/null; df -h / | tail -1'
```

- **老包（雷沃这种）不写 `/var/log/cp-unattended/`**：`verify.sh --debian` 会自动降级到 `dpkg.log` + `apt history.log` 段；不要因为没有脚本日志就重装一遍。
- **看 `apt history.log` 判断 deb 包组是否被整组拒绝**：只有 `apt remove …` 一条、没有 install 记录，且 `dpkg -l` 版本没变 ⇒ `apt install -y …` 遇降级被拒（`E: Packages were downgraded and -y was used without --allow-downgrades`），包里的 deb 一个都没装。
- 分区/镜像类证据比对**前 N 字节**：`dd if=/dev/block/by-name/logo bs=1M | head -c <size> | md5sum`，不要整分区 md5（分区比镜像大）。

没真盘时用 loop 镜像 + `mknod` 模拟 sd 分区，让守护进程真跑（实测 1 s 内响应）：

```bash
adb shell 'dd if=/dev/zero of=/tmp/manual.img bs=1M count=8; mkfs.vfat /tmp/manual.img
LOOP=$(losetup -f); echo "LOOP=$LOOP"; mkdir -p /tmp/mm; losetup "$LOOP" /tmp/manual.img
mount "$LOOP" /tmp/mm; # 把盘根 unattended_installation.sh 写进 /tmp/mm
sync; umount /tmp/mm; mknod /dev/sdz1 b 7 "${LOOP##*loop}"'   # major 7=loop，minor 是 loop 编号
# 观察：/mnt/installUsb 挂载、脚本 stdout 进 GUI、返回后自动卸载
adb shell 'rm -f /dev/sdz1; losetup -d "$LOOP"; rm -rf /tmp/manual.img /tmp/mm'
```

- 守护进程只认 `sd*` 且名字长度 > 3 的分区（`sdz1` 可以，`sdz` 不行）；`mknod` 节点没有内核/udev 事件，所以只验手动链，不会误触自动链。
- 负向确认：盘根只放 `auto_unattended_installation.sh` → 不执行；杀掉 GUI/守护进程后新建分区 → 无动作（工具没开不触发）。

### 7.4.2 服务可用性三判据（必查；`is-active` 一刀切会误杀）

单位来源：`AVAIL_UNITS` 显式传，或从 deb 反推——

```bash
adb shell 'dpkg -L <pkg> | grep -E "/usr/lib/systemd/system/.*[.]service$"'
```

逐条查（本机实测输出示例在括号里）：

```bash
adb shell 'systemctl show -p UnitFileState,ActiveState,SubState,Result,ExecMainStatus,NRestarts <unit>'
adb shell 'journalctl -u <unit> -b --no-pager -n 5'
```

| unit 类型 | 通过判据 | 实测反例（别误判） |
|---|---|---|
| 常驻（`Type=simple` 长期跑） | `ActiveState=active`；`NRestarts` 不持续增长 | — |
| oneshot / 播完就退（如 `cpwelcome`） | `UnitFileState=enabled` + `Result=success` + `ExecMainStatus=0` | `inactive/dead` 是**正常**的，别判失败 |
| 被别的单元拉起（如 `lovolrun` 由 `cpfeh` 的 `systemctl start`） | `ActiveState=active` 即可 | `UnitFileState=disabled` 是**正常**的，别判失败 |
| 重启后 | `uptime` 归零后再查一遍，仍满足上表，且 `NRestarts` 没有因 crash loop 暴涨 | 只看重启前会漏掉自启失败 |

- 证据里要写清"谁拉起的"：`journalctl -u <unit>` 里那条 `sudo … systemctl start <unit>` 就是。
- 服务起不来（`Result=exit-code` / `failed` / `NRestarts` 持续涨）⇒ 报告「可用性」一行判 ❌，别用"已安装"糊过去。

### 7.5 真盘（可选，需要人配合）

- 盘插**独立 Host 口**：`journalctl -f | grep -E "auto_unattended|usb_disk|silentInstaller"`，`ls /media/usb_disk`。
- 只有 OTG 口：点工具窗口 `Open` 切 host（adb 会掉），照 SKILL §7.3 让用户确认切回，别把 adb 掉线判成失败。

### 7.6 收尾

```bash
adb shell 'pkill -x silentInstaller; rm -rf /media/usb_disk /mnt/installUsb /run/auto_unattended_installation.sh /run/silentInstaller /run/temp_copy'
adb shell 'rm -rf /var/lib/cp-unattended /usr/local/share/verify-demo; rm -f /run/auto_unattended_installation.log'
```

`/media/usb_disk` 不清，下次模拟会读到旧包；`/run/auto_unattended_installation.sh` 不清，包装脚本会拿旧脚本再跑一遍。

---

## 8. 坑表

| 现象 | 原因 | 处理 |
|---|---|---|
| 插盘毫无反应 | `otg_mode=otg`（U 盘没枚举）；或插在 OTG 口 | 工具窗口点 `Open`，或插独立 Host 口 |
| 盘挂上了但没 UI | U 盘根没有 `auto_unattended_installation/`，或目录里没有 `auto_unattended_installation.sh` | 目录/文件名写死，逐字核对 |
| UI 报「脚本文件不存在」 | `/run/auto_unattended_installation.sh` 不在；或重复运行时目录被 `mv` 嵌套成 `/run/auto_unattended_installation/auto_unattended_installation/` | 重启后再试；载荷保持扁平，别在目录里嵌套子目录 |
| 手动方式插盘没反应 | GUI/守护进程没开（手动方式没有系统级 udev，实测无 GUI 时新分区 8 s 无动作） | 先点开 `Unattended_Installation_Tools`；`ps` 看 `/usr/bin/unattended_installation` |
| 盘根文件名放错 | 两种方式**互不认**启动脚本（手动只跑 `unattended_installation.sh`，自动只跑 `auto_unattended_installation/…`） | 按方式放对应名字；实测反例都不执行 |
| 整盘节点 `sda` 不触发 | 守护进程只认 `sd*` 且长度 > 3 的分区 | 用带分区的盘（出现 `sda1`）或按 §7.4 模拟 |
| 手动脚本想「跑完再看盘」 | 脚本返回后守护进程立即卸载 `/mnt/installUsb` | 在脚本运行期间拷走/处理完 |
| 每次插盘都重装 | udev 对 `sda`、`sda1` 各触发一次；双入口还会叠加守护进程 | `flock` + 幂等 |
| 装完自动重启，然后无限重启 | 脚本末尾 `reboot` + 盘没拔，udev 再触发 | 默认不重启；必须重启就写 `/var/lib/cp-unattended/<pkg>.done` |
| 大包复制失败 / `/run` 满 | `/run` 只有 391 MB，载荷整体复制 | 大载荷放 U 盘根，运行时读 |
| 重启后取证只有空文件 | 日志/截图写到了 `/tmp`，开机 bootclean 清空 | 一律落 `/var/log/`、`/userdata/`、`/usr/local/share/` |
| `systemctl show/status`、`journalctl` 卡住 60 s+ | adb 给了 pty，systemd 进了 pager | 加 `--no-pager` 或 `\| cat`，或 `SYSTEMD_PAGER=cat` |
| 包自带 reboot，`adb shell` 返回 `rc=0` 且没输出 | 会话被重启打断，不是脚本成功 | 别判失败、别重跑；看 `dpkg.log`/`apt history.log`/落点时间戳 |
| `adb wait-for-device` 秒回、随后 `adb shell` 报 no devices | USB 重新枚举期间短暂出现的假就绪（实测重启 27 s 就回来，但 `wait-for-device` 提前返回） | 循环重试：`until adb shell uptime 2>/dev/null \| grep -q "up 0 min\|up [1-9] min"; do sleep 2; done`，或连续 3 次 `adb shell true` 成功再继续 |
| 手动方式截屏全黑 | 应用走 eglfs/DRM，`x11grab` 抓不到；手动方式也没有 `:uisum` 摘要 | 手动方式不截屏，用落点 md5/服务/进程取证 |
| 界面先卡 60 s 才跑脚本 | 盘根/目录带了 `eeprom_config.json`，先走 EEPROM 配置 | 不需要就删掉 |
| 工具行为被换掉 | U 盘根放了 `silentInstaller`，优先于 `/usr/bin/` | 不要随包工具二进制 |
| 脚本报 `\r: command not found` | CRLF | 打包前 `grep -c $'\r'` |
| 脚本里命令找不到 | systemd 的 PATH 很短 | 显式设置 PATH |
| 两个窗口都弹、只跑了一次 | 双入口 + `flock` 正常现象 | 交付说明里写清楚 |
| 改 `/home/linaro` 的东西不生效 | 属主被 root 改掉 | `chown 1000:1000` |

---

## 9. 参考

- 工具：`unattendedinstallationtools` 1.0.4（`dpkg -L` 可列全部文件）；`silentInstaller` / `Unattended_Installation_Tools` 的行为来自二进制反查。
- 现网包：`~/customizationData/archive/雷沃/20260303-SPRING2 10PRO-雷沃U盘静默安装包（…）.zip`（手动方式，根 `unattended_installation.sh` + `customization.tar`，末尾 `reboot`）；`~/other/customizationData/patches/debian_auto_openssh_drop.zip`（自动方式，`:uisum`）。
- 老包盘根还见过 `/mnt/usb/sda1`；脚本兜底扫描，不要照抄硬编码。
- 平台差异与 OTG 处置：`../SKILL.md` §5.2、§7.3。
