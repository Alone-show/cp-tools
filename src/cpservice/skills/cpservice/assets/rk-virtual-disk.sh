#!/bin/sh
# RK 安卓：用 storaged 虚拟磁盘造一个「真实公共卷」，替代 U 盘/SD 卡做整包验证
#
#   ./rk-virtual-disk.sh setup     # 建虚拟盘并挂成 /storage/XXXX-XXXX
#   ./rk-virtual-disk.sh status    # 看当前卷 / 虚拟盘镜像
#   ./rk-virtual-disk.sh teardown  # 卸卷 + 删虚拟盘镜像
#
# 原理：CpService 靠 StorageManager 卷枚举找盘根，普通目录/假挂载都不算卷；
#      `sm set-virtual-disk true` + `sm partition ... public` 会挂出一个真实公共卷（约 512 MB）。
# 注意：`sm partition` 会格式化该虚拟盘；重启后不一定自动挂回，先 status 再看。
#      teardown 会先删卷根 `CpService.xml`——留着它（尤其带 install + cmd reboot）会变成每次开机都重启。
set -e

ADB=${ADB:-adb}
sh_() { $ADB shell "$@"; }

volumes() { sh_ 'sm list-volumes all 2>/dev/null'; }
vol_id() { volumes | tr -d '\r' | awk '/^public:.*mounted/ {print $1; exit}'; }
vol_path() {
  sh_ 'ls -1 /storage 2>/dev/null' | tr -d '\r' | grep -v -E '^(emulated|self)$' | head -1
}

case "${1:-status}" in
  setup)
    ID="$(vol_id)"
    if [ -n "$ID" ]; then
      V="$(vol_path)"
      echo "已存在公共卷：$ID -> /storage/$V"
      echo "  adb push <包目录>/. /storage/$V/"
      exit 0
    fi
    echo "[1/3] 打开虚拟磁盘"
    sh_ 'sm set-virtual-disk true' >/dev/null 2>&1 || true
    # 实测：set-virtual-disk true 之后 sm list-disks 需要数秒才出现 disk:7,0（3 秒常为空）
    DISK=""; j=0
    while [ $j -lt 15 ]; do
      sleep 1
      DISK="$(sh_ 'sm list-disks 2>/dev/null' | tr -d '\r' | head -1)"
      [ -n "$DISK" ] && break
      j=$((j+1))
    done
    [ -n "$DISK" ] || { echo "找不到虚拟磁盘（sm list-disks 为空）"; exit 1; }
    echo "      disk = $DISK（等待 ${j}s）"
    echo "[2/3] 分区为 public（会格式化）"
    sh_ "sm partition $DISK public" >/dev/null 2>&1 || true
    echo "[3/3] 等待挂载"
    V=""; i=0
    while [ $i -lt 30 ]; do
      sleep 1
      V="$(vol_path)"
      [ -n "$V" ] && break
      i=$((i+1))
    done
    [ -n "$V" ] || { echo "卷没挂上来，检查：adb shell sm list-volumes all"; exit 1; }
    echo "OK: /storage/$V（$(vol_id)）"
    echo "下一步："
    echo "  adb push <包目录>/. /storage/$V/"
    echo "  adb shell 'am broadcast -a android.intent.action.MEDIA_MOUNTED -d file:///storage/$V'"
    ;;
  status)
    volumes
    echo "--- /storage"
    sh_ 'ls -1 /storage 2>/dev/null'
    echo "--- 虚拟盘镜像"
    sh_ 'ls -l /data/media/virtual_disk 2>/dev/null || echo "(无)"'
    ;;
  teardown)
    V="$(vol_path)"
    # 关键：卷根留着 install + reboot 的 xml，下次开机工具还会执行 → 重启循环
    [ -n "$V" ] && sh_ "rm -f /storage/$V/CpService.xml" >/dev/null 2>&1 || true
    ID="$(vol_id)"
    [ -n "$ID" ] && sh_ "sm unmount $ID" >/dev/null 2>&1 || true
    sleep 1
    sh_ 'sm set-virtual-disk false' >/dev/null 2>&1 || true
    sh_ 'rm -f /data/media/virtual_disk' >/dev/null 2>&1 || true
    # 关键：teardown 会把 emulated;0 一起 eject 掉，/storage/emulated/0 变成
    # "Transport endpoint is not connected"（应用读写 /sdcard 全失败），必须重新挂回。
    sleep 1
    sh_ 'sm mount emulated\;0' >/dev/null 2>&1 || true
    sleep 2
    if sh_ 'test -d /storage/emulated/0 && touch /storage/emulated/0/.vd_probe && rm -f /storage/emulated/0/.vd_probe' 2>/dev/null; then
      echo "emulated 存储已恢复可写"
    else
      echo "⚠ /storage/emulated/0 不可用：手工执行 adb shell 'sm mount emulated\\;0'（或重启）"
    fi
    echo "已清理；剩余卷："
    volumes
    ;;
  *)
    echo "用法: $0 setup|status|teardown" >&2
    exit 1
    ;;
esac
