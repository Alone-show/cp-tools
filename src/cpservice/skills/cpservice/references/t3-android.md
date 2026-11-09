# T3 安卓：`E9631Service.xml`（com.android.guard）

> **适用**：Allwinner T3 / Android 6.0.1（历史实测机 `t3_spring`）。
> **工具**：`com.android.guard` 1.4.9（`/system/app/E9631/E9631.apk`），`USBReceiver` 收 `MEDIA_MOUNTED`，日志 `USBReceiver / TaskThread: action = …`。
> **xml 文件名**：`E9631Service.xml`（固定）。
> **先读** `../SKILL.md`（判定、共享硬约束、验证主线）；RK 用 `rk-android.md`；T3 Linux（Buildroot，`/Launcher`）用 `t3-linux.md`。

---

## 1. 工具与触发

- 广播型：`USBReceiver` 收 `ACTION_MEDIA_MOUNTED` 后起 `TaskThread` 逐条执行；正常情况下插盘即跑。
- **先确认是谁在处理这个 xml**（不一定名字带 update 的那个）：

```bash
adb shell 'for d in /system/app /system/priv-app /data/app; do grep -ral "E9631Service" $d 2>/dev/null; done'
adb shell 'ps | grep -i <包名>'                                # 工具进程得在跑，广播才有人收
adb shell 'dumpsys package <包名> | grep -i MEDIA_MOUNTED'     # 有没有 MEDIA_MOUNTED receiver
```

- 同机的 `com.van.update` 是 OTA 升级 App，**不**读这个 xml。

### 选触发方式（别默认假挂载一定行）

| 工具类型 | 判断 | 验证方式 |
|---|---|---|
| 广播型（收 `MEDIA_MOUNTED`） | `dumpsys package` 能查到 receiver | 假挂载 + broadcast（§5.2） |
| 手动型（App 里点「查找/升级」） | 只有 MainActivity、没有 receiver | 真 U 盘，或只做 §5.3 脚本脱机 |
| 只认真实 StorageVolume | 用 `StorageManager.getStorageVolumes()` 枚举卷 | 假目录无效，直接上真盘 |

单 USB 口的设备插真盘会挤掉 adb：分口插，或用假挂载只验脚本 + 动作顺序。

---

## 2. 动作表（9 个）

| action | params | 落点 / 效果 | 坑 |
|---|---|---|---|
| `canuse_ver` | 版本片段 | `ro.build.cp.version` 的 `contains` 判断，不匹配跳后续 | 不可恢复；默认不加 |
| `install` | APK 文件名 | 后台复制到 `/data` 再 `pm install` | 异步，`reboot` 会打断 |
| `uninstall` | 包名 | shell 卸载 | 系统 APK 仍在 |
| `start` | `包名/类名` | `am start` | 输出不一定带 `Success` |
| `cmd` | shell 命令 | root 执行一条命令 | 多步逻辑走脚本 |
| `ota` | OTA 包名 | 复制 + 触发升级 | — |
| `bootlogo` | logo 文件名 | 工具写 **`/bootloader/`**（不是 `boot` 分区） | 别用 `dd` 代替；别用分区 hash 判生效 |
| `bootanimation` | 动画文件名 | 落 `/system/media/` | — |
| `copy` | `srcfile`/`udiskfile` + `dstdir` | 设备内复制，或 U 盘 → 设备 | `dstdir` 是**目标文件** |

### 2.1 `install`（异步）

- 后台复制到 `/data` 再 `pm install`；紧跟其后的 `cmd`/`copy` 会并行。要等装完用 `cmd sleep` 或脚本 `wait`。
- **不要在 `install` 后立刻 `cmd reboot`**（会打断安装）；非要纯 xml 就 `cmd sleep 65`。

### 2.2 `copy`（三个属性）

```xml
<item action="copy" srcfile="/data/AA/aa.txt" dstdir="/system/AA/aa.txt"/>
<item action="copy" udiskfile="testbb.sh" dstdir="/data/testbb.sh"/>
```

- `srcfile` 设备内源；`udiskfile` U 盘根文件名；`dstdir` 目标**文件**。
- 写 `/system` 前先 remount；`dstdir` 以 `/system/` 开头时工具自己 `mount -o remount,rw /dev/block/mmcblk0p7 /system`。

### 2.3 `canuse_ver`

- `contains(params)`，不是全等；不匹配后续全跳且本次解析内不可恢复。
- **默认不加**；要用先 `adb shell getprop ro.build.cp.version`。

## 3. 设备端脚本约束（T3 特有）

随包脚本在设备上由 root shell 跑（通则见 `../SKILL.md` §5.3），T3 额外注意：

