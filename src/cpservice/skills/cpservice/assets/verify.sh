#!/bin/sh
# U 盘升级结果核验（只读）
#
# 用法：
#   ./verify.sh [--rk|--t3|--debian|--t3linux|auto] <脚本日志> [pkg1] [pkg2] ...
#   LOGO_SRC=./logo.img BOOTANIM_SRC=./bootanimation.zip ./verify.sh --rk /sdcard/cpservice_setup.log com.cp.pkg
#   FW_SRC=./fw_cyw43438.bin ./verify.sh --t3 /sdcard/setup_e9631service.log
#   ./verify.sh --debian /var/log/cp-unattended/demo.log unattendedinstallationtools
#   FILES='/logo /data/cp-unattended/demo.txt' LOGO_SRC=./logo ./verify.sh --t3linux /data/cp-unattended/demo.log
#   AVAIL_UNITS='cpwelcome.service lovolrun.service' ./verify.sh --debian <log> <pkg>   # 强制指定要查的 systemd 服务
#   AVAIL_PKGS='com.cp.launcher' ./verify.sh --rk /sdcard/cpservice_setup.log           # 强制指定要启动的客户应用
#   （可用性必查：安卓客户应用能启动/常驻、Debian 服务能起来、T3 Linux 桌面包 Launcher/MDM 或服务模式约定进程；判据见 SKILL §7.4）
#
#   auto（默认）：/etc/os-release 含 Buildroot → T3 Linux；含 Debian → Debian；否则 getprop rk* → RK，其余 → T3 安卓
#   平台专属证据（logo 分区、动画、固件、计数属性、dpkg/udev）按平台自动选段。

PLATFORM=auto
case "$1" in
  --rk) PLATFORM=rk; shift ;;
  --t3) PLATFORM=t3; shift ;;
  --debian) PLATFORM=debian; shift ;;
  --t3linux|--t3l) PLATFORM=t3linux; shift ;;
  auto) shift ;;
  "") ;;
esac
LOG="${1:?用法: verify.sh [--rk|--t3|--debian|--t3linux|auto] <脚本日志> [pkg...]}"
shift 2>/dev/null || true
line() { echo "---------------------------------------------------------------"; }

# 安卓可用性：客户应用能启动（有 Activity）或常驻（服务型），且无 FATAL
avail_android() {
  line; echo "3.5) 应用可用性（必查：启动/常驻 + 无 FATAL）"
  _pkgs="${AVAIL_PKGS:-$*}"
  if [ -z "$_pkgs" ]; then
    echo "  (没有包名可查：用位置参数或 AVAIL_PKGS='com.a com.b' 传入)"; return 0
  fi
  for p in $_pkgs; do
    echo "--- $p"
    adb shell "dumpsys package $p 2>/dev/null | grep -E 'versionName|lastUpdateTime' | head -2" 2>&1 || true
    adb shell "monkey -p $p -c android.intent.category.LAUNCHER 1 2>/dev/null | tail -2" 2>&1 || true
    sleep 2
    adb shell "dumpsys activity activities 2>/dev/null | grep mResumedActivity | head -1" 2>&1 || true
    adb shell "pidof $p 2>/dev/null || echo '(进程不在)'" 2>&1 || true
    adb shell "dumpsys activity services $p 2>/dev/null | grep -c ServiceRecord" 2>&1 || true
    adb shell "logcat -d -b crash 2>/dev/null | grep -A3 'FATAL EXCEPTION' | tail -8" 2>&1 || true
  done
  echo "判读：mResumedActivity 命中 或 pidof 在 或 ServiceRecord>0，且无该包 FATAL ⇒ 通过"
}

