# 真机核验（四平台共用项）

> 从 SKILL §7.4 下沉；OTG 口径只看 SKILL §7.3，报告模板见 SKILL §7.6。
> 平台专属命令见各自 reference（rk-android §7 / t3-android §5 / rk-debian §7 / t3-linux §6）。

| 检查项 | 命令 | 通过判据 |
|---|---|---|
| 工具执行 | Android：logcat 过滤（RK：`logcat -d -s _Command:V \| grep -- '--xml---action---'`，详见 `rk-android.md` §7 / `t3-android.md` §5）；Debian：`journalctl -b --no-pager` + `/run/auto_unattended_installation.log` | 有 action 行、无解析异常（重启前有效） |
| 脚本日志 | `cat /var/log/cp-unattended/<pkg>.log`、`/data/cp-unattended/<pkg>.log` 或 `/sdcard/<name>.log` | `start, usb root:`、无 `skip missing`、`… Success`、结尾 `done`（老包不写日志 → SKILL §7.8-5） |
| 本轮跑完 | `dpkg-query -W` / `dumpsys package <pkg>` / `ls -l` + `date -r`（T3 Linux 没有 `--full-time`） | **时间戳**在本轮窗口内（别只比 md5） |
| 文件到位 | `md5sum`（设备 vs 包内） | 一致 |
| **可用性（必查）** | 安卓：`am start`/`monkey -p` 后 `dumpsys activity activities \| grep mResumedActivity`、`pidof <pkg>`、`logcat -d \| grep -F "FATAL EXCEPTION"`；Debian：`systemctl show -p UnitFileState,ActiveState,Result,ExecMainStatus,NRestarts <unit>`；T3 Linux：按包设计取进程集（桌面=Launcher/MDM；服务模式=`JobMonitor.out`/`CFT.out`/`VariableMonitor` 等）+ `ps` + 目视 | 见下「可用性判据」；客户应用/系统服务/桌面起不来 = 不通过 |
| 残留 | `ls /data/*.apk /data/local/tmp/usbroot`、`/media/usb_disk`、`/run/…`、`/mnt/usb/sda1` | 无 |
| 重启回来（OTG） | `adb devices -l`、`lsusb \| grep -iE '2207\|1f3a'`、`uptime` | 切回后 adb 出现；超时按 SKILL §7.3 提示用户切 DEVICE（不写报告） |
| UI（仅 Debian 自动方式） | `ffmpeg -f x11grab` 截屏 | 摘要区 `:uisum…`、结束 `退出码:0`；**手动方式没有摘要，不用截图**（eglfs 机型还可能全黑） |

**可用性判据**（四平台共用；`is-active` 一刀切会误杀，实测就踩过）：

- **常驻服务**（`Type=simple` 长期跑）：`ActiveState=active`，且 `NRestarts` 不持续增长（停在 1 次属正常）。
- **一次性 / oneshot**（如 `cpwelcome`，播完就退出）：`UnitFileState=enabled` + `Result=success` + `ExecMainStatus=0`；`inactive/dead` 是**正常**的。
- **被其它单元拉起**（如 `lovolrun` 由 `cpfeh` 启动）：`ActiveState=active` 即可，`UnitFileState=disabled` 是**正常**的；证据里写清"谁拉起的"（journal 行）。
- **安卓应用**：有 Launcher Activity → 启动后 `mResumedActivity` 命中包名；**无 Activity 的服务型**（如 `com.android.guard`、VanCoreT3）→ `dumpsys activity services <pkg>` 有记录或 `pidof` 非空。两种情况都要求 logcat 无该包的 `FATAL EXCEPTION`。
- **T3 Linux 桌面/服务**：桌面包看 `pidof Launcher`、`pidof MDM`；服务模式包看包内约定的进程（如 `JobMonitor.out`、`CFT.out`、`VariableMonitor`）。服务模式替换 Launcher 时，Launcher/MDM 不在是**可能正常**的，报告写清包设计，不要一律判失败。
- **T3 Linux UI**：`eglfs/mali` 下 `/dev/fb0` 可能仍显示开机帧/黑屏，不能据此判 UI 成败；必须目视或拍照，否则标「未验证（需目视）」。
