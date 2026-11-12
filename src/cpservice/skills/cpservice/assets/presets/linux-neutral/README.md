# 预置「中性」Linux 开机图（只有源图，产物现出）

客户无关的通用 Linux 开机图源图：黑底白字 **Linux**，1024×600。**只用于 Linux 平台**，不是客户品牌图。

包内只放 `logo.png` 一张源图；`logo`（T3 Linux）/ `bootlogo.bmp` / `logo.img` 一律用 `generate-bootlogo.sh` 现出，不在库里存多份产物（省 ~6.6 MB，也避免「图改了产物没跟着改」）。

## 触发条件（硬前提）

**允许**（需全部满足）：

1. 需求原话**明确要「中性」**（中性 logo / 中性开机图），或明确说用 Linux 通用 logo。
2. 平台是 Linux：T3 Linux（Buildroot）、RK Linux、RK Debian。
3. 客户本次没给品牌图。

**不用**（任一命中）：

- 需求没说中性、客户给了品牌图 → 用客户的图走 `assets/generate-bootlogo.sh`（SKILL §8.4），不要拿这份顶替。
- 安卓（RK/T3）→ 用 `assets/presets/rk-android-neutral/`，两边产物不同（`logo.img` + `bootanimation.zip`）。
- 屏幕不是 1024×600 → 本图重生成不了别的尺寸（脚本只接受 1024×600 / 1280×800，且不做拉伸判定），要 1280×800 就找客户图，别硬改。

## 文件

| 文件 | 用途 | 体积 | md5 |
|---|---|---|---|
| `logo.png` | 源图，1024×600（黑底白字），所有平台的产物都从它现出 | 125,194 B | `ffb39495942a2f4fa0fd22b6adee6e07` |

## 怎么用：一条命令现出产物

```bash
# T3 Linux（原机 /logo 是 2 帧；SPRING 系列加 --rotate）
assets/generate-bootlogo.sh --image assets/presets/linux-neutral/logo.png \
  --chip T3 --system Linux --rotate --logo-frames 2 --no-video --name linux-neutral --out ~/Downloads

# RK Linux / RK Debian（产物 logo.img，dd 到 logo 分区）
assets/generate-bootlogo.sh --image assets/presets/linux-neutral/logo.png \
  --chip RK --system Linux --rotate --name linux-neutral --out ~/Downloads
```

- 产物落在 `<out>/<CHIP>_<SYSTEM>_<name>_<YYYYMMDD>/`，平铺进包根。
- `--no-video` 只在不需要换开机动画时加；要换动画就去掉它，从同一张 `logo.png` 出 `video_demo.yuv`。
- 方向由脚本处理（`--rotate` = 存储图 R180，屏上才是正的）；**不要手工裁/拼/转**。

**可复现性已验**（2026-11-12，本机 ffmpeg）：`--chip T3 --system Linux --rotate --logo-frames 2 --no-video` 现出的 `bootlogo.bmp` = `0ab3d5d9d3b52cc00a093f0a048c7b46`、`logo` = `3e9b85b53cca1eba050c2efc1ae46a9f`（2 帧 bgra 1024×600），与原先入库的两份产物逐字节一致。尺寸是硬指标；换 ffmpeg 版本字节可能变，交付前自己 `md5sum` 留档。

## 风险

- 只换 `logo` / `bootlogo.bmp` 不换 `video_demo.yuv` → 开机动画仍是旧的 CPDEVICE（SKILL §8.4）。
- RK Debian 用 `dd` 写 logo 分区；T3 Linux 是直接覆盖 `/logo`，别把两套动作混用。
- 本图是通用标识，客户品牌图优先；用了就在交付说明里点明「中性 Linux logo」。