# Debian 可用性：systemd 服务能起来（三判据），unit 可从 deb 文件列表反推
avail_debian() {
  line; echo "4.5) 服务可用性（必查：enabled / active / Result；三判据见 SKILL §7.4）"
  _units="${AVAIL_UNITS:-}"
  if [ -z "$_units" ]; then
    for p in "$@"; do
      _units="$_units $(adb shell "dpkg -L $p 2>/dev/null | grep -E '/systemd/system/.*[.]service$' | sed 's|.*/||'" 2>/dev/null | tr -d '\r')"
    done
  fi
  if [ -z "$(echo $_units)" ]; then
    echo "  (没推到 unit：用 AVAIL_UNITS='a.service b.service' 显式传)"; return 0
  fi
  for u in $_units; do
    echo "--- $u"
    adb shell "systemctl show -p UnitFileState,ActiveState,SubState,Result,ExecMainStatus,NRestarts '$u' 2>/dev/null" 2>&1 || true
    adb shell "journalctl -u '$u' -b --no-pager -n 5 2>/dev/null | tail -5" 2>&1 || true
  done
  echo "判读：常驻=active；oneshot=enabled+Result=success+ExecMainStatus=0（inactive 正常）；被拉起=active（disabled 正常）；NRestarts 持续增长=crash loop"
}

if [ "$PLATFORM" = auto ]; then
  if adb shell 'grep -qi buildroot /etc/os-release 2>/dev/null && echo BR' 2>/dev/null | grep -q BR; then
    PLATFORM=t3linux
  elif adb shell 'grep -qi debian /etc/os-release 2>/dev/null && echo DEB' 2>/dev/null | grep -q DEB; then
    PLATFORM=debian
  else
    PLATFORM=$(adb shell getprop ro.board.platform 2>/dev/null | tr -d '\r' | grep -q '^rk' && echo rk || echo t3)
  fi
fi

line; echo "0) 时间 / 运行时长（无电池 RTC 从 1970/2022 起算，用 uptime 反推）"
adb shell 'date; uptime' 2>&1 || true

line; echo "0.5) 环境"
if [ "$PLATFORM" = debian ]; then
  adb shell 'uname -a; grep -E "^(PRETTY_NAME|VERSION_ID)" /etc/os-release' 2>&1 || true
elif [ "$PLATFORM" = t3linux ]; then
  adb shell 'uname -a; head -3 /etc/os-release; cat /Configs/system_info/system_info.ini 2>/dev/null' 2>&1 || true
else
  adb shell 'getprop ro.board.platform; getprop ro.build.version.sdk; getprop ro.build.cp.version' 2>&1 || true
fi

if [ "$PLATFORM" = debian ]; then
  line; echo "1) 系统 / 工具（期望 Debian 11 + unattendedinstallationtools 1.0.4）"
  adb shell 'grep -E "^(PRETTY_NAME|VERSION_ID)" /etc/os-release; uname -m; dpkg -l unattendedinstallationtools 2>/dev/null | tail -1' 2>&1 || true
  adb shell 'ls -l /usr/bin/silentInstaller /usr/bin/auto_unattended_installation.sh /etc/udev/rules.d/10-auto_unattended_installation.rules 2>/dev/null' 2>&1 || true
  adb shell 'echo -n "otg_mode="; cat /sys/devices/platform/fe8a0000.usb2-phy/otg_mode 2>/dev/null; echo' 2>&1 || true

  line; echo "1.5) 两条链是否执行（journalctl，重启后仍在）"
  adb shell 'journalctl -b --no-pager 2>/dev/null | grep -E "auto_unattended|silentInstaller|installUsb|usb_disk" | tail -20' 2>&1 || true

  line; echo "2) 包装脚本日志 /run/auto_unattended_installation.log（重启清空）"
  adb shell 'cat /run/auto_unattended_installation.log 2>/dev/null || echo "(无，正常：包装脚本只记 pre-install)"' 2>&1 || true

  line; echo "3) 脚本日志（包脚本自己写 /var/log/cp-unattended；老包不写 → 自动走 3.5）"
  adb shell "cat '$LOG' 2>/dev/null || echo '(日志不存在)'" 2>&1 || true

  # 这套 adb 不传远端退出码，靠输出判断日志是否存在
  if ! adb shell "test -s '$LOG' && echo HAVE_LOG" 2>/dev/null | grep -q HAVE_LOG; then
    line; echo "3.5) 降级证据：dpkg / apt 事务（老包无自写日志时的唯一依据）"
    adb shell 'grep -E " (install|upgrade|remove) " /var/log/dpkg.log | tail -15' 2>&1 || true
    adb shell 'tail -15 /var/log/apt/history.log' 2>&1 || true
    echo "判读：只有 apt remove 一条、没有 install 记录 ⇒ apt 包组被整组拒绝（降级需 --allow-downgrades），deb 一个没装"
  fi

  line; echo "4) 安装结果（dpkg 版本/状态）"
  for p in "$@"; do
    echo "--- $p"
    adb shell "dpkg -l $p 2>/dev/null | tail -2; dpkg-query -W -f='\${Package} \${Version} \${db:Status-Abbrev}\n' $p 2>/dev/null" 2>&1 || true
  done
  [ -n "${DEB_SRC:-}" ] && md5sum "$DEB_SRC"

  avail_debian "$@"

  line; echo "5) 文件落点 / 校验（可传 FILES='/etc/x /usr/local/y'）"
  if [ -n "${FILES:-}" ]; then
    for f in $FILES; do adb shell "ls -l '$f' 2>/dev/null; md5sum '$f' 2>/dev/null" 2>&1 || true; done
  else
    adb shell 'ls -l /var/log/cp-unattended/ 2>/dev/null || echo "(无日志目录)"' 2>&1 || true
  fi

  line; echo "6) 一次性标记 / 模拟残留"
  adb shell 'ls -l /var/lib/cp-unattended/ 2>/dev/null || echo "(无标记)"; ls -ld /media/usb_disk /mnt/installUsb /run/auto_unattended_installation.sh /run/silentInstaller 2>/dev/null || echo "(无模拟残留)"' 2>&1 || true

