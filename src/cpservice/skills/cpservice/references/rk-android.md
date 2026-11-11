# RK 安卓：`CpService.xml`（com.cpdevice.cpservice）

> **适用**：Rockchip RK356x / RK3588 的 Android 11+。
> **实测机**：`SPRING2_MIX` / `ro.board.platform=rk356x` / Android 11（SDK 30）/ `userdebug` / 固件 `CP_SP2-10MIX_A_V1.17_LCD10_B0_MDM_20260923`。
> **工具**：`com.cpdevice.cpservice` 7.5.4（`/system/priv-app/CpService/CpService.apk`），**21 个动作**；xml 固定 `CpService.xml`。
> **依据**：`android-cpservice-develop`（`_Command.java` 为准 + `doc/操作说明.md`）与示例包 `/home/my/Downloads/20260717/`。
> **先读** `../SKILL.md`（判定、共享硬约束、验证主线）；T3 用 `t3-android.md`。

---

## 1. 工具与触发

1. 插盘 → 系统发 `ACTION_MEDIA_MOUNTED`（`file://`）。
2. `App` 里**动态注册**的 receiver 收到（排除 `/storage/emulated/0`），5 秒防抖，调 `_Command.instance().start()`。
3. `getSdCardPath()` 反射遍历 `StorageManager.getVolumeList()`，取**非 `emulated`、非 `self`、可读可写**的卷根当 `mRootDir`；配置 = `<mRootDir>/CpService.xml`。
4. 按 XML 顺序**逐条同步**执行。

要点：

- **假挂载 + 广播无效**：工具不看广播里的路径，自己枚举真实卷；`/storage/udisk(id=TEST)` 这类自建目录不在卷列表。没有真盘时用 `sm` 虚拟磁盘造真实公共卷（§7.2），adb-only 也能整包验证。
- `getSdCardPath()` 取**最后一个**符合条件卷；插多个盘时先只留一个。U 盘必须可写。
- logcat：TAG `_Command`（`--xml---action---…`、`--getAbsolutePath---…`）、`vacay`（`getStoragePath--->path=…;label=…`）、`vaca`（解析异常）、`cpservice`。UI 只有 Toast，**没有日志文件**，随包脚本必须自己写日志。

### 解析规则（写 xml 前必知）

- 只认 `<item>`；**`action` 或 `params` 任一为空 → 整条静默跳过**（`remount` 也要写非空 `params`）。
- 属性：`params` 主参数；`param1` 第二参数（只有 `copy` / `copyout` / `app_splash` 用）。
- 单条抛异常只记 logcat，不影响后续；`canuse_ver` 不匹配或 `runlimit` 超限 → `cmdFlag=false`，后续全跳，直到本次解析结束。
- 严格解析器：坏 xml 只在 logcat 留 `xml--…`，现场就是「插盘没反应」。

---

## 2. 动作表（21 个）

