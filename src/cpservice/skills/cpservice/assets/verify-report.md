# 验证报告：<机型/客户> · <包名>

- **平台**：`RK 安卓（CpService.xml）` / `T3 安卓（E9631Service.xml）` / `RK Debian（unattended_installation.sh）` / `T3 Linux（Buildroot；桌面包 / 服务模式包）`；判据 `<pm path … / /etc/os-release + dpkg -l unattendedinstallationtools / os-release=Buildroot + /Launcher>`
- **包**：`<文件名>` md5 `<…>`；**设备**：`<model / hostname>` / `<Android 版本 / Debian 11 / Buildroot 2016.11 + kernel>`；**触发**：`<真盘 / sm 虚拟盘 / 假挂载广播 / 模拟挂载点 / GUI 切换开关>`
- **形态**：`<平铺 / 套目录>`；T3 Linux 入口 `<盘根 / 子目录>`，zip 内模式 `<0755 / 0664>`；**服务模式**：`<是 / 否>`（是则写清约定进程）
- **时间**：`<安装窗口>` → `<重启后 uptime 归零时刻>`（安装 `<n>` s / 重启 `<n>` s）

> 写法：只回答三列——**包里有什么、期望什么、实际什么**。不写安装过程（不要 `cp`/`tar`/`apt`/"第几步做了什么"）。每条挂证据；没跑写「未验证」。主表 ≤12 行，异常才加附录。

## 包内交付物 → 期望 → 实际

| 交付物（包里有什么） | 期望状态 | 实际（证据） | 结论 |
|---|---|---|---|
| `<xxx.apk / 二进制 / tar 载荷>`（客户应用） | 已安装/落盘 `<版本>`，且能启动 | `dumpsys package` / `am start` → `mResumedActivity` / `pidof` / 落点 md5 | ✅ |
| `<yyy.service>`（系统服务） | `enabled` + 起得来（判据见可用性）+ 重启后仍可用 | `systemctl show -p UnitFileState,ActiveState,Result,ExecMainStatus,NRestarts` | ✅ |
| `logo.img` | 分区前 `<N>` 字节 md5 一致 | `beda5b36…`（设备 = 包内） | ✅ |
| `bootanimation.zip` / 开机动画 | 落点 md5 一致 | `<md5>` | ✅ |
| `<fw_xxx.bin / 配置文件 / 资源>` | 落点与 md5 一致 | `<md5 + ls -l + date -r>` | ✅ |
| 固件/属性（T3 固件、`persist.*`） | 重启后加载/值正确 | `dmesg` / `getprop` | ✅/仅目视 |

## 可用性（必查，缺一项不算验证完）

| 项 | 期望 | 实际 | 结论 |
|---|---|---|---|
| **安卓客户应用启动** | 启动后前台是本应用，或无 Activity 的服务型进程常驻，无 `FATAL EXCEPTION` | `<启动方式 + mResumedActivity/pidof + logcat>` | ✅/未验证 |
| **系统服务启动** | 常驻：`active`；oneshot：`enabled + Result=success`；被拉起：`active` | `<systemctl show 输出>` | ✅ |
| **桌面 / 常驻进程（T3 Linux）** | 桌面包：`/Launcher`、`/mdm/MDM` 在跑；服务模式包：包内约定进程（如 `JobMonitor.out`/`CFT.out`/`VariableMonitor`）常驻，Launcher/MDM 不在可能正常 | `pidof` / `ps` / 0·15·60 s 采样 / 截图或目视 | ✅/未验证 |
| **T3 Linux UI** | 画面可见、可操作 | `eglfs/mali` 不能用 `/dev/fb0` 判定；需目视/拍照 | ✅/未验证（需目视） |
| **重启后仍可用** | `uptime` 归零后应用/服务仍处可用状态 | `<重启后再查一次>` | ✅/未验证 |

**结论**：通过 `<n>`/`<m>`；未验证：`<原因>`；风险：`<一句话>`。

> 纪律：一项不过即停；不在报告里追根因，不把「重启应用后好了」写成通过，不杀业务进程取证。

<!-- 仅当有异常时才保留以下章节，正常情况删掉 -->
## 附录：异常详情

- `<现象>` / `<证据>` / `<影响>` / `<建议>`
