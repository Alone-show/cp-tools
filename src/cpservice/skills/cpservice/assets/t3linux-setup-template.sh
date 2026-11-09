#!/bin/bash
# T3 Linux（Buildroot）U 盘静默安装主脚本骨架
#
# 放置（文件名/路径写死，不能改）：
#   U 盘根/unattended_installation.sh   →  设备上 /mnt/usb/sda1/unattended_installation.sh
# 触发：
#   Launcher → 设置 → U盘查看 → 右上角开关
#   Launcher 起 QProcess("bash")，把 "./<脚本路径>\n" 写到 bash 的 stdin；cwd 是 /
#   ⇒ 没有 $1；$0 可能形如 .//mnt/usb/sda1/unattended_installation.sh；不要读 stdin
#
# 身份：root；bash 4.3；日志落 /data（/tmp 是 tmpfs，重启即空）
# 约束：不要 sudo、不要 adb、不要 CRLF；载荷大就放 U 盘根，运行时直接从 $USB 读
# 权限：Launcher 用「bash 读 stdin 执行 ./<脚本>」，脚本**必须有执行位**（chmod 755）；
#       adb push/解压到 ext4 常是 644，打包/推送后要补 chmod。
# 服务模式：rcS 可能先 `/etc/autorun.sh &` 后 `mount /data`；runqt 启动 `/data/app.sh` 前
#           要等 `/data` 挂好（最多 30 s），否则应用会丢或抢在 CAN/servicemanager 之前。
#
# 脱机验证（不经过 Launcher）：
#   bash ./unattended_installation.sh /path/to/fake_usb
#   或 printf '%s\n' /mnt/usb/sda1/unattended_installation.sh | bash

set -Eeuo pipefail

PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH

# ================= 按需改这里 =================
PKG_ID="demo"                 # 日志/标记名，改成包名
TARBALL=""                    # 例：data.tar.gz（可能实际是未压缩 tar，一律 tar xf）
TAR_DEST="/data"
COPY_FILES=""                 # 例："app.conf:/etc/app.conf"（空格分隔，源在 U 盘根）
COPY_DIRS=""                  # 例："appdir:/data/appdir"
LOGO=""                       # 例：logo（拷到 /logo）
BOOTLOGO=""                   # 例：bootlogo.bmp（/Configs + boot-resource 分区）
DO_REBOOT=1                   # 现场默认重启收尾（Launcher 的 bash 收不到 EOF）
ONLY_ONCE=0                   # 1 = 同一台设备只跑一次
# =============================================

LOG_DIR=/data/cp-unattended
LOG="$LOG_DIR/$PKG_ID.log"
MARKER="$LOG_DIR/$PKG_ID.done"
LOCK=/run/cp-unattended.lock
BOOT_MNT=/mnt

# Launcher 不传 $1；$0 可能带 "./" 前缀
USB="${1:-}"
if [ -z "$USB" ] || [ ! -d "$USB" ]; then
    USB="$(cd "$(dirname "$0")" 2>/dev/null && pwd || true)"
    if [ -z "$USB" ] || [ ! -d "$USB" ]; then
        USB=/mnt/usb/sda1
    fi
fi
[ -d "$USB" ] || { echo "U 盘目录不存在: $USB" >&2; exit 1; }

mkdir -p "$LOG_DIR" 2>/dev/null || true

# 不吃 Launcher 的 stdin：任何子命令误读都只会读到 EOF
exec </dev/null

say() {
    printf '%s %s\n' "$(date '+%F %T')" "$*" | tee -a "$LOG" 2>/dev/null || true
}

on_err() {
    local rc=$?
    say "失败: 行 $1, rc=$rc"
    exit "$rc"
}
trap 'on_err $LINENO' ERR

# 防双触发（GUI 连点 / 手动重跑）
exec 9>"$LOCK" 2>/dev/null || true
if ! flock -n 9 2>/dev/null; then
    say "已有安装进程在跑，退出"
    exit 0
fi

if [ "$ONLY_ONCE" = 1 ] && [ -f "$MARKER" ]; then
    say "已安装过（$MARKER），跳过"
    exit 0
