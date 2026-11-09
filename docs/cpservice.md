> **合并后说明（2026-11-09）**：本文件是合并前的详细说明，保留作为子插件文档。
> 包名已改为 `@local/cp-tools`，入口为 `@local/cp-tools/{docs,firmware,cpservice,flash}`；
> 源码路径已移到 `src/<子插件>/`，固定流程改用 `scripts/` 下的脚本。安装与总览见根 `README.md`。

# E9631Service / CpService / RK Debian / T3 Linux（U 盘升级包 skill，调用命令 `/cpservice`）

按需求生成 U 盘升级包（**RK 安卓 `CpService.xml`** / **T3 安卓 `E9631Service.xml`** / **RK Debian `unattended_installation.sh` + `auto_unattended_installation`** / **T3 Linux（Buildroot）盘根 `unattended_installation.sh`**），并在真机上验证。纯 skill，不带工具。

**整机线刷已剥离**（2026-11-09）：全量覆盖烧写走独立 skill `flash`（`/flash`，源码 `src/flash/`），本 skill 只做 U 盘升级包。

## 结构（一份事实只写一处）

| 文件 | 角色 |
|---|---|
| `src/cpservice/skills/cpservice/SKILL.md` | **调度器**：判定平台 → 读对应 reference → 出包 → 自检 → 验证主线 → 报告；唯一平台差异表、验证流程、文件索引都在这 |
| `src/cpservice/skills/cpservice/references/rk-android.md` | RK 安卓事实：工具/21 个动作/落点/写权限/验证命令/实测/坑/MDM 边界 |
| `src/cpservice/skills/cpservice/references/t3-android.md` | T3 安卓事实：工具/9 个动作/mksh 约束/假挂载验证/坑/MDM+WiFi |
| `src/cpservice/skills/cpservice/references/rk-debian.md` | RK Debian 事实：两种安装方式（自动 udev / 手动 GUI）、包结构、`:uisum` 协议、脚本约束、dpkg/落点、验证、坑 |
| `src/cpservice/skills/cpservice/references/t3-linux.md` | T3 Linux（Buildroot）事实：`/Launcher` 触发链、`/mnt/usb/sda1`、包结构、落点、bash 约束、假挂载验证、坑 |
| `src/cpservice/skills/cpservice/assets/` | 模板、探针、触发、核验、虚拟盘、Debian 触发脚本、**logo 资源生成驱动**（清单见 SKILL 文件索引） |
| `src/cpservice/skills/cpservice/vendor/` | T3 可复用二进制（`VanCoreT3-260414.apk`、CYW43438 固件）；RK 不复用 WiFi 固件 |

## 平台判定

先看系统，再看工具：

- **Debian**：`/etc/os-release` 是 `Debian 11 (bullseye)`，装了 `unattendedinstallationtools`（`/usr/bin/silentInstaller`、udev 规则 `10-auto_unattended_installation.rules`）。
- **RK 安卓**：`com.cpdevice.cpservice`（`/system/priv-app/CpService/CpService.apk`），读 `CpService.xml`。
- **T3 安卓**：`com.android.guard`，读 `E9631Service.xml`。
- **T3 Linux（Buildroot）**：`/etc/os-release` 是 `Buildroot 2016.11`，桌面 `/Launcher`；盘根 `unattended_installation.sh` 由「设置→U盘查看→右上开关」触发。

判据、优先级、无设备时怎么问，见 `src/cpservice/skills/cpservice/SKILL.md` §1。**机型名不能当判据**（SP2-10PRO、SP2-10MIX 在 RK 安卓 / RK Debian / T3 都有）。

## 怎么用

新会话里直接提需求即可：

> 给 RK 的 SP2-10MIX 做个升级包：装 VanCoreT3，换 logo 和开机动画，装完重启。

模型会：判定平台 → 读 `references/rk-android.md` → 生成 `CpService.xml`（必要时配 `setup_cpservice.sh`）→ 本机自检 → 真机验证（RK 假挂载无效；没有真盘就用 `rk-virtual-disk.sh` 造 `sm` 虚拟盘）→ 出带证据的验证报告。

T3 同理：

> 给 QX_SP2-10PRO 做个升级包：装 MyLauncher，换开机 logo，推 WiFi 固件，装完重启。

Debian：

> 给 SPRING2-PRO 做个 U 盘静默安装包：插盘自动装 app.deb，写一条日志，别自动重启。

