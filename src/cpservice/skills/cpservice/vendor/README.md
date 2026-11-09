# vendor：现成二进制素材（**T3 专用**）

插件自带的可复用二进制，做包时直接从 `vendor/` 拷，不用再去 Downloads 找。

> **只适用于 T3 安卓（com.android.guard / E9631Service.xml）**。
> RK 安卓（com.cpdevice.cpservice / CpService.xml）**不要**套这里的 WiFi 固件——`fw_cyw43438.bin` / `nvram_cyw43438.txt` 是 T3 的 CYW43438 模块用的，RK 机型模块不同，先 `lsmod` / `dmesg` 确认再谈。RK 只可复用 `VanCoreT3-<build>.apk`（MDM），装法见 `skill/references/rk-android.md` 第 10 节。
>
> 客户专属素材（如科丰的 `PA-Entry.apk`、`bootlogo.bmp`）不进 vendor，每单从客户给的 zip 里取。

| 文件 | 大小 | md5 | 说明 |
|---|---|---|---|
| `VanCoreT3-260414.apk` | 28798099 | `7d7fdb892a3e8fccc684d16ac4c1ccf6` | MDM，包名 `com.cp.vancoret3`，versionName `260414`；T3/RK 都可装 |
| `fw_cyw43438.bin` | 411319 | `511b75bc06aeea9d313fb61de09e1917` | CYW43438 WiFi 固件 → `/system/vendor/modules`（**仅 T3**） |
| `nvram_cyw43438.txt` | 1146 | `9abab03dfbbd634ec06d3a60830ea5bf` | 与上面 fw 配套的 nvram，必须成对替换（**仅 T3**） |

## 更新

MDM / 固件出新版时：

1. 新文件放进本目录，**保留文件名里的版本号**（如 `VanCoreT3-<build>.apk`）。
2. 更新上表的 md5（`md5sum vendor/*`）。
3. 同步改 `skill/references/t3-android.md` 第 6 节的版本号 / md5 / 文件名（RK 侧见 `rk-android.md` 第 10 节）。
4. 旧的 VanCoreT3 包确认不再用后可删，别在目录里留两份同名不同版。

## 注意

- `fw_cyw43438.bin` 与 `nvram_cyw43438.txt` 必须成对，且只适用于 CYW43438 / SPRING2 系列；同目录其它 `fw_bcm43436b0.bin`、`fw_cyw43438a0/a1.bin` 是别的模块的，不要混用。
- 这些文件只用于生成 U 盘包，不会被打进 APK 或安装到插件运行时里。
