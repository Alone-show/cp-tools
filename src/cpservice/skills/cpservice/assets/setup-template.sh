#!/system/bin/sh
# 升级脚本骨架（设备端执行）：xml 用 copy 暂存本脚本，再 sh 执行
#   <item action="copy" udiskfile="setup_xxx.sh" dstdir="/data/local/tmp/setup_xxx.sh"/>
#   <item action="cmd" params="sh /data/local/tmp/setup_xxx.sh"/>

LOG_FILE="/sdcard/setup_xxx.log"
if ! ( : >> "$LOG_FILE" ) 2>/dev/null; then
    LOG_FILE="/data/local/tmp/setup_xxx.log"
    : >> "$LOG_FILE" 2>/dev/null
fi

log() {
    ts="$(date '+%m-%d %H:%M:%S' 2>/dev/null)"
    [ -z "$ts" ] && ts="--:--:--"
    echo "$ts [setup_xxx] $1"
    echo "$ts [setup_xxx] $1" >> "$LOG_FILE" 2>/dev/null
}

find_usb_root() {
    d="${0%/*}"
    [ "$d" != "$0" ] && [ -f "$d/E9631Service.xml" ] && { echo "$d"; return 0; }
    for d in /storage/* /mnt/media_rw/* /mnt/usb_storage* /mnt/udisk*; do
        [ -f "$d/E9631Service.xml" ] && { echo "$d"; return 0; }
    done
    return 1
}

USB_ROOT="$(find_usb_root)"
[ -z "$USB_ROOT" ] && { log "usb root not found"; exit 1; }

remount_rw() {
    mount -o rw,remount,rw /system >/dev/null 2>&1
    mount -o rw,remount /system   >/dev/null 2>&1
    mount -o rw,remount,rw /vendor >/dev/null 2>&1
    mount -o rw,remount /vendor   >/dev/null 2>&1
}

copy_file() {
    src="$USB_ROOT/$1"; dst="$2"
    [ -f "$src" ] || { log "skip missing: $1"; return 0; }
    mkdir -p "${dst%/*}" 2>/dev/null
    cp -f "$src" "$dst" || { log "copy failed: $1 -> $dst"; return 1; }
    chmod 644 "$dst"; chown 0:0 "$dst" 2>/dev/null
    log "copied $1 -> $dst"
}

install_apk_async() {
    name="${1##*/}"
    [ -f "$1" ] || { log "skip missing apk: $name"; return 0; }
    cp -f "$1" "/data/$name" || { log "stage failed: $name"; return 1; }
    chmod 777 "/data/$name"
    log "install apk: $name"
    (
        out="$(pm install -t -r -d "/data/$name" 2>&1 | tr '\n' ' ')"
        log "pm install output: $out"
        case "$out" in *Success*) rm -f "/data/$name" ;; esac
    ) &
}

log "start, usb root: $USB_ROOT, log: $LOG_FILE"

install_apk_async "$USB_ROOT/app1.apk"
remount_rw
copy_file "fw_xxx.bin"    "/system/vendor/modules/fw_xxx.bin"
copy_file "nvram_xxx.txt" "/system/vendor/modules/nvram_xxx.txt"

wait
sync

if [ "$NO_REBOOT" = "1" ] || [ -f /data/local/tmp/no_reboot ]; then
    log "done (skip reboot)"
else
    log "done, reboot"
    reboot
fi
