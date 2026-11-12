# vendor：现成二进制素材（**T3 家族**）

插件自带的可复用二进制，做包时直接从 `vendor/` 拷，不用再去 Downloads 找。

> **适用面按「平台」列逐条看，不要整目录一起搬。**
> - `MDM` 只给 **T3 Buildroot（Linux）**；`VanCoreT3-<build>.apk` 是**安卓**的 MDM，两者完全不同，互换必挂。
> - `fw_cyw43438.bin` / `nvram_cyw43438.txt` 只适用于 **T3 的 CYW43438 模块**；RK 安卓（`com.cpdevice.cpservice`）**不要**套——模块不同，先 `lsmod` / `dmesg` 确认再谈。RK 只可复用 `VanCoreT3-<build>.apk`（MDM），装法见 `references/rk-android.md` 第 8 节。
>
> 客户专属素材（如科丰的 `PA-Entry.apk`、`bootlogo.bmp`）不进 vendor，每单从客户给的 zip 里取。

| 文件 | 平台 | 大小 | md5 | 说明 / 落点 |
|---|---|---|---|---|
| `MDM` | **T3 Buildroot（Linux）** | 21239396 | `3de099e9653bccb9b218cccc12edb3d2` | MDM 原生二进制（ELF 32-bit ARM EABI5，动态链 `/lib/ld-linux-armhf.so.3`）→ `/mdm/MDM`。包内根目录**必须仍叫 `MDM`**（安装脚本按 `$USB/MDM` 取）。替换顺序 `cp → /mdm/MDM.new`、`chmod 755`、`mv` 覆盖（进程在跑，直接覆盖会 `Text file busy`） |
| `VanCoreT3-260414.apk` | T3 安卓 / RK 安卓 | 28798099 | `7d7fdb892a3e8fccc684d16ac4c1ccf6` | MDM APK，包名 `com.cp.vancoret3`，versionName `260414` → `pm install -t -r -d`，约 55 s |
| `fw_cyw43438.bin` | T3（CYW43438 模块） | 411319 | `511b75bc06aeea9d313fb61de09e1917` | WiFi 固件 → `/system/vendor/modules` |
| `nvram_cyw43438.txt` | T3（同上，成对） | 1146 | `9abab03dfbbd634ec06d3a60830ea5bf` | 与上面 fw 配套的 nvram，必须成对替换 |

`MDM` 无内嵌可读版本串（Rust 构建，`strings` 只剩 hash 噪声）：**只靠 md5 / 文件日期辨识**（本份 2026-10-14），报告里别写「版本 Vx.y」。来自 `~/Downloads/MDM`、`MDM_t3_buildroot.zip`、`SPRING2_L_EC200G_LinuxLogo_WiFi_MDM_20261111.zip` 三处，md5 一致。

## 更新

MDM / 固件出新版时：

1. 新文件放进本目录，**保留文件名里的版本号**（如 `VanCoreT3-<build>.apk`）；`MDM` 没有版本串，保持文件名 `MDM` 不变，把旧份删掉，别留两份同名不同版。
2. 更新上表的 md5（`md5sum vendor/*`）。
3. 同步改 `references/t3-android.md` §7 的版本号 / md5 / 文件名；`MDM` 的用法同步 `references/t3-linux.md`（RK 侧见 `rk-android.md` §8）。

## 注意

- `fw_cyw43438.bin` 与 `nvram_cyw43438.txt` 必须成对，且只适用于 CYW43438 / SPRING2 系列；同目录其它 `fw_bcm43436b0.bin`、`fw_cyw43438a0/a1.bin` 是别的模块的，不要混用。
- 这些文件只用于生成 U 盘包，不会被打进 APK 或安装到插件运行时里。
