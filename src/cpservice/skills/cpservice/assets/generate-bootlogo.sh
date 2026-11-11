#!/usr/bin/env bash
#
# generate-bootlogo.sh — 按平台生成开机 logo 资源（DSH skill: /cpservice）
#
# 上游：https://github.com/Alone-show/CP_Generate_Bootlogo
#   commit a0198694c15afc028205b897ce662ea489410a93
#   sha256 0687c04527849bf27190cbf1e6862f6098893d63d766432f21e79ec8d42646dc
#   原样副本：assets/vendor/generate_bootlogo.sh（交互式，输出写在自己所在目录）
#
# 与上游的关系：
#   * 媒体产物（bootlogo.bmp / logo / logo.img）与两个 xml 默认与上游逐字节一致，
#     由 test/smoke.mjs 的一致性断言守护；上游一改，测试立刻红。
#     （唯一例外：--logo-frames 2 时 logo 为上游单帧的两倍，对齐现场原机格式）
#   * 两个安装脚本行为一致、缩进整理过（上游是 tab/空格混排），断言按去缩进比对。
#   * 方向语义（现场实测，勿"顺手修"）：--rotate（hflip,vflip）只作用于
#     bootlogo.bmp / logo；video_demo.yuv 恒不旋转 —— 视频层由 CPVideoPlayDemo
#     播在 fb1，方向与 logo 层不同，上游脚本的 yuv 本来就不带翻转。
#   * T3 Linux 的 logo 帧数：原机 /logo 可能是 2 帧（SPRING2_L：4,915,200 B），
#     用 --logo-frames 2 出双帧；禁止手工 cat 拼帧。
#
# 用法：
#   generate-bootlogo.sh --image <png> --chip <RK|T3> --system <Android|Linux>
#                        [--name <tag>] [--out <父目录>] [--rotate]
#                        [--logo-frames 1|2] [--model <机型>] [--no-video] [--assets-only] [--dry-run]
#   generate-bootlogo.sh --check <已生成目录>
#   generate-bootlogo.sh --help
#
# 组合 → 产物：
#   RK_Android  logo.img                                CpService.xml（logo + reboot）
#   RK_Linux    logo.img                                unattended_installation.sh（/mnt/installUsb）
#   T3_Android  bootlogo.bmp                            E9631Service.xml（bootlogo + sync + reboot）
#   T3_Linux    bootlogo.bmp + logo + video_demo.yuv    unattended_installation.sh（/mnt/usb/sda1）
#
# 尺寸约束：图片必须是 1024x600 或 1280x800（与上游一致，ffprobe 判定）。
# --rotate      180°（hflip,vflip）：只转 bootlogo.bmp / logo；yuv 恒不旋转
# --logo-frames T3 Linux 的 logo 帧数，默认 1；原机是 2 帧时用 2
# --model       机型（如 SPRING2/SPRING2PRO）：SPRING1/SPRING2/SPRING2PRO 必须加 --rotate，
#               漏了会直接退出 2（这三款屏幕 180°）
#
# 退出码：0 成功 / 2 用法错误 / 3 缺 ffmpeg|ffprobe / 4 图片尺寸不符
#         5 生成失败 / 6 自检失败

set -Eeuo pipefail

TODAY="$(date +%Y%m%d)"
readonly TODAY

IMAGE='' CHIP='' SYSTEM='' NAME='logo' OUT_DIR='' CHECK_DIR='' MODEL=''
ROTATE=0 NO_VIDEO=0 ASSETS_ONLY=0 DRY_RUN=0 LOGO_FRAMES=1

die() { local code="$1"; shift; printf 'generate-bootlogo: %s\n' "$*" >&2; exit "$code"; }

usage() {
  awk 'NR>=3 { if ($0 !~ /^#/) exit; sub(/^# ?/,""); print }' "${BASH_SOURCE[0]}"
  exit 0
}

