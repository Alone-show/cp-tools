#!/bin/bash
# T3 Linux（Buildroot）U 盘静默安装：主机侧触发 / 取证（adb）
#
#   ./t3linux-trigger.sh stage <包目录> [挂载点]   # 把包推到 /mnt/usb/sda1（Launcher 写死的路径）
#   ./t3linux-trigger.sh run [远端日志]            # bash <挂载点>/unattended_installation.sh
#   ./t3linux-trigger.sh stdin-run [远端日志]      # 复现 Launcher：printf '<脚本>\n' | bash
#   ./t3linux-trigger.sh probe [证据目录]          # 最小探针包：stage + run + 校验（不 reboot）
#   ./t3linux-trigger.sh evidence [文件...]        # reboot 前一次抓全
#   ./t3linux-trigger.sh bootcheck                 # 启动链 / /data 挂载 / app.sh / can0 / 进程 / core
#   ./t3linux-trigger.sh sample [次数] [间隔秒]    # 进程稳定性采样（默认 3 次，间隔 15 s）
#   ./t3linux-trigger.sh status                    # 进程 / 挂载 / 日志
#   ./t3linux-trigger.sh gui                       # 打印人工触发步骤
#   ./t3linux-trigger.sh cleanup                   # 清假挂载点与探针残留
#
# 说明：
#   - /mnt/usb/sda1 是 Launcher 写死的脚本路径；普通目录即可模拟，不占 USB、adb 不掉。
#   - 真 U 盘要 Host 角色；切 Host 可能掉 adb（见 SKILL §7.3），不要判失败。
#   - 脚本含 reboot 时 adb 会提前返回，成败看日志/落点时间戳，不要重跑整包。
#   - 这台设备的 adb 不保证回传远端退出码，一律看输出判断。

set -Eeuo pipefail

USB="${T3L_USB:-/mnt/usb/sda1}"
LOG_DEV="${T3L_LOG:-/data/cp-unattended/manual.log}"
PROBE_LOG=/data/cp-unattended/probe.log

die() { echo "错误：$*" >&2; exit 1; }
sh_() { adb shell "$@"; }

check_adb() {
    adb get-state >/dev/null 2>&1 || die "没有 adb 设备（先确认 USB/OTG 在 DEVICE，见 SKILL §7.3）"
    sh_ 'id' 2>/dev/null | grep -q 'uid=0' || die "设备不是 root"
}

is_mount() {
    sh_ "grep -qs ' $1 ' /proc/mounts && echo MOUNTED" 2>/dev/null | grep -q MOUNTED
}

stage() {
    local pkg="$1" dir="${2:-$USB}"
    [ -d "$pkg" ] || die "包目录不存在：$pkg"
    [ -f "$pkg/unattended_installation.sh" ] || die "包目录里没有 unattended_installation.sh（必须是盘根入口）"
    if is_mount "$dir"; then
        die "$dir 是真实挂载点，改用真盘流程（见 references/t3-linux.md §6.4）"
    fi
    sh_ "rm -rf '$dir'; mkdir -p '$dir'" >/dev/null
    adb push "$pkg/." "$dir/" >/dev/null
    # Launcher 是「bash 从 stdin 读 ./<路径>」再执行，脚本必须有执行位
    sh_ "chmod 755 '$dir/unattended_installation.sh'" >/dev/null 2>&1 || true
    echo "已推送 $(find "$pkg" -type f | wc -l | tr -d ' ') 个文件 -> $dir"
}

run() {
    local log="${1:-$LOG_DEV}"
    sh_ "mkdir -p '$(dirname "$log")'" >/dev/null 2>&1 || true
    sh_ "bash '$USB/unattended_installation.sh' >'$log' 2>&1; echo rc=\$?"
    echo "--- 远端日志（$log）---"
    sh_ "tail -30 '$log' 2>/dev/null" || true
    echo "提示：包里有 reboot 时 adb 会提前返回，rc 不可信；看日志和落点时间戳。"
}