| # | action | params / param1 | 落点或效果 | 坑 / 生效 |
|---|---|---|---|---|
| 1 | `canuse_ver` | 版本片段 / — | `ro.build.cp.version` 的 `contains` 判断，不匹配跳后续 | 不可恢复；默认不加 |
| 2 | `installSync` | APK 名 / — | 不落盘，`pm install -t -r -d <U盘路径>` | FUSE 读盘可能失败，首选 `install` |
| 3 | `install` | APK 名 / — | 复制 `/data/<apk>` → `pm install -t -r -d` → 成功删除 | `reboot` 自动延后；失败留残留、不重试 |
| 4 | `uninstall` | 包名 / — | `pm uninstall --user 0` | 系统分区 APK 仍在 |
| 5 | `start` | `包名/类名` / — | `am start -n` | 输出通常不是 `Success`，别据此判失败 |
| 6 | `cmd` | shell 命令 / — | root shell 原样执行 | 含 `settings put` 会被转交；`reboot` 可能延后 |
| 7 | `remount` | 任意非空 / — | `mount -o rw,remount /system` `/vendor` `/product` + `sys.adb.remount=all` | `/system` 无独立挂载点，基本无效（§4） |
| 8 | `ota` | OTA 包名 / — | `/data/update.zip` → `RecoverySystem.installPackage` | 重启进 recovery；源不删 |
| 9 | `logo` | **必须 `logo.img`** / — | `/sdcard/logo.img`；SDK<34 `dd` 到 `/dev/block/by-name/logo` | 名字硬编码；SDK≥34 只置属性（§3.2） |
| 10 | `boot` | **必须 `boot.img`** / — | `/sdcard/boot.img` + `sys.copy.bootimg=doit` | 名字硬编码；消费端在系统侧 |
| 11 | `app_splash` | png / 包名 | `/data/overlay/vendor/addon/app/<包名>/splash.png` | 需 overlay 生效/重启 |
| 12 | `bootanimation` | **必须 `bootanimation.zip`** / — | `/data/media/bootanimation.zip` | `chmod` 硬编码（§3.3） |
| 13 | `copy` | U 盘文件名 / 目标**目录** | 无 param1 → `/data/<名>`；有 → `cp` 到 `<param1>` | param1 是目录，不是文件（§3.4） |
| 14 | `copyout` | 设备绝对路径 / U 盘内相对名 | 设备 → U 盘根（目录自动 `cp -r`） | 本机 7.5.4 **失效**（§3.4） |
| 15 | `system_apns` | `apns-conf.xml` / — | `/data/overlay/system/etc/apns-conf.xml` | 目标名固定；需 overlay 生效 |
| 16 | `product_apns` | `apns-conf.xml` / — | `/data/overlay/product/etc/apns-conf.xml` | 同上 |
| 17 | `settings` | `settings put <ns> <key> <value>` / — | `Settings.System/Global/Secure.putString` | 值不能带空格 |
| 18 | `wallpaper` | png / — | `/data/media/wallpaper.png` + `WallpaperManager` | **只生效一次**（§3.5） |
| 19 | `odmapp` | APK 名 / — | 删 `/odm/…/<名>` 再走 20 | 仅恢复出厂预装用（§3.6） |
| 20 | `installApkReSetRestore` | APK 名 / — | `/cache/cpservice/<apk>` + `install_apk.xml` + `installSync` | 外部约定，无读取端（§3.6） |
| 21 | `runlimit` | 次数（0=不限） / — | `persist.cps.xml.run.time` 计数，超限跳后续 | 放最前；验证后清零（§3.5） |

---

## 3. 有坑的动作

### 3.1 `install` / `installSync`

- `install`：Java 流复制 U 盘 → `/data/<apk>` → `pm install -t -r -d` → 成功删残留。失败不删、不重试。
- **与 `reboot` 联动**：`install` 让安装计数 +1，后面的 `cmd reboot` 只登记不执行，等最后一个 APK 装完才真正重启——所以 RK 上「`install` 紧跟 `cmd reboot`」是安全的（T3 相反）。
- `installSync` 直接把 U 盘路径交给 `pm`，省 `/data` 空间，但**FUSE 路径 root/`pm` 可能读不了**；失败就换 `install`。

### 3.2 `logo`

```xml
<item action="logo" params="logo.img"/>
```

- **params 必须叫 `logo.img`**：先 `cp` 到 `/sdcard/`，SDK<34 再 `dd if=/sdcard/logo.img of=/dev/block/by-name/logo`；`dd` 输入路径硬编码，改名 → `cp` 成功、`dd` 读不到 → 静默不生效。
- 生成：`assets/generate-bootlogo.sh --chip RK --system Android`（`../SKILL.md` §8.4）；`logo.img` 格式 = BMP + 458 字节 0 + BMP（1024x600 → 3,686,966 B，1280x800 → 6,144,566 B，现场包实测）。
- SDK≥34 只置 `sys.copy.bootlogo=doit`，写入由系统侧完成（本机 SDK 30 走 `dd`）。
- 验证：分区前 N 字节 md5 与包内一致（分区比文件大，按文件长度比）：

```bash
adb exec-out 'dd if=/dev/block/by-name/logo 2>/dev/null' | head -c "$(stat -c %s logo.img)" | md5sum
```