elif [ "$PLATFORM" = t3linux ]; then
  line; echo "1) 桌面 / 启动链 / 触发工具"
  adb shell 'echo -n "Launcher="; pidof Launcher; echo -n " MDM="; pidof MDM; echo; ps | grep -E "/Launcher|/mdm/MDM" | grep -v grep' 2>&1 || true
  adb shell 'grep -n -E "autorun|mount -t ext4 /dev/mmcblk0p1 /data" /etc/init.d/rcS 2>/dev/null; grep -E "mmcblk0p1| /data " /proc/mounts 2>/dev/null; ls -l /data/app.sh 2>/dev/null; ls /sys/class/net 2>/dev/null' 2>&1 || true
  adb shell 'ls -l /etc/mdev/udisk_insert /etc/mdev/do_mount 2>/dev/null; grep "/mnt/usb" /proc/mounts 2>/dev/null; ls -l /mnt/usb 2>/dev/null' 2>&1 || true
  echo "判读：桌面包看 Launcher；服务模式包看 /data/app.sh + 约定进程。rcS 先 autorun 后 mount /data 时存在抢跑；CFT 需要 can0。"

  line; echo "1.5) Launcher 日志（GUI 触发痕迹，qDebug 落 /data/Log/log.log）"
  adb shell 'tail -30 /data/Log/log.log 2>/dev/null' 2>&1 || true

  line; echo "2) 脚本日志（包脚本写 /data/cp-unattended）"
  adb shell "cat '$LOG' 2>/dev/null || echo '(日志不存在 → 脚本没启动或没写日志)'" 2>&1 || true

  line; echo "3) 落点 / 校验（FILES='/logo /data/cp-unattended/demo.txt'）"
  if [ -n "${FILES:-}" ]; then
    for f in $FILES; do
      adb shell "ls -l '$f' 2>/dev/null; md5sum '$f' 2>/dev/null; date -r '$f' 2>/dev/null" 2>&1 || true
    done
  else
    adb shell 'ls -l /data/cp-unattended 2>/dev/null' 2>&1 || true
  fi

  line; echo "4) 开机 LOGO / bootlogo"
  if [ -n "${LOGO_SRC:-}" ]; then
    echo "包内: md5=$(md5sum "$LOGO_SRC" | cut -d' ' -f1) size=$(wc -c < "$LOGO_SRC")"
    adb shell 'md5sum /logo 2>/dev/null; ls -l /logo 2>/dev/null' 2>&1 || true
  else
    adb shell 'ls -l /logo /Configs/bootlogo.bmp 2>/dev/null' 2>&1 || true
  fi
  if [ -n "${BOOTLOGO_SRC:-}" ]; then
    echo "包内 bootlogo: md5=$(md5sum "$BOOTLOGO_SRC" | cut -d' ' -f1)"
    adb shell 'mkdir -p /run/t3l_boot; mount -t vfat -o ro /dev/mmcblk0p2 /run/t3l_boot 2>/dev/null; md5sum /run/t3l_boot/bootlogo.bmp 2>/dev/null; umount /run/t3l_boot 2>/dev/null; rmdir /run/t3l_boot 2>/dev/null' 2>&1 || true
    echo "判读：boot-resource 里 bootlogo.bmp 的 md5 应与包内一致；挂载失败时改看 /mnt/bootlogo.bmp"
  fi

  line; echo "5) 可用性（必查：桌面包 Launcher/MDM；服务模式看约定进程；重启后 uptime 归零再查）"
  adb shell 'echo -n "Launcher="; pidof Launcher; echo -n " MDM="; pidof MDM; echo; ps | grep -E "/Launcher|/mdm/MDM" | grep -v grep' 2>&1 || true
  adb shell 'echo "服务模式进程:"; ps | grep -E "JobMonitor|CFT|VariableMonitor" | grep -v grep; echo "core:"; ls -l /data/*.core 2>/dev/null || echo "(无)"' 2>&1 || true
  echo "判读：服务模式包不要求 Launcher/MDM 在；按包内约定进程判，进程集应 0/15/60 s 都在。"

  line; echo "6) 残留 / UI 证据"
  adb shell 'ls -l /mnt/usb/sda1 2>/dev/null; ls -l /data/*.tar.gz 2>/dev/null; ls -l /data/cp-unattended 2>/dev/null' 2>&1 || true
  echo "UI：eglfs/mali 不能用 /dev/fb0 判成败；需目视/拍照，否则标未验证。"

