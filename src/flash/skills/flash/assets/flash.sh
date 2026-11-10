#!/bin/bash
# 整机线刷 + 验证（一条命令）
#
#   flash.sh doctor                                   环境自检（只读）
#   flash.sh plan   [<img|url> …] [参数]              只读：设备状态 / 镜像预检 / 将执行的命令
#   flash.sh flash  <img|url> [<url2> …] [验证参数]   进下载模式 → 线刷 → 等回线 → 验证（结论只打终端）
#   flash.sh verify [验证参数]                        只验证（设备已起系统，不刷）
#
# 下载源（可以给多条 URL：alist 优先，失败自动回落）：
#   flash.sh flash <alist直链> <minio直链>   先下 alist；403/超时/内容不是整机镜像就换下一条
#   本地镜像         直接给一个路径（不与 URL 混用）
#   FLASH_ALIST_HOSTS  判定 alist 的域名（默认 alist.cpinnov.run，逗号分隔）
#
# 平台与工具：
#   RK 安卓 / RK Debian   → rk_upgrade_tool UF <img>
#   T3 安卓 / T3 Linux    → openixcli flash <img> -V true -m full_erase -a reboot
#
# 进下载模式：
#   RK        : adb reboot loader
#   T3 安卓   : adb shell reboot efex
#   T3 Linux  : adb shell "devmem 0x01c20508 32 0x5AA5A55A && sync && reboot"
#
# 验证参数（flash / verify 通用，可重复）：
#   --expect-version V   期望版本；缺省从镜像文件名推导（整串优先，退回 V1.23 / DEV-XXXXXXXX 片段）
#   --exact              版本必须完全相等
#   --no-version-check   不做版本断言（只记录）
#   --no-reboot-check    不做 boot_id 变化断言
#   --expect 'k=v'       设备 getprop k 必须等于 v
#   --check 'cmd'        设备端命令 rc=0 才算通过（远端 `{ cmd; } && echo __PASS__`）
#   --pkg P              安卓：pm path P 非空
#   --unit U             Debian：systemctl is-active U == active
#   --proc N             T3 Linux：pidof N 非空
#
# 公共参数：
#   --serial S            adb 序列号（多设备必填；单设备自动选）
#   --platform rk|t3      平台判不出来时强制
#   --log F               日志路径（默认 ~/Downloads/<镜像名>_flash_<时间>.log）
#   --report F            可选：额外生成 md 报告（默认不生成，只打日志）
#   --timeout-flash S     刷写超时，默认 2700
#   --timeout-boot S      回线 + 起系统超时，默认 600
#   --sha256 H            镜像 sha256 校验
#   --cache-dir D         URL 下载缓存，默认 ~/Downloads（不另建子目录）
#   --force-platform-mismatch  兼容旧用法：跳过跨系统提示（芯片一致本来就默认允许；芯片不一致仍拒）
#   --rk-index N          多台 rockusb 时先 rk_upgrade_tool SD N
#   -v                    打印工具完整输出（默认也落日志）
#   --quiet               只留里程碑（下载/进下载模式/刷写结论/验证），不刷进度条；日志仍全量
#   --dry-run             只预检：解析（含下载）镜像、判平台、比芯片与版本，打印将执行的命令后退出，不进下载模式
#
# 验收口径：只比版本号（设备版本与期望一致即通过）；boot_id、systemd 单元状态仅记录，不阻塞。
#
# 退出码：0 通过 / 2 用法 / 3 前置不满足 / 4 刷写失败 / 5 验证不通过 / 6 超时

set -Eeuo pipefail

SELF_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
TOOLS_DIR="${FLASH_TOOLS_DIR:-$SELF_DIR/tools}"
ADB_BIN="${ADB:-adb}"
HOME_DIR="${HOME:-/root}"
DL_DIR="${DL_DIR:-$HOME_DIR/Downloads}"
CACHE_DIR="${FLASH_CACHE_DIR:-$DL_DIR}"
# alist 域名（可用 FLASH_ALIST_HOSTS 覆盖，逗号分隔）：多条候选里 alist 排最前，下载优先用它
ALIST_HOSTS="${FLASH_ALIST_HOSTS:-alist.cpinnov.run}"

SERIAL=""
PRE_ADB_DEVS=()
PLATFORM_OVERRIDE=""
REPORT=""
LOG=""
FLASH_TIMEOUT=2700
BOOT_TIMEOUT=600
SHA256_EXPECT=""
VERBOSE=0
QUIET=0
DRY_RUN=0
FORCE_MISMATCH=0
RK_INDEX=""

EXPECT_VERSION=""
EXACT=0
NO_VERSION_CHECK=0
NO_REBOOT_CHECK=0
EXPECTS=()
CHECKS=()
PKGS=()
UNITS=()
PROCS=()
POSITIONAL=()

FW=""
FW_SOURCE=""
FW_SOURCE_KIND=""
FW_SOURCE_FELL_BACK=0
FW_SIZE=0
FW_SHA=""
CANDIDATES=()
STEM=""
T3_BUS=""
T3_PORT=""
T3_COUNT=0
RK_COUNT=0

PRE_PLATFORM=""
PRE_VERSION=""
PRE_BOOT_ID=""
POST_PLATFORM=""
POST_VERSION=""
POST_BOOT_ID=""
FLASH_VERDICT="未执行"
FLASH_SECONDS=0
BOOTID_NOTE="未检查"
TMPDIR_RUN=""
RK_TOOL=""
OPENIXCLI=""

RES_NAMES=()
RES_STATES=()
RES_EVID=()

cleanup() { [ -n "$TMPDIR_RUN" ] && rm -rf "$TMPDIR_RUN" 2>/dev/null || true; }
trap cleanup EXIT

# ---------------------------------------------------------------- 基础输出

say() {
    printf '%s\n' "$*"
    # 里程碑同时落 $LOG：tail -f 即可看到阶段，不必再 sleep 一轮去 grep
    if [ -n "${LOG:-}" ] && [ -w "$LOG" ]; then printf '%s\n' "$*" >>"$LOG"; fi
}
# 给人看的过程消息一律走 stderr：download_firmware 等函数的 stdout 会被 $(...) 捕获成路径。
say_err() { printf '%s\n' "$*" >&2; }
warn() { printf 'WARN: %s\n' "$*" >&2; }
hr() { printf '%s\n' '----------------------------------------------------------------'; }
die() { local code="$1"; shift; printf 'ERROR: %s\n' "$*" >&2; exit "$code"; }

usage() { sed -n '2,/^$/p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

record() { # name state evidence
    RES_NAMES+=("$1")
    RES_STATES+=("$2")
    RES_EVID+=("${3:-}")
    printf '  [%s] %s%s\n' "$2" "$1" "${3:+ — $3}"
}

fail_count() {
    local n=0 s
    for s in "${RES_STATES[@]:-}"; do [ "$s" = FAIL ] && n=$((n + 1)); done
    printf '%s' "$n"
}

trim() { printf '%s' "$1" | tr -d '\r' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//'; }
vlog() { [ "$VERBOSE" = 1 ] && printf 'VERBOSE: %s\n' "$*" >&2 || true; }

# ---------------------------------------------------------------- 工具解析

resolve_tool() { # env_value name
    local envv="$1" name="$2" p
    if [ -n "$envv" ] && [ -x "$envv" ]; then printf '%s' "$envv"; return 0; fi
    if [ -x "$TOOLS_DIR/$name" ]; then printf '%s' "$TOOLS_DIR/$name"; return 0; fi
    p=$(command -v "$name" 2>/dev/null || true)
    if [ -n "$p" ]; then printf '%s' "$p"; return 0; fi
    return 1
}

need_tools() { # family
    if [ "$1" = rk ]; then
        RK_TOOL=$(resolve_tool "${RK_UPGRADE_TOOL:-}" rk_upgrade_tool) ||
            die 3 "找不到 rk_upgrade_tool（放 assets/tools/ 或装到 PATH）"
    else
        OPENIXCLI=$(resolve_tool "${OPENIXCLI:-}" openixcli) ||
            die 3 "找不到 openixcli（放 assets/tools/ 或装到 PATH）"
    fi
}

# ---------------------------------------------------------------- adb

adb_() {
    if [ -n "$SERIAL" ]; then "$ADB_BIN" -s "$SERIAL" "$@"; else "$ADB_BIN" "$@"; fi
}

sh_() { adb_ shell "$@"; }

adb_devices() {
    "$ADB_BIN" devices 2>/dev/null | sed -n '2,$p' | grep -E 'device$' | awk '{print $1}' || true
}

pick_serial() {
    local devs=() n
    if [ -n "$SERIAL" ]; then return 0; fi
    mapfile -t devs < <(adb_devices)
    n=${#devs[@]}
    case "$n" in
        0) return 1 ;;
        1) SERIAL="${devs[0]}" ;;
        *) die 3 "有多台 adb 设备（${devs[*]}），用 --serial 指定要刷哪一台" ;;
    esac
}

