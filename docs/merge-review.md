# 合并审查：cp-docs / e9631service / firmware-finder → @local/cp-tools

> 审查时间：2026-11-09
> 审查对象：`@local/cp-docs` 0.2.4、`@local/e9631service` 0.7.1、`@local/firmware-finder` 0.5.1（含未提交的 0.5.x 改动）
> 结论：合并为一个 bundle `@local/cp-tools`，导出三个子插件；公共入口与数据目录不变。

## 1. 合并前基线

| 插件 | 入口 | 注册内容 | 数据 |
|---|---|---|---|
| cp-docs | `/cp-docs` | 1 个命令 | `.cpdocs`（包内 `data/` 首次复制） |
| firmware-finder | `/firmware` | 1 个 skill + 10 个工具 | `.tbfw`（TB 索引/凭据）+ `.fixfinder`（commit 索引） |
| e9631service | `/cpservice` | 1 个 skill | 无运行期数据；skill 资产 + `vendor/` 二进制 |

合并前离线测试：cp-docs 23 项、firmware 78 项、cpservice smoke 全绿。

## 2. 重复项与处理

| # | 重复内容 | 证据 | 处理 |
|---|---|---|---|
| D1 | 机型归一核心（`nz`/`splitVendor`/`canonCore`/`queryCores`/`gapScore`/`scoreCore`/`equivCore`） | firmware `index.js`、`lib/fix/models.js`、cp-docs `lib/models.js`；`nz` 还在 `tb-live.js`、`fix/parse.js` | 抽到 `src/shared/model-core.js`；**保留三个域各自的 `resolveModel`** |
| D2 | SKILL.md frontmatter 解析 + 注册 | firmware 与 e9631 各一份 `readBundledSkill` | 抽到 `src/shared/skill.js` |
| D3 | 数据目录解析（env → 工作区 → 默认 → cwd） | cp-docs `store.js`、firmware `candidateDirs/tokenDir`、fix `store.js` | 抽到 `src/shared/data-dir.js`，env 名与默认子目录不变 |
| D4 | 两个 alist 客户端 | `alist.js`（TTL 缓存、失败返回 null）vs `lib/fix/alist.js`（抛错 + 重试、rawUrl/readText） | **不合并**：错误语义/缓存/返回结构不同，合并风险大于收益 |
| D5 | `LINK_FIELDS`/`asList`/`UA`/`PROJECT_ID` | firmware `index.js`、`issues.js`、`tb-live.js` | 抽到 `src/firmware/lib/constants.js` |
| D6 | 包元数据样板（package/patch/locale/icon/index.json/README） | cp-docs、firmware 各一套 | 合并为一份包清单；三个子路径各自 locale/icon |
| D7 | 测试入口不统一 | firmware 根 `*.test.mjs` + `test/*.test.mjs`；cp-docs `test/`；e9631 `smoke.mjs` | 统一到 `test/{docs,firmware,cpservice,shared,contract}`，由 `scripts/verify.mjs` 串起 |
| D8 | cp-docs 运行期 `data/models/*/doc.md` 与 `materials/specs/*.md` 重复 | 28 个文件、约 456K；运行期只读 spec/programming/workpoints | 运行期去掉 `doc.md`；`materials/` 只留仓库 `docs/materials/`，不进包 |
| D9 | e9631 根 `vendor/` 28M 未列入 `files` | `package.json.files` 缺 `vendor/*`，SKILL 却引用插件根 `vendor/` | 移到 `src/cpservice/skills/cpservice/vendor/`，随 `src/**` 发布 |
| D10 | 编辑残留 / 运行期污染 | e9631 4 个 `*.bak-*`；firmware 插件目录内 36M `.tbfw/browser-profile` | 合并副本不复制；`check-package` 拦截 |
| D11 | 固定流程靠手打 | 资料导入、TB 登录、TB/fix 同步、验证 | 脚本化（见第 6 节） |

### 为什么保留三个 `resolveModel`

- TB 看板：按族/别名/变体分组，支持 `APOLLO2-MIX`、`SP2-10MIX`、7/7A、12/12A。
- alist 产品线：按 `platform + product` 隔离，同名机型跨芯片绝不合并。
- 文档机型：按 `cores` 数组 + 厂商权重 + 更严的歧义阈值（`APOLLO X` 不被 `APOLLO 12X` 拖成歧义）。

三者的分组与阈值语义不同，只共享打分原语；现有 101 项测试原样保留，新增共享原语 golden 测试。

## 3. 相互依赖与处理

| 依赖 | 类型 | 处理 |
|---|---|---|
| cp-docs 的机型规则来自 firmware | 代码复制（隐式） | 改为同包 `shared/model-core.js` 硬依赖 |
| cpservice 用 `/firmware` 查 OSS 线刷直链 | 运行时软依赖 | 保留 `firmware_find` 工具名；SKILL 文案说明“可用则用，否则本地 `.img`”；firmware 子插件 disable 时仍可出包 |
| firmware 依赖 `.tbfw/token.json` | 运行时数据 | 共享 data-dir；保留 `DSH_TBFW_DIR`/`DSH_FIRMWARE_DIR` |
| 三者依赖工作区数据目录 | 运行时数据 | `.cpdocs`/`.tbfw`/`.fixfinder` 原名保留，不迁移 |
| 三个旧包各自的 GitHub 仓库/index.json | 发布 | 合并为一个仓库/索引；旧仓库归档说明（push 时才做） |
| 三行插件共用 profile 安装单元 | 安装 | 一个 patch 插三行；可单独 disable，不能单独卸载 |