| 不许用 | 原因 / 替代 |
|---|---|
| `cmd package resolve-activity` | Android 6 没有 `cmd`（`which cmd` 为空），改解析 `dumpsys package` |
| `awk` | SPRING2 正式版实测 `awk: not found`，`md5sum x \| awk` 静默返回空；md5 用 `${m%% *}` 截断，解析用 `sed`/`grep` |
| `ls -ln` 取属主 | 部分 toybox 没有链接数列，列错位；用 `stat -c '%u:%g'` |
| `while read` 读无结尾换行的列表 | 最后一行被静默丢弃；列表用 `printf '%s\n'` 输出 |

- 电脑端脚本单独命名（如 `add-icon-host.sh`），**不得**由 xml 或 setup 脚本调用。
- 本机 `sh -n` 是 dash，校不出 bash 语法；怀疑时 `bash -n` 或设备上 `sh -n`。
- 路径带 `(id=XXXX)` 括号：`adb shell 'sh /storage/udisk(id=TEST)/x.sh'` 会报 `syntax error: '(' unexpected`，必须整条加引号。

---

## 4. 出包模板

**A 纯 xml**

```xml
<?xml version="1.0" encoding="utf-8"?>
<root>
	<item action="install" params="MyLauncher.apk"/>
	<item action="cmd" params="mount -o rw,remount,rw /system"/>
	<item action="copy" udiskfile="fw_cyw43438.bin" dstdir="/system/vendor/modules/fw_cyw43438.bin"/>
	<item action="cmd" params="sync"/>
	<item action="cmd" params="reboot"/>
</root>
```

**B 薄壳 + 脚本**

```xml
<root>
	<item action="bootlogo" params="bootlogo.bmp"/>
	<item action="copy" udiskfile="setup_e9631service.sh" dstdir="/data/local/tmp/setup_e9631service.sh"/>
	<item action="cmd" params="sh /data/local/tmp/setup_e9631service.sh"/>
</root>
```

`params` 是 **`bootlogo.bmp`**（现场包三处一致：`work/kefeng/…`、`customizationData/archive/data/安卓logo`、Downloads 科丰包），不是 RK 的 `logo.img`。生成：`assets/generate-bootlogo.sh --chip T3 --system Android`（`../SKILL.md` §8.4）。

模板 `assets/setup-template.sh`；脚本自己找盘根，别靠扫挂载点猜自己。出包前 checklist 见 `../SKILL.md` §6.1（通用）。

## 5. 验证命令（T3）

### 5.1 认设备 / 工具

```bash
adb devices -l && adb shell id
adb shell getprop ro.build.cp.version; adb shell getprop ro.build.version.release
adb shell 'for c in awk sed grep tr sqlite3 md5sum; do printf "%s: " $c; command -v $c || echo MISSING; done'
adb shell 'cat /sys/devices/soc.0/usbc0.2/otg_role'   # 重启前应是 usb_device
```

### 5.2 假挂载 + 广播（`assets/trigger.sh`）

```bash
adb shell 'mkdir -p "/storage/udisk(id=TEST)"'
adb push ./<包目录>/. "/storage/udisk(id=TEST)/"
adb shell 'logcat -c; am broadcast -a android.intent.action.MEDIA_MOUNTED -d "file:///storage/udisk(id=TEST)"'
adb shell 'logcat -d | grep -E "USBReceiver|TaskThread|XmlPullParser|System.err" | tail -30'
```

`TaskThread: action = cmdparams =…` 才是真执行；`am broadcast result=0` 不代表有人处理；`XmlPullParserException` = xml 不合法。

### 5.3 脚本脱机（不经过工具）

```bash
adb shell 'mkdir -p /data/local/tmp/usbroot'
adb push ./<包目录>/. /data/local/tmp/usbroot/
adb shell 'touch /data/local/tmp/no_reboot; NO_REBOOT=1 sh /data/local/tmp/usbroot/setup_xxx.sh'
adb shell 'cat /sdcard/setup_xxx.log'
```

真跑 reboot 前先删 `no_reboot`。耗时（t3_spring）：28 MB APK ≈55 s；整包 ≈90 s；加重启 ≈2.5 min，按 5 分钟预留。

### 5.4 核验（T3 专属行）与收尾

跑 `assets/verify.sh --t3 <日志> [pkg...]`，或手工核对（通用行见 `../SKILL.md` §7.4）：

| 检查项 | 命令 | 通过判据 |
|---|---|---|
| 工具执行 | `logcat -d \| grep -E "USBReceiver\|TaskThread"` | 有 action 行、无 `System.err` |
| 固件生效 | `dmesg \| grep -iE "fw_path\|nv_path\|Firmware version"` | 重启后有加载路径/版本 |
| 桌面图标 | `sqlite3 .../launcher.db "select title,cellX,cellY from favorites where container=-100"` | 目标应用在列、属主是 launcher uid |
| 点击副作用 | `dumpsys activity activities \| grep mResumedActivity` | 停在 launcher |
| **服务型应用常驻**（必查） | `dumpsys activity services <pkg> \| grep -c ServiceRecord`；`pidof <pkg>`；`logcat -d -b crash \| grep -A3 'FATAL EXCEPTION'` | ServiceRecord>0 或进程在，且无该包 FATAL（T3 客户应用常常没有 Launcher Activity，别只看界面） |

