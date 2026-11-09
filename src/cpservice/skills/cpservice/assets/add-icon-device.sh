#!/system/bin/sh
# 给已安装的 App 在 Launcher3 桌面建图标（设备端，不依赖 adb/bash）
# 用法：sh add-icon-device.sh ['包名|标签|组件' ...]
# 要点：APK 装完再跑；root 写库后属主要改回 launcher；包刚更新时跑两轮兜底

LAUNCHER_PKG="${LAUNCHER_PKG:-com.android.launcher3}"
COLS="${COLS:-6}"
ROWS="${ROWS:-5}"
DATA_DIR="/data/data/${LAUNCHER_PKG}/databases"
DB="${DATA_DIR}/launcher.db"
ICON_DB="${DATA_DIR}/app_icons.db"
TMP_LIST="/data/local/tmp/add_icon_targets.$$"

LOG_FILE="/sdcard/add-icon-to-home.log"
if ! ( : >> "$LOG_FILE" ) 2>/dev/null; then
    LOG_FILE="/data/local/tmp/add-icon-to-home.log"
fi

log() {
    echo "add-icon: $*"
    echo "add-icon: $*" >> "$LOG_FILE" 2>/dev/null
}

DEFAULT_TARGETS=''
# 例：DEFAULT_TARGETS='com.example.app|应用名|com.example.app/.MainActivity'

