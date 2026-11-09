#!/bin/bash
# RK Debian 静默安装包：主机侧触发/取证（adb，只操作可清理的临时路径）
#
#   ./debian-trigger.sh udev   <包目录> [证据目录]   # 自动方式：模拟挂载点跑整条 udev 链（不要真盘）
#   ./debian-trigger.sh manual <包目录>              # 手动方式启动脚本契约：sh /mnt/installUsb/unattended_installation.sh /mnt/installUsb
#                                                    # （真实触发是 GUI 点击 Open 后插盘，这里只验脚本；日志落 /var/log/lw_install.log）
#   ./debian-trigger.sh evidence                     # reboot 前一次抓全：dpkg/apt 事务、日志、服务、落点、残留
#   ./debian-trigger.sh script <包目录>              # 只跑脚本（不经过 UI）
#   ./debian-trigger.sh shot   <输出.png>            # 截设备屏幕（ffmpeg x11grab）
#   ./debian-trigger.sh status                       # 进程 / /run 残留 / 日志
#   ./debian-trigger.sh cleanup                      # 清模拟挂载点、/run 残留、silentInstaller
#
# 说明：
#   - udev 链的真实入口是 udev 规则；这里用 mkdir /media/usb_disk + 直接执行包装脚本模拟，
#     规则本身只能在真盘上验证。
#   - /media/usb_disk、/mnt/installUsb 是真实挂载点时 cleanup 不会删（防误删 U 盘内容）。
#   - adb 必须是 root（Debian 固件默认 root shell）。

set -Eeuo pipefail

CMD="${1:-}"
ARG="${2:-}"

die() { echo "错误：$*" >&2; exit 1; }
sh_() { adb shell "$@"; }

is_mount() {
    # 注意：这套 adb 不传远端退出码（恒为 0），只能看输出
    adb shell "mountpoint '$1' 2>/dev/null" | grep -q 'is a mountpoint'
}

stage() {
    local pkg="$1" dir="$2"
    [ -d "$pkg" ] || die "包目录不存在：$pkg"
    if is_mount "$dir"; then
        die "$dir 是真实挂载点，改用真盘流程（见 references/rk-debian.md 7.5）"
    fi
    adb shell "rm -rf '$dir'; mkdir -p '$dir'"
    adb push "$pkg/." "$dir/" >/dev/null
    echo "已推送 $(find "$pkg" -type f | wc -l) 个文件 -> $dir"
}

cleanup() {
    adb shell 'pkill -x silentInstaller 2>/dev/null' >/dev/null 2>&1 || true
    for d in /media/usb_disk /mnt/installUsb; do
        if is_mount "$d"; then
            echo "跳过 $d（真实挂载点）"
        else
            adb shell "rm -rf '$d'" >/dev/null 2>&1 || true
        fi
    done
    adb shell 'rm -f /run/auto_unattended_installation.sh /run/silentInstaller /run/auto_unattended_installation.log; rm -rf /run/temp_copy' >/dev/null 2>&1 || true
    echo "已清理模拟挂载点与 /run 残留"
}