- 现成中性图：`assets/presets/rk-android-neutral/logo.img`（1024x600，3,686,966 B，md5 `a3e60d60…`）——**仅当需求明确要中性**时才用（`../SKILL.md` §8.4）。

### 3.3 `bootanimation`

- 落 `/data/media/bootanimation.zip`（**不是 `/system/media`**）；本机 `/system/etc/init.bootanimation.sh` 读它，缺失时用 `/system/media/` 兜底 → RK 原生支持。
- **文件名必须叫 `bootanimation.zip`**（`chmod` 硬编码）；不写系统属性。
- 现成中性动画：`assets/presets/rk-android-neutral/bootanimation.zip`（全 stored，`desc.txt` = `1024 600 10` + 单帧 `part0`）。

### 3.4 `copy` / `copyout`

```xml
<item action="copy" params="setup_cpservice.sh" param1="/data/local/tmp"/>
<item action="copy" params="testbb.sh"/>                      <!-- 不写 param1 → /data/ -->
```

- `param1` 被当**目录**：传文件路径时 `cp` 成功但 `chmod` 失败。这就是 RK 的「暂存脚本」写法（对应 T3 的 `dstdir`/`udiskfile`）。
- `copyout` 本机 **7.5.4 实测不可用**：走 native shell（system uid），写 FUSE 卷被拒（`cp: Permission denied`），logcat 有 action 但盘上无文件。回传结果改用 `cmd` + 脚本以 root `cp`（`assets/probe-collect.sh`），或写 `/sdcard` 用 adb 取。

### 3.5 `wallpaper` / `runlimit` / `settings` / `canuse_ver`

- `wallpaper`：`persist.wallpaper.set=true` 后永久跳过；重设先 `setprop persist.wallpaper.set false`。
- `runlimit`：`persist.cps.xml.run.time` 跨重启累计，必须放 XML 最前；验证完 `setprop persist.cps.xml.run.time 0`。
- `settings`：至少 5 段，值里不能带空格；格式错只弹 Toast。
- `canuse_ver`：`contains` 匹配，不是全等；一旦不匹配后续全跳且不可恢复。

### 3.6 `odmapp` / `installApkReSetRestore`

- `odmapp`：`mount -o remount,rw /odm` + 删旧目录（SDK<34 `bundled_uninstall_back-app`，≥34 `bundled_persist-app`），再走 `installApkReSetRestore`。只用于「恢复出厂保留」预装。
- `installApkReSetRestore`：复制 `/cache/cpservice/<apk>` + 追加 `install_apk.xml`（按包名去重）+ `installSync`；该 xml 是给恢复出厂/OTA 侧的外部约定，仓库内无读取端。

### 3.7 其余动作一句话

- `ota`：复制固定名 `/data/update.zip` → recovery；`boot`：`/sdcard/boot.img` + `sys.copy.bootimg`（消费端在系统侧）；`app_splash`/`system_apns`/`product_apns`：落 `/data/overlay/…`，需 overlay 生效；`uninstall --user 0`；`start` 不保证 `Success`；`cmd` 可写多语句但复杂逻辑仍应走脚本。

---

## 4. 落点与写权限（本机实测）

| 项 | 值 |
|---|---|
| `/` | `dm-0` ext4 **ro**（system-as-root） |
| `/system_ext` `/vendor` `/product` `/odm` | `dm-1` ~ `dm-4`，全部 **ro** |
| 动态分区 | `ro.boot.dynamic_partitions=true`；`super` = `mmcblk2p13` |
| verity | `ro.boot.veritymode=enforcing`、`verifiedbootstate=orange`（userdebug） |
| logo / boot | `/dev/block/by-name/logo` → `mmcblk2p12`；`boot` → `mmcblk2p7` |

**RK 升级包默认不写 `/system` / `/vendor` / `/product`：**

