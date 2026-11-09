#!/usr/bin/env bash

set -u

readonly SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
readonly OUTPUT_DATE="$(date +%Y%m%d)"

trim_whitespace() {
  local value="$1"

  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "$value"
}

prompt_image_path() {
  local image_path width height

  while true; do
    printf '请输入图片路径: '
    IFS= read -r image_path
    image_path="$(trim_whitespace "$image_path")"

    if [[ -z "$image_path" ]]; then
      printf '图片路径不能为空，请重新输入。\n\n'
      continue
    fi

    if [[ ! -f "$image_path" ]]; then
      printf '文件不存在: %s\n\n' "$image_path"
      continue
    fi

    if ! IFS=',' read -r width height < <(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0:s=, "$image_path"); then
      printf '无法读取图片尺寸，请重新输入。\n\n'
      continue
    fi

    if [[ "$width" == "1024" && "$height" == "600" ]] || [[ "$width" == "1280" && "$height" == "800" ]]; then
      SELECTED_IMAGE_PATH="$image_path"
      SELECTED_WIDTH="$width"
      SELECTED_HEIGHT="$height"
      return 0
    fi

    printf '图片尺寸必须是 1024x600 或 1280x800，当前是 %sx%s。\n\n' "$width" "$height"
  done
}

prompt_rotation() {
  local answer

  while true; do
    printf '是否需要旋转180度? [y/n]: '
    IFS= read -r answer
    case "${answer,,}" in
      y|yes)
        ROTATE_FILTER='hflip,vflip,'
        return 0
        ;;
      n|no)
        ROTATE_FILTER=''
        return 0
        ;;
      *)
        printf '请输入 y 或 n。\n\n'
        ;;
    esac
  done
}

prompt_chip() {
  local answer

  while true; do
    printf '请选择芯片 [1.RK 2.T3]: '
    IFS= read -r answer
    case "${answer^^}" in
      1|RK)
        CHIP_NAME='RK'
        return 0
        ;;
      2|T3)
        CHIP_NAME='T3'
        return 0
        ;;
      *)
        printf '请输入 1 或 2。\n\n'
        ;;
    esac
  done
}

prompt_system() {
  local answer

  while true; do
    printf '请选择系统 [1.Linux 2.Android]: '
    IFS= read -r answer
    case "${answer,,}" in
      1|linux)
        SYSTEM_NAME='Linux'
        return 0
        ;;
      2|android)
        SYSTEM_NAME='Android'
        return 0
        ;;
      *)
        printf '请输入 1 或 2。\n\n'
        ;;
    esac
  done
}

prompt_custom_name() {
  local answer

  while true; do
    printf '请输入输出文件夹自定义名称: '
    IFS= read -r answer

    if [[ -z "$answer" ]]; then
      printf '自定义名称不能为空。\n\n'
      continue
    fi

    CUSTOM_NAME="${answer// /_}"
    return 0
  done
}

write_t3_linux_installer() {
  cat > "$installer_output_file" <<'EOF'
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

  chmod +x "$installer_output_file"
}

write_rk_linux_installer() {
  cat > "$installer_output_file" <<'EOF'
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

  chmod +x "$installer_output_file"
}

write_t3_android_service_xml() {
  cat > "$service_xml_output_file" <<'EOF'
<?xml version="1.0" encoding="utf-8"?>
<root>
	<item action="bootlogo" params="bootlogo.bmp"/>
	<item action="cmd" params="sync"/>
	<item action="cmd" params="reboot"/>
</root>
EOF
}

write_rk_android_service_xml() {
  cat > "$service_xml_output_file" <<'EOF'
<?xml version="1.0" encoding="utf-8"?>
<root>
  <item action="logo" params="logo.img" />
  <item action="cmd" params="reboot"/>
</root>
EOF
}

generate_bootlogo_bmp() {
  if ! ffmpeg -y -i "$SELECTED_IMAGE_PATH" -vf "$bmp_filter" -s "${SELECTED_WIDTH}x${SELECTED_HEIGHT}" -frames:v 1 -update 1 -c:v bmp "$bmp_output_file"; then
    printf 'bootlogo.bmp 转换失败。\n' >&2
    exit 1
  fi
}

