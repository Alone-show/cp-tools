#!/bin/bash
# RK Debian「只换开机 LOGO（logo 分区）」安装包主脚本模板
#
# 用途：订单要换中性开机图 / 去品牌图时，用 generate-bootlogo.sh 出 logo.img，再套这份模板进包。
# 形态（与 cpservice SKILL §4 C 一致，别改目录名与文件名）：
#
#   <包根，平铺>/
#   ├── logo.img                                     ← generate-bootlogo.sh 产物（1024x600 或 1280x800）
#   ├── unattended_installation.sh                   ← 手动入口：assets/debian-entry-template.sh 原样复制
#   └── auto_unattended_installation/
#       └── auto_unattended_installation.sh          ← 本模板（改成下面的 PKG_ID / LOGO_FILE）
#
# 触发：
#   自动（udev）：插盘 → /media/usb_disk → 目录拷到 /run → silentInstaller → bash /run/auto_unattended_installation.sh
#   手动（GUI）：Unattended_Installation_Tools 点 Open 切 host 插盘 → /mnt/installUsb
#                → sh <盘根>/unattended_installation.sh <盘根>
#
# 行为：flock 防双触发 → 与分区现有内容比 md5（相同即跳写）→ 备份原分区到 /userdata/verify_bak
#       → dd 写 logo.img → 按镜像长度回读 md5 → 写 .done 标记 → 默认 reboot（NO_REBOOT=1 可免）
#
# 脱机/真机验证：NO_REBOOT=1 sh <盘根>/unattended_installation.sh <盘根>
# 已实测：SPRING2-PRO / Debian 11 / kernel 5.10.160，logo.img 3,686,966 B，重启后桌面正常（2026-11-16）

set -Eeuo pipefail

PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH

# ---------- 按单改这里 ----------
PKG_ID="order_logo"                  # 日志名 / 标记名：/var/log/cp-unattended/$PKG_ID.log、/var/lib/cp-unattended/$PKG_ID.done
LOGO_FILE="logo.img"                 # 放 U 盘根的镜像文件名（generate-bootlogo.sh 的产物名）
LOGO_PART=/dev/block/by-name/logo    # RK Debian 的 logo 分区（by-name 链接，别写死 /dev/mmcblk0p5）
DO_REBOOT=1                          # 1 = 写完自动重启（产线默认）；验证时设 NO_REBOOT=1
ONLY_ONCE=1                          # 1 = 同机只跑一次，防「插着盘反复重启」
# ---------------------------------

LOG_DIR=/var/log/cp-unattended
LOG="$LOG_DIR/$PKG_ID.log"
MARKER="/var/lib/cp-unattended/$PKG_ID.done"
LOCK=/run/cp-unattended.lock
BAK_DIR=/userdata/verify_bak

mkdir -p "$LOG_DIR" 2>/dev/null || true

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ "$SELF_DIR" = /run ]; then MODE=udev; else MODE=manual; fi

say() { printf '%s [%s] %s\n' "$(date '+%F %T')" "$PKG_ID" "$*" >>"$LOG" 2>/dev/null || true; }
ui() {
    if [ "$MODE" = udev ]; then printf ':uisum%s\n' "$*"; else printf '%s\n' "$*"; fi
    say "$*"
}
on_err() {
    local rc=$?
    trap - ERR
    ui "失败（rc=$rc，第 $LINENO 行），详见 $LOG"
    exit "$rc"
}
trap on_err ERR

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
    if [ -n "${1:-}" ] && [ -d "$1" ]; then printf '%s\n' "$1"; return 0; fi
    for d in /media/usb_disk /mnt/installUsb /mnt/usb/sda1 /media/*/; do
        d="${d%/}"
        if [ -f "$d/$LOGO_FILE" ] || [ -d "$d/auto_unattended_installation" ]; then
            printf '%s\n' "$d"
            return 0
        fi
    done
    return 1
}

USB_ROOT="$(find_usb_root "${1:-}" || true)"
say "usb root: ${USB_ROOT:-未找到}"

payload_path() {
    if [ -f "$SELF_DIR/$1" ]; then printf '%s\n' "$SELF_DIR/$1"; return 0; fi
    if [ -n "$USB_ROOT" ] && [ -f "$USB_ROOT/$1" ]; then printf '%s\n' "$USB_ROOT/$1"; return 0; fi
    return 1
}

ui "开始静默安装 $PKG_ID（mode=$MODE，usb=${USB_ROOT:-无}）"

SRC="$(payload_path "$LOGO_FILE")" || { ui "失败：找不到 $LOGO_FILE（U 盘根要有它）"; exit 1; }
SIZE="$(stat -c %s "$SRC")"
SRC_MD5="$(md5sum "$SRC" | cut -d' ' -f1)"
say "payload: $SRC size=$SIZE md5=$SRC_MD5"

[ -b "$LOGO_PART" ] || { ui "失败：$LOGO_PART 不是块设备"; exit 1; }

CUR_MD5="$(head -c "$SIZE" "$LOGO_PART" | md5sum | cut -d' ' -f1)"
if [ "$CUR_MD5" = "$SRC_MD5" ]; then
    ui "logo 分区已是目标内容（md5=$CUR_MD5），无需重写"
    if [ "$ONLY_ONCE" = 1 ] || [ "$DO_REBOOT" = 1 ]; then
        mkdir -p "${MARKER%/*}" 2>/dev/null || true
        date '+%F %T' >"$MARKER" 2>/dev/null || true
    fi
    if [ "$DO_REBOOT" = 1 ] && [ "${NO_REBOOT:-0}" != 1 ]; then
        ui "即将重启"
        nohup reboot >/dev/null 2>&1 &
    fi
    exit 0
fi

mkdir -p "$BAK_DIR" 2>/dev/null || true
BAK="$BAK_DIR/logo.part.$(date +%Y%m%d-%H%M%S).bak"
ui "备份原 logo 分区 → $BAK"
dd if="$LOGO_PART" of="$BAK" bs=1M 2>>"$LOG"
say "backup md5: $(md5sum "$BAK" | cut -d' ' -f1)"

ui "写入 logo 分区（$SIZE 字节）"
dd if="$SRC" of="$LOGO_PART" bs=4096 conv=fsync 2>>"$LOG"
sync

NEW_MD5="$(head -c "$SIZE" "$LOGO_PART" | md5sum | cut -d' ' -f1)"
if [ "$NEW_MD5" != "$SRC_MD5" ]; then
    ui "失败：回读 md5 不一致（期望 $SRC_MD5，实际 $NEW_MD5）"
    exit 1
fi
ui "已写入并回读校验通过（md5=$NEW_MD5）"

if [ "$ONLY_ONCE" = 1 ] || [ "$DO_REBOOT" = 1 ]; then
    mkdir -p "${MARKER%/*}" 2>/dev/null || true
    date '+%F %T' >"$MARKER" 2>/dev/null || true
fi

ui "成功"

if [ "$DO_REBOOT" = 1 ] && [ "${NO_REBOOT:-0}" != 1 ]; then
    ui "即将重启（插着盘不会再跑，见 $MARKER）"
    nohup reboot >/dev/null 2>&1 &
fi
exit 0