need_value() { [[ $# -ge 2 && -n "$2" && "$2" != -* ]] || die 2 "$1 需要一个值"; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --image)  need_value "$@"; IMAGE="$2"; shift 2 ;;
    --chip)   need_value "$@"; CHIP="${2^^}"; shift 2 ;;
    --system) need_value "$@"; SYSTEM="${2,,}"; shift 2 ;;
    --name)   need_value "$@"; NAME="$2"; shift 2 ;;
    --out)    need_value "$@"; OUT_DIR="$2"; shift 2 ;;
    --check)  need_value "$@"; CHECK_DIR="$2"; shift 2 ;;
    --model)  need_value "$@"; MODEL="$2"; shift 2 ;;
    --rotate) ROTATE=1; shift ;;
    --logo-frames) need_value "$@"; LOGO_FRAMES="$2"; shift 2 ;;
    --no-video) NO_VIDEO=1; shift ;;
    --assets-only) ASSETS_ONLY=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage ;;
    *) die 2 "未知参数：$1（--help 看用法）" ;;
  esac
done

# ---------------------------------------------------------------- 校验与探测

require_tools() {
  command -v ffmpeg  >/dev/null 2>&1 || die 3 '未找到 ffmpeg，请先安装'
  command -v ffprobe >/dev/null 2>&1 || die 3 '未找到 ffprobe，请先安装'
}

probe_image() {
  local dims w h
  [[ -n "$IMAGE" ]] || die 2 '缺少 --image'
  [[ -f "$IMAGE" ]] || die 2 "文件不存在：$IMAGE"
  dims="$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0:s=, "$IMAGE")" \
    || die 4 "无法读取图片尺寸：$IMAGE"
  IFS=',' read -r w h <<<"$dims"
  if [[ ! ( "$w" == 1024 && "$h" == 600 ) && ! ( "$w" == 1280 && "$h" == 800 ) ]]; then
    die 4 "图片尺寸必须是 1024x600 或 1280x800，当前是 ${w}x${h}"
  fi
  W="$w"; H="$h"
}

normalize_name() {
  local cleaned
  cleaned="$(printf '%s' "$1" | tr -c 'A-Za-z0-9._-' '_' | sed 's/^_*//; s/_*$//')"
  [[ -n "$cleaned" ]] || cleaned='logo'
  printf '%s' "$cleaned"
}

resolve_plan() {
  case "${CHIP}_${SYSTEM}" in
    RK_android) COMBO='RK_Android' ;;
    RK_linux)   COMBO='RK_Linux' ;;
    T3_android) COMBO='T3_Android' ;;
    T3_linux)   COMBO='T3_Linux' ;;
    *) die 2 "--chip 取 RK|T3，--system 取 Android|Linux（收到 chip=${CHIP:-空} system=${SYSTEM:-空}）" ;;
  esac
  ROTATE_FILTER=''
  (( ROTATE )) && ROTATE_FILTER='hflip,vflip,'
  [[ "$LOGO_FRAMES" == "1" || "$LOGO_FRAMES" == "2" ]] \
    || die 2 "--logo-frames 只接受 1 或 2（收到 ${LOGO_FRAMES}）"
  if [[ -n "$MODEL" ]]; then
    local m="${MODEL^^}"
    m="${m//[^A-Z0-9]/}"
    case "$m" in
      SPRING1*|SPRING2*)
        (( ROTATE )) || die 2 "机型 ${MODEL} 的屏幕是 180°，必须加 --rotate（漏了会上下颠倒）"
        printf '机型 %s：已启用 --rotate（屏幕 180°）\n' "$MODEL" >&2 ;;
    esac
  fi
  NAME="$(normalize_name "$NAME")"
  OUT_DIR="${OUT_DIR:-$HOME/Downloads}"
  TARGET="$OUT_DIR/${COMBO}_${NAME}_${TODAY}"
}

# ---------------------------------------------------------------- 媒体产物

gen_bmp() {
  ffmpeg -nostdin -v error -y -i "$IMAGE" -vf "${ROTATE_FILTER}format=bgr24" -s "${W}x${H}" \
    -frames:v 1 -update 1 -c:v bmp "$TARGET/bootlogo.bmp" \
    || die 5 'bootlogo.bmp 转换失败'
}

gen_yuv() {
  # yuv 恒不旋转：视频层（CPVideoPlayDemo / fb1）方向与 logo 层不同（现场实测）
  ffmpeg -nostdin -v error -y -loop 1 -i "$IMAGE" -vf "scale=${W}:${H},format=yuv420p" \
    -frames:v 234 -pix_fmt yuv420p -f rawvideo "$TARGET/video_demo.yuv" \
    || die 5 'video_demo.yuv 转换失败'
}

