# 取证硬规则（踩过的坑）

> 从 SKILL §7.8 下沉；OTG 见 SKILL §7.3。

1. **日志落持久路径**：`/var/log/`、`/userdata/`、`/usr/local/share/`。**禁止 `/tmp`**——Debian 开机 bootclean 清空，重启后整段 stdout 消失。
2. **一次抓全**：reboot 前用一条 `adb shell 'a; b; c'` 或 `debian-trigger.sh evidence`，别一条条打。
3. **systemd 查询带 `--no-pager` 或 `| cat`**：`systemctl show|status` 在 adb pty 下会进 less，卡 60 s 不动。
4. **包自带 reboot 时 `adb` 会假 `rc=0` 提前返回**，拿不到脚本 rc：只看 `dpkg.log`/`apt history.log`/时间戳，别判失败、别重跑。
5. **旧包没有自写日志**：用 `/var/log/dpkg.log`（装了哪些包、几点）+ `/var/log/apt/history.log`（apt 事务是否整组被拒，如降级 `E: Packages were downgraded and -y was used without --allow-downgrades`）+ 落点 `ls -l --full-time` 反查。
6. 只取设备端可见落点：分区 hash、文件 md5、服务状态、进程、日志；视觉类（LOGO/动画）单列「仅目视」。
7. T3 Linux：日志落 `/data/cp-unattended/`（`/tmp` 是 tmpfs）；Launcher 的 bash 收不到 EOF、不会自己结束，**别等 UI 回 idle**；GUI 触发痕迹看 `/data/Log/log.log`；脚本要 `+x`，否则 stdin 模式报 `Permission denied`。
8. **不杀/不重启业务进程**：验证只读；进程变化用 0/15/60 s 采样 + core + `dmesg` 判断，不要 kill 后重拉。确需重拉先征得同意，结束后重启恢复。
9. **先查启动依赖**：T3 Linux 的 `/data` 由 `rcS` 挂载，`/etc/autorun.sh` 可能先跑；先看 `/proc/mounts`、`/data/app.sh`、`can0`。CFT 在 `CanInit` 崩溃时先查 `can0`，别反复跑二进制。
10. **失败即停**：一项不过就写报告；验证不是排障，不把「为什么」扩成主任务。
11. **属性/配置回读有陈旧窗口**：`setprop` 后 1–2 s 内 `getprop` 可能仍读到旧值或空值（实测 `persist.hw.modem.nsim` 0→1，立即读仍是 0，2 s 后才变 1）；判定前 `sleep 2`，以 `/data/property/<name>` 终值为准。**别用单次回读判失败**，更别据此推成权限/沙箱问题（本次差点误判成 SELinux 拒绝，白查 9 分钟）。
12. **无电池 RTC 的设备每次重启时钟归零**（1970/2022 起算）：`mtime`、日志时间跨重启不可比，判断先后一律用 `uptime` 对齐；只比属性值和文件内容，别拿 mtime 推「有服务在覆盖」。
13. **复制/落盘失败先查挂载**：`cp` 报目标不存在、脚本里 `[ -d ]` 突然判假、目录「看着空了」，先看 `/proc/mounts`——挂到上级目录会遮蔽整棵子树。实测 T3 Linux 包先 `mount /dev/mmcblk0p2 /mnt` 再装应用，Launcher 的盘路径 `/mnt/usb/sda1` 被遮住，日志只剩一句 `app目录不存在`（遮蔽按路径生效，真 U 盘挂同一路径也一样）。挂载点用独立目录（如 `/mnt/bootresource`），写完 `sync` + `umount`。
