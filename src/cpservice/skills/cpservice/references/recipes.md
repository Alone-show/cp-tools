# 需求 → 写法（按平台速查）

> 从 SKILL §8.1–§8.3 下沉；出包模板见各平台 reference，LOGO/动画见 `bootlogo.md`。

## 8.1 Android

见 `rk-android.md` §5 / `t3-android.md` §5：`install`、`copy`、`logo`/`bootlogo`、`bootanimation`、写 `/system`（RK 拒绝、T3 先 remount）、`canuse_ver`、`runlimit`。

## 8.2 RK Debian

| 需求 | 写法 |
|---|---|
| 装 deb | `dpkg -i --force-overwrite <deb>`，或 `apt install -y --allow-downgrades <deb>`（**不带 `--allow-downgrades` 遇降级整组拒绝，一个都不装**）；装完 `dpkg-query -W` 核对 |
| 推文件/目录 | `cp -a` + md5 校验 + `chown` |
| 改服务/自启 | 备份 → 改 → `systemctl daemon-reload` → `enable/restart` |
| 换开机 LOGO | `dd if=logo.img of=/dev/block/by-name/logo`（不是安卓的 `logo` 动作） |
| 装完重启 | 默认交给 UI「重启」按钮；自动重启用 `DO_REBOOT=1` + `.done` 标记 |
| 只跑一次 / 大载荷 | `ONLY_ONCE=1`（`/var/lib/cp-unattended/<pkg>.done`）+ `flock`；大载荷放 U 盘根 |
| 清临时物 | `rm -rf /customization /customization.tar`（`rm` 不带 `-r` 静默失败，172 MB 留在 `/`） |

## 8.3 T3 Linux

| 需求 | 写法 |
|---|---|
| 装应用 | `tar xf data.tar.gz -C /data`，或 `cp` 二进制后改 `/data/app.sh` / `/etc/init.d/runqt` |
| 换开机 LOGO | `cp logo /logo`（5 MB raw，权限 644） |
| 换 bootlogo | `cp bootlogo.bmp /Configs/` + `mount -t vfat /dev/mmcblk0p2 /mnt` 替换 `bootlogo.bmp` 后 `sync`/`umount` |
| 换开机动画 | `CPVideoPlayDemo` + `video_demo.yuv`（`rcS` 里 `-t 9`） |
| 改自启 | 备份 `/etc/init.d/rcS`、`/etc/init.d/runqt` 后再改 |
| 装完重启 | 默认 `DO_REBOOT=1`；调试 `NO_REBOOT=1` |
| 只跑一次 | `ONLY_ONCE=1`（`/data/cp-unattended/<pkg>.done`）+ `flock` |
| 大载荷 | 放 U 盘根，脚本运行时从 `$USB` 读，别整包拷进 `/data` |