wait_adb() { # timeout
    local deadline=$((SECONDS + $1)) devs=() cands=() d last_hint=$SECONDS start=$SECONDS next=$((SECONDS + 15))
    while [ "$SECONDS" -lt "$deadline" ]; do
        if [ $((SECONDS - last_hint)) -ge 120 ]; then
            say "…仍在等 adb；若设备停在 OTG Host（安卓刷完/重启默认），请在设备上切到 DEVICE（见 SKILL §7.3）"
            last_hint=$SECONDS
        fi
        if [ "$SECONDS" -ge "$next" ]; then
            next=$((SECONDS + 15))
            say "  …等 adb 回线 $((SECONDS - start))s（USB: $(usb_ids)）"
        fi
        if [ -n "$SERIAL" ] && "$ADB_BIN" -s "$SERIAL" get-state 2>/dev/null | grep -q '^device$'; then
            return 0
        fi
        mapfile -t devs < <(adb_devices)
        case "${#devs[@]}" in
            1)
                # 重装系统后 adb 序列号会变（量产机常见），只剩一台就直接接管
                if [ "$SERIAL" != "${devs[0]}" ]; then
                    say "  adb 序列号变更：${SERIAL:-无} → ${devs[0]}（重装系统后正常，已接续）"
                fi
                SERIAL="${devs[0]}"
                return 0
                ;;
            0) ;;
            *)
                # 多台时接管「刷前不在场」的那台，避免等旧序列号等到超时
                cands=()
                for d in "${devs[@]}"; do
                    case " ${PRE_ADB_DEVS[*]-} " in *" $d "*) ;; *) cands+=("$d") ;; esac
                done
                if [ "${#cands[@]}" -eq 1 ]; then
                    say "  adb 序列号变更：${SERIAL:-无} → ${cands[0]}（新回线设备，已接续）"
                    SERIAL="${cands[0]}"
                    return 0
                fi
                die 3 "有多台 adb 设备（${devs[*]}），用 --serial 指定"
                ;;
        esac
        sleep 2
    done
    return 1
}

# ---------------------------------------------------------------- 平台判定

detect_platform() { # 输出 rk-android|rk-debian|t3-android|t3-linux|unknown
    local os plat sdk cps guard
    if [ -n "$PLATFORM_OVERRIDE" ]; then
        case "$PLATFORM_OVERRIDE" in
            rk)
                os=$(sh_ 'head -3 /etc/os-release 2>/dev/null' | tr -d '\r' || true)
                case "$os" in *Debian*) echo rk-debian ;; *) echo rk-android ;; esac ;;
            t3)
                os=$(sh_ 'head -3 /etc/os-release 2>/dev/null' | tr -d '\r' || true)
                case "$os" in *Buildroot*|*buildroot*) echo t3-linux ;; *) echo t3-android ;; esac ;;
            *) die 2 "--platform 只接受 rk|t3" ;;
        esac
        return 0
    fi

    os=$(sh_ 'head -3 /etc/os-release 2>/dev/null' | tr -d '\r' || true)
    case "$os" in
        *Debian*) echo rk-debian; return 0 ;;
        *Buildroot*|*buildroot*) echo t3-linux; return 0 ;;
    esac

    plat=$(sh_ getprop ro.board.platform 2>/dev/null | tr -d '\r\n' || true)
    sdk=$(sh_ getprop ro.build.version.sdk 2>/dev/null | tr -d '\r\n' || true)
    cps=$(sh_ 'pm path com.cpdevice.cpservice 2>/dev/null' | tr -d '\r\n' || true)
    guard=$(sh_ 'pm path com.android.guard 2>/dev/null' | tr -d '\r\n' || true)

    if [ "${plat#rk}" != "$plat" ] || [ -n "$cps" ]; then echo rk-android; return 0; fi
    if [ "${plat#sun}" != "$plat" ] || [ -n "$guard" ] || [ "$sdk" = 23 ]; then echo t3-android; return 0; fi
    echo unknown
}

platform_family() { case "$1" in rk-*) echo rk ;; t3-*) echo t3 ;; *) echo unknown ;; esac; }

usb_family() {
    if lsusb 2>/dev/null | grep -q 'ID 2207:'; then echo rk; return 0; fi
    if lsusb 2>/dev/null | grep -q 'ID 1f3a:'; then echo t3; return 0; fi
    echo unknown
}

# ---------------------------------------------------------------- 设备版本

current_version() { # platform
    local v=""
    case "$1" in
        rk-android|t3-android)
            v=$(sh_ 'getprop ro.build.cp.version' 2>/dev/null | tr -d '\r' || true)
            [ -n "$(trim "$v")" ] || v=$(sh_ 'getprop ro.build.display.id' 2>/dev/null | tr -d '\r' || true)
            ;;
        rk-debian)
            v=$(sh_ "sed -n 's/^Version=//p' /etc/system_info/system_info.ini 2>/dev/null | head -1" | tr -d '\r' || true)
            [ -n "$(trim "$v")" ] || v=$(sh_ 'uname -r' 2>/dev/null | tr -d '\r' || true)
            ;;
        t3-linux)
            v=$(sh_ "sed -n 's/^Version=//p' /Configs/system_info/system_info.ini 2>/dev/null | head -1" | tr -d '\r' || true)
            [ -n "$(trim "$v")" ] || v=$(sh_ 'uname -r' 2>/dev/null | tr -d '\r' || true)
            ;;
    esac
    trim "$v"
}

device_boot_id() { sh_ 'cat /proc/sys/kernel/random/boot_id 2>/dev/null' | tr -d '\r\n' || true; }

# ---------------------------------------------------------------- 下载模式

rk_present() {
    [ -n "$RK_TOOL" ] || return 1
    local out n
    out=$("$RK_TOOL" LD 2>&1 || true)
    n=$(printf '%s\n' "$out" | sed -n 's/.*List of rockusb connected(\([0-9]*\)).*/\1/p' | head -1)
    RK_COUNT="${n:-0}"
    [ "${RK_COUNT:-0}" -gt 0 ]
}

usb_ids() { # 当前 USB 上看到的 Rockchip/全志 ID，用于进度行
    local ids
    ids=$(lsusb 2>/dev/null | grep -oE 'ID (2207|1f3a):[0-9a-f]{4}' | awk '{print $2}' | paste -sd, -)
    printf '%s' "${ids:-无}"
}