gen_logo_raw() {
  local one="$TARGET/.logo.1f"
  ffmpeg -nostdin -v error -y -i "$IMAGE" -vf "${ROTATE_FILTER}scale=${W}:${H},format=bgra" \
    -frames:v 1 -f rawvideo "$one" \
    || die 5 'logo 转换失败'
  if [[ "$LOGO_FRAMES" == "2" ]]; then
    cat "$one" "$one" >"$TARGET/logo"
    rm -f "$one"
  else
    mv "$one" "$TARGET/logo"
  fi
}

# logo.img = BMP + 458 字节 0 + BMP（上游格式，现场包实测 3,686,966 / 6,144,566 B）
make_logo_img() {
  cp "$TARGET/bootlogo.bmp" "$TARGET/logo.img"
  dd if=/dev/zero bs=458 count=1 >>"$TARGET/logo.img" 2>/dev/null \
    || die 5 'logo.img 填充失败'
  cat "$TARGET/bootlogo.bmp" >>"$TARGET/logo.img"
  rm -f "$TARGET/bootlogo.bmp"
}

# ---------------------------------------------------------------- 清单与安装脚本

write_rk_android_xml() {
  cat >"$TARGET/CpService.xml" <<'EOF'
<?xml version="1.0" encoding="utf-8"?>
<root>
  <item action="logo" params="logo.img" />
  <item action="cmd" params="reboot"/>
</root>
EOF
}

write_t3_android_xml() {
  cat >"$TARGET/E9631Service.xml" <<'EOF'
<?xml version="1.0" encoding="utf-8"?>
<root>
	<item action="bootlogo" params="bootlogo.bmp"/>
	<item action="cmd" params="sync"/>
	<item action="cmd" params="reboot"/>
</root>
EOF
}

write_rk_linux_installer() {
  cat >"$TARGET/unattended_installation.sh" <<'EOF'
#!/bin/sh

USBPATH="/mnt/installUsb"

echo "开始静默logo"

if [ -f ${USBPATH}/logo.img ];then

/bin/cp -rvf ${USBPATH}/logo.img /
dd if=/logo.img of=/dev/block/by-name/logo
rm /logo.img

fi
echo "静默安装结束"

EOF
  chmod +x "$TARGET/unattended_installation.sh"
}

write_t3_linux_installer() {
  cat >"$TARGET/unattended_installation.sh" <<'EOF'
#!/bin/sh

FILE_DIR=/mnt/usb/sda1

echo "开始静默安装logo"

if [ -f ${FILE_DIR}/logo ];then

	/bin/cp -rf ${FILE_DIR}/logo /
	echo "复制logo 完毕"
	else
	echo "logo不存在"
fi

if [ -f ${FILE_DIR}/video_demo.yuv ];then
	/bin/cp -rf ${FILE_DIR}/video_demo.yuv /
	echo "复制video_demo.yuv完毕"
	else
	echo "video_demo.yuv不存在"
fi

if [ -f ${FILE_DIR}/bootlogo.bmp ];then
	chmod 777 ${FILE_DIR}/bootlogo.bmp
	/bin/cp -rf ${FILE_DIR}/bootlogo.bmp /Configs/
	chmod 777 /Configs/bootlogo.bmp

	/bin/mount -rw -t vfat /dev/mmcblk0p2 /mnt/
	/bin/rm /mnt/bootlogo.bmp

	if [ -f /Configs/bootlogo.bmp ];then
	echo "复制bootlogo.bmp Configs完毕"
	/bin/mv /Configs/bootlogo.bmp /mnt/
	else
	echo "bootlogo.bmp不存在Configs"
	/bin/cp -rf ${FILE_DIR}/bootlogo.bmp /mnt/
	fi

	echo "复制bootlogo.bmp mnt完毕"
	else
	echo "bootlogo.bmp不存在"
fi

echo "静默安装结束"


reboot
EOF
  chmod +x "$TARGET/unattended_installation.sh"
}

# ---------------------------------------------------------------- 自检

