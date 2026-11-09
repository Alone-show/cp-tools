#!/system/bin/sh
# RK 探针落地脚本：由 CpService.xml 的 copy + cmd 调用
#   <item action="copy" params="probe-collect.sh" param1="/data/local/tmp"/>
#   <item action="cmd" params="sh /data/local/tmp/probe-collect.sh"/>
#
# 为什么不用 copyout：本机 7.5.4 的 copyout 走 native shell（system uid），写 FUSE 卷被拒；
# 这里以 root 身份把结果同时写到 /data/local/tmp、/sdcard 和 U 盘根（找得到的话）。
OUT=/data/local/tmp
LOG=/sdcard/probe.log

log() { echo "[probe] $1"; echo "[probe] $1" >> "$LOG" 2>/dev/null; }

find_root() {
    d="${0%/*}"
    [ "$d" != "$0" ] && [ -f "$d/CpService.xml" ] && { echo "$d"; return 0; }
    for d in /storage/* /mnt/media_rw/* /mnt/usb_storage* /mnt/udisk*; do
        [ -f "$d/CpService.xml" ] && { echo "$d"; return 0; }
    done
    return 1
}

df > "$OUT/probe_df.txt" 2>&1
mount > "$OUT/probe_mount.txt" 2>&1
getprop > "$OUT/probe_props.txt" 2>&1
{ ls -la /storage; ls -la /mnt/media_rw 2>/dev/null; } > "$OUT/probe_storage.txt" 2>&1
ls -la /dev/block/by-name > "$OUT/probe_blockname.txt" 2>&1
ls -ld /data/media /data/overlay /odm /cache/cpservice /system/media /system/etc/init.bootanimation.sh > "$OUT/probe_paths.txt" 2>&1 || true
{ for c in awk sed grep md5sum sqlite3 dd reboot; do printf '%s=' $c; command -v $c || echo MISSING; done; } > "$OUT/probe_tools.txt" 2>&1
{ date; uptime; } > "$OUT/probe_run.txt" 2>&1
{ echo "board=$(getprop ro.board.platform)"; echo "cp_version=$(getprop ro.build.cp.version)"; echo "sdk=$(getprop ro.build.version.sdk)"; echo "runlimit=$(getprop persist.cps.xml.run.time)"; echo "wallpaper_set=$(getprop persist.wallpaper.set)"; echo "dynamic_partitions=$(getprop ro.boot.dynamic_partitions)"; echo "verity=$(getprop ro.boot.veritymode)"; } > "$OUT/probe_key.txt" 2>&1

ROOT="$(find_root)"
log "start; usb_root=${ROOT:-none}"
if [ -n "$ROOT" ] && [ -d "$ROOT" ]; then
    for f in "$OUT"/probe_*.txt; do
        cp -f "$f" "$ROOT/" && log "copied $(basename "$f") -> $ROOT"
    done
else
    log "U盘根没找到，结果只在 /data/local/tmp 和 /sdcard"
fi
log "done"