# 进下载模式之前先确认沙箱能碰 USB：workspace-write 下 rk_upgrade_tool 只报
# failed to call context_enter!（设备根本没被访问到）。此时若已 adb reboot loader，
# 设备会被踢进 loader 却刷不了，只能整轮重跑——宁可在这里 fail-fast，设备不动。
preflight_usb() { # family
    local out rc=0
    if [ "$1" = rk ]; then
        [ -n "$RK_TOOL" ] || return 0
        out=$("$RK_TOOL" LD 2>&1) || rc=$?
        if [ "$rc" -ne 0 ] || printf '%s' "$out" | grep -qi 'context_enter'; then
            die 3 "沙箱看不到 USB（rk_upgrade_tool LD: $(printf '%s\n' "$out" | head -1)）。线刷必须用 full-access 跑；设备未被重启，可直接重跑。"
        fi
    fi
    return 0
}

t3_present() {
    [ -n "$OPENIXCLI" ] || return 1
    local out line
    out=$("$OPENIXCLI" scan 2>&1 || true)
    if ! printf '%s\n' "$out" | grep -q 'Found [0-9][0-9]* device'; then
        T3_COUNT=0
        return 1
    fi
    T3_COUNT=$(printf '%s\n' "$out" | grep -c 'Bus [0-9][0-9]*, Port [0-9][0-9]*' || true)
    line=$(printf '%s\n' "$out" | grep -oE 'Bus [0-9]+, Port [0-9]+' | head -1)
    T3_BUS=$(printf '%s' "$line" | sed -n 's/^Bus \([0-9]*\),.*/\1/p')
    T3_PORT=$(printf '%s' "$line" | sed -n 's/.*Port \([0-9]*\)$/\1/p')
    [ "${T3_COUNT:-0}" -gt 0 ]
}

usb_t3_id() {
    lsusb -d 1f3a:efe8 2>/dev/null | awk 'NR==1{print $2"."$4}'
}

wait_download_mode() { # family timeout
    local deadline=$((SECONDS + $2)) a b start=$SECONDS next=$((SECONDS + 10))
    while [ "$SECONDS" -lt "$deadline" ]; do
        if [ "$1" = rk ]; then
            rk_present && return 0
        else
            if t3_present; then
                # T3 进 FEL 会先以高速 ff.ff 出现、再重枚举成正式 FEL；等同一个 USB 地址稳定 4s 再刷
                a=$(usb_t3_id)
                sleep 4
                b=$(usb_t3_id)
                if [ -n "$b" ] && [ "$a" = "$b" ] && t3_present; then
                    return 0
                fi
            fi
        fi
        if [ "$SECONDS" -ge "$next" ]; then
            next=$((SECONDS + 10))
            say "  …等 $1 下载模式 $((SECONDS - start))s（USB: $(usb_ids)）"
        fi
        sleep 2
    done
    return 1
}

enter_download_mode() { # platform
    case "$1" in
        rk-android|rk-debian)
            say "→ adb reboot loader"
            adb_ reboot loader 2>/dev/null || sh_ 'reboot loader' 2>/dev/null || true
            ;;
        t3-android)
            say "→ adb shell reboot efex"
            sh_ reboot efex 2>/dev/null || sh_ "su -c 'reboot efex'" 2>/dev/null || true
            ;;
        t3-linux)
            say "→ adb shell \"devmem 0x01c20508 32 0x5AA5A55A && sync && reboot\""
            sh_ "devmem 0x01c20508 32 0x5AA5A55A && sync && reboot" 2>/dev/null || true
            ;;
    esac
}

# ---------------------------------------------------------------- 镜像

url_basename() {
    local b
    b=$(basename -- "${1%%[?#]*}")
    printf '%s' "${b//%20/ }"
}