# check_dir <dir>：按文件集反推组合，校验尺寸公式与可执行位
check_dir() {
  local dir="$1" bmp logo img yuv rc=0

  [[ -d "$dir" ]] || die 6 "目录不存在：$dir"
  bmp="$dir/bootlogo.bmp"; logo="$dir/logo"; img="$dir/logo.img"; yuv="$dir/video_demo.yuv"

  expect_size() { # name expected actual
    if [[ "$2" != "$3" ]]; then
      printf '  自检失败：%s 期望 %s 字节，实际 %s 字节\n' "$1" "$2" "$3" >&2
      rc=1
    else
      printf '  ok  %-24s %s 字节\n' "$1" "$3"
    fi
  }

  local w h
  if [[ -f "$bmp" ]]; then
    if command -v ffprobe >/dev/null 2>&1; then
      IFS=',' read -r w h <<<"$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0:s=, "$bmp")"
      [[ "$w" == 1024 || "$w" == 1280 ]] || { printf '  自检失败：bootlogo.bmp 尺寸异常 %sx%s\n' "$w" "$h" >&2; rc=1; }
      expect_size bootlogo.bmp "$((54 + w * h * 3))" "$(stat -c %s "$bmp")"
    else
      printf '  skip bootlogo.bmp（无 ffprobe，跳过尺寸校验）\n'
    fi
  fi

  if [[ -f "$img" ]]; then
    if [[ -f "$bmp" ]]; then
      expect_size logo.img "$(( $(stat -c %s "$bmp") * 2 + 458 ))" "$(stat -c %s "$img")"
    else
      # 只有 logo.img：按 BMP 反推（img = 2*bmp + 458）
      local bmp_size=$(( ($(stat -c %s "$img") - 458) / 2 ))
      [[ $(( bmp_size * 2 + 458 )) -eq "$(stat -c %s "$img")" ]] \
        && printf '  ok  %-24s %s 字节（反推 bmp=%s）\n' logo.img "$(stat -c %s "$img")" "$bmp_size" \
        || { printf '  自检失败：logo.img 不符合 BMP+458+BMP 公式\n' >&2; rc=1; }
    fi
  fi

  if [[ -f "$logo" ]]; then
    local px
    px="$(stat -c %s "$logo")"
    case "$px" in
      2457600)  printf '  ok  %-24s %s 字节（1024x600 bgra，1 帧）\n' logo "$px" ;;
      4915200)  printf '  ok  %-24s %s 字节（1024x600 bgra，2 帧）\n' logo "$px" ;;
      4096000)  printf '  ok  %-24s %s 字节（1280x800 bgra，1 帧）\n' logo "$px" ;;
      8192000)  printf '  ok  %-24s %s 字节（1280x800 bgra，2 帧）\n' logo "$px" ;;
      *) printf '  自检失败：logo 期望 2457600/4915200/4096000/8192000 字节，实际 %s\n' "$px" >&2; rc=1 ;;
    esac
  fi

  if [[ -f "$yuv" ]]; then
    local yuv_size
    yuv_size="$(stat -c %s "$yuv")"
    case "$yuv_size" in
      215654400|359424000) printf '  ok  %-24s %s 字节（234 帧）\n' video_demo.yuv "$yuv_size" ;;
      *) printf '  自检失败：video_demo.yuv 期望 215654400(1024x600) 或 359424000(1280x800)，实际 %s\n' "$yuv_size" >&2; rc=1 ;;
    esac
  fi

  local f
  for f in "$dir/CpService.xml" "$dir/E9631Service.xml"; do
    [[ -f "$f" ]] || continue
    grep -q '<root>' "$f" || { printf '  自检失败：%s 缺 <root>\n' "$(basename "$f")" >&2; rc=1; }
    grep -q 'action="' "$f" || { printf '  自检失败：%s 没有 action\n' "$(basename "$f")" >&2; rc=1; }
  done

  local inst="$dir/unattended_installation.sh"
  if [[ -f "$inst" ]]; then
    [[ -x "$inst" ]] || { printf '  自检失败：unattended_installation.sh 没有可执行位\n' >&2; rc=1; }
    sh -n "$inst" || { printf '  自检失败：unattended_installation.sh 语法错误\n' >&2; rc=1; }
    printf '  ok  %-24s 可执行且语法通过\n' unattended_installation.sh
  fi

  # 清单/安装脚本存在时，它引用的媒体必须也在（只删媒体、留清单是最常见的坏包）
  if [[ -f "$dir/CpService.xml" && ! -f "$img" ]]; then
    printf '  自检失败：CpService.xml 存在但缺 logo.img\n' >&2; rc=1
  fi
  if [[ -f "$dir/E9631Service.xml" && ! -f "$bmp" ]]; then
    printf '  自检失败：E9631Service.xml 存在但缺 bootlogo.bmp\n' >&2; rc=1
  fi
  if [[ -f "$dir/unattended_installation.sh" && ! -f "$img" && ! -f "$logo" ]]; then
    printf '  自检失败：unattended_installation.sh 存在但缺 logo.img / logo\n' >&2; rc=1
  fi

  if [[ ! -f "$img" && ! -f "$bmp" && ! -f "$logo" ]]; then
    printf '  自检失败：没有任何媒体产物（logo.img / bootlogo.bmp / logo）\n' >&2; rc=1
  fi
  return "$rc"
}