case "$CMD" in
    script)
        [ -n "$ARG" ] || die "用法：debian-trigger.sh script <包目录>"
        stage "$ARG" /usr/local/share/verify-demo
        adb shell 'bash /usr/local/share/verify-demo/auto_unattended_installation/auto_unattended_installation.sh >/var/log/lw_install.log 2>&1; echo rc=$?; tail -20 /var/log/lw_install.log'
        ;;
    udev)
        [ -n "$ARG" ] || die "用法：debian-trigger.sh udev <包目录> [证据目录]"
        EV="${3:-./evidence}"
        mkdir -p "$EV"
        cleanup
        stage "$ARG" /media/usb_disk
        adb shell 'DISPLAY=:0 setsid -f /usr/bin/auto_unattended_installation.sh </dev/null >/var/log/auto_unattended_wrapper.log 2>&1' >/dev/null
        for _ in $(seq 1 20); do
            adb shell 'test -f /run/auto_unattended_installation.sh' >/dev/null 2>&1 && break
            sleep 1
        done
        sleep 3
        "$0" shot "$EV/gui.png"
        adb shell 'cat /var/log/auto_unattended_wrapper.log 2>/dev/null; echo ---; tail -20 /run/auto_unattended_installation.log 2>/dev/null'
        adb shell 'pkill -x silentInstaller 2>/dev/null' >/dev/null 2>&1 || true
        echo "已关闭 silentInstaller；残留用 cleanup 清"

        ;;
    manual)
        [ -n "$ARG" ] || die "用法：debian-trigger.sh manual <包目录>"
        stage "$ARG" /mnt/installUsb
        # 日志落 /var/log（不落 /tmp）：Debian 开机 bootclean 清 /tmp，重启后取证只剩空文件
        adb shell 'date; sh /mnt/installUsb/unattended_installation.sh /mnt/installUsb >/var/log/lw_install.log 2>&1; echo "rc=$?（包自带 reboot 时不可信）" >>/var/log/lw_install.log; date >>/var/log/lw_install.log' || true
        echo "--- /var/log/lw_install.log 尾部（重启后仍可读）"
        adb shell 'tail -40 /var/log/lw_install.log 2>/dev/null || echo "(日志缺失)"'
        echo "提示：包自带 reboot 时 adb 会提前返回 rc=0；成败用 ./debian-trigger.sh evidence 判，别重跑整包"
        ;;
    evidence)
        adb shell 'echo "== 本轮 dpkg 事务 =="; grep -E " (install|upgrade|remove) " /var/log/dpkg.log | tail -20
echo "== apt 事务（整组被降级拒绝时只有 remove 一条）=="; tail -20 /var/log/apt/history.log
echo "== 安装日志 =="; tail -20 /var/log/lw_install.log 2>/dev/null || echo "(无 /var/log/lw_install.log)"
echo "== 服务 =="; systemctl is-enabled cpwelcome lovolrun 2>/dev/null; systemctl is-active lovolrun 2>/dev/null
echo "== 落点 / 容量 =="; du -sh /customization /customization.tar 2>/dev/null; df -h / | tail -1
echo "== 模拟残留 =="; ls -ld /media/usb_disk /mnt/installUsb /run/auto_unattended_installation.sh 2>/dev/null || echo "(无)"'
        ;;
    shot)
        [ -n "$ARG" ] || die "用法：debian-trigger.sh shot <输出.png>"
        SIZE="$(adb shell 'DISPLAY=:0 xdpyinfo | awk "/dimensions:/ {print \$2}"' | tr -d '\r')"
        [ -n "$SIZE" ] || SIZE=1024x600
        adb shell "DISPLAY=:0 ffmpeg -hide_banner -loglevel error -f x11grab -video_size $SIZE -i :0.0 -frames:v 1 -update 1 -y /var/log/_gui.png"
        mkdir -p "$(dirname "$ARG")"
        adb pull /var/log/_gui.png "$ARG" >/dev/null
        adb shell 'rm -f /var/log/_gui.png' >/dev/null 2>&1 || true
        echo "截图：$ARG（${SIZE}）—— 仅自动方式需要；手动方式没有 :uisum 摘要，eglfs 机型还可能全黑"
        ;;
    status)
        adb shell 'echo "== 进程 =="; ps -ef | grep -E "silentInstaller|auto_unattended_installation|unattended_installation" | grep -v grep
echo "== /run =="; ls -l /run/auto_unattended_installation.sh /run/silentInstaller /run/auto_unattended_installation.log 2>/dev/null
echo "== 挂载点 =="; ls -ld /media/usb_disk /mnt/installUsb 2>/dev/null
echo "== 脚本日志 =="; ls -l /var/log/cp-unattended/ 2>/dev/null'
        ;;
    cleanup)
        cleanup
        ;;
    *)
        sed -n '2,18p' "$0"
        exit 1
        ;;
esac
