#!/bin/sh
# 假挂载 + 广播触发升级，免插拔 U 盘
# 用法：./trigger.sh <包目录> [假挂载名]
set -e

PKG_DIR="${1:?用法: trigger.sh <包目录> [假挂载名]}"
VOL="${2:-udisk(id=TEST)}"
DEV_PATH="/storage/$VOL"

[ -d "$PKG_DIR" ] || { echo "包目录不存在: $PKG_DIR" >&2; exit 1; }

adb shell "mkdir -p '$DEV_PATH'"
adb push "$PKG_DIR/." "$DEV_PATH/" >/dev/null
adb shell "ls -l '$DEV_PATH'"

adb shell "logcat -c"
adb shell "am broadcast -a android.intent.action.MEDIA_MOUNTED -d 'file://$DEV_PATH'"

sleep 10
adb shell "logcat -d | grep -E 'USBReceiver|TaskThread|XmlPullParser|System.err' | tail -40"
adb shell 'for f in /sdcard/*.log; do echo "### $f"; cat "$f"; done 2>/dev/null'

echo "清理：adb shell 'rm -rf \"$DEV_PATH\"'"
