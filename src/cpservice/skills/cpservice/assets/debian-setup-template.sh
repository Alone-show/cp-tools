#!/bin/bash
# RK Debian U 盘静默安装主脚本骨架（udev 链 + 手动链共用）
#
# 放置（文件名/目录名写死，不能改）：
#   U 盘根/auto_unattended_installation/auto_unattended_installation.sh
# 运行方式：
#   udev：插盘 → /media/usb_disk → 整个目录拷到 /run → /run/silentInstaller
#         → /bin/bash /run/auto_unattended_installation.sh        （:uisum 进摘要区）
#   手动：工具窗口 → /mnt/installUsb
#         → sh <盘根>/unattended_installation.sh <盘根>（转交给本脚本，$1 = 盘根）
#
# 约束：bash 5（udev 链）/ root / 工作目录是 / / 不要 sudo / 不要 CRLF
# 大载荷（tar、镜像）放 U 盘根，运行时按 $USB_ROOT 读；小载荷放本目录（会被复制进 /run，391 MB 上限）
#
# 脱机验证：bash ./auto_unattended_installation.sh /path/to/fake_usb

set -Eeuo pipefail

PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH

# ---------- 按需改这里 ----------
PKG_ID="demo"                        # 日志名 / 标记名，改成包名
DEB_LIST=""                          # 例：DEB_LIST="app_1.0.0_arm64.deb"
COPY_FILES=""                        # 例：COPY_FILES="lightdm.conf:/etc/lightdm/lightdm.conf"
COPY_DIRS=""                         # 例：COPY_DIRS="cpseq:/usr/local/share/cpseq"
DO_REBOOT=0                          # 1 = 装完自动重启（会写标记防重启循环）
ONLY_ONCE=0                          # 1 = 同一台设备只跑一次（/var/lib/cp-unattended/<id>.done）
# --------------------------------

LOG_DIR=/var/log/cp-unattended
LOG="$LOG_DIR/$PKG_ID.log"
MARKER="/var/lib/cp-unattended/$PKG_ID.done"
LOCK=/run/cp-unattended.lock

mkdir -p "$LOG_DIR" 2>/dev/null || true

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ "$SELF_DIR" = /run ]; then
    MODE=udev
else
    MODE=manual
fi

say() {
    printf '%s [%s] %s\n' "$(date '+%F %T')" "$PKG_ID" "$*" >>"$LOG" 2>/dev/null || true
}

# udev 链：前 6 个字符 :uisum 才会进 silentInstaller 的摘要区；手动链只打纯文本
ui() {
    if [ "$MODE" = udev ]; then
        printf ':uisum%s\n' "$*"
    else
        printf '%s\n' "$*"
    fi
    say "$*"
}

on_err() {
    local rc=$?
    trap - ERR
    ui "失败（rc=$rc，第 $LINENO 行），详见 $LOG"
    exit "$rc"
}
trap on_err ERR

# 同一时刻只允许一个静默安装（udev 对 sda/sda1 各触发一次、双入口叠加守护进程）
exec 9>"$LOCK"
if ! flock -n 9; then
    printf '%s\n' "另一个静默安装正在运行，跳过（$PKG_ID）"
    say "skip: lock busy"
    exit 0
fi

if [ "$ONLY_ONCE" = 1 ] && [ -f "$MARKER" ]; then
    ui "已经安装过（$MARKER），跳过"
    exit 0
fi

find_usb_root() {
    local d
    if [ -n "${1:-}" ] && [ -d "$1" ]; then
        printf '%s\n' "$1"
        return 0
    fi
    for d in /media/usb_disk /mnt/installUsb /mnt/usb/sda1 /media/*/; do
        d="${d%/}"
        if [ -d "$d/auto_unattended_installation" ] || [ -f "$d/unattended_installation.sh" ]; then
            printf '%s\n' "$d"
            return 0
        fi
    done
    return 1
}

USB_ROOT="$(find_usb_root "${1:-}" || true)"
if [ -n "$USB_ROOT" ]; then
    say "usb root: $USB_ROOT"
else
    say "usb root: (未找到，载荷只从 $SELF_DIR 取)"
fi

# 载荷优先取脚本同目录（udev 链已复制到 /run），其次取 U 盘根
payload_path() {
    if [ -f "$SELF_DIR/$1" ]; then
        printf '%s\n' "$SELF_DIR/$1"
        return 0
    fi
    if [ -n "$USB_ROOT" ] && [ -f "$USB_ROOT/$1" ]; then
        printf '%s\n' "$USB_ROOT/$1"
        return 0
    fi
    return 1
}

install_deb() {
    local f name ver have
    f="$(payload_path "$1")" || { ui "跳过缺失 deb：$1"; return 0; }
    name="$(dpkg-deb -f "$f" Package 2>/dev/null || true)"
    ver="$(dpkg-deb -f "$f" Version 2>/dev/null || true)"
    ui "安装 ${name:-$1} ${ver}"
    if dpkg -i --force-overwrite "$f" >>"$LOG" 2>&1; then
        have="$(dpkg-query -W -f='${Version}' "$name" 2>/dev/null || true)"
        if [ -n "$ver" ] && [ "$have" != "$ver" ]; then
            ui "警告：$name 版本不一致（期望 $ver，实际 ${have:-未安装}）"
        else
            ui "已安装 $name $have"
        fi
    else
        ui "失败：$name 安装失败，详见 $LOG"
        return 1
    fi
}

copy_file() {
    local src dst a b
    src="$(payload_path "$1")" || { ui "跳过缺失文件：$1"; return 0; }
    dst="$2"
    mkdir -p "${dst%/*}" 2>/dev/null || true
    cp -f "$src" "$dst"
    chmod 644 "$dst" 2>/dev/null || true
    chown 0:0 "$dst" 2>/dev/null || true
    a="$(md5sum "$src" | cut -d' ' -f1)"
    b="$(md5sum "$dst" | cut -d' ' -f1)"
    if [ "$a" != "$b" ]; then
        ui "失败：$dst 校验不一致"
        return 1
    fi
    ui "已复制 $1 -> $dst"
}

copy_dir() {
    local src dst
    src="$(payload_path "$1")"
    if [ -z "$src" ] || [ ! -d "$src" ]; then
        ui "跳过缺失目录：$1"
        return 0
    fi
    dst="$2"
    mkdir -p "$dst" 2>/dev/null || true
    cp -a "$src"/. "$dst"/
    ui "已复制目录 $1 -> $dst"
}

run_cmd() {
    say "run: $*"
    "$@" >>"$LOG" 2>&1
}

ui "开始静默安装 $PKG_ID（mode=$MODE，usb=${USB_ROOT:-无}）"

for d in $DEB_LIST; do
    install_deb "$d"
done

for pair in $COPY_FILES; do
    copy_file "${pair%%:*}" "${pair#*:}"
done

for pair in $COPY_DIRS; do
    copy_dir "${pair%%:*}" "${pair#*:}"
done

# 示例：改完配置刷新服务
# run_cmd systemctl daemon-reload
# run_cmd systemctl restart <unit>

sync

if [ "$ONLY_ONCE" = 1 ] || [ "$DO_REBOOT" = 1 ]; then
    mkdir -p "${MARKER%/*}" 2>/dev/null || true
    date '+%F %T' >"$MARKER" 2>/dev/null || true
fi

ui "成功"

if [ "$DO_REBOOT" = 1 ]; then
    ui "即将重启（插着盘不会再跑，见 $MARKER）"
    nohup reboot >/dev/null 2>&1 &
fi

exit 0