模型会：判定 RK Debian → 读 `references/rk-debian.md` → 生成 `auto_unattended_installation/auto_unattended_installation.sh`（bash + `:uisum`）+ 根 `unattended_installation.sh`（sh 入口）→ 自检 → 真机验证（模拟挂载跑 udev 链 + 工具窗口入口 + UI 截屏；真盘 udev 需人配合）→ 报告 → zip。

T3 Linux：

> 给 SPRING2_L 做个 U 盘静默安装包：装应用 tar，换 logo 和 bootlogo，装完重启。

模型会：判定 T3 Linux（Buildroot）→ 读 `references/t3-linux.md` → 生成盘根 `unattended_installation.sh`（bash，`+x`，日志 `/data/cp-unattended/`）→ 自检 → 真机验证（假挂载 `/mnt/usb/sda1` + `bash`/stdin 两种触发；GUI 点击人工）→ 报告 → zip。

整机线刷（会清数据）已独立成 skill `flash`（命令 `/flash`，源码 `src/flash/`，SOP `src/flash/skills/flash/SKILL.md`）：

> 给这台 SPRING2-PRO 刷成 V1.16，然后确认版本号。

模型会：`/firmware` 查 OSS 线刷直链 → `flash.sh plan`（只看不刷）→ `flash.sh flash --quiet`（自动 `adb reboot loader` → `rk_upgrade_tool UF`）→ 回线后**只比 `Version=`** 即判通过（boot_id / systemd 仅记录）。详见 [`docs/flash.md`](flash.md)。

常见更新：

> 更新 mdm 和 wifi 固件 —— T3 安卓套 `t3-android.md` §7；RK 只装 MDM，WiFi 固件要先确认模块型号。

只做开机 logo（不进整包）：

> 用这张图给 RK 安卓出一套开机 logo —— 模型调 `assets/generate-bootlogo.sh`（SKILL §8.4），按 芯片×系统 出 `logo.img`/`bootlogo.bmp`/`logo`/`video_demo.yuv` + 对应 xml 或安装脚本，产物落 `~/Downloads/<CHIP>_<SYSTEM>_<name>_<日期>/` 并自检。

验证现成包：

> 验证 /home/my/Downloads/20260717/ 这个包

RK 样板包在 `/home/my/Downloads/20260717/`；工具源码与逐条说明在 `/home/my/Downloads/android-cpservice-develop/`。
Debian 现网包在 `/home/my/customizationData/archive/雷沃/` 与 `/home/my/other/customizationData/patches/debian_auto_openssh_drop.zip`。
T3 Linux 现网包示例：`/home/my/customizationData/archive/雷沃/lovol_install_服务模式(JK01101020000a)_20250423.zip`。

显式调用：`/cpservice`（原命令 `/e9631service` 已改名）。

## 自检

```bash
node scripts/verify.mjs --fast   # 插件契约 + references/assets 齐全 + 去重/链接守卫 + 事实清单
```

skill 正文是运行时从 `src/cpservice/skills/cpservice/SKILL.md` 读的：改完要**新会话**（或重载插件）才生效。

## 安装到 profile

```bash
# 1) 放到插件目录（示例）
cp -r /path/to/cp-tools ~/Documents/deepseek-harness/default-workspace/plugins/

# 2) 在 ~/.dsh/profiles/web/package.json 的 dependencies 里加
#    "@local/cp-tools/cpservice": "link:/path/to/plugins/E9631Service"
#    并在 dsh.profile.bundles 里加 "@local/cp-tools/cpservice"

# 3) 安装依赖并重启 dsh web
cd ~/.dsh/profiles/web && pnpm install
```

## 目录

```
E9631Service/
├── package.json
├── cordis.patch.yml     # 把插件插进 profile
├── index.js             # 读 skills/cpservice/SKILL.md 并 ctx.skills.register()
├── test/smoke.mjs       # 离线自检（含去重与链接守卫）
├── skills/cpservice/vendor/  # T3 可复用二进制
└── skills/cpservice/
    ├── SKILL.md         # 调度器：判定 + 共享约束 + 验证主线
    ├── references/
    │   ├── rk-android.md
    │   ├── t3-android.md
    │   ├── rk-debian.md
    │   └── t3-linux.md
    └── assets/          # 模板 / 探针 / 触发 / 核验 / 虚拟盘 / Debian / T3 Linux 触发
```
