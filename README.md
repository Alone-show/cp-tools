# cp-tools（从平定制工具集）

一个 DSH bundle，六个可独立开关的子插件：

| 子插件 | 入口 | 能力 |
|---|---|---|
| 产品资料 | `/cp-docs` | 按机型返回本地全部资料（参数 / 接口与线束表 / 图内文字 / 编程节点 / 工作点），由模型定位作答 |
| 固件查找 | `/firmware` | 量产固件与线刷/OTA 直链（alist 优先 + minio 备用）、机型族与写法归一；只做固件查找 |
| 工单与历史问题 | `/tickets` | 按现象查 TB 工单/任务号与子任务状态；历史 bug 是否修进客户正式版、跨机型/系统/芯片比对 |
| U 盘升级 | `/cpservice` | RK 安卓 / T3 安卓 / RK Debian / T3 Linux 升级包生成与真机验证 |
| 整机线刷 | `/flash` | 整机镜像覆盖烧写（RK / T3，安卓 / Debian / Buildroot），刷完只比版本号验收 |
| BPMS 订单需求 | `/bpms` | BPMS（CPSales）登录、按「分区/字段名」读写订单需求表、备份与回滚 |

六个子插件共用一次安装/升级，但在插件管理器里可以按 id 单独停用：
`cp-docs`、`firmware-finder`、`cp-tickets`、`e9631service`、`cp-flash`、`cp-bpms`。

另有一行 `cp-tools-web`（模块名就是包名 `@local/cp-tools`）：它不注册任何能力，只作为包根载体，
让 DSH 的 `client-modules` 能发现本包的 `./client`（浏览器端的 BPMS 配置页）。

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
/firmware apollo 12 pro debian --customer CP
/firmware models
```

默认只返回**量产版**（`DEV-` 构建需点名 `dev:true`）。只注册 2 个工具：
`firmware_find`、`firmware_models`。只做固件查找；工单/任务号/bug 修复判定走 `/tickets`。
TB 看板快照与登录凭据由 `/tickets` 维护（共用 `.tbfw`），firmware 只读。

### `/tickets`

```text
/tickets 单卡 设置里出现两个卡 上不去网
/tickets 问题 spring2pro 摄像头断层 --status open
/tickets 修复 摄像头热插拔断层 spring2pro
/tickets sync
/tickets login
```

注册 8 个工具：`ticket_search`、`ticket_sync`、`ticket_login`、`ticket_bug_check`、
`ticket_bug_models`、`ticket_bug_log`、`ticket_bug_matrix`、`ticket_bug_sync`。
与 `/firmware` 共用 TB 缓存（`.tbfw`）与 commit 索引（`.fixfinder`），是本 bundle 里唯一写 TB 索引的子插件。

### `/cpservice`

纯 skill：判定 RK 安卓 / T3 安卓 / RK Debian / T3 Linux（Buildroot），按平台读 reference 出包，
并在真机上验证。可复用二进制在 `src/cpservice/skills/cpservice/vendor/`；预置「中性」开机 logo/动画包在
`src/cpservice/skills/cpservice/assets/presets/rk-android-neutral/`（RK 安卓，**仅当需求明确要中性时**才用）。

### `/bpms`

BPMS（CPSales）登录与订单需求表编辑：登录、读记录、按字段改记录、备份与回滚。

只需要填**用户名 + 密码**；服务地址与租户名有内置默认值（`https://bpms.cpuniverse.cn` / `从平`），
页面不要求填写。配置按优先级找第一个存在的文件：

1. `BPMS_CONFIG` 环境变量指向的文件
2. `~/.dsh/cp-tools/bpms.json`（推荐，插件升级不丢）
3. 插件目录 `bpms_config.json`（本地填写方便，已 gitignore）

```json
{
  "base_url": "https://bpms.cpuniverse.cn",
  "username": "<BPMS 用户名>",
  "password": "<BPMS 密码>",
  "tenant_name": "从平",
  "timeout_seconds": 20
}
```

仓库里只有占位模板 `bpms_config.example.json`，**不要把真实口令提交进 git**；建议 `chmod 600`。

也可以直接在 **DSH Web → 插件 → 从平工具集 → 「BPMS 账号」** 里填（写 `~/.dsh/cp-tools/bpms.json`；
密码只写不回显，保存带 revision 防并发覆盖）。页面上有 **测试登录**，用当前填写值（含还没保存的）直接验一次能不能登进去，
不写 token、不改文件。

```text
/bpms 登录
/bpms 看下 CPS-SY2026DX0949 这张单
/bpms 把这张单的「品名」改成 SPRING2 10 特别版
/bpms 恢复某个备份
```

工具：`bpms_login` / `bpms_fields` / `bpms_get` / `bpms_update`（默认 dry-run，`apply:true` 才写库；
写前备份到 `~/.dsh/cp-tools/backups/`，写前校验 `updateTime`，写后只允许本次字段变化）。

## 固定流程脚本

```bash
npm test                 # 全部离线测试（docs + firmware + tickets + cpservice + flash + bpms + shared/contract）
npm run check            # 包清单校验：exports / patch / locale / icon / skill / vendor / files
npm run import:docs      # work/cpdoc/ai-readable → .cpdocs
npm run login            # Teambition 登录/刷新凭据
npm run sync -- --tb     # TB 看板 + 子任务（/tickets 口径）
npm run sync -- --fix    # alist commit 索引
npm run sync -- --all    # 资料 + TB + commit 索引
npm run resolve -- SPRING2PRO --catalog docs
node scripts/live-smoke.mjs   # 在线冒烟；无凭据/断网时 SKIP
```

## 数据目录与环境变量

| 子插件 | 默认目录 | 环境变量 |
|---|---|---|
| docs | `.cpdocs` | `DSH_CPDOCS_DIR` |
| firmware / tickets | `.tbfw` / `.fixfinder` | `DSH_TBFW_DIR` / `DSH_FIRMWARE_DIR` / `DSH_FIXFINDER_DIR` |

`DSH_FIRMWARE_NO_PROBE=1` 关闭 TB 实时探测；`DSH_ALIST_DISABLE=1` 关闭 alist；
`DSH_ALIST_TTL_MS` 控制 alist 目录缓存。

## 结构

```text
src/shared/       机型归一原语、SKILL frontmatter、数据目录解析
src/tb/           TB 共享层：凭据、看板/子任务同步、实时检索、机型归一
src/docs/         /cp-docs 子插件 + 运行期数据
src/firmware/     /firmware 子插件（只做固件查找）+ skill
src/tickets/      /tickets 子插件（工单 + 历史 bug）+ skill
src/cpservice/    /cpservice 子插件 + skill + references/assets/vendor
src/flash/        /flash 子插件 + 线刷 skill（SOP + flash.sh + tools）
src/bpms/         /bpms 子插件 + BPMS 登录/编辑工具 + skill
scripts/          固定流程脚本
test/             docs / firmware / tickets / cpservice / flash / bpms / shared / contract
docs/             合并审查与各子插件的详细说明（不随包发布）
```

合并审查（重复项、依赖、保留决策）见仓库内 [`docs/merge-review.md`](https://github.com/Alone-show/cp-tools/blob/main/docs/merge-review.md)（`docs/` 不随包发布，所以这里用仓库链接）。