stdin_run() {
    local log="${1:-$LOG_DEV}"
    sh_ "mkdir -p '$(dirname "$log")'" >/dev/null 2>&1 || true
    sh_ "chmod 755 '$USB/unattended_installation.sh'" >/dev/null 2>&1 || true
    # Launcher 的实际调用：bash 从 stdin 读入一行 "./<脚本>"，脚本要有执行位；这里用 EOF 收尾
    sh_ "printf '%s\n' '$USB/unattended_installation.sh' | bash >'$log' 2>&1; echo rc=\$?"
    echo "--- 远端日志（$log）---"
    sh_ "tail -30 '$log' 2>/dev/null" || true
}

probe() {
    local ev="${1:-}"
    local tmp marker
    tmp="$(mktemp -d)"
    marker="T3LINUX-PROBE-$(date +%Y%m%d%H%M%S)"
    printf '%s\n' "$marker" > "$tmp/probe_marker.txt"

    cat > "$tmp/unattended_installation.sh" <<'EOS'
#!/bin/bash
set -u
USB="${1:-/mnt/usb/sda1}"
LOG=/data/cp-unattended/probe.log
mkdir -p /data/cp-unattended
exec </dev/null
{
    echo "$(date '+%F %T') start, usb root: $USB"
    echo "argv0=$0 argv1=${1:-<none>}"
    cp -f "$USB/probe_marker.txt" /data/cp-unattended/probe_marker.txt
    md5sum "$USB/probe_marker.txt" /data/cp-unattended/probe_marker.txt
    echo "$(date '+%F %T') done"
} >> "$LOG" 2>&1
EOS

    stage "$tmp"
    sh_ "rm -f '$PROBE_LOG'" >/dev/null 2>&1 || true
    run "$PROBE_LOG"
    echo "--- 探针校验 ---"
    sh_ "echo -n 'log: '; tail -1 '$PROBE_LOG' 2>/dev/null; echo -n 'src: '; md5sum '$USB/probe_marker.txt' | cut -d' ' -f1; echo -n 'dst: '; md5sum /data/cp-unattended/probe_marker.txt 2>/dev/null | cut -d' ' -f1"

    if [ -n "$ev" ]; then
        mkdir -p "$ev"
        evidence > "$ev/t3linux_evidence.txt" 2>&1 || true
        echo "证据已写 $ev/t3linux_evidence.txt"
    fi
    rm -rf "$tmp"
    echo "探针完成；GUI 触发见 ./t3linux-trigger.sh gui"
}

evidence() {
    local files="${T3L_FILES:-$*}"
    sh_ 'echo "== 时间 / 运行时长 =="; date; uptime'
    sh_ 'echo "== 环境 =="; head -3 /etc/os-release; uname -a; cat /Configs/system_info/system_info.ini 2>/dev/null'
    sh_ 'echo "== 进程 =="; ps | grep -E "JobMonitor|CFT|VariableMonitor|Launcher|MDM" | grep -v grep' || true
    sh_ 'echo "== 启动依赖 =="; grep -E "mmcblk0p1| /data " /proc/mounts 2>/dev/null; ls -l /data/app.sh 2>/dev/null; ls /sys/class/net 2>/dev/null' || true
    sh_ 'echo "== core =="; ls -l /data/*.core 2>/dev/null || echo "(无)"' || true
    sh_ 'echo "== 挂载 =="; grep "/mnt/usb" /proc/mounts 2>/dev/null; ls -l /mnt/usb 2>/dev/null'
    sh_ "echo '== 脚本日志（$LOG_DEV）=='; cat '$LOG_DEV' 2>/dev/null || echo '(无)'"
    sh_ 'echo "== Launcher 日志 =="; tail -30 /data/Log/log.log 2>/dev/null || echo "(无)"'
    if [ -n "$files" ]; then
        sh_ "echo '== 落点 =='; for f in $files; do ls -l \"\$f\" 2>/dev/null; md5sum \"\$f\" 2>/dev/null; done"
    fi
    sh_ 'echo "== 残留 =="; ls -l /mnt/usb/sda1 2>/dev/null || echo "(无假挂载)"; ls -l /data/*.tar.gz 2>/dev/null || true'
}

