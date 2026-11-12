# 平台差异（唯一对照表）

> 从 SKILL §5.2 下沉；判定流程见 SKILL §1，按平台读的 reference 见 SKILL §2。
> 机型名不是判据（同名机型跨芯片两条产线）；本表只写包形态/动作模型差异，平台专属坑写在各平台 reference 里。

| 维度 | RK 安卓 | T3 安卓 | RK Debian | T3 Linux |
|---|---|---|---|---|
| 描述文件 | `CpService.xml` | `E9631Service.xml` | `auto_unattended_installation/auto_unattended_installation.sh`（+ 根入口） | 盘根 `unattended_installation.sh`（Launcher 写死路径） |
| 动作模型 | 21 个 action | 9 个 action | 无动作，脚本全权；`:uisum` 进 UI 摘要 | 无动作，脚本全权；stdout 进 Launcher 进程 |
| 设备端 shell | mksh，有 `awk`/`sqlite3` | mksh，**无 `awk`**、无 `cmd` | udev：bash；入口：sh（dash） | bash 4.3（`/bin/sh` 也是 bash）；busybox |
| 系统分区 | 动态分区 + verity，**默认不写 `/system`** | 可 remount（工具写死分区号） | rootfs **rw**：`dpkg`/`systemctl` 可用，改前备份 | `/`、`/data` ext4 rw；boot-resource 单独 mount |
| 重启 | `cmd reboot`（自动延后） | 异步，会打断安装 | 默认不重启，交给 UI「重启」按钮 | 默认 `reboot`（Launcher 的 bash 收不到 EOF） |
