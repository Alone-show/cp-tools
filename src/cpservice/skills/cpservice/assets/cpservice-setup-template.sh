#!/system/bin/sh
# RK 安卓（CpService.xml / com.cpdevice.cpservice）设备端脚本骨架
#
# 由 xml 暂存后执行（RK 的 copy 里 param1 是“目录”）：
#   <item action="copy" params="setup_cpservice.sh" param1="/data/local/tmp"/>
#   <item action="cmd" params="sh /data/local/tmp/setup_cpservice.sh"/>
#
# 也可以手动跑：  sh /sdcard/setup_cpservice.sh
# 脱机验证：      NO_REBOOT=1 sh /data/local/tmp/usbroot/setup_cpservice.sh
#
# 约束：mksh（无 bash）；本机 toybox 有 awk/sed/grep/md5sum/sqlite3/dd；
#       **不写 /system /vendor /product**（RK 动态分区 + verity，写不进去）。

# ---------- 按需改这里 ----------
APK_LIST=""                         # 例：APK_LIST="VanCoreT3-260414.apk app.apk"
COPY_DIRS=""                        # 例：COPY_DIRS="fcw/data:/sdcard/fcw/data tts:/data/local/tts"
COPY_FILES=""                       # 例：COPY_FILES="cfg.ini:/data/local/cfg.ini"
LOGO_IMG=""                         # 例：LOGO_IMG="logo.img"（文件名必须是 logo.img）
BOOTANIMATION=""                    # 例：BOOTANIMATION="bootanimation.zip"（文件名必须是 bootanimation.zip）
DO_REBOOT=1
# --------------------------------

LOG_FILE="/sdcard/cpservice_setup.log"
if ! ( : >> "$LOG_FILE" ) 2>/dev/null; then
    LOG_FILE="/data/local/tmp/cpservice_setup.log"
    mkdir -p /data/local/tmp 2>/dev/null
    : >> "$LOG_FILE" 2>/dev/null
fi

log() {
    ts="$(date '+%m-%d %H:%M:%S' 2>/dev/null)"
    [ -z "$ts" ] && ts="--:--:--"
    echo "$ts [setup_cpservice] $1"
    echo "$ts [setup_cpservice] $1" >> "$LOG_FILE" 2>/dev/null
}

find_usb_root() {
    d="${0%/*}"
    if [ "$d" != "$0" ] && [ -f "$d/CpService.xml" ]; then
        echo "$d"
        return 0
    fi

    for d in /storage/* /mnt/media_rw/* /mnt/usb_storage* /mnt/udisk*; do
        [ -f "$d/CpService.xml" ] && { echo "$d"; return 0; }
    done

    # RK 上外置卷一般也挂成 /dev/fuse
    for d in $(df | awk '/^\/dev\/fuse/ {print $NF}'); do
        [ -f "$d/CpService.xml" ] && { echo "$d"; return 0; }
    done

    return 1
}

copy_file() {
    src="$USB_ROOT/$1"
    dst="$2"
    if [ ! -f "$src" ]; then
        log "skip missing: $1"
        return 0
    fi
    mkdir -p "${dst%/*}" 2>/dev/null
    if cp -f "$src" "$dst"; then
        chmod 644 "$dst" 2>/dev/null
        chown 0:0 "$dst" 2>/dev/null
        log "copied $1 -> $dst"
    else
        log "copy failed: $1 -> $dst"
        return 1
    fi
}

copy_dir() {
    src="$USB_ROOT/$1"
    dst="$2"
    if [ ! -d "$src" ]; then
        log "skip missing dir: $1"
        return 0
    fi
    mkdir -p "$dst" 2>/dev/null
    if cp -rf "$src"/. "$dst"/; then
        log "copied dir $1 -> $dst"
    else
        log "copy dir failed: $1 -> $dst"
        return 1
    fi
}

install_apk() {
    name="${1##*/}"
    if [ ! -f "$USB_ROOT/$1" ]; then
        log "skip missing apk: $name"
        return 0
    fi
    cp -f "$USB_ROOT/$1" "/data/$name" || { log "stage failed: $name"; return 1; }
    chmod 777 "/data/$name"
    log "install apk: $name"
    out="$(pm install -t -r -d "/data/$name" 2>&1 | tr '\n' ' ')"
    log "pm install output: $out"
    case "$out" in
        *Success*) rm -f "/data/$name" ;;
        *) log "install failed, keep /data/$name for debug" ;;
    esac
}

install_logo() {
    [ -f "$USB_ROOT/$1" ] || { log "skip missing logo: $1"; return 0; }
    # logo 动作的 dd 硬编码读 /sdcard/logo.img，文件名不要改
    cp -f "$USB_ROOT/$1" /sdcard/logo.img || { log "logo copy failed"; return 1; }
    chmod 777 /sdcard/logo.img
    if dd if=/sdcard/logo.img of=/dev/block/by-name/logo 2>/dev/null; then
        sync
        log "logo written: md5=$(md5sum /sdcard/logo.img 2>/dev/null | cut -d' ' -f1)"
    else
        log "logo dd failed"
        return 1
    fi
}

install_bootanimation() {
    [ -f "$USB_ROOT/$1" ] || { log "skip missing bootanimation: $1"; return 0; }
    mkdir -p /data/media 2>/dev/null
    if cp -f "$USB_ROOT/$1" /data/media/bootanimation.zip; then
        chmod 777 /data/media/bootanimation.zip
        chown media_rw:media_rw /data/media/bootanimation.zip 2>/dev/null
        log "bootanimation -> /data/media/bootanimation.zip"
    else
        log "bootanimation copy failed"
        return 1
    fi
}

USB_ROOT="$(find_usb_root)"
if [ -z "$USB_ROOT" ] || [ ! -d "$USB_ROOT" ]; then
    log "usb root not found (需要盘根有 CpService.xml，且卷可写)"
    exit 1
fi

log "start, usb root: $USB_ROOT, log: $LOG_FILE"
log "tool: $(getprop ro.board.platform) / $(getprop ro.build.cp.version)"

for apk in $APK_LIST; do
    install_apk "$apk"
done

[ -n "$LOGO_IMG" ] && install_logo "$LOGO_IMG"
[ -n "$BOOTANIMATION" ] && install_bootanimation "$BOOTANIMATION"

for pair in $COPY_FILES; do
    copy_file "${pair%%:*}" "${pair#*:}"
done

for pair in $COPY_DIRS; do
    copy_dir "${pair%%:*}" "${pair#*:}"
done

sync
log "done, reboot=$DO_REBOOT"

if [ "$NO_REBOOT" = "1" ] || [ -f /data/local/tmp/no_reboot ]; then
    log "skip reboot (NO_REBOOT)"
elif [ "$DO_REBOOT" = "1" ]; then
    reboot
fi