# ---------------------------------------------------------------- 主流程

plan_lines() {
  case "$COMBO" in
    RK_Android) printf '%s\n' 'logo.img' 'CpService.xml' ;;
    RK_Linux)   printf '%s\n' 'logo.img' 'unattended_installation.sh' ;;
    T3_Android) printf '%s\n' 'bootlogo.bmp' 'E9631Service.xml' ;;
    T3_Linux)
      if (( NO_VIDEO )); then printf '%s\n' 'bootlogo.bmp' 'logo' 'unattended_installation.sh'
      else printf '%s\n' 'bootlogo.bmp' 'logo' 'video_demo.yuv' 'unattended_installation.sh'; fi ;;
  esac
}

generate() {
  mkdir -p "$TARGET"
  case "$COMBO" in
    RK_Android)
      gen_bmp; make_logo_img
      (( ASSETS_ONLY )) || write_rk_android_xml ;;
    RK_Linux)
      gen_bmp; make_logo_img
      (( ASSETS_ONLY )) || write_rk_linux_installer ;;
    T3_Android)
      gen_bmp
      (( ASSETS_ONLY )) || write_t3_android_xml ;;
    T3_Linux)
      gen_bmp
      (( NO_VIDEO )) || gen_yuv
      gen_logo_raw
      (( ASSETS_ONLY )) || write_t3_linux_installer ;;
  esac
}

next_step_hint() {
  case "$COMBO" in
    RK_Android) printf '  装包：CpService.xml 与 logo.img 平铺到盘根；logo 动作的 params 必须叫 logo.img（SKILL §3.2）\n' ;;
    RK_Linux)   printf '  装包：脚本按 /mnt/installUsb 硬编码（工具窗口方式）；手动入口 $1 形式见 SKILL §4 C\n' ;;
    T3_Android) printf '  装包：E9631Service.xml 的 bootlogo 动作 params 必须是 bootlogo.bmp（现场包实测）\n' ;;
    T3_Linux)   printf '  装包：脚本按 /mnt/usb/sda1；正式包建议用 assets/t3linux-setup-template.sh 补日志与 NO_REBOOT\n' ;;
  esac
}

main() {
  if [[ -n "$CHECK_DIR" ]]; then
    printf '自检目录：%s\n' "$CHECK_DIR"
    check_dir "$CHECK_DIR" || exit 6
    printf '自检通过。\n'
    exit 0
  fi

  require_tools
  probe_image
  resolve_plan

  local rot='否'
  (( ROTATE )) && rot='是'

  if (( DRY_RUN )); then
    printf '组合：%s   尺寸：%sx%s   旋转：%s\n' "$COMBO" "$W" "$H" "$rot"
    printf '输出目录：%s\n产物：\n' "$TARGET"
    plan_lines | sed 's/^/  - /'
    exit 0
  fi

  generate

  printf '组合：%s   尺寸：%sx%s   旋转：%s\n' "$COMBO" "$W" "$H" "$rot"
  printf '输出目录：%s\n' "$TARGET"
  ls -l "$TARGET"
  printf '自检：\n'
  check_dir "$TARGET" || die 6 '自检未通过，产物不要直接进包'
  next_step_hint
}

main "$@"
