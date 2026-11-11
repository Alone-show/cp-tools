# 预置「中性」开机 logo / 开机动画包（RK 安卓）

客户无关的通用开机 logo + 开机动画，插 U 盘即换。**只适用 RK 安卓**（`com.cpdevice.cpservice`，Android 11+）。

## 触发条件

### A. 设备侧（这套包在设备上怎么被拉起）

插盘 → `ACTION_MEDIA_MOUNTED` → 工具枚举真实卷、取卷根 → 读卷根 `CpService.xml` → 按序同步执行：

1. `logo`：`/sdcard/logo.img` → `dd` 到 `/dev/block/by-name/logo`（SDK≥34 只置 `sys.copy.bootlogo=doit`）
2. `bootanimation`：落 `/data/media/bootanimation.zip`（不是 `/system/media`）
3. `cmd sync` → 4. `cmd sleep 5` → 5. `cmd reboot`

卷必须真实可见：自建假挂载（如 `/storage/udisk(id=TEST)`）不在卷列表 = 没反应；xml 解析失败同样静默无动作。

### B. 何时才允许用这份预置包（显式触发，硬前提）

**允许**（需全部满足）：

1. 需求原话**明确要「中性」**（中性 logo / 中性开机动画 / 中性开机图）。
2. RK 安卓（`pm path com.cpdevice.cpservice` 非空）。
3. 屏幕 1024×600（`adb shell wm size`）。
4. 客户没给要用的品牌图，本次也不要求客户品牌。

**不用**（任一命中）：

- 需求没说「中性」——**「客户没给图」「随便弄一个」「用默认的」「通用一点的」都不等于中性**，走 `assets/generate-bootlogo.sh` 生成，或先问。
- 1280×800（logo.img 尺寸公式不同，必须重生成）。
- 客户品牌图 / 客户指定品牌。
- T3 安卓 / RK Debian / T3 Linux（缺 `bootlogo.bmp` / `logo` / `video_demo.yuv`）。
- 要真多帧动画（本包动画只有 1 帧，静态）。
- 调试/验证轮要免重启（用 `NO_REBOOT=1`，不套本 xml）。

**部分复用**：明确要中性但还需装 apk 等动作时，只借 `logo.img` + `bootanimation.zip`，`CpService.xml` 按本次需求重写。

## 文件

| 文件 | 体积 | md5 |
|---|---|---|
| `logo.img` | 3,686,966 B | `a3e60d60eb40a10780d5b36cd5511d02` |
| `bootanimation.zip` | 14,172 B | `b587ad1149fa59b3bfe1edd6f5bd5cd5` |
| `CpService.xml` | 266 B | `04144bf93f9a9a29027aabaa04ccf4ac` |

`logo.img` = BMP 1024×600×24bpp + 458 B 0 + 同一 BMP（两半逐字节相同）；`bootanimation.zip` 内 `desc.txt` = `1024 600 10` + 单帧 `part0`，3 个条目**全部 stored（不压缩）**。

## 怎么用

只把 `logo.img`、`bootanimation.zip`、`CpService.xml` 三个文件**平铺**到 U 盘根目录（本 README 不进包），插盘即执行。换图按 `assets/generate-bootlogo.sh --image <png> --chip RK --system Android` 重新生成 `logo.img`（图片只接受 1024×600 / 1280×800）。

只想要静态图给 T3 用时可从本包取 BMP：`head -c 1843254 logo.img > bootlogo.bmp`（= 54 + 1024×600×3）。

## 自检

```bash
assets/generate-bootlogo.sh --check assets/presets/rk-android-neutral   # 尺寸公式
unzip -Z -l assets/presets/rk-android-neutral/bootanimation.zip         # 应全为 stor
```

## 风险

- 含 `cmd reboot`：重启后 OTG 默认 Host，adb 不回线按 SKILL §7.3 等回线、超时才提示切 DEVICE；验证轮用 `NO_REBOOT=1`。
- 带 xml 的卷会被反复挂载：验完删卷根 `CpService.xml`，否则每次开机都重启（SKILL §10）。