# alist 直链在本机全局代理（https_proxy/http_proxy）下会 TLS 握手失败（curl 35，
# 表现为「下载失败」或 plan 直接静默退出）。统一走这里：alist 域名强制直连；
# 其他域名先用环境代理，遇到代理/TLS 类失败（5/6/7/35/52/56/60）再改直连重试一次。
curl_fw() { # <url> [curl 参数...]
    local url="$1" rc=0
    shift
    case "$url" in
        *alist.cpinnov.run*|*cpinnov.run/p/*)
            curl --noproxy '*' "$@" "$url" ;;
        *)
            curl "$@" "$url" && return 0
            rc=$?
            case "$rc" in
                5|6|7|35|52|56|60)
                    say_err "经代理访问失败（curl $rc），改直连重试"
                    curl --noproxy '*' "$@" "$url" ;;
                *) return "$rc" ;;
            esac ;;
    esac
}

http_size() {
    curl_fw "$1" -sIL --max-time 30 2>/dev/null | tr -d '\r' |
        awk 'tolower($1)=="content-length:"{v=$2} END{if(v)printf "%.0f", v}'
}

# 下载源分类：alist / minio / next / 其它（回 host）
source_kind() { # url
    local url="$1" host h hit=0
    host=$(printf '%s' "$url" | sed -E 's#^[a-zA-Z]+://([^/]+).*#\1#')
    local IFS=','
    for h in $ALIST_HOSTS; do
        [ -n "$h" ] || continue
        case "$host" in *"$h"*) hit=1 ;; esac
    done
    if [ "$hit" = 1 ]; then printf 'alist'; return 0; fi
    case "$host" in
        minio.cpuniverse.cn) printf 'minio' ;;
        next.cpinnov.run) printf 'next' ;;
        *) printf '%s' "$host" ;;
    esac
}

# 候选排序：alist 优先（同组保持给定顺序），结果写全局 CANDIDATES
order_candidates() {
    local u
    CANDIDATES=()
    for u in "$@"; do
        if [ "$(source_kind "$u")" = alist ]; then CANDIDATES+=("$u"); fi
    done
    for u in "$@"; do
        if [ "$(source_kind "$u")" != alist ]; then CANDIDATES+=("$u"); fi
    done
}

# 下载之前先查下载目录：按 URL basename 查 ~/Downloads 顶层，size 对得上就复用。
# 只返回路径，不复制、不改名——镜像在下载目录里只留一份。
precheck_local() { # url
    local url="$1" b size f
    b=$(url_basename "$url")
    size=$(http_size "$url")
    [ "${size:-0}" -gt 0 ] || return 1
    for f in "$CACHE_DIR/$b" "$DL_DIR/$b"; do
        [ -s "$f" ] || continue
        [ "$(stat -c %s "$f" 2>/dev/null || echo 0)" = "$size" ] || continue
        printf '%s' "$f"
        return 0
    done
    return 1
}

# 落地校验：alist 直链失效时可能返回 200 + 几百字节 JSON，体积和镜像头都要对得上
firmware_looks_valid() { # file [expect_size]
    local f="$1" want="${2:-0}" cur chip
    [ -f "$f" ] || return 1
    cur=$(stat -c %s "$f" 2>/dev/null || echo 0)
    [ "$cur" -gt 0 ] || return 1
    if [ "${want:-0}" -gt 0 ] && [ "$cur" != "$want" ]; then
        say_err "大小不符：$cur / $want B"
        return 1
    fi
    chip=$(image_chip "$f")
    if [ -n "$chip" ]; then return 0; fi
    if [ "$cur" -lt 1048576 ]; then
        say_err "内容不像整机镜像（$(head -c 8 -- "$f" 2>/dev/null | tr -d '\0' | tr -cd '[:print:]')，$cur B）"
        return 1
    fi
    warn "镜像头不是 RKFW/RKAF/IMAGEWTY，体积正常（$cur B），继续"
    return 0
}

# 下载单个候选。成功时 stdout 只输出本地路径；失败 return 3（由 resolve_firmware 决定是否换下一个源）。
# 第 2 参数 purge=1：失败时删掉半包，避免两个源的内容拼在一起。
download_firmware() { # url [purge_on_fail]
    local url="$1" purge="${2:-0}" dest size cur
    dest="$CACHE_DIR/$(url_basename "$url")"
    mkdir -p "$CACHE_DIR"

    if [ "$(source_kind "$url")" = alist ]; then
        say_err "alist 直链：本机代理会 TLS 失败，已强制直连下载"
    fi

    # 注意：本函数 stdout 只允许输出最终路径（会被 resolve_firmware 的 $(...) 捕获），
    # 过程消息一律 say_err（曾经写成 say，导致 FW 变成「提示行 + 路径」两行 → sha256sum 报错 + 静默退出）。
    size=$(http_size "$url")
    if [ -s "$dest" ]; then
        cur=$(stat -c %s "$dest" 2>/dev/null || echo 0)
        if [ "${size:-0}" -gt 0 ] && [ "$cur" = "$size" ]; then
            say_err "复用已下载镜像：$dest（$cur B）"
            printf '%s' "$dest"
            return 0
        fi
        say_err "续传：$dest（$cur / ${size:-?} B）"
        if ! curl_fw "$url" -sS -L --fail --retry 3 --retry-delay 2 -C - -o "$dest"; then
            say_err "下载失败：$url"
            if [ "$purge" = 1 ]; then rm -f "$dest"; fi
            return 3
        fi
    else
        say_err "下载中：$url"
        if ! curl_fw "$url" -sS -L --fail --retry 3 --retry-delay 2 -o "$dest"; then
            say_err "下载失败：$url"
            if [ "$purge" = 1 ]; then rm -f "$dest"; fi
            return 3
        fi
    fi
    if ! firmware_looks_valid "$dest" "${size:-0}"; then
        say_err "下载结果不可用：$url"
        if [ "$purge" = 1 ]; then rm -f "$dest"; fi
        return 3
    fi
    say_err "下载完成：$dest（$(stat -c %s "$dest") B）"
    printf '%s' "$dest"
}

# 解析镜像：<download(0|1)> <候选 URL 或本地镜像...>
# 多条 URL 时 alist 自动排最前；主源失败自动换下一条（不同源的半包不拼接）。
resolve_firmware() {
    local do_dl="$1" hit="" arg cand i purge=0
    local urls=() locals_=() failed=()
    shift
    for arg in "$@"; do
        case "$arg" in
            http://*|https://*) urls+=("$arg") ;;
            *) locals_+=("$arg") ;;
        esac
    done
    FW=""
    FW_SOURCE=""
    FW_SOURCE_KIND=""
    FW_SOURCE_FELL_BACK=0
    CANDIDATES=()

    if [ "${#locals_[@]}" -gt 0 ] && [ "${#urls[@]}" -gt 0 ]; then
        die 2 "本地镜像与 URL 不能混用（本地：${locals_[*]}）"
    fi
    if [ "${#locals_[@]}" -gt 1 ]; then
        die 2 "只能指定一个本地镜像（收到 ${#locals_[@]} 个）"
    fi

    if [ "${#locals_[@]}" -eq 1 ]; then
        arg="${locals_[0]}"
        [ -f "$arg" ] || die 3 "镜像不存在：$arg"
        FW="$arg"
        FW_SOURCE="$arg"
        FW_SOURCE_KIND="local"
    else
        [ "${#urls[@]}" -gt 0 ] || return 0
        order_candidates "${urls[@]}"
        # 1) 下载目录里已有同 size 的同一份文件就直接用（不重复下载）
        for cand in "${CANDIDATES[@]}"; do
            hit=$(precheck_local "$cand" || true)
            if [ -n "$hit" ]; then
                FW="$hit"
                FW_SOURCE="$cand"
                FW_SOURCE_KIND=$(source_kind "$cand")
                say_err "复用本地镜像：$hit（$(stat -c %s "$hit") B，不重复下载）"
                break
            fi
        done
        if [ -z "$FW" ] && [ "$do_dl" = 0 ]; then
            # 只预检：按候选顺序取第一个能拿到 Content-Length 的
            for cand in "${CANDIDATES[@]}"; do
                FW_SOURCE="$cand"
                FW_SOURCE_KIND=$(source_kind "$cand")
                FW_SIZE=$(http_size "$cand")
                if [ "${FW_SIZE:-0}" -gt 0 ]; then break; fi
                FW_SIZE=0
            done
            return 0
        fi
        if [ -z "$FW" ]; then
            for i in "${!CANDIDATES[@]}"; do
                cand="${CANDIDATES[$i]}"
                purge=0
                if [ "$((i + 1))" -lt "${#CANDIDATES[@]}" ]; then purge=1; fi
                if FW=$(download_firmware "$cand" "$purge"); then
                    FW_SOURCE="$cand"
                    FW_SOURCE_KIND=$(source_kind "$cand")
                    if [ "$i" -gt 0 ]; then FW_SOURCE_FELL_BACK=1; fi
                    break
                fi
                FW=""
                failed+=("$(source_kind "$cand")=$cand")
                if [ "$((i + 1))" -lt "${#CANDIDATES[@]}" ]; then
                    say "下载源 $(source_kind "$cand") 不可用，换下一个候选"
                fi
            done
            [ -n "$FW" ] || die 3 "所有下载源都失败：${failed[*]:-（无候选）}"
            [ -f "$FW" ] || die 3 "镜像解析失败（下载函数返回了非路径内容）：$FW"
        fi
    fi

    if [ "${FW##*.}" = zip ]; then
        unzip -o -j -q "$FW" '*.img' -d "$TMPDIR_RUN" || die 3 "zip 里没有 .img：$FW"
        local imgs=()
        mapfile -t imgs < <(find "$TMPDIR_RUN" -maxdepth 1 -name '*.img' -type f)
        [ "${#imgs[@]}" -eq 1 ] || die 3 "zip 里的 .img 不是唯一一个，无法自动选择"
        FW="${imgs[0]}"
    fi

    FW_SIZE=$(stat -c %s "$FW" 2>/dev/null || echo 0)
    FW_SHA=$(sha256sum "$FW" | awk '{print $1}')
    if [ -n "$SHA256_EXPECT" ] && [ "$FW_SHA" != "${SHA256_EXPECT,,}" ]; then
        die 3 "sha256 不匹配：期望 $SHA256_EXPECT，实际 $FW_SHA"
    fi
}

version_from_name() { basename -- "${1%%[?#]*}" | sed 's/\.\(img\|bin\|zip\|gz\)$//'; }

version_token() {
    printf '%s' "$1" | grep -oE 'DEV-[0-9A-Fa-f]+|V[0-9]+(\.[0-9]+)+' | head -1 || true
}

image_letter() {
    basename -- "$1" | sed -n 's/^[^_]*_[^_]*_\([ADRL]\)_.*/\1/p'
}

letter_platform() {
    case "$1" in
        A) echo android ;;
        D) echo debian ;;
        R|L) echo linux ;;
        *) echo '' ;;
    esac
}

image_chip() { # img -> rk|t3|""
    local m
    [ -n "$1" ] && [ -f "$1" ] || return 0
    m=$(head -c 8 -- "$1" 2>/dev/null | tr -d '\0' || true)
    case "$m" in
        IMAGEWTY*) echo t3 ;;
        RKFW*|RKAF*) echo rk ;;
    esac
}

check_image_platform() { # platform
    local letter expect got fam chip
    [ -n "$FW" ] || return 0
    fam=$(platform_family "$1")
    # 跨系统（安卓 ↔ Debian ↔ BuildRoot）直接刷；芯片不一致（RK vs T3）一律拒。
    chip=$(image_chip "$FW")
    if [ -n "$chip" ] && [ -n "$fam" ] && [ "$chip" != "$fam" ]; then
        die 3 "镜像芯片=${chip}，设备芯片=${fam}；跨系统可以，跨芯片不刷"
    fi
    letter=$(image_letter "$FW")
    [ -n "$letter" ] || return 0
    expect=$(letter_platform "$letter")
    got="$1"
    case "$expect:$got" in
        android:*-android|debian:rk-debian|linux:t3-linux) return 0 ;;
    esac
    [ "$FORCE_MISMATCH" = 1 ] && return 0
    warn "跨系统刷写：镜像 _${letter}_（${expect}）→ 设备 ${got}，芯片一致（${fam:-?}），继续"
    return 0
}