## 4. 目标结构

```text
plugins/cp-tools/
├── package.json / cordis.patch.yml / index.json / README.md
├── icons/{docs,firmware,cpservice,cp-tools}.svg
├── locale/{docs,firmware,cpservice}/{zh,en}.json
├── src/
│   ├── shared/{model-core.js,skill.js,data-dir.js}
│   ├── docs/{index.js,lib/*,data/**}
│   ├── firmware/{index.js,alist.js,login.js,keywords.json,lib/**,skills/firmware/SKILL.md}
│   └── cpservice/{index.js,skills/cpservice/{SKILL.md,references/*,assets/*,vendor/*}}
├── scripts/{verify,check-package,resolve-model,import-docs,tb-login,sync,live-smoke}.mjs
├── test/{docs,firmware,cpservice,shared,contract,helpers}
└── docs/{merge-review.md,materials/**}
```

三个插件行（id 保持旧值，便于旧会话/配置连续）：

```yaml
- insert:
    - id: cp-docs
      name: '@local/cp-tools/docs'
    - id: firmware-finder
      name: '@local/cp-tools/firmware'
    - id: e9631service
      name: '@local/cp-tools/cpservice'
```

## 5. 公共契约（不变）

- 命令：`/cp-docs`。
- 工具：`firmware_find`、`firmware_models`、`firmware_sync`、`firmware_login`、`firmware_issues`、`firmware_fix_check`、`firmware_fix_models`、`firmware_fix_log`、`firmware_fix_matrix`、`firmware_fix_sync`。
- skill：`firmware`、`cpservice`。
- 数据目录与环境变量：`.cpdocs`、`.tbfw`、`.fixfinder`、`DSH_CPDOCS_DIR`、`DSH_TBFW_DIR`、`DSH_FIRMWARE_DIR`、`DSH_FIXFINDER_DIR`、`DSH_FIRMWARE_NO_PROBE`、`DSH_ALIST_*`。
- 输出报文与 `source.kind = cp-docs` 折叠卡片。

变化仅在安装单元与行名：三个包 → 一个 `@local/cp-tools`；`vendor/` 从插件根移到 cpservice skill 目录。

## 6. 固定流程脚本

| 脚本 | 作用 |
|---|---|
| `npm test` / `scripts/verify.mjs` | 全部离线测试 + 契约检查 |
| `scripts/check-package.mjs` | exports→文件、patch 三行、locale/icon、skill、vendor、files、禁止产物 |
| `scripts/resolve-model.mjs` | docs/TB/alist 三套目录的机型归一排查 |
| `scripts/import-docs.mjs` | `work/cpdoc/ai-readable → .cpdocs` |
| `scripts/tb-login.mjs` | TB 登录/刷新（替代 `tools/login.sh` + `capture_token.mjs`） |
| `scripts/sync.mjs` | `--docs` / `--tb` / `--fix` / `--all` |
| `scripts/live-smoke.mjs` | token 状态 + alist 可达性；无凭据/断网 SKIP |

## 7. 验证记录（2026-11-09）

- `npm test`：shared/contract 18、docs 23、cpservice smoke、firmware gate/model/alist、firmware suite 80 项，全绿。
- `npm run check`：通过；docs 28 款机型；预计安装体积 33.7 MiB。
- `npm pack --dry-run`：157 个文件，22.5 MB tar / 35.4 MB 解包；含 vendor APK、两个 SKILL、docs 数据；不含 `test/`、`docs/`、`.tbfw`。
- 安装：移除三个旧 bundle 后安装 `@local/cp-tools`，返回 `application: applied`，无 warning。
- 三行状态：`include:cp-docs`、`include:firmware-finder`、`include:e9631service` 均 `enabled: true`、`fiberPhase: active`。
- 工具：`cordis_inspect_query` 可见 10 个 `firmware_*` 工具。
- skill：会话目录出现 `firmware`、`cpservice`。
- 独立性：disable `cp-docs` 后 firmware/cpservice 仍 active；随后已恢复。
- 数据兼容：现有 `.cpdocs`（28 机型）、`.tbfw`（看板/子任务/过期 token）、`.fixfinder`（commit 索引）直接可读。

## 8. 回滚

1. `plugin_manager remove_bundle @local/cp-tools`。
2. 按原方式重装：
   - `@local/cp-docs`：`github:Alone-show/cp-docs`
   - `@local/firmware-finder`：`link:/home/my/Documents/deepseek-harness/default-workspace/plugins/firmware-finder`
   - `@local/e9631service`：`link:/home/my/mydata/plugins/E9631Service`
3. 如 profile 清单异常，恢复 `~/.dsh/profiles/web/package.json.bak-cptools-20261109154433` 与同批 `cordis.patch.yml` / `pnpm-lock.yaml` 备份。
4. 数据目录未改动，无需迁移。

## 9. 后续可选

- 统一两个 alist 客户端的 HTTP 传输层（保留各自错误语义），需要单独回归。
- 增加 `scripts/export-materials.mjs`，从运行期数据再生成 `docs/materials/`。
- push 到 `Alone-show/cp-tools`，并在三个旧仓库 README 加归档说明。
