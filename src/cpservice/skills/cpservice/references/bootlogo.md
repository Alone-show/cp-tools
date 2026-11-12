# 开机 LOGO / bootlogo / 开机动画资源

> 从 SKILL §8.4 下沉；SKILL 正文只留红线与方向结论。

**红线：开机 logo / bootlogo / 开机动画资源只准由 `assets/generate-bootlogo.sh` 生成；脚本已验过，产物直接进包，不再手工核尺寸/字节数。**
- 禁止手绘、PS/PIL 拼字、手工 `ffmpeg`、手工 `cat` 拼帧、手工改尺寸/颜色/字节数。
- 客户已有字标图，先要图（问一句），不要自己"参照样式"造字。
- 上游 `assets/vendor/generate_bootlogo.sh` 原样保留（交互式），只作对照，不直接改。

```bash
assets/generate-bootlogo.sh --image logo.png --chip T3 --system Linux --name <客户> --out ~/Downloads
#   --rotate       180°（hflip,vflip）：只转 bootlogo.bmp / logo（哪些机型加见下）
#   --logo-frames  T3 Linux 的 logo 帧数：原机 /logo 是 2 帧（4,915,200 B）时传 2，默认 1
#   --no-video     跳过 video_demo.yuv（仅明确不换开机动画时用）
#   --assets-only  只出媒体，不出 xml / 安装脚本（往已有包里塞）
```

**方向（通用规则，只在这里写）**

- `/logo`、`bootlogo.bmp`：**存储 = 显示图旋转 180°**（`--rotate` = `hflip,vflip`），屏上才是正的。
- `video_demo.yuv` **不旋转**：视频层（`CPVideoPlayDemo` / fb1）方向与 logo 层不同；脚本 yuv 分支本身不带翻转，别"顺手修"。
- **SPRING1 / SPRING2 / SPRING2PRO（含 `SPRING2_L`、`SPRING2_PRO` 等变体）屏幕 180°：识别到这三款就传 `--rotate`**；脚本按参数直出，不硬判机型。

| 芯片_系统 | 产物 | 装包动作 |
|---|---|---|
| RK_Android | `logo.img` + `CpService.xml` | `logo` 动作，`params` 必须叫 `logo.img`（见 rk-android.md §3.2） |
| RK_Linux | `logo.img` + `unattended_installation.sh` | `dd if=logo.img of=/dev/block/by-name/logo`（SKILL §8.2） |
| T3_Android | `bootlogo.bmp` + `E9631Service.xml` | `bootlogo` 动作，`params` 必须是 `bootlogo.bmp` |
| T3_Linux | `bootlogo.bmp` + `logo` + `video_demo.yuv` + `unattended_installation.sh` | `/logo`、`/Configs/bootlogo.bmp` + `/dev/mmcblk0p2`（SKILL §8.3） |

- **预置「中性」包（RK 安卓）**：`assets/presets/rk-android-neutral/` = `logo.img`（1024x600，3,686,966 B）+ `bootanimation.zip`（单帧）+ `CpService.xml`（`logo → bootanimation → sync → sleep 5 → reboot`）。
  - **只在需求原话明确要「中性」**（中性 logo/动画/开机图）时用；「客户没给图」「随便/默认/通用一点」都不算中性 → 走上面的生成器，或先问。
  - 还需 RK 安卓（`com.cpdevice.cpservice`）+ 屏幕 1024x600（`adb shell wm size`）。1280x800 / 客户品牌图 / T3 或 Debian / 要真多帧动画 / 调试轮免重启（`NO_REBOOT=1`）一律不用。
  - 组合需求（如装 apk + 中性 logo）只借 `logo.img` + `bootanimation.zip`，xml 按需求重写；用了就在交付说明里点明用的是预置包。
  - 设备侧触发：插盘 → `ACTION_MEDIA_MOUNTED` → 工具枚举真实卷 → 读卷根 `CpService.xml` → 顺序执行；`reboot` 后 adb 掉线按 SKILL §7.3 等回线。
- **预置「中性」Linux logo**：`assets/presets/linux-neutral/` = 只有 `logo.png`（1024x600 源图），产物现出：`generate-bootlogo.sh --image <该 png> --chip T3 --system Linux --rotate --logo-frames 2 --no-video`（RK Linux / RK Debian 换 `--chip RK`、去掉 `--logo-frames`）。
  - 库里不再存 `logo` / `bootlogo.bmp`：同一份 png 现出的 md5 与旧产物逐字节一致（`3e9b85b5…` / `0ab3d5d9…`，2026-11-12 验过），存三份只会「改了图忘了产物」。
  - 只在需求明确要「中性 / Linux 通用 logo」且客户没给品牌图时用；给了品牌图一律用客户的图走生成器。
  - 只适用 Linux：T3 Linux 产物平铺进包根；RK Linux / RK Debian 用同一张 `logo.png` 出 `logo.img`。安卓用 `rk-android-neutral`。
  - 不含 `video_demo.yuv`（215 MB）：要换开机动画去掉 `--no-video` 一起出。
  - 用了就在交付说明里点明「中性 Linux logo」。
- 图片只接受 **1024x600 / 1280x800**（ffprobe 判，与上游一致）；脚本末尾自检不通过就不会产出。
- 生成的安装脚本是**最小版**：RK Linux 按 `/mnt/installUsb` 硬编码（工具窗口方式；要手动入口 `$1` 形式按 SKILL §4 C 改写）；T3 Linux 无日志、无 `NO_REBOOT`，正式包用 `assets/t3linux-setup-template.sh` 补齐。
- 输出目录 `<out>/<CHIP>_<SYSTEM>_<name>_<YYYYMMDD>`，产物平铺进包根。