status() {
    sh_ 'echo -n "Launcher="; pidof Launcher; echo -n "MDM="; pidof MDM; echo'
    sh_ 'echo "== 服务模式进程 =="; ps | grep -E "JobMonitor|CFT|VariableMonitor" | grep -v grep' || true
    sh_ 'echo "== /data 与 can =="; grep -E "mmcblk0p1| /data " /proc/mounts 2>/dev/null; ls /sys/class/net 2>/dev/null' || true
    sh_ 'grep "/mnt/usb" /proc/mounts 2>/dev/null; ls -l /mnt/usb 2>/dev/null'
    sh_ "ls -l '$LOG_DEV' /data/cp-unattended 2>/dev/null"
}

bootcheck() {
    sh_ 'echo "== inittab =="; grep -vE "^(#|$)" /etc/inittab 2>/dev/null' || true
    sh_ 'echo "== rcS 顺序 =="; grep -n -E "autorun|mount -t ext4 /dev/mmcblk0p1 /data|/data/app.sh" /etc/init.d/rcS 2>/dev/null' || true
    sh_ 'echo "== /data 挂载 =="; grep -E "mmcblk0p1| /data " /proc/mounts 2>/dev/null' || true
    sh_ 'echo "== 服务文件 =="; for f in /data/app.sh /data/comm_analysis/JobMonitor.out /data/comm_analysis/CFT.out /data/v_monitor_data/VariableMonitor; do ls -l "$f" 2>/dev/null || echo "missing $f"; done' || true
    sh_ 'echo "== 网络 =="; ls /sys/class/net 2>/dev/null' || true
    sh_ 'echo "== 进程 =="; ps | grep -E "JobMonitor|CFT|VariableMonitor|Launcher|MDM" | grep -v grep' || true
    sh_ 'echo "== core =="; ls -l /data/*.core 2>/dev/null || echo "(无)"' || true
}

sample() {
    local n="${1:-3}" delay="${2:-15}" i=1
    while [ "$i" -le "$n" ]; do
        echo "--- sample $i/$n $(date '+%H:%M:%S') ---"
        sh_ 'date; ps | grep -E "JobMonitor|CFT|VariableMonitor|Launcher|MDM" | grep -v grep; ls -l /data/*.core 2>/dev/null' || true
        i=$((i + 1))
        if [ "$i" -le "$n" ]; then
            sleep "$delay"
        fi
    done
}

gui() {
    cat <<'EOS'
GUI 触发（人工，需要真 U 盘）：
  1) U 盘（FAT32，带分区）插 Host 口；确认：adb shell 'grep /mnt/usb /proc/mounts'
  2) Launcher → 设置 → U盘查看 → 右上角开关 → 静默安装
  3) 取证：adb shell 'tail -50 /data/Log/log.log'; adb shell 'cat /data/cp-unattended/<pkg>.log'
  4) 若 adb 掉了：先问用户是否切回 DEVICE（SKILL §7.3），不要判失败
EOS
}

cleanup() {
    if is_mount "$USB"; then
        echo "跳过 $USB（真实挂载点）"
    else
        sh_ "rm -rf '$USB'" >/dev/null 2>&1 || true
        echo "已清理假挂载点 $USB"
    fi
    sh_ "rm -f '$PROBE_LOG' /data/cp-unattended/probe_marker.txt" >/dev/null 2>&1 || true
    echo "已清理探针日志/标记（其余日志保留）"
}

case "${1:-}" in
    stage)     check_adb; stage "${2:?用法: t3linux-trigger.sh stage <包目录> [挂载点]}" "${3:-$USB}" ;;
    run)       check_adb; run "${2:-$LOG_DEV}" ;;
    stdin-run) check_adb; stdin_run "${2:-$LOG_DEV}" ;;
    probe)     check_adb; probe "${2:-}" ;;
    evidence)  check_adb; shift; evidence "$@" ;;
    bootcheck) check_adb; bootcheck ;;
    sample)    check_adb; sample "${2:-3}" "${3:-15}" ;;
    status)    check_adb; status ;;
    gui)       gui ;;
    cleanup)   check_adb; cleanup ;;
    *)         sed -n '2,20p' "$0"; exit 1 ;;
esac
