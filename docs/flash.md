# 整机线刷（skill `flash`，调用命令 `/flash`）

> 2026-11-09 从 `/cpservice`（U 盘升级包）拆出来的独立子插件：整机 `.img` 覆盖烧写会清 userdata，
> 与「装应用 / 换 logo / 换动画」是两条完全不同的流程，混在一个 skill 里既费上下文也容易选错入口。
>
> 2026-11-12：skill 设为**用户专属**（`disable-model-invocation: true`），只进 `/` 菜单、不进模型目录；
> 必须由用户输入 `/flash` 显式触发。自然语言「刷机」不会被模型自动加载，避免误触清数据。

## 结构

| 文件 | 角色 |
|---|---|
| `src/flash/index.js` | Cordis 子插件 `cp-flash`：只往 `ctx.skills` 注册 skill `flash` |
| `src/flash/skills/flash/SKILL.md` | **SOP**：何时用 → 刷前 5 项核对 → S1–S6 步骤 → 验收口径 → 回线/OTG → 失败速查 → 省时跑法 → 附参数表 |
| `src/flash/skills/flash/references/flash.md` | 事实页：工具与版本、设备模式与 USB、镜像判定、`flash.sh` 全参数、失败模式、沙箱 |
| `src/flash/skills/flash/assets/flash.sh` | 线刷脚本：`doctor` / `plan` / `flash` / `verify` |
| `src/flash/skills/flash/assets/tools/` | `rk_upgrade_tool` v2.22、`openixcli` 0.2.4、`VERSIONS.md`、license |

## 验收口径（本次明确变更）

- **只比版本号**：RK Debian `/etc/system_info/system_info.ini` 的 `Version=`；安卓 `ro.build.cp.version`；T3 Linux `/Configs/system_info/system_info.ini`。
- **刷机前不等确认**：核对由模型自己做（序列号/机型/客户/芯片 + 目标版本），下发前只用一行说明「版本 + 会清数据」。
- **默认只刷量产版**（不带 `DEV-` 标识）：`firmware_find` 默认已过滤 DEV，只有用户点名 DEV 才用 `dev:true` 的结果。
- `boot_id`（真重启）、systemd/Launcher 状态一律 `INFO`：只记录，不阻塞。
- **不截图、不验 UI / LOGO / 桌面**，也不跑客户业务功能；需要额外断言才加 `--check`/`--pkg`/`--unit`/`--proc`。

## 本次顺带修掉的缺陷

1. **URL 直刷静默失败**：`download_firmware` 里的 `say` 写 stdout，被 `FW=$(download_firmware …)` 捕获成「提示行 + 路径」两行；`set -Eeuo pipefail` 下 `sha256sum` 失败 → 脚本静默 `exit 1`（表现为「下载完就退」）。修法：过程消息改 `say_err`（stderr），stdout 只留路径；`resolve_firmware` 加 `[ -f "$FW" ]` 防御。
2. **进度噪音**：`curl` 加 `-sS`，下载只打「下载中 / 下载完成 + 体积」；`flash_device` 在 `--quiet` 下过滤 `Download Image...` 与百分比行，日志仍全量。
3. **新增 `--dry-run`**：解析（含下载）/判平台/比芯片与版本后停下，不进下载模式——预检与回归测试不用再赌运气。
4. **新增 `--quiet`**：终端只留里程碑，日志不动。
5. **文档坑**：RK Debian 版本只读 `system_info.ini`；不要为 UI 抓屏（`x11grab` 会挂）；线刷任务只需读本 skill，不必加载 `/cpservice` 全文。

## 回归验证

- `node test/flash/smoke.mjs`：契约 / 资产 / 工具版本 / 文档口径 / 行数预算；
  含**端到端 URL 回归**——本地 `python3 -m http.server` 提供 4 KB 假 img，`flash.sh flash <url> --dry-run` 必须退出 0、无 `sha256sum:` 报错、输出 ≤15 行；再跑一次覆盖「复用已下载镜像」分支。
- `node scripts/check-package.mjs`：4 行 bundle patch、flash 的 locale/icon/skill/资产、cpservice 下不再有 `flash.sh`。
- `node scripts/verify.mjs --fast`：契约 + docs + cpservice + flash。

## 生效方式

新子插件要重装一次 bundle 才会出现在 skill 目录：

```bash
plugin_manager install_bundle target=/home/my/Documents/deepseek-harness/default-workspace/plugins/cp-tools
```

重装会改 profile（影响所有会话），所以只提示、不自动执行。