generate_t3_linux_yuv() {
  if ! ffmpeg -y -loop 1 -i "$SELECTED_IMAGE_PATH" -vf "scale=${SELECTED_WIDTH}:${SELECTED_HEIGHT},format=yuv420p" -frames:v 234 -pix_fmt yuv420p -f rawvideo "$yuv_output_file"; then
    printf 'video_demo.yuv 转换失败。\n' >&2
    exit 1
  fi
}

generate_t3_linux_logo() {
  if ! ffmpeg -y -i "$SELECTED_IMAGE_PATH" -vf "$logo_filter" -frames:v 1 -f rawvideo "$logo_output_file"; then
    printf 'logo 转换失败。\n' >&2
    exit 1
  fi
}

generate_rk_logo_img() {
  generate_bootlogo_bmp

  cp "$bmp_output_file" "$logo_img_output_file"

  if ! dd if=/dev/zero bs=458 count=1 >> "$logo_img_output_file" 2>/dev/null; then
    printf 'logo.img 填充失败。\n' >&2
    exit 1
  fi

  cat "$bmp_output_file" >> "$logo_img_output_file"
  rm -f "$bmp_output_file"
}

generate_t3_linux_outputs() {
  generate_bootlogo_bmp
  generate_t3_linux_yuv
  generate_t3_linux_logo
  write_t3_linux_installer
}

generate_t3_android_outputs() {
  generate_bootlogo_bmp
  write_t3_android_service_xml
}

generate_rk_android_outputs() {
  generate_rk_logo_img
  write_rk_android_service_xml
}

generate_rk_linux_outputs() {
  generate_rk_logo_img
  write_rk_linux_installer
}

print_generated_files() {
  printf '\n生成完成:\n'
  printf '输出目录: %s\n' "$output_dir"

  case "${CHIP_NAME}_${SYSTEM_NAME}" in
    T3_Linux)
      printf '输出文件: %s\n' "$bmp_output_file"
      printf '输出文件: %s\n' "$yuv_output_file"
      printf '输出文件: %s\n' "$logo_output_file"
      printf '输出文件: %s\n' "$installer_output_file"
      ;;
    T3_Android)
      printf '输出文件: %s\n' "$bmp_output_file"
      printf '输出文件: %s\n' "$service_xml_output_file"
      ;;
    RK_Android)
      printf '输出文件: %s\n' "$logo_img_output_file"
      printf '输出文件: %s\n' "$service_xml_output_file"
      ;;
    RK_Linux)
      printf '输出文件: %s\n' "$logo_img_output_file"
      printf '输出文件: %s\n' "$installer_output_file"
      ;;
  esac
}

generate_outputs() {
  case "${CHIP_NAME}_${SYSTEM_NAME}" in
    T3_Linux)
      generate_t3_linux_outputs
      ;;
    T3_Android)
      generate_t3_android_outputs
      ;;
    RK_Linux)
      generate_rk_linux_outputs
      ;;
    RK_Android)
      generate_rk_android_outputs
      ;;
  esac
}

main() {
  local output_dir bmp_output_file yuv_output_file logo_output_file logo_img_output_file installer_output_file service_xml_output_file bmp_filter logo_filter

  command -v ffmpeg >/dev/null 2>&1 || {
    printf '未找到 ffmpeg，请先安装。\n' >&2
    exit 1
  }

  command -v ffprobe >/dev/null 2>&1 || {
    printf '未找到 ffprobe，请先安装。\n' >&2
    exit 1
  }

  prompt_image_path
  prompt_rotation
  prompt_chip
  prompt_system
  prompt_custom_name

  output_dir="${SCRIPT_DIR}/${CHIP_NAME}_${SYSTEM_NAME}_${CUSTOM_NAME}_${OUTPUT_DATE}"
  bmp_output_file="${output_dir}/bootlogo.bmp"
  yuv_output_file="${output_dir}/video_demo.yuv"
  logo_output_file="${output_dir}/logo"
  logo_img_output_file="${output_dir}/logo.img"
  installer_output_file="${output_dir}/unattended_installation.sh"
  service_xml_output_file="${output_dir}/$( [[ "$CHIP_NAME" == 'T3' ]] && printf 'E9631Service.xml' || printf 'CpService.xml' )"
  bmp_filter="${ROTATE_FILTER}format=bgr24"
  logo_filter="${ROTATE_FILTER}scale=${SELECTED_WIDTH}:${SELECTED_HEIGHT},format=bgra"

  mkdir -p "$output_dir"

  generate_outputs
  print_generated_files
}

main "$@"