elif [ "$PLATFORM" = rk ]; then
  line; echo "1) 工具（期望 /system/priv-app/CpService/CpService.apk，versionName=7.5.4）"
  adb shell 'pm path com.cpdevice.cpservice; dumpsys package com.cpdevice.cpservice | grep -E "versionName|versionCode" | head -3' 2>&1 || true

  line; echo "1.5) 工具是否真的执行（只在重启前有效）"
  adb shell 'logcat -d -s _Command 2>/dev/null | tail -20' 2>&1 || true
  adb shell 'logcat -d 2>/dev/null | grep -E "getStoragePath--->|vaca|xml--" | tail -8' 2>&1 || true

  line; echo "2) 脚本日志（包脚本可能不写日志，那就只看时间戳）"
  adb shell "cat '$LOG' 2>/dev/null || echo '(日志不存在)'" 2>&1 || true

  line; echo "3) APK 安装记录（lastUpdateTime 落在本轮窗口内 = 本次装的）"
  for p in "$@"; do
    echo "--- $p"
    adb shell "dumpsys package $p 2>/dev/null | grep -E 'versionName|firstInstallTime|lastUpdateTime|codePath' | head -5" 2>&1 || true
  done

  avail_android "$@"

  line; echo "4) 开机动画（/data/media/bootanimation.zip）"
  adb shell 'ls -l /data/media/bootanimation.zip 2>/dev/null; md5sum /data/media/bootanimation.zip 2>/dev/null' 2>&1 || true
  [ -n "$BOOTANIM_SRC" ] && md5sum "$BOOTANIM_SRC"

  line; echo "5) LOGO 分区（与包内 logo.img 前 N 字节比对）"
  if [ -n "$LOGO_SRC" ]; then
    SIZE=$(stat -c %s "$LOGO_SRC" 2>/dev/null || wc -c < "$LOGO_SRC")
    echo "包内: size=$SIZE md5=$(md5sum "$LOGO_SRC" | cut -d' ' -f1)"
    echo "设备: $(adb exec-out 'dd if=/dev/block/by-name/logo 2>/dev/null' | head -c "$SIZE" | md5sum | cut -d' ' -f1)"
  else
    adb shell 'ls -l /dev/block/by-name/logo; ls -l /sdcard/logo.img 2>/dev/null' 2>&1 || true
  fi

  line; echo "6) 一次性 / 计数属性"
  adb shell 'echo -n "run.time="; getprop persist.cps.xml.run.time; echo -n "wallpaper.set="; getprop persist.wallpaper.set' 2>&1 || true

  line; echo "6.5) 卷根残留 xml（会导致每次开机重复执行 → 重启循环）"
  adb shell 'ls -l /storage/*/CpService.xml 2>/dev/null || echo "(无，正常)"' 2>&1 || true

  line; echo "7) 残留"
  adb shell 'ls -l /data/*.apk /data/local/tmp/usbroot 2>/dev/null || echo "(无残留)"' 2>&1 || true

  line; echo "7.5) /sdcard 是否健康（卸卷/teardown 会把 emulated 一起 eject）"
  adb shell 'touch /sdcard/.verify_probe && rm -f /sdcard/.verify_probe && echo "sdcard OK" || echo "⚠ /storage/emulated/0 不可用：sm mount emulated\\;0"' 2>&1 || true