# ---------------------------------------------------------------- 刷写

flash_device() { # family
    local family="$1" section="$TMPDIR_RUN/flash.out" start=0 rc=0 t0=$SECONDS
    [ -f "$LOG" ] && start=$(wc -l <"$LOG")
    : >"$section"

    set +e
    if [ "$family" = rk ]; then
        if [ "$QUIET" = 1 ]; then
            # 日志仍写原始输出；终端只留结论行（工具进度条会刷上百行）
            timeout "$FLASH_TIMEOUT" "$RK_TOOL" UF "$FW" 2>&1 | tee -a "$LOG" |
                tr '\r' '\n' | grep -v -E 'Download Image\.\.\.|^\s*$' | tail -n 20
        else
            timeout "$FLASH_TIMEOUT" "$RK_TOOL" UF "$FW" 2>&1 | tee -a "$LOG"
        fi
        rc=${PIPESTATUS[0]}
    else
        local args=(-V true -m full_erase -a reboot)
        [ -n "$T3_BUS" ] && args+=(-b "$T3_BUS")
        [ -n "$T3_PORT" ] && args+=(-P "$T3_PORT")
        if [ "$QUIET" = 1 ]; then
            timeout "$FLASH_TIMEOUT" "$OPENIXCLI" flash "$FW" "${args[@]}" 2>&1 | tee -a "$LOG" |
                tr '\r' '\n' | grep -v -E '^\s*$|[0-9]+%' | tail -n 20
        else
            timeout "$FLASH_TIMEOUT" "$OPENIXCLI" flash "$FW" "${args[@]}" 2>&1 | tee -a "$LOG"
        fi
        rc=${PIPESTATUS[0]}
    fi
    set -e

    FLASH_SECONDS=$((SECONDS - t0))
    tail -n +"$((start + 1))" "$LOG" >"$section" 2>/dev/null || true

    if [ "$rc" -eq 124 ]; then
        FLASH_VERDICT="超时"
        return 6
    fi

    if [ "$family" = rk ]; then
        if grep -q 'Download Firmware Success' "$section" && ! grep -q 'Download Firmware Fail' "$section"; then
            FLASH_VERDICT="成功"
            return 0
        fi
    else
        if grep -q 'All partitions flashed successfully' "$section"; then
            FLASH_VERDICT="成功"
            return 0
        fi
    fi
    FLASH_VERDICT="失败"
    return 4
}

# ---------------------------------------------------------------- 验证

wait_boot() { # platform timeout
    local pl="$1" deadline=$((SECONDS + $2)) v=""
    while [ "$SECONDS" -lt "$deadline" ]; do
        case "$pl" in
            *-android)
                v=$(sh_ 'getprop sys.boot_completed' 2>/dev/null | tr -d '\r\n' || true)
                [ "$v" = 1 ] && return 0
                ;;
            rk-debian)
                v=$(sh_ 'systemctl is-system-running 2>/dev/null' 2>/dev/null | tr -d '\r\n' || true)
                case "$v" in running|degraded) return 0 ;; esac
                ;;
            t3-linux)
                if sh_ 'test -r /Configs/system_info/system_info.ini && echo ok' 2>/dev/null | grep -q ok; then
                    return 0
                fi
                ;;
        esac
        sleep 3
    done
    return 1
}

run_assertions() { # platform version
    local pl="$1" ver="$2" out exp token name got res nf units

    # 1) 版本
    if [ "$NO_VERSION_CHECK" = 0 ]; then
        name="版本"
        exp="${EXPECT_VERSION:-$(version_from_name "${STEM:-$FW}")}"
        if [ -z "$(trim "$exp")" ]; then
            record "$name" WARN "没有期望版本可比对；设备版本=$ver"
        elif [ -z "$ver" ]; then
            record "$name" FAIL "读不到设备版本（期望 $exp）"
        elif [ "$EXACT" = 1 ]; then
            if [ "$ver" = "$exp" ]; then record "$name" PASS "$ver"; else record "$name" FAIL "设备=$ver 期望=$exp"; fi
        elif [[ "${ver,,}" == *"${exp,,}"* ]]; then
            record "$name" PASS "$ver（匹配 $exp）"
        else
            token=$(version_token "$exp")
            if [ -n "$token" ] && [[ "${ver,,}" == *"${token,,}"* ]]; then
                record "$name" PASS "$ver（匹配片段 $token）"
            else
                record "$name" FAIL "设备=$ver 期望含=$exp"
            fi
        fi
    else
        record "版本" SKIP "未检查（--no-version-check）；设备版本=$ver"
    fi

    # 2) 真重启（旁证：只记录，不判失败——验收口径只比版本号）
    if [ "$NO_REBOOT_CHECK" = 0 ] && [ -n "$PRE_BOOT_ID" ] && [ -n "$POST_BOOT_ID" ]; then
        if [ "$PRE_BOOT_ID" != "$POST_BOOT_ID" ]; then
            BOOTID_NOTE="已变化（${PRE_BOOT_ID:0:8} → ${POST_BOOT_ID:0:8}）"
        else
            BOOTID_NOTE="未变化（${PRE_BOOT_ID:0:8}）——设备可能没真正重启，仅作旁证"
        fi
    else
        BOOTID_NOTE="未检查"
    fi
    record "真重启（boot_id，旁证）" INFO "$BOOTID_NOTE"

    # 3) 系统可用性（只记录旁证：不进 PASS/FAIL 判定，验收口径只比版本号）
    case "$pl" in
        *-android)
            out=$(sh_ 'dumpsys activity activities 2>/dev/null | grep mResumedActivity | head -1' 2>/dev/null | tr -d '\r' || true)
            if [ -n "$(trim "$out")" ]; then record "前台应用（旁证）" INFO "$(trim "$out")"
            else record "前台应用（旁证）" INFO "mResumedActivity 为空（可能是无界面设备）"; fi
            ;;
        rk-debian)
            out=$(sh_ 'systemctl is-system-running 2>/dev/null' 2>/dev/null | tr -d '\r\n' || true)
            case "$out" in
                running) record "systemd（旁证）" INFO "running" ;;
                degraded)
                    nf=$(sh_ 'systemctl --failed --no-pager --plain --no-legend 2>/dev/null | wc -l' 2>/dev/null | tr -d '\r\n' || true)
                    units=$(sh_ "systemctl --failed --no-pager --plain --no-legend 2>/dev/null | awk '{print \$1}' | head -4 | tr '\n' ' '" 2>/dev/null | tr -d '\r' || true)
                    record "systemd（旁证）" INFO "degraded（failed ${nf:-?} 个：$(trim "$units")）" ;;
                *) record "systemd（旁证）" INFO "is-system-running=$out" ;;
            esac
            ;;
        t3-linux)
            out=$(sh_ 'pidof Launcher 2>/dev/null' 2>/dev/null | tr -d '\r' || true)
            if [ -n "$(trim "$out")" ]; then record "Launcher（旁证）" INFO "pid=$out"
            else record "Launcher（旁证）" INFO "没有 Launcher（服务模式包可能正常）"; fi
            ;;
    esac

    # 4) 显式断言
    for out in "${EXPECTS[@]:-}"; do
        [ -n "$out" ] || continue
        got=$(trim "$(sh_ "getprop '${out%%=*}'" 2>/dev/null | tr -d '\r' || true)")
        exp="${out#*=}"
        if [ "$got" = "$exp" ]; then record "prop ${out%%=*}" PASS "$got"
        else record "prop ${out%%=*}" FAIL "实际=$got 期望=$exp"; fi
    done

    for out in "${CHECKS[@]:-}"; do
        [ -n "$out" ] || continue
        res=$(sh_ "{ $out; } && echo __PASS__" 2>&1 | tr -d '\r' || true)
        if printf '%s' "$res" | grep -q '__PASS__'; then record "check: $out" PASS "rc=0"
        else record "check: $out" FAIL "$(printf '%s' "$res" | tail -2 | tr '\n' ' ')"; fi
    done

    for out in "${PKGS[@]:-}"; do
        [ -n "$out" ] || continue
        case "$pl" in
            *-android)
                if [ -n "$(trim "$(sh_ "pm path '$out' 2>/dev/null" | tr -d '\r' || true)")" ]; then
                    record "app $out" PASS "已安装"
                else
                    record "app $out" FAIL "pm path 为空"
                fi
                ;;
            *) record "app $out" SKIP "非安卓，跳过" ;;
        esac
    done

    for out in "${UNITS[@]:-}"; do
        [ -n "$out" ] || continue
        if [ "$(trim "$(sh_ "systemctl is-active '$out' 2>/dev/null" | tr -d '\r' || true)")" = active ]; then
            record "unit $out" PASS "active"
        else
            record "unit $out" FAIL "非 active"
        fi
    done

    for out in "${PROCS[@]:-}"; do
        [ -n "$out" ] || continue
        if [ -n "$(trim "$(sh_ "pidof '$out' 2>/dev/null" | tr -d '\r' || true)")" ]; then
            record "进程 $out" PASS "在"
        else
            record "进程 $out" FAIL "不在"
        fi
    done
}