TARGETS="$DEFAULT_TARGETS"
if [ $# -gt 0 ]; then
    TARGETS=''
    for t in "$@"; do
        TARGETS="${TARGETS}${t}
"
    done
fi

if [ -z "$TARGETS" ]; then
    echo "add-icon: DEFAULT_TARGETS 为空，用法：sh $0 <包名>[|<标签>[|<组件>]]"
    exit 1
fi

sqlite_run() {
    sqlite3 "$DB" "$1"
}

resolve_component() {
    dump="$(dumpsys package "$1" 2>/dev/null)"
    comp="$(printf '%s\n' "$dump" | sed -n '/Activity Resolver Table:/,$p' \
        | grep -A1 'android.intent.action.MAIN:' 2>/dev/null \
        | grep -oE "$1/[A-Za-z0-9_.]+" | head -1)"
    [ -z "$comp" ] && comp="$(printf '%s\n' "$dump" | grep -oE "$1/[A-Za-z0-9_.]+" | head -1)"
    printf '%s' "$comp"
}

resolve_label() {
    pkg="$1"; label="$2"
    if [ -n "$label" ]; then
        printf '%s' "$label"; return 0
    fi
    if [ -f "$ICON_DB" ]; then
        label="$(sqlite3 "$ICON_DB" "select label from icons where componentName like '${pkg}%' limit 1;" 2>/dev/null)"
    fi
    [ -n "$label" ] && { printf '%s' "$label"; return 0; }
    printf '%s' "${pkg##*.}"
}

db_owner() {
    stat -c '%u:%g' "$DB" 2>/dev/null
}

fix_owner() {
    owner="$1"
    [ -n "$owner" ] || return 0
    chown "$owner" "$DB" 2>/dev/null
    chmod 660 "$DB" 2>/dev/null
    for f in "${DB}-journal" "${DB}-wal" "${DB}-shm"; do
        [ -f "$f" ] && chown "$owner" "$f" 2>/dev/null
    done
}

restart_launcher() {
    am force-stop "$LAUNCHER_PKG" >/dev/null 2>&1
    sleep 1
    am start -n "${LAUNCHER_PKG}/.Launcher" >/dev/null 2>&1 || \
        input keyevent KEYCODE_HOME >/dev/null 2>&1
    sleep 2
}

is_free() {
    fx="$1"; fy="$2"
    echo "$OCCUPIED" | while read -r rx ry sx sy; do
        [ -z "$rx" ] && continue
        if [ "$fx" -ge "$rx" ] && [ "$fx" -lt $((rx + sx)) ] && \
           [ "$fy" -ge "$ry" ] && [ "$fy" -lt $((ry + sy)) ]; then
            echo busy
        fi
    done | grep -q busy && return 1
    return 0
}

find_free_cell() {
    y=0
    while [ "$y" -lt "$ROWS" ]; do
        x=0
        while [ "$x" -lt "$COLS" ]; do
            if is_free "$x" "$y"; then
                printf '%s,%s' "$x" "$y"
                return 0
            fi
            x=$((x + 1))
        done
        y=$((y + 1))
    done
    return 1
}

[ -f "$DB" ] || { log "launcher db not found: $DB"; exit 1; }
command -v sqlite3 >/dev/null 2>&1 || { log "sqlite3 not found"; exit 1; }

PAGE="$(sqlite_run 'select _id from workspaceScreens order by screenRank limit 1;')"
[ -n "$PAGE" ] || { log "cannot read workspaceScreens"; exit 1; }
log "launcher db: $DB, page: $PAGE"

add_missing_pass() {
    list="$1"
    : > "$list"

    printf '%s\n' "$TARGETS" | while IFS='|' read -r pkg label comp; do
        case "$pkg" in ''|\#*) continue ;; esac

        if ! pm list packages 2>/dev/null | grep -qx "package:${pkg}"; then
            log "skip not installed: ${pkg}"
            continue
        fi

        [ -z "$comp" ] && comp="$(resolve_component "$pkg")"
        if [ -z "$comp" ]; then
            log "cannot resolve launcher activity: ${pkg}"
            continue
        fi

        label="$(resolve_label "$pkg" "$label")"

        existing="$(sqlite_run "select count(*) from favorites where container=-100 and intent like '%component=${pkg}/%';")"
        if [ -n "$existing" ] && [ "$existing" != "0" ]; then
            log "already on home: ${label} (${comp})"
            continue
        fi

        printf '%s|%s|%s\n' "$pkg" "$label" "$comp" >> "$list"
    done

    [ -s "$list" ] || return 0

    OWNER="$(db_owner)"
    am force-stop "$LAUNCHER_PKG" >/dev/null 2>&1
    sleep 1

    OCCUPIED="$(sqlite_run "select cellX||' '||cellY||' '||spanX||' '||spanY from favorites where container=-100 and screen=${PAGE};")"

    while IFS='|' read -r pkg label comp; do
        [ -z "$pkg" ] && continue

        cell="$(find_free_cell)"
        if [ -z "$cell" ]; then
            log "no free cell for ${label}"
            continue
        fi
        cx="${cell%,*}"
        cy="${cell#*,}"

        intent="#Intent;action=android.intent.action.MAIN;category=android.intent.category.LAUNCHER;launchFlags=0x10200000;component=${comp};end"

        if sqlite_run "insert into favorites (_id,title,intent,container,screen,cellX,cellY,spanX,spanY,itemType,appWidgetId,isShortcut,iconType,iconPackage,iconResource,icon,uri,displayMode,appWidgetProvider,modified,restored,profileId,rank,options) values ((select ifnull(max(_id),0)+1 from favorites),'${label}','${intent}',-100,${PAGE},${cx},${cy},1,1,0,-1,null,null,null,null,null,null,null,null,0,0,0,0,0);"; then
            OCCUPIED="${OCCUPIED}
${cx} ${cy} 1 1"
            log "added ${label} -> ${comp} at (${cx},${cy})"
        else
            log "insert failed: ${label}"
        fi
    done < "$list"

    fix_owner "$OWNER"
    restart_launcher
    return 1
}

LIST1="${TMP_LIST}.1"
LIST2="${TMP_LIST}.2"

add_missing_pass "$LIST1"
log "pass 1 done"

sleep 2
add_missing_pass "$LIST2"
log "pass 2 done"

rm -f "$LIST1" "$LIST2"
log "done"