fi

say "start, usb root: $USB"

need() {
    [ -f "$USB/$1" ] || { say "缺少文件: $USB/$1"; exit 1; }
}

md5_of() { md5sum "$1" 2>/dev/null | cut -d' ' -f1; }

copy_file() {   # $1=源(相对 U 盘根)  $2=目标绝对路径
    local src="$1" dst="$2" a b
    need "$src"
    mkdir -p "$(dirname "$dst")"
    cp -f "$USB/$src" "$dst"
    chmod 644 "$dst" 2>/dev/null || true
    a=$(md5_of "$USB/$src"); b=$(md5_of "$dst")
    if [ -n "$a" ] && [ "$a" = "$b" ]; then
        say "ok $src -> $dst md5=$a"
    else
        say "md5 不一致: $src -> $dst"
        exit 1
    fi
}

copy_dir() {    # $1=源目录(相对 U 盘根)  $2=目标绝对目录
    local src="$1" dst="$2"
    [ -d "$USB/$src" ] || { say "缺少目录: $USB/$src"; exit 1; }
    mkdir -p "$dst"
    cp -a "$USB/$src/." "$dst/"
    say "ok dir $src -> $dst"
}

install_tar() { # $1=tar 文件名(相对 U 盘根)  $2=解压目标
    local t="$1" dest="$2"
    need "$t"
    mkdir -p "$dest"
    tar xf "$USB/$t" -C "$dest"
    say "ok tar $t -> $dest"
}

replace_logo() { # $1=logo 文件名  → /logo
    local f="$1"
    need "$f"
    cp -f "$USB/$f" /logo
    chmod 644 /logo 2>/dev/null || true
    say "ok logo -> /logo md5=$(md5_of /logo)"
}

replace_bootlogo() { # $1=bootlogo 文件名 → /Configs + boot-resource
    local f="$1" bak=/data/cp-unattended/bootlogo.bmp.bak
    need "$f"
    mkdir -p /Configs
    cp -f "$USB/$f" /Configs/bootlogo.bmp
    sync
    say "ok bootlogo -> /Configs/bootlogo.bmp"

    if mountpoint -q "$BOOT_MNT" 2>/dev/null; then
        say "警告: $BOOT_MNT 已被占用，跳过 boot-resource 替换"
        return 0
    fi
    if ! mount -t vfat -o rw /dev/mmcblk0p2 "$BOOT_MNT"; then
        say "挂载 /dev/mmcblk0p2 失败，boot-resource 未替换"
        return 1
    fi
    if [ -f "$BOOT_MNT/bootlogo.bmp" ]; then
        cp -f "$BOOT_MNT/bootlogo.bmp" "$bak" 2>/dev/null || true
    fi
    cp -f "$USB/$f" "$BOOT_MNT/bootlogo.bmp"
    chmod 644 "$BOOT_MNT/bootlogo.bmp" 2>/dev/null || true
    sync
    say "ok bootlogo -> $BOOT_MNT/bootlogo.bmp md5=$(md5_of "$BOOT_MNT/bootlogo.bmp")"
    umount "$BOOT_MNT" || say "警告: umount $BOOT_MNT 失败"
}

if [ -n "$TARBALL" ]; then
    install_tar "$TARBALL" "$TAR_DEST"
fi
for pair in $COPY_FILES; do
    copy_file "${pair%%:*}" "${pair#*:}"
done
for pair in $COPY_DIRS; do
    copy_dir "${pair%%:*}" "${pair#*:}"
done
if [ -n "$LOGO" ]; then
    replace_logo "$LOGO"
fi
if [ -n "$BOOTLOGO" ]; then
    replace_bootlogo "$BOOTLOGO"
fi

if [ "$ONLY_ONCE" = 1 ]; then
    : > "$MARKER"
fi

sync
say "done"

if [ "${NO_REBOOT:-0}" = 1 ]; then
    say "NO_REBOOT=1，跳过重启"
elif [ "$DO_REBOOT" = 1 ]; then
    say "reboot"
    sync
    reboot
fi
