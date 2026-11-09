#!/bin/sh
# RK Debian 手动工具入口：/usr/bin/unattended_installation 执行
#   sh <U 盘根>/unattended_installation.sh <U 盘根>
# 主逻辑在 auto_unattended_installation/auto_unattended_installation.sh，本文件只做转交。
# udev 形态（auto_unattended_installation/ 被拷到 /run）不需要这个文件。
#
# 放置：U 盘根 / unattended_installation.sh（文件名写死，不能改）。

USB="${1:-/mnt/installUsb}"
MAIN="$USB/auto_unattended_installation/auto_unattended_installation.sh"

if [ ! -f "$MAIN" ]; then
    echo "缺少 $MAIN"
    echo "U 盘根要有 auto_unattended_installation/auto_unattended_installation.sh"
    exit 1
fi

exec /bin/bash "$MAIN" "$USB"