- `/system` 没有独立挂载点，`remount` 动作里那条基本无效；`/vendor`、`/product` 是 dm 只读逻辑卷，未禁 verity 也挂不上 rw。
- 改系统内容走 overlay（`/data/overlay`）或 `adb remount`（userdebug，需先 `adb disable-verity` 并重启）——**U 盘包不做**。
- 安全落点：`/data`、`/data/media`、`/data/local`、`/data/local/tmp`、`/cache/cpservice`、`/sdcard`、logo 分区（走 `logo` 动作）。
- 客户坚持写 `/system`：说明 verity 风险，改 overlay 或单独走 adb remount。

---

## 5. 出包模板

### 5.1 纯 xml

```xml
<?xml version="1.0" encoding="utf-8"?>
<root>
	<item action="install" params="VanCoreT3-260414.apk"/>
	<item action="logo" params="logo.img"/>
	<item action="bootanimation" params="bootanimation.zip"/>
	<item action="copy" params="fw_xxx.bin" param1="/data/local/tmp"/>
	<item action="cmd" params="sync"/>
	<item action="cmd" params="reboot"/>
</root>
```

中性 logo/动画整套现成（`assets/presets/rk-android-neutral/`，同样 5 条动作）：**仅当需求明确要中性**时直接用，否则按需生成（`../SKILL.md` §8.4）。

### 5.2 薄壳 + 脚本（多步骤/要日志/要判定时首选）

```xml
<root>
	<item action="copy" params="setup_cpservice.sh" param1="/data/local/tmp"/>
	<item action="cmd" params="sh /data/local/tmp/setup_cpservice.sh"/>
</root>
```

模板 `assets/cpservice-setup-template.sh`：改顶部 `APK_LIST`/`COPY_DIRS`/`COPY_FILES`/`LOGO_IMG`/`BOOTANIMATION`/`DO_REBOOT`。

### 5.3 示例包 `/home/my/Downloads/20260717/`

`CpService.xml`（一条 `cmd` 调脚本）+ `setup_cpservice.sh`（装 2 APK、`dd` logo、`/data/media/bootanimation.zip`、拷 `fcw/data`、`fcw/model`、`tts`、`setprop logd`、`sync`、`reboot`）。

照抄骨架与落点；`pm install -r` 建议统一 `-t -r -d`；别手写 `dd` logo、手拷动画——原生 `logo`/`bootanimation` 动作等价且更稳。

## 6. 设备端脚本（RK 增量）

只管与通则不同的部分（通则见 `../SKILL.md` §5.3）：

- toybox 有 `awk`/`sed`/`grep`/`md5sum`/`sqlite3`/`dd`，可以直接用 `awk`（T3 不行）。
- 不写 `/system` / `/vendor` / `/product`（见 §4）。
- 日志建议 `/sdcard/cpservice_setup.log`；工具 UI 看不到脚本 stdout。

---

## 7. 验证命令（RK）

### 7.1 认设备 / 工具

```bash
adb devices -l && adb shell id
adb shell 'getprop ro.board.platform; getprop ro.build.version.sdk; getprop ro.build.cp.version'
adb shell 'pm path com.cpdevice.cpservice; dumpsys package com.cpdevice.cpservice | grep -E "versionName|versionCode"'
# 期望：/system/priv-app/CpService/CpService.apk，versionName=7.5.4
adb shell 'for c in awk sed grep md5sum sqlite3 dd; do printf "%s=" $c; command -v $c || echo MISSING; done'
```

### 7.2 整包（虚拟盘优先，真盘同理）

**虚拟盘（adb-only）**：

```bash
./assets/rk-virtual-disk.sh setup                 # 输出 OK: /storage/XXXX-XXXX
adb push ./<包目录>/. /storage/XXXX-XXXX/          # 实测 ≈15 s / 314 MB
adb shell 'am broadcast -a android.intent.action.MEDIA_MOUNTED -d file:///storage/XXXX-XXXX'
sleep 4 && adb shell 'rm -f /storage/XXXX-XXXX/CpService.xml'   # 见下「删 xml 时机」
# 验完：./assets/rk-virtual-disk.sh teardown
```

