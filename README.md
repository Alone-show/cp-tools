# cp-tools（从平定制工具集）

一个 DSH bundle，四个可独立开关的子插件：

| 子插件 | 入口 | 能力 |
|---|---|---|
| 产品资料 | `/cp-docs` | 按机型返回本地全部资料（参数 / 接口与线束表 / 图内文字 / 编程节点 / 工作点），由模型定位作答 |
| 固件与问题 | `/firmware` | 量产固件与线刷/OTA 直链（alist 优先 + minio 备用）、TB 版本任务/子任务状态、bug 是否修进客户正式版 |
| U 盘升级 | `/cpservice` | RK 安卓 / T3 安卓 / RK Debian / T3 Linux 升级包生成与真机验证 |
| 整机线刷 | `/flash` | 整机镜像覆盖烧写（RK / T3，安卓 / Debian / Buildroot），刷完只比版本号验收 |

四个子插件共用一次安装/升级，但在插件管理器里可以按 id 单独停用：
`cp-docs`、`firmware-finder`、`e9631service`、`cp-flash`。

## 安装

本地开发用 link：

```bash
plugin_manager install_bundle target=/home/my/Documents/deepseek-harness/default-workspace/plugins/cp-tools
```

或在对话里说“安装 `@local/cp-tools`”。安装后 `~/.dsh/profiles/web/package.json` 的
`dsh.profile.bundles` 只应保留 `@local/cp-tools` 这一项。

> 从三个旧包迁移：先移除 `@local/cp-docs`、`@local/firmware-finder`、`@local/e9631service`，
> 再安装本包。命令、工具、skill 名称与数据目录均保持不变。

## 子插件

### `/cp-docs`

```text
/cp-docs SPRING2PRO 的屏幕尺寸
/cp-docs SPRING2PRO 的 RS232 引脚在第几脚
/cp-docs 支持哪些机型
```

只注册命令，不注册模型工具；命中机型后把该机型全部资料作为折叠上下文卡片推给会话。
运行期数据在 `.cpdocs`（首次从包内 `src/docs/data` 复制）。

### `/firmware`

```text
/firmware spring2pro 安卓
/firmware 问题 spring2pro 摄像头断层 --status open
/firmware 修复 摄像头热插拔断层 spring2pro
/firmware models
/firmware sync
```

默认只返回**量产版**（`DEV-` 构建需点名 `dev:true`）。注册 10 个工具：`firmware_find`、`firmware_models`、`firmware_sync`、`firmware_login`、
`firmware_issues`、`firmware_fix_check`、`firmware_fix_models`、`firmware_fix_log`、
`firmware_fix_matrix`、`firmware_fix_sync`。数据在 `.tbfw` 与 `.fixfinder`。

### `/cpservice`

纯 skill：判定 RK 安卓 / T3 安卓 / RK Debian / T3 Linux（Buildroot），按平台读 reference 出包，
并在真机上验证。可复用二进制在 `src/cpservice/skills/cpservice/vendor/`；预置「中性」开机 logo/动画包在
`src/cpservice/skills/cpservice/assets/presets/rk-android-neutral/`（RK 安卓，**仅当需求明确要中性时**才用）。

## 固定流程脚本

```bash
npm test                 # 全部离线测试（docs + firmware + cpservice + flash + shared/contract）
npm run check            # 包清单校验：exports / patch / locale / icon / skill / vendor / files
npm run import:docs      # work/cpdoc/ai-readable → .cpdocs
npm run login            # Teambition 登录/刷新凭据
npm run sync -- --tb     # TB 看板 + 子任务
npm run sync -- --fix    # alist commit 索引
npm run sync -- --all    # 资料 + TB + commit 索引
npm run resolve -- SPRING2PRO --catalog docs
node scripts/live-smoke.mjs   # 在线冒烟；无凭据/断网时 SKIP
```

## 数据目录与环境变量

| 子插件 | 默认目录 | 环境变量 |
|---|---|---|
| docs | `.cpdocs` | `DSH_CPDOCS_DIR` |
| firmware / fix | `.tbfw` / `.fixfinder` | `DSH_TBFW_DIR` / `DSH_FIRMWARE_DIR` / `DSH_FIXFINDER_DIR` |

`DSH_FIRMWARE_NO_PROBE=1` 关闭 TB 实时探测；`DSH_ALIST_DISABLE=1` 关闭 alist；
`DSH_ALIST_TTL_MS` 控制 alist 目录缓存。

## 结构

```text
src/shared/       机型归一原语、SKILL frontmatter、数据目录解析
src/docs/         /cp-docs 子插件 + 运行期数据
src/firmware/     /firmware 子插件 + 工具 + skill
src/cpservice/    /cpservice 子插件 + skill + references/assets/vendor
src/flash/        /flash 子插件 + 线刷 skill（SOP + flash.sh + tools）
scripts/          固定流程脚本
test/             docs / firmware / cpservice / flash / shared / contract
docs/             合并审查与各子插件的详细说明（不随包发布）
```

合并审查（重复项、依赖、保留决策）见 [`docs/merge-review.md`](docs/merge-review.md)。