else
  line; echo "1) 工具"
  adb shell 'pm path com.android.guard; dumpsys package com.android.guard | grep -E "versionName" | head -2' 2>&1 || true

  line; echo "1.5) 工具是否真的执行"
  adb shell 'logcat -d 2>/dev/null | grep -E "USBReceiver|TaskThread|XmlPullParser" | tail -15' 2>&1 || true

  line; echo "2) 脚本日志"
  adb shell "cat '$LOG' 2>/dev/null || echo '(日志不存在 → 脚本没启动)'" 2>&1 || true

  line; echo "3) APK 安装记录"
  for p in "$@"; do
    echo "--- $p"
    adb shell "dumpsys package $p 2>/dev/null | grep -E 'versionName|firstInstallTime|lastUpdateTime|codePath' | head -5" 2>&1 || true
  done

  avail_android "$@"

  line; echo "4) 固件文件与驱动加载（重启后才有意义）"
  adb shell 'ls -l /system/vendor/modules/ 2>/dev/null | tail -10; md5sum /system/vendor/modules/fw_* /system/vendor/modules/nvram_* 2>/dev/null' 2>&1 || true
  [ -n "$FW_SRC" ] && md5sum "$FW_SRC"
  adb shell 'dmesg 2>/dev/null | grep -iE "fw_path|nv_path|Firmware version" | tail -8' 2>&1 || true

  line; echo "5) 残留"
  adb shell 'ls -l /system/media/fw_* /system/media/nvram_* /data/*.apk 2>/dev/null || echo "(无残留)"' 2>&1 || true

  line; echo "6) 假挂载 / UI"
  adb shell 'ls -d /storage/udisk* 2>/dev/null || echo "(已清理)"; dumpsys activity activities 2>/dev/null | grep mResumedActivity | head -2' 2>&1 || true
fi

if [ "$PLATFORM" = rk ] || [ "$PLATFORM" = t3 ]; then
  line; echo "7) 桌面图标（Launcher3）"
  adb shell 'db=/data/data/com.android.launcher3/databases/launcher.db; if [ -f "$db" ]; then sqlite3 "$db" "select title,container,cellX,cellY from favorites where container=-100" 2>/dev/null; stat -c "db owner: %u:%g" "$db"; else echo "(无 launcher.db)"; fi' 2>&1 || true
fi

line; echo "8) 收尾提示"
echo "  RK: rm -f /storage/*/CpService.xml; rm -rf /data/local/tmp/usbroot /data/local/tmp/probe_*; setprop persist.cps.xml.run.time 0"
echo "  RK: ./rk-virtual-disk.sh teardown（用过虚拟盘才需要）"
echo "  T3: rm -rf \"/storage/udisk(id=TEST)\" /data/local/tmp/usbroot; rm -f /data/local/tmp/no_reboot"
echo "  Debian: pkill -x silentInstaller; rm -rf /media/usb_disk /mnt/installUsb /run/auto_unattended_installation.sh /run/silentInstaller"
echo "  T3 Linux: rm -rf /mnt/usb/sda1; rm -f /data/cp-unattended/probe*; 真盘挂载时不要删 /mnt/usb/sda1"
echo "  含 reboot 的包：重启后 adb 不回来先看 lsusb（RK 2207 / T3 1f3a）；超时且没有 loader/FEL 才提示用户切 OTG/DEVICE（§7.3），别判失败"