- 卷约 511 MB（`df` 实测 511M）：314 MB 的包占 62%，再大就换真盘或只放必需文件。
- 工具日志里卷的 label 是 `Virtual SD 卡`；`disk:7,0` 这类 id 每台机器/每次重建都可能变，脚本自己取。
- 已 push 到 `/data` 的包，用 `adb shell 'cp -r /data/local/tmp/usbroot/. /storage/XXXX-XXXX/'` 走本地拷贝，比再 push 一次 FUSE 快且稳。
- `sm set-virtual-disk true` 后 `sm list-disks` 可能要等几秒（脚本已轮询 15 s）；仍为空就手工 `sleep 5; sm list-disks` 再 `sm partition disk:7,0 public`。
- `sm partition` 会格式化虚拟盘；重启后不一定自动挂回，先 `./assets/rk-virtual-disk.sh status`。

**删 xml 的时机**：工具先整份解析再逐条执行，**触发后 3～4 s 删卷根 `CpService.xml` 不影响正在跑的条目**（实测 07:30:30 触发、07:30:34 删、07:30:41 正常装完），还能避免重启循环。

**真盘**：插盘后看

```bash
adb shell 'logcat -c'
adb logcat -d -s _Command | tail -30
adb logcat -d | grep -E "getStoragePath--->|--xml---action---|--getAbsolutePath---" | tail -20
```

期望：`_Command: 版本:7.5.4`、`vacay: getStoragePath--->path=/storage/XXXX-XXXX;label=…`、`--getAbsolutePath---/storage/XXXX-XXXX`、`--xml---action---…`。**假挂载不会有 action 行**（卷枚举里没有）。

### 7.3 核验（RK 专属行）与收尾

跑 `assets/verify.sh --rk <日志> [pkg...]`，或手工核对（通用行见 `../SKILL.md` §7.4）：

| 检查项 | 命令 | 通过判据 |
|---|---|---|
| 工具执行 | `logcat -d -s _Command` | 有 `--getAbsolutePath---` + `--xml---action---`，`vaca` 无异常；**重启前有效** |
| logo | 分区前 N 字节 md5（§3.2） | 与包内 `logo.img` 一致 |
| 开机动画 | `md5sum /data/media/bootanimation.zip` | 与包内一致 |
| 预装登记 | `ls -l /cache/cpservice/`；`cat /cache/cpservice/install_apk.xml` | 仅 `odmapp`/`installApkReSetRestore` 时查 |
| 一次性/计数 | `getprop persist.cps.xml.run.time`；`getprop persist.wallpaper.set` | 与预期一致，验证后清零 |
| 卷根 xml | `ls /storage/*/CpService.xml` | 无（否则重启循环） |
| **客户应用能启动**（必查） | `monkey -p <pkg> -c android.intent.category.LAUNCHER 1`；`dumpsys activity activities \| grep mResumedActivity`；`pidof <pkg>`；`logcat -d -b crash` | `mResumedActivity` 命中包名或进程常驻，且无该包 `FATAL EXCEPTION` |

收尾：

```bash
adb shell 'rm -f /storage/*/CpService.xml'
adb shell 'rm -rf /data/local/tmp/usbroot /data/local/tmp/probe_*'
adb shell 'rm -f /data/local/tmp/no_reboot'
adb shell 'setprop persist.cps.xml.run.time 0'
./assets/rk-virtual-disk.sh teardown      # 会先删卷根 xml，再卸卷
```

**teardown 坑**：它会把 `emulated;0` 一起 eject，之后 `/storage/emulated/0` 报 `Transport endpoint is not connected`。脚本已自动 `sm mount emulated\;0` 并自检；输出 `⚠` 时手工执行 `adb shell 'sm mount emulated\;0'`（分号转义）。

### 7.4 实测记录（2026-11-05，SPRING2_MIX）

一轮完整验证 ≈2 分钟（不含打包/推送）：

