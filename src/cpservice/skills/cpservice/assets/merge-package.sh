#!/usr/bin/env bash
# 把资源增量合进客户已有安装包（BPMS「预装软件文件上传」里那份 zip），再交回上传。
#
#   merge-package.sh <原包.zip> [--out DIR] <文件或目录>...
#
# 规则（踩过的坑都在这）：
#   1. **内部布局原样保留**：包里有顶层目录就留在里面，平铺还是平铺。不要「顺手拍平」——
#      实测两种包都存在：zkydl_2026…zip 套一层同名目录，SPRING2_L_…zip 是平铺。
#   2. 同名文件**就地覆盖**（在包内哪个目录就覆盖哪个），新文件放到包根（有顶层目录时放那层）。
#   3. 不改包内 xml / 脚本内容：xml 里 params/srcfile/udiskfile 引用的文件名必须仍存在，
#      缺一个就不产包、直接失败（拒绝产出一个装不上的包）。
#   4. 输出名 = 原包名 + _YYYYMMDD.zip，同日多次自动加 -2/-3，不覆盖原包。
#
# 用法示例：
#   merge-package.sh ~/Downloads/zkydl_20261102.zip vendor/VanCoreT3-260414.apk
#   merge-package.sh pkg.zip --out ~/Downloads logo.img bootlogo.bmp
set -euo pipefail

die() { printf 'merge-package: %s\n' "$1" >&2; exit "${2:-1}"; }
usage() { sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; }

[[ $# -ge 2 ]] || { usage; exit 2; }
case "${1:-}" in -h|--help|help) usage; exit 0 ;; esac

ZIP="$1"; shift
[[ -f "$ZIP" ]] || die "找不到原包：$ZIP"

OUT_DIR=""
SRC=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --out) OUT_DIR="${2:?--out 需要目录}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) SRC+=("$1"); shift ;;
  esac
done
[[ ${#SRC[@]} -gt 0 ]] || die "没有要合入的文件"

command -v unzip >/dev/null || die "缺 unzip"
command -v zip >/dev/null || die "缺 zip"
for f in "${SRC[@]}"; do [[ -e "$f" ]] || die "找不到要合入的：$f"; done

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
unzip -q "$ZIP" -d "$WORK" || die "解包失败：$ZIP"

# 顶层目录：整包只有一个一级目录时，它就是设备眼里的包根
TOP=""
mapfile -t entries < <(cd "$WORK" && ls -A)
if [[ ${#entries[@]} -eq 1 && -d "$WORK/${entries[0]}" ]]; then TOP="${entries[0]}"; fi
ROOT="$WORK${TOP:+/$TOP}"

added=0; replaced=0; unchanged=0
declare -a ADDED=() REPLACED=()

merge_file() {
  local src="$1" base dest
  base="$(basename "$src")"
  dest="$(find "$WORK" -type f -name "$base" -print -quit || true)"
  if [[ -n "$dest" ]]; then
    if cmp -s "$src" "$dest"; then
      unchanged=$((unchanged + 1))
    else
      cp -f "$src" "$dest"
      replaced=$((replaced + 1)); REPLACED+=("${dest#$WORK/}")
    fi
  else
    cp -f "$src" "$ROOT/$base"
    added=$((added + 1)); ADDED+=("$base")
  fi
}

merge_dir() {
  local src="$1" base target
  base="$(basename "$src")"
  target="$(find "$WORK" -type d -name "$base" -print -quit || true)"
  [[ -n "$target" ]] || target="$ROOT/$base"
  mkdir -p "$target"
  while IFS= read -r -d '' f; do
    merge_file_to "$f" "$target"
  done < <(find "$src" -type f -print0)
}

merge_file_to() {
  local src="$1" target_dir="$2" base dest
  base="$(basename "$src")"
  dest="$target_dir/$base"
  if [[ -f "$dest" ]]; then
    if cmp -s "$src" "$dest"; then unchanged=$((unchanged + 1)); else
      cp -f "$src" "$dest"; replaced=$((replaced + 1)); REPLACED+=("${dest#$WORK/}")
    fi
  else
    cp -f "$src" "$dest"; added=$((added + 1)); ADDED+=("${dest#$WORK/}")
  fi
}

for src in "${SRC[@]}"; do
  if [[ -d "$src" ]]; then merge_dir "$src"; else merge_file "$src"; fi
done

# 引用校验：xml 里写了文件名，包里就必须有（大小写敏感，按 basename 比对）
ref_missing=()
while IFS= read -r -d '' xml; do
  while IFS= read -r ref; do
    [[ -n "$ref" ]] || continue
    case "$ref" in */*|*" "*) continue ;; esac                # 带路径/带空格的当命令，不按文件名校
    [[ "$ref" == *.* ]] || continue                           # 只校有扩展名的资源名
    [[ -n "$(find "$WORK" -type f -name "$ref" -print -quit)" ]] || ref_missing+=("$(basename "$xml"): $ref")
  done < <(grep -oE '(params|srcfile|udiskfile)="[^"]+"' "$xml" | sed -E 's/^[a-z]+="//; s/"$//' || true)
done < <(find "$WORK" -type f -iname '*.xml' -print0)

if [[ ${#ref_missing[@]} -gt 0 ]]; then
  printf 'merge-package: 包内 xml 引用的文件在合并后不存在，拒绝产包：\n' >&2
  printf '  - %s\n' "${ref_missing[@]}" >&2
  exit 3
fi

STAMP="$(date +%Y%m%d)"
OUT_DIR="${OUT_DIR:-$(dirname "$ZIP")}"
mkdir -p "$OUT_DIR"
OUT_DIR="$(cd "$OUT_DIR" && pwd)"
base_name="$(basename "$ZIP" .zip)"
out="$OUT_DIR/${base_name}_${STAMP}.zip"
n=2
while [[ -e "$out" ]]; do out="$OUT_DIR/${base_name}_${STAMP}-${n}.zip"; n=$((n + 1)); done

( cd "$WORK" && zip -qr "$out" . ) || die "重新打包失败：$out"

total=$(cd "$WORK" && find . -type f | wc -l | tr -d ' ')
printf '原包：%s\n' "$ZIP"
if [[ -n "$TOP" ]]; then printf '布局：套一层目录 %s/\n' "$TOP"; else printf '布局：平铺在 zip 根\n'; fi
printf '新增 %d / 替换 %d / 未变 %d（包内共 %d 个文件）\n' "$added" "$replaced" "$unchanged" "$total"
[[ ${#ADDED[@]} -gt 0 ]] && printf '  新增：%s\n' "${ADDED[*]}"
[[ ${#REPLACED[@]} -gt 0 ]] && printf '  替换：%s\n' "${REPLACED[*]}"
printf '产物：%s\n' "$out"
printf '%s\n' "$out"