write_report() { # verdict
    local verdict="$1" f i fw_kind="${FW_SOURCE_KIND:-?}"
    [ -n "$REPORT" ] || return 0
    f="$REPORT"
    if [ "$FW_SOURCE_FELL_BACK" = 1 ]; then fw_kind="$fw_kind（alist 失败，已回落）"; fi
    mkdir -p "$(dirname -- "$f")"
    {
        echo "# 线刷验证报告"
        echo
        echo "- 时间：$(date '+%F %T %Z')"
        echo "- 结论：**$verdict**"
        echo
        echo "| 项 | 值 |"
        echo "|---|---|"
        echo "| 设备序列号 | ${SERIAL:-未知} |"
        echo "| 平台（刷前 → 刷后） | ${PRE_PLATFORM:-未知} → ${POST_PLATFORM:-未知} |"
        if [ -n "$FW" ]; then
            echo "| 固件 | $(basename -- "$FW") |"
            echo "| 固件大小 / sha256 | ${FW_SIZE:-?} B / ${FW_SHA:-?} |"
            echo "| 固件来源 | $fw_kind |"
        else
            echo "| 固件 | ${FW_SOURCE:-(未指定)} |"
            echo "| 固件大小 / sha256 | — |"
        fi
        echo "| 刷写 | ${FLASH_VERDICT}（${FLASH_SECONDS}s） |"
        echo "| 版本（刷前 → 刷后） | ${PRE_VERSION:-?} → ${POST_VERSION:-?} |"
        echo "| boot_id | ${BOOTID_NOTE} |"
        echo
        echo "## 断言"
        echo
        echo "| # | 检查 | 结果 | 证据 |"
        echo "|---|---|---|---|"
        for i in "${!RES_NAMES[@]}"; do
            printf '| %s | %s | %s | %s |\n' "$((i + 1))" \
                "$(printf '%s' "${RES_NAMES[$i]}" | tr '|' '/')" "${RES_STATES[$i]}" \
                "$(printf '%s' "${RES_EVID[$i]}" | tr '|' '/' | cut -c1-160)"
        done
        echo
        echo "## 验收口径"
        echo
        echo '- **只比版本号**：设备版本与期望版本一致即通过；`boot_id`、systemd/Launcher 状态仅记录，不阻塞。'
        echo "- 不截图、不验 UI / 开机 LOGO / 桌面；不跑客户业务功能（摄像头、CAN、网络等）。"
        echo '- 需要额外断言时显式加 `--check` / `--pkg` / `--unit` / `--proc` / `--expect`，否则不在本报告结论内。'
        echo
        echo "## 日志"
        echo
        echo '```'
        echo "${LOG:-（无）}"
        echo '```'
    } >"$f"
}

# ---------------------------------------------------------------- 参数

parse_args() {
    POSITIONAL=()
    while [ "$#" -gt 0 ]; do
        case "$1" in
            --serial) SERIAL="${2:?--serial 需要值}"; shift 2 ;;
            --serial=*) SERIAL="${1#*=}"; shift ;;
            --platform) PLATFORM_OVERRIDE="${2:?}"; shift 2 ;;
            --platform=*) PLATFORM_OVERRIDE="${1#*=}"; shift ;;
            --report) REPORT="${2:?}"; shift 2 ;;
            --report=*) REPORT="${1#*=}"; shift ;;
            --log) LOG="${2:?}"; shift 2 ;;
            --log=*) LOG="${1#*=}"; shift ;;
            --timeout-flash) FLASH_TIMEOUT="${2:?}"; shift 2 ;;
            --timeout-flash=*) FLASH_TIMEOUT="${1#*=}"; shift ;;
            --timeout-boot) BOOT_TIMEOUT="${2:?}"; shift 2 ;;
            --timeout-boot=*) BOOT_TIMEOUT="${1#*=}"; shift ;;
            --sha256) SHA256_EXPECT="${2:?}"; shift 2 ;;
            --sha256=*) SHA256_EXPECT="${1#*=}"; shift ;;
            --cache-dir) CACHE_DIR="${2:?}"; shift 2 ;;
            --cache-dir=*) CACHE_DIR="${1#*=}"; shift ;;
            --force-platform-mismatch) FORCE_MISMATCH=1; shift ;;
            --rk-index) RK_INDEX="${2:?}"; shift 2 ;;
            --rk-index=*) RK_INDEX="${1#*=}"; shift ;;
            --expect-version) EXPECT_VERSION="${2:?}"; shift 2 ;;
            --expect-version=*) EXPECT_VERSION="${1#*=}"; shift ;;
            --exact) EXACT=1; shift ;;
            --no-version-check) NO_VERSION_CHECK=1; shift ;;
            --no-reboot-check) NO_REBOOT_CHECK=1; shift ;;
            --expect) EXPECTS+=("${2:?}"); shift 2 ;;
            --expect=*) EXPECTS+=("${1#*=}"); shift ;;
            --check) CHECKS+=("${2:?}"); shift 2 ;;
            --check=*) CHECKS+=("${1#*=}"); shift ;;
            --pkg) PKGS+=("${2:?}"); shift 2 ;;
            --pkg=*) PKGS+=("${1#*=}"); shift ;;
            --unit) UNITS+=("${2:?}"); shift 2 ;;
            --unit=*) UNITS+=("${1#*=}"); shift ;;
            --proc) PROCS+=("${2:?}"); shift 2 ;;
            --proc=*) PROCS+=("${1#*=}"); shift ;;
            -v|--verbose) VERBOSE=1; shift ;;
            --quiet|-q) QUIET=1; shift ;;
            --dry-run) DRY_RUN=1; shift ;;
            --) shift; POSITIONAL+=("$@"); break ;;
            -*) die 2 "未知参数：$1（flash.sh help 看用法）" ;;
            *) POSITIONAL+=("$1"); shift ;;
        esac
    done
}

setup_paths() { # stem
    STEM="$1"
    if [ -z "$LOG" ]; then LOG="$DL_DIR/${STEM}_flash_$(date +%Y%m%d-%H%M%S).log"; fi
    mkdir -p "$DL_DIR" 2>/dev/null || die 3 "日志/下载目录不可写：$DL_DIR（用 --log/--cache-dir 指定）"
    : >"$LOG" 2>/dev/null || die 3 "无法创建日志：$LOG（用 --log 指定）"
}

# ---------------------------------------------------------------- 子命令