| 步 | 实测 | 教训 |
|---|---|---|
| 认设备/工具（一条 adb 全探） | ≈1 s | 别拆成七八次调用 |
| 前置：基线 + 备份 logo/动画 + 清障 + 算容量 | ≈3 s | 跳过就会中途返工（logo 会变） |
| 虚拟盘 setup + 推 314 MB 包 | 5～8 s + 15 s | 卷 512 MB，包 314 MB 占 62% |
| 触发 → 抓 logcat → 4 s 后删 xml | ≈2 s | 不删 → 重启后自动挂卷再执行 → 重启循环 |
| 脚本跑完（看 `lastUpdateTime`） | ≈10 s | 用内容 md5 判完成会误判 |
| 真实重启 → adb 回来 | ≈70 s | 别为「取证」预跑屏蔽 reboot 的整包 |
| 重启后核验（md5/时间戳/uptime/属性） | ≈5 s | 证据重启后全在 |
| 收尾：卸卷、清临时目录、确认 `/sdcard` 可写 | ≈5 s | teardown 会 eject emulated（已修） |
| 回线超时才提示用户切 OTG（不写报告） | — | 固定动作（SKILL §7.3） |

**重启会清空 logcat**：重启后只剩 `--------- beginning of …`，工具执行行全丢——「工具真的执行了」只能用重启前抓的日志。

### 7.5 坑表

| 现象 | 原因 | 处理 |
|---|---|---|
| 插盘完全没反应 | 盘只读 / 卷不可写；或根目录没有 `CpService.xml`（大小写也算） | `logcat -s _Command` 看有没有 `--getAbsolutePath---`；换可写盘 |
| 设备一直重启（重启循环） | 卷根留着带 `install`+`cmd reboot` 的 xml，每次开机自动执行 | 进得去 adb 就 `rm -f /storage/*/CpService.xml` 断环，再卸应用、teardown；排队的那次 reboot 仍会执行一次 |
| 某条动作像没执行 | `params` 为空被静默跳过（`remount` 最容易踩） | 所有 `<item>` 带非空 `params` |
| `logo` 拷了但不生效 | 文件不叫 `logo.img`，`dd` 读死 `/sdcard/logo.img` | 文件名固定 |
| `bootanimation` 的 `chmod` 报错 | 文件不叫 `bootanimation.zip` | 文件名固定 |
| `copy` 后权限不对 | `param1` 被当目录，传了文件路径 | `param1` 只写目录 |
| 壁纸改不回来 | `persist.wallpaper.set=true` 永久跳过 | `setprop persist.wallpaper.set false` 后重试 |
| 只执行了第一次 | `runlimit` 计数已满 | 看 `persist.cps.xml.run.time`，`0` 清零 |
| `settings` 没生效 | 值里带空格被拆段 | 值不带空格，或 `cmd` + `setprop` |
| `installSync` 失败 | FUSE 路径 root/`pm` 读不了 | 改用 `install` |
| 写 `/system` 失败 | 动态分区 + verity | 改落 `/data`/overlay，或走 adb remount |
| `copyout` 无文件 | system uid 写 FUSE 被拒 | 用 `probe-collect.sh` 的 root 回拷，或写 `/sdcard` |

---

## 8. MDM / WiFi 边界

- RK 固件同样有 `com.cp.vancoret3`；`vendor/VanCoreT3-260414.apk` 可装：`pm install -t -r -d /data/VanCoreT3-<build>.apk`，证据同 T3（`codePath=/data/app/…` 那条的 `lastUpdateTime`）。
- **`vendor/fw_cyw43438.bin` / `nvram_cyw43438.txt` 是 T3 的 CYW43438 专用，RK 不要用**。先 `lsmod`、`dmesg | grep -i -E "wifi|wlan|cfg80211"` 确认模块与驱动期望文件名，再单独出包。
- 参数与 md5 见 `vendor/README.md`。

---

## 9. 参考

- 工具源码：`/home/my/Downloads/android-cpservice-develop/`（以 `app/src/main/java/com/cpdevice/cpservice/_Command.java` 为准；`doc/操作说明.md` 逐条说明）。
- 示例包：`/home/my/Downloads/20260717/`。
- 本机固件：`CP_SP2-10MIX_A_V1.17_LCD10_B0_MDM_20260923`。
- 固件升级后行为变化，以现场 `logcat -s _Command` 为准，并回写本文件坑表。