```bash
adb shell 'rm -rf "/storage/udisk(id=TEST)" /data/local/tmp/usbroot; rm -f /data/local/tmp/no_reboot'
```

`no_reboot` 不删，这台设备以后刷什么包都不重启；假挂载目录不删，下次广播会重复触发。

## 6. 坑表（t3_spring / Android 6.0.1）

| 现象 | 原因 | 处理 |
|---|---|---|
| 图标一个都没生成，日志一行 `No such file or directory` | 脚本是电脑端 bash + adb | 改设备端 mksh + sqlite3（`assets/add-icon-device.sh`） |
| 图标加了，重启后桌面起不来 | root 写 `launcher.db` 属主变 root | `stat -c '%u:%g'` 记原属主，写完 `chown` 回去 + `chmod 660` |
| 包更新后刚加的图标消失 | 桌面更新/重载时清理该包条目 | 脚本跑两轮，第二轮回补 |
| `chown 24576:24576 launcher.db` 把属主弄错 | 用 `ls -ln` 取属主，toybox 无链接数列、列错位 | 一律 `stat -c '%u:%g'` |
| `while read` 漏掉最后一个目标 | 列表结尾没换行 | `printf '%s\n'` 输出 |
| `sh /storage/udisk(id=TEST)/x.sh` 报 `syntax error: '(' unexpected` | 路径括号没加引号 | 整条加引号（通用规则 SKILL §5.1-4；脚本内 `"$d/..."` 也加） |
| `cmd package resolve-activity` 报 `cmd: not found` | Android 6 没有 `cmd` | 解析 `dumpsys package` |
| bootlogo 后 `boot` 分区 hash 没变 | 实际写 bootloader 分区（`/dev/block/mmcblk0p2`） | 别用分区 hash 下结论，看真机画面 |
| 插上真 U 盘 adb 掉线 | 单 USB 口 OTG 被盘占用 | 分口插，或假挂载验证 |
| 重启后 adb 一直不回来 | 见 SKILL §7.3 | 超时仍未回线才提示用户切 DEVICE，再继续 `adb wait-for-device` |

---

## 7. MDM / WiFi

素材在 `vendor/`，文件名与 md5 见 `vendor/README.md`（本文不重复 md5）。

### 7.1 VanCoreT3（MDM）

| 项 | 值 |
|---|---|
| 包名 / 组件 | `com.cp.vancoret3` / `com.cp.vancoret3/.view.MainActivity` |
| APK 命名 | `VanCoreT3-<build>.apk`（如 `VanCoreT3-260414.apk`） |
| 安装 | `pm install -t -r -d /data/<apk>`，约 55 s（28 MB） |
| 位置 | `/system/app/VanCoreT3`；`pm install -r` 装成 `/data/app/…` 覆盖，系统包保留 |
| 证据 | `pm install output: … Success`；`dumpsys package com.cp.vancoret3` 里 **`codePath=/data/app/…` 那条**的时间戳与日志对齐 |
| 图标 | 默认不加；需要时 `assets/add-icon-device.sh` |

### 7.2 WiFi 固件（CYW43438）

- 文件：`fw_cyw43438.bin` + `nvram_cyw43438.txt`（必须成对）。
- 落盘 `/system/vendor/modules/`，`chmod 644`、`chown 0:0`；写前 `mount -o rw,remount,rw /system`。
- `sync` + 重启后看 `dmesg`：`fw_path` / `nv_path` / `Firmware version = wl0: … 7.46.58.25 (CY)`。
- 同目录还有 `fw_bcm43436b0.bin`、`fw_cyw43438a0/a1.bin` 等别的模块，别混用；只拷不重启 `dmesg` 还是上次记录。

### 7.3 产物（脚本形态首选）

```xml
<root>
	<item action="copy" udiskfile="update-mdm-wifi.sh" dstdir="/data/local/tmp/update-mdm-wifi.sh"/>
	<item action="cmd" params="sh /data/local/tmp/update-mdm-wifi.sh"/>
</root>
```

`assets/update-mdm-wifi.sh` 自己扫 `/storage/udisk*`、`/mnt/media_rw/udisk*`（根目录需有 `E9631Service.xml`）。只改一样：`APK_LIST` / `FW_LIST` 留空。**别用**「`install` + 紧接着 `reboot`」的纯 xml；报告里 WiFi 证据必须带 `dmesg` 的 `fw_path` / `Firmware version`。

## 8. 参考

- 工具/固件：`com.android.guard` 1.4.9、`t3_spring`（Android 6.0.1）。
- 素材：`vendor/`（md5 与更新办法见 `vendor/README.md`）。
- 平台差异与 OTG 处置：`../SKILL.md` §5.2、§7.3。
