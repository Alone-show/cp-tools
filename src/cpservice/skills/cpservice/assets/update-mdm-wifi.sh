#!/system/bin/sh
# 更新 WiFi 固件（CYW43438）与/或 VanCoreT3(MDM)
# 用法：sh update-mdm-wifi.sh
#       NO_REBOOT=1 或存在 /data/local/tmp/no_reboot 时跳过重启

APK_LIST="VanCoreT3-260414.apk"
FW_LIST="fw_cyw43438.bin nvram_cyw43438.txt"
FW_DST="/system/vendor/modules"

LOG_FILE="/sdcard/update-mdm-wifi.log"
if ! ( : >> "$LOG_FILE" ) 2>/dev/null; then
    LOG_FILE="/data/local/tmp/update-mdm-wifi.log"
fi

log() {
    line="$(date '+%m-%d %H:%M:%S' 2>/dev/null) [update-mdm-wifi] $1"
    echo "$line"
    echo "$line" >> "$LOG_FILE" 2>/dev/null
}

# 取 md5 第一列：这台固件没有 awk，不能 md5sum | awk
md5of() {
    m="$(md5sum "$1" 2>/dev/null)"
    printf '%s' "${m%% *}"
}

find_usb_root() {
    d="${0%/*}"
    [ "$d" != "$0" ] && [ -f "$d/E9631Service.xml" ] && { echo "$d"; return 0; }
    for d in /storage/* /mnt/media_rw/* /mnt/usb_storage* /mnt/udisk* /sdcard; do
        [ -f "$d/E9631Service.xml" ] && { echo "$d"; return 0; }
    done
    return 1
}

install_apk() {
    apk="$1"
    name="${apk##*/}"
    f="$USB_ROOT/$apk"
    [ -f "$f" ] || { log "skip missing apk: $apk"; return 0; }
    cp -f "$f" "/data/$name" || { log "copy apk failed: $name"; return 1; }
    chmod 777 "/data/$name"
    log "install apk: $name"
    (
        out="$(pm install -t -r -d "/data/$name" 2>&1 | tr '\n' ' ')"
        log "pm install output: $out"
        case "$out" in *Success*) rm -f "/data/$name" ;; esac
    ) &
}

update_fw() {
    mount -o rw,remount,rw /system >/dev/null 2>&1
    mount -o rw,remount /system >/dev/null 2>&1
    mkdir -p "$FW_DST" 2>/dev/null

    for f in $FW_LIST; do
        src="$USB_ROOT/$f"
        dst="$FW_DST/$f"
        [ -f "$src" ] || { log "skip missing fw: $f"; continue; }
        cp -f "$src" "$dst" || { log "copy failed: $f"; continue; }
        chmod 644 "$dst"
        chown 0:0 "$dst" 2>/dev/null
        s="$(md5of "$src")"
        d="$(md5of "$dst")"
        if [ "$s" = "$d" ]; then
            log "fw ok: $dst (md5 $d)"
        else
            log "fw md5 MISMATCH: $dst src=$s dst=$d"
        fi
    done

    rm -f /system/media/fw_cyw43438.bin /system/media/nvram_cyw43438.txt
    sync
}

USB_ROOT="$(find_usb_root)"
[ -n "$USB_ROOT" ] || { log "usb root not found"; exit 1; }
log "start, usb root: $USB_ROOT"

[ -n "$APK_LIST" ] && for a in $APK_LIST; do install_apk "$a"; done
[ -n "$FW_LIST" ] && update_fw

wait
sync

if [ "$NO_REBOOT" = "1" ] || [ -f /data/local/tmp/no_reboot ]; then
    log "done (skip reboot)"
else
    log "done, reboot"
    reboot
fi
