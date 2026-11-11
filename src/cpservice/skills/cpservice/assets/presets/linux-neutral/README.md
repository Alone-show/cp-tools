# 预置「中性」Linux 开机 logo

客户无关的通用 Linux 开机图：黑底白字 **Linux**。**只用于 Linux 平台**（T3 Linux / RK Linux / RK Debian 可按下面命令重出），不是客户品牌图。

## 触发条件（硬前提）

**允许**（需全部满足）：

1. 需求原话**明确要「中性」**（中性 logo / 中性开机图），或明确说用 Linux 通用 logo。
2. 平台是 Linux：T3 Linux（Buildroot）、RK Linux、RK Debian。
3. 客户本次没给品牌图。

**不用**（任一命中）：

- 需求没说中性、客户给了品牌图 → 用客户的图走 `assets/generate-bootlogo.sh`（§8.4），不要拿这份顶替。
- 安卓（RK/T3）→ 用 `assets/presets/rk-android-neutral/`，两边产物不同（`logo.img` + `bootanimation.zip`）。
- 屏幕不是 1024×600 → 用 `logo.png` 重新生成。

## 文件

| 文件 | 用途 | 体积 | md5 |
|---|---|---|---|
| `logo.png` | 源图，1024×600（黑底白字），重出各平台都从它开始 | 125,194 B | `ffb39495942a2f4fa0fd22b6adee6e07` |
| `logo` | **T3 Linux 直用**：bgra 1024×600，2 帧，已 R180 | 4,915,200 B | `3e9b85b53cca1eba050c2efc1ae46a9f` |
| `bootlogo.bmp` | **T3 Linux 直用**：1024×600×24bpp，已 R180 | 1,843,254 B | `0ab3d5d9d3b52cc00a093f0a048c7b46` |

- 方向已按现场出好（`logo`、`bootlogo.bmp` 存储为 R180），生成规则见 SKILL §8.4。
- 未内置 `video_demo.yuv`（215 MB）：要换开机动画就从 `logo.png` 现出。

## 怎么用

**T3 Linux**：把 `logo`、`bootlogo.bmp` 平铺进包根，安装脚本按 §8.3 落 `/logo`、`/Configs/bootlogo.bmp` + boot-resource 分区（`/dev/mmcblk0p2`）。要连开机动画一起换，再加 `video_demo.yuv`。

**重出 / 换平台**（图片只用 `logo.png`，不要手工裁/拼）：

```bash
# T3 Linux（SPRING2_L 原机 /logo 是 2 帧 → --logo-frames 2；SPRING 系列加 --rotate）
assets/generate-bootlogo.sh --image assets/presets/linux-neutral/logo.png \
  --chip T3 --system Linux --rotate --logo-frames 2 --name linux-neutral --out ~/Downloads

# RK Linux / RK Debian（产物 logo.img，dd 到 logo 分区）
assets/generate-bootlogo.sh --image assets/presets/linux-neutral/logo.png \
  --chip RK --system Linux --rotate --name linux-neutral --out ~/Downloads
```

## 风险

- 只换 `logo` / `bootlogo.bmp` 不换 `video_demo.yuv` → 开机动画仍是旧的 CPDEVICE（SKILL §8.4）。
- RK Debian 用 `dd` 写 logo 分区；T3 Linux 是直接覆盖 `/logo`，别把两套动作混用。
- 本图是通用标识，客户品牌图优先；用了就在交付说明里点明「中性 Linux logo」。