cmd_doctor() {
    local ok=1 tool
    hr
    say "flash.sh doctor"
    hr

    for c in "$ADB_BIN" curl tee timeout sha256sum unzip sed awk lsusb; do
        if command -v "$c" >/dev/null 2>&1; then
            say "OK   host: $c"
        else
            say "FAIL host: $c 缺失"; ok=0
        fi
    done

    if tool=$(resolve_tool "${RK_UPGRADE_TOOL:-}" rk_upgrade_tool); then
        RK_TOOL="$tool"
        say "OK   RK: $tool（$("$tool" -V 2>&1 | head -1)）"
    else
        say "FAIL RK: 找不到 rk_upgrade_tool（assets/tools/ 或 PATH）"; ok=0
    fi

    if tool=$(resolve_tool "${OPENIXCLI:-}" openixcli); then
        OPENIXCLI="$tool"
        say "OK   T3: $tool（$("$tool" --version 2>&1 | head -1)）"
    else
        say "FAIL T3: 找不到 openixcli（assets/tools/ 或 PATH）"; ok=0
    fi

    if compgen -G '/etc/udev/rules.d/*rockusb*' >/dev/null || compgen -G '/etc/udev/rules.d/*rk-*' >/dev/null; then
        say "OK   udev: Rockchip 规则存在"
    else
        say "WARN udev: 没有 Rockchip 规则（2207 设备可能没权限；见 references/flash.md）"
    fi
    if compgen -G '/etc/udev/rules.d/*allwinner*' >/dev/null; then
        say "OK   udev: Allwinner 规则存在"
    else
        say "WARN udev: 没有 Allwinner 规则（1f3a FEL 可能没权限）"
    fi

    if command -v lsmod >/dev/null 2>&1 && lsmod | grep -q '^awusb'; then
        say "WARN awusb: 全志 awusb 驱动已加载（modalias 自动加载，会抢 FEL）；先 pkexec sh -c 'echo blacklist awusb > /etc/modprobe.d/blacklist-awusb.conf && rmmod awusb'"
    fi

    say "---- 剩余空间（$DL_DIR）"
    df -h "$DL_DIR" 2>/dev/null | tail -1 || true

    say "---- adb"
    if "$ADB_BIN" devices | sed -n '2,$p' | grep -q .; then
        "$ADB_BIN" devices -l | sed -n '2,$p'
    else
        say "（无 adb 设备）"
    fi

    say "---- 下载模式"
    rk_present && say "ROCKUSB: $RK_COUNT 台" || say "ROCKUSB: 无"
    t3_present && say "FEL: $T3_COUNT 台（bus=$T3_BUS port=$T3_PORT）" || say "FEL: 无"

    hr
    if [ "$ok" = 1 ]; then say "doctor: OK"; else say "doctor: FAIL（缺工具）"; return 1; fi
}

cmd_plan() {
    local pl family
    parse_args "$@"

    RK_TOOL=$(resolve_tool "${RK_UPGRADE_TOOL:-}" rk_upgrade_tool) || RK_TOOL=""
    OPENIXCLI=$(resolve_tool "${OPENIXCLI:-}" openixcli) || OPENIXCLI=""

    if [ "${#POSITIONAL[@]}" -ge 1 ]; then
        resolve_firmware 0 "${POSITIONAL[@]}"
    fi
    STEM=$(basename -- "${FW:-${FW_SOURCE:-plan}}"); STEM="${STEM%.*}"

    hr
    say "PLAN（只读，不改设备）"
    hr
    if [ -n "$FW_SOURCE" ]; then
        say "固件：$FW_SOURCE"
        if [ "${#CANDIDATES[@]}" -gt 1 ]; then
            say "  下载源（alist 优先，失败自动回落）："
            local ci
            for ci in "${!CANDIDATES[@]}"; do
                say "    $((ci + 1)). $(source_kind "${CANDIDATES[$ci]}")  ${CANDIDATES[$ci]}"
            done
        elif [ -n "$FW_SOURCE_KIND" ]; then
            say "  下载源：$FW_SOURCE_KIND"
        fi
        if [ -n "$FW" ]; then
            say "  本地：$FW（$FW_SIZE B, sha256=${FW_SHA:0:16}…）"
        else
            if [ "${FW_SIZE:-0}" -gt 0 ]; then say "  远端：$FW_SIZE B（下载目录未命中，flash 时下载到 $CACHE_DIR）"
            else say "  远端：大小未知（下载目录未命中，flash 时下载到 $CACHE_DIR）"; fi
        fi
        say "  期望版本（按文件名）：$(version_from_name "${FW:-$FW_SOURCE}")"
        if [ -n "$(version_token "$(version_from_name "${FW:-$FW_SOURCE}")")" ]; then
            say "  版本片段：$(version_token "$(version_from_name "${FW:-$FW_SOURCE}")")"
        fi
    fi

    if pick_serial; then
        say "adb 设备：$SERIAL"
        pl=$(detect_platform)
        [ "$pl" = unknown ] && die 3 "判不出平台（安卓？Debian/Buildroot？）；用 --platform rk|t3 强制"
        say "  平台：$pl"
        say "  当前版本：$(current_version "$pl")"
        family=$(platform_family "$pl")
        if [ "$family" = t3 ] && command -v lsmod >/dev/null 2>&1 && lsmod | grep -q '^awusb'; then
            say "  ⚠ 宿主机 awusb 驱动已加载（FEL 自动加载），刷前先 pkexec sh -c 'echo blacklist awusb > /etc/modprobe.d/blacklist-awusb.conf && rmmod awusb'"
        fi
        case "$pl" in
            rk-*) say "  进下载模式：adb reboot loader" ;;
            t3-android) say "  进下载模式：adb shell reboot efex" ;;
            t3-linux) say '  进下载模式：adb shell "devmem 0x01c20508 32 0x5AA5A55A && sync && reboot"' ;;
        esac
        [ -n "$FW" ] && check_image_platform "$pl"
        if [ "$family" = rk ]; then say "  工具：rk_upgrade_tool UF ${FW:-<img>}"
        else say "  工具：openixcli flash ${FW:-<img>} -V true -m full_erase -a reboot"; fi
    elif rk_present; then
        say "设备已在 rockusb/loader 模式（$RK_COUNT 台）"
        say "  工具：rk_upgrade_tool UF ${FW_SOURCE:-<img>}"
    elif t3_present; then
        say "设备已在 FEL 模式（$T3_COUNT 台，bus=$T3_BUS port=$T3_PORT）"
        say "  工具：openixcli flash ${FW_SOURCE:-<img>} -V true -m full_erase -a reboot -b $T3_BUS -P $T3_PORT"
    else
        say "没有 adb 设备，也没有 loader/FEL 设备"
        say "  先让设备起系统（adb 可见）或手动进 loader/FEL"
    fi
    hr
    say "plan: OK（未刷任何东西）"
}

dry_run_report() { # family
    local family="$1"
    hr
    say "DRY-RUN（不刷写、不进下载模式）"
    hr
    say "设备：${SERIAL:-未连接}  平台：${PRE_PLATFORM:-$family}  当前版本：${PRE_VERSION:-?}"
    say "固件：$FW"
    say "  $FW_SIZE B  sha256=$FW_SHA"
    if [ "$FW_SOURCE_FELL_BACK" = 1 ]; then
        say "下载源：${FW_SOURCE_KIND:-?}（alist 不可用，已回落）"
    else
        say "下载源：${FW_SOURCE_KIND:-local}"
    fi
    say "期望版本：${EXPECT_VERSION:-$(version_from_name "$FW")}"
    if [ "$family" = rk ]; then
        say "将执行：adb reboot loader → rk_upgrade_tool UF $FW"
    else
        say "将执行：adb shell reboot efex（或 devmem …）→ openixcli flash $FW -V true -m full_erase -a reboot"
    fi
    say "验收：只比版本号（boot_id / systemd 仅记录）"
}

cmd_flash() {
    local family="" pl="" usb_fam="" rc=0 nf
    parse_args "$@"
    [ "${#POSITIONAL[@]}" -ge 1 ] || die 2 "用法：flash.sh flash <img|url> [<url2> …] [验证参数]"

    resolve_firmware 1 "${POSITIONAL[@]}"
    [ -n "$FW" ] || die 2 "镜像解析失败"
    setup_paths "$(version_from_name "$FW")"

    hr
    say "FLASH"
    hr
    say "固件：$FW"
    say "  $FW_SIZE B  sha256=$FW_SHA"
    if [ "$FW_SOURCE_FELL_BACK" = 1 ]; then
        say "  来源：${FW_SOURCE_KIND:-?}（alist 不可用，已回落）"
    else
        say "  来源：${FW_SOURCE_KIND:-local}"
    fi
    say "  期望版本：${EXPECT_VERSION:-$(version_from_name "$FW")}"

    if pick_serial; then
        pl=$(detect_platform)
        [ "$pl" = unknown ] && die 3 "判不出平台；用 --platform rk|t3 强制"
        if [ "$(platform_family "$pl")" = t3 ] && command -v lsmod >/dev/null 2>&1 && lsmod | grep -q '^awusb'; then
            die 3 "宿主机加载了全志 awusb 驱动（FEL 设备出现时自动加载），会抢 1f3a:efe8 → openixcli: USB transfer failed。一次性解决：pkexec sh -c 'echo blacklist awusb > /etc/modprobe.d/blacklist-awusb.conf && rmmod awusb'；恢复全志工具：pkexec rm /etc/modprobe.d/blacklist-awusb.conf && pkexec modprobe awusb"
        fi
        PRE_PLATFORM="$pl"
        PRE_VERSION=$(current_version "$pl")
        PRE_BOOT_ID=$(device_boot_id)
        mapfile -t PRE_ADB_DEVS < <(adb_devices)
        family=$(platform_family "$pl")
        say "设备：$SERIAL  平台：$pl  当前版本：$PRE_VERSION"
        check_image_platform "$pl"
        need_tools "$family"
        vlog "工具：$([ "$family" = rk ] && echo "$RK_TOOL" || echo "$OPENIXCLI")"
        if [ "$DRY_RUN" = 1 ]; then dry_run_report "$family"; return 0; fi
        preflight_usb "$family"
        enter_download_mode "$pl"
    else
        usb_fam=$(usb_family)
        [ "$usb_fam" = unknown ] && die 3 "没有 adb 设备，也没有 loader/FEL 设备"
        family="$usb_fam"
        need_tools "$family"
        preflight_usb "$family"
        say "设备不在 adb，USB 上是 $family；按已在下载模式处理"
        if [ "$family" = rk ]; then
            rk_present || die 3 "rk_upgrade_tool 看不到 rockusb 设备"
            say "  rockusb：$RK_COUNT 台"
        else
            t3_present || die 3 "openixcli 看不到 FEL 设备"
            say "  FEL：$T3_COUNT 台（bus=$T3_BUS port=$T3_PORT）"
        fi
        if [ "$DRY_RUN" = 1 ]; then dry_run_report "$family"; return 0; fi
    fi

    if [ "$family" = rk ] && [ "${RK_COUNT:-0}" -gt 1 ]; then
        if [ -n "$RK_INDEX" ]; then
            say "多台 rockusb，切到 #$RK_INDEX"
            "$RK_TOOL" SD "$RK_INDEX" || die 3 "rk_upgrade_tool SD $RK_INDEX 失败"
        else
            die 3 "有 $RK_COUNT 台 rockusb；先只留一台，或用 --rk-index N"
        fi
    fi

    if ! wait_download_mode "$family" 90; then
        die 3 "90s 内没等到 $family 下载模式（USB 线/口、OTG 角色、驱动；见 references/flash.md）"
    fi

    hr
    say "开始刷写（$family）…"
    flash_device "$family" || rc=$?
    case "$rc" in
        0) say "刷写成功（${FLASH_SECONDS}s）" ;;
        6) write_report "不通过（刷写超时）"; die 6 "刷写超时（${FLASH_TIMEOUT}s）；日志：$LOG" ;;
        *) write_report "不通过（刷写失败）"; die 4 "刷写失败（rc=$rc）；日志：$LOG" ;;
    esac

    say "等设备回线（最多 ${BOOT_TIMEOUT}s）…"
    if ! wait_adb "$BOOT_TIMEOUT"; then
        write_report "不通过（回线超时）"
        die 6 "刷完 ${BOOT_TIMEOUT}s 内没等到 adb 设备；若设备停在 OTG Host，切到 DEVICE 后跑 verify（SKILL §7.3）；重装系统后 adb 序列号会变，verify 前先 adb devices 取当前序列号；日志：$LOG"
    fi

    POST_PLATFORM=$(detect_platform)
    [ "$POST_PLATFORM" = unknown ] && POST_PLATFORM="$PRE_PLATFORM"
    say "回线：$SERIAL  平台：$POST_PLATFORM"
    wait_boot "$POST_PLATFORM" "$BOOT_TIMEOUT" || warn "系统在 ${BOOT_TIMEOUT}s 内没有明确就绪，继续取证"

    POST_VERSION=$(current_version "$POST_PLATFORM")
    POST_BOOT_ID=$(device_boot_id)

    hr
    say "验证"
    hr
    run_assertions "$POST_PLATFORM" "$POST_VERSION"

    nf=$(fail_count)
    if [ "$nf" -eq 0 ]; then
        write_report "通过"
        hr
        say "结果：通过"
        say "  版本：${PRE_VERSION:-?} → ${POST_VERSION:-?}"
        say "  日志：$LOG"
        if [ -n "$REPORT" ]; then say "  报告：$REPORT"; fi
        return 0
    fi
    write_report "不通过（$nf 项失败）"
    hr
    say "结果：不通过（$nf 项失败）"
    say "  版本：${PRE_VERSION:-?} → ${POST_VERSION:-?}"
    say "  日志：$LOG"
    if [ -n "$REPORT" ]; then say "  报告：$REPORT"; fi
    return 5
}

cmd_verify() {
    local pl nf
    parse_args "$@"
    [ "${#POSITIONAL[@]}" -eq 0 ] || die 2 "verify 不接受位置参数"
    setup_paths "verify"

    pick_serial || die 3 "没有 adb 设备"
    pl=$(detect_platform)
    [ "$pl" = unknown ] && die 3 "判不出平台；用 --platform rk|t3 强制"
    POST_PLATFORM="$pl"
    hr
    say "VERIFY  $SERIAL  $pl"
    hr
    wait_boot "$pl" "$BOOT_TIMEOUT" || warn "系统在 ${BOOT_TIMEOUT}s 内没有明确就绪，继续取证"
    POST_VERSION=$(current_version "$pl")
    say "当前版本：$POST_VERSION"
    run_assertions "$pl" "$POST_VERSION"

    nf=$(fail_count)
    if [ "$nf" -eq 0 ]; then
        write_report "通过"
        say "结果：通过"
        if [ -n "$REPORT" ]; then say "  报告：$REPORT"; fi
        return 0
    fi
    write_report "不通过（$nf 项失败）"
    say "结果：不通过（$nf 项失败）"
    if [ -n "$REPORT" ]; then say "  报告：$REPORT"; fi
    return 5
}

main() {
    TMPDIR_RUN=$(mktemp -d)
    local cmd="${1:-help}"
    [ "$#" -gt 0 ] && shift
    case "$cmd" in
        doctor) cmd_doctor "$@" ;;
        plan) cmd_plan "$@" ;;
        flash) cmd_flash "$@" ;;
        verify) cmd_verify "$@" ;;
        help|-h|--help) usage ;;
        *) usage; exit 2 ;;
    esac
}

main "$@"
