# cp-tools 审核报告：Anthropic Skill 规范 + 全仓代码 / 安全

> 审核对象：`@local/cp-tools` 1.0.0（`8eeeb5c`，`main`，工作区有本次修复未提交）
> 审核时间：2026-11-11
> 审核标准：`anthropics/skills` 的 `skill-creator`（编写指南 + `scripts/quick_validate.py`）、Agent Skills 规范（`agentskills.io/specification`）、以及 DSH 自己的 `@deepseek-ai/dsh-skill-filesystem` loader 契约，三者取严。
> 结论口径：每条都在源码/实跑里核过，附 `文件:行`；子代理只做初筛，未复核的条目没有写进来。

---

## 0. 一页结论

| 项 | 结果 |
|---|---|
| 三个 skill 的机器校验（官方 `quick_validate.py`） | **全部通过**（firmware / flash / cpservice） |
| 三个 skill 的规范形状 | frontmatter 合法、name 合规、description 未超限；`cpservice` 1008/1024 字符，只剩 16 字符余量 |
| 全仓发现 | **P1 10 条**（2 条已修）、**P2 22 条**（7 条已修）、**P3 10 条** |
| 最该先处理的一件事 | `firmware_fix_check` 在「客户线内提交被 revert」时会给出自相矛盾的结论（§4.2），这是会误导排版本的那类错误 |
| 结构性优点 | 零 npm 依赖、`shellcheck -S warning` 干净、凭据 0600/0700、子进程全部数组参数、有契约测试与离线测试（9 个套件全绿） |

本次直接改掉的机械性问题（13 处，见 §7）：skill 解析器改 fail-fast、`check-package` 补齐规范校验、脚本权限统一、两份超长 reference 补目录、断链与重复条目清理、`firmware_login(cookie=)` 漏 `await`、`flash.sh verify` 期望版本误取字面量、`models.json` / 文档里的本机绝对路径。

---

## 1. 范围与方法

- **Skill 层**：三个 `SKILL.md` 的 frontmatter、description 触发质量、渐进披露预算、references/assets 引用可达性、脚本可执行位、正文与 reference 的分工、重复与单一真源、破坏性动作是否有声明。
- **DSH 契约层**：`src/shared/skill.js` 的 frontmatter 解析是否与 DSH loader 同义；`package.json` 的 `exports`/`files` 与 `cordis.patch.yml` 四个 id 是否一致；发布包里有什么。
- **代码层**：`src/**`（约 9k 行）+ 17 个 shell 资产，按模块做静态审查，重点外部输入、网络、凭据、子进程、文件系统、设备端 root shell。
- **取证方式**：读代码 + 跑离线测试 + 跑官方 validator + 用真实索引/真实数据复现（`~/.tbfw`、`.fixfinder`、`docs/materials`）。
- **未覆盖**：真机行为（未接设备）、TB/alist 在线链路（本会话无凭据）、实际刷机；报告中相关结论都标了「静态」或「未验证」。

---

## 2. Skill 规范符合性（逐项）

| 维度（规范要求） | firmware | flash | cpservice |
|---|---|---|---|
| frontmatter 是合法 YAML dict | ✅ | ✅ | ✅ |
| 只含允许键 | ✅ 2 键 | ✅ 2 键 | ✅ 2 键 |
| name kebab-case、≤64 | ✅ | ✅ | ✅ |
| description 单行、≤1024、无 `<>` | ✅ 166 | ✅ 468 | ⚠️ 1008（余量 16） |
| SKILL.md ≤500 行（正文常驻上下文） | ✅ 82 行 / 6.7 KB | ✅ 143 行 / 12 KB | ⚠️ 401 行 / 40 KB |
| 引用的 `references/assets/scripts` 都存在 | ✅（无引用） | ✅ 2/2 | ✅ 24/24 |
| >300 行的 reference 有目录 | — | — | ✅ 本次给 rk-debian(392)、rk-android(314) 补了 §目录 |
| 脚本有可执行位（「一条命令跑」） | — | ✅ | ✅ 本次统一 755（原 3 个 600、3 个 711） |
| description 说清「何时用 + 与谁互斥」 | ✅ 三条能力线 | ✅ §0 用/不用表 | ⚠️ 前半好，后半是 200+ 个关键词堆 |
| 正文 vs reference 分工 | ✅ | ✅ | ⚠️ §5.2 平台对照表、§7.4 核验表属于「按平台才需要」的内容，可下沉 |
| 破坏性动作有言明（不制造惊喜） | ✅ 明确「TB 状态 ≠ 代码已修」 | ✅ 开头就写「会清 userdata」 | ✅ §5/§10 写清 root、写分区、重启 |

**判断**：三个 skill 都过得了官方校验，形状是健康的。真正的问题不在「格式」，而在两个地方：`cpservice` 的 description/正文体积已经贴着规范上限（再加一句就会越界，而越界不会报错，只会让 skill 静默不触发）；以及 skill 的**运行期契约**是 cp-tools 自己手写的解析器，它比 DSH 的 YAML 解析更弱（§4.1、§7.1）。

### 2.1 `cpservice` 的 description（1008/1024）

现有写法是「一句能力描述 + 一长串中英文关键词」。规范化建议：把「何时用 + 边界」写到 300 字符内，关键词只保留会被用户真实说出口的 20–30 个（`U盘升级`、`静默安装`、`bootlogo`、`E9631Service`、`Launcher`…）。理由：DSH 的 skill 触发是模型读 description 判断，不是关键词倒排；1000 字符的堆砌挤占目录预算，也让「什么时候该走 `/flash` 而不是 `/cpservice`」这条边界被淹掉。**这属于语义改动，本次没有动，列在 §8 待你决定。**

### 2.2 `cpservice` 的正文体积（401 行 / 40 KB）

规范给的是「<500 行，接近上限就加一层层级 + 指针」。它现在不是超限，而是**同一份 40 KB 每次触发都要整份进上下文**，其中 §7.4 核验表、§8 需求→写法、§5.2 平台差异是典型的「按平台取用」内容，`references/` 里已有对应事实页。建议把这三节压成指针（各留 3–5 行索引），可省 30% 左右。同样列为待定。

---

## 3. 发现总览

| 级别 | 定义 | 数量 | 已修 |
|---|---|---|---|
| P1 | 会给出错误结论、丢数据、或在常见条件下直接失效 | 10 | 2 |
| P2 | 健壮性 / 契约缺口 / 有条件的安全面 | 22 | 7 |
| P3 | 可维护性、风格、防御未落地 | 10 | 0 |

严重度不是按「代码丑不丑」排的：P1 的判据是**会不会让用户拿到错的答案，或者设备上丢东西**。

---

## 4. P1：会给出错误结论或丢数据

### 4.1 `firmware_login(cookie=…)` 漏 `await`，永远返回 `{}`（已修）

`src/firmware/index.js:2199`

```js
if (options.cookie) return jsonSafe(loginWithCookie(dir, options.cookie));  // loginWithCookie 是 async
```

`jsonSafe` 对 Promise 做 `Object.entries()` 得到 `[]`，所以工具返回值恒为 `{}`：**token 已经写进磁盘（副作用发生了），但结果里没有 status/tokenPath，render 走 else 分支输出「需要你手动完成登录（undefined）」**。headless / 无显示环境下这是唯一的凭据注入路径，用户会以为没成功而反复粘贴。

已改为 `jsonSafe(await loginWithCookie(...))`。

### 4.2 `fix_check`：客户线内被 revert 的提交，会报成「只出现在其它产品线」

`src/firmware/lib/fix/search.js:347-371`（配合 `parse.js:60` 的 `revert` 标记）

`inCustomerHit` 已排除「被 revert 的原提交」，但**没有排除 revert 提交本身**；`verdict` 的 else 分支又用 `top.placement.lines` 拼「其它产品线」，没有减掉客户自己的线。实跑（真实索引 `.fixfinder`，4145 条提交）：

```
bug="debug ops 打不开" model=APOLLO2-MIX os=ANDROID customer=CP
verdict = fixed_other_line_only
notes   = 该修复只出现在其它产品线：RK/ANDROID/APOLLO2-MIX(YL)、…、RK/ANDROID/APOLLO2-MIX(CP)、…
          客户线（CP）未合入。
candidates = 8bf42a06:567, 86826c3d:447(REVERT), 3a255aea:431
```

`8bf42a06` 就在 `APOLLO2-MIX(CP)` 线上，且已被 `86826c3d` revert（`commits.json` 里 `86826c3d` 的 subject 是 `Revert "feat(common): DO-1234 debug ops"`）。正确结论应是「客户线已合入、又被 86826c3d 回退」，现在却说「未合入」，且「其它产品线」列表里出现了客户自己的线。

影响：研发会按「没进客户线」去重新走合入流程；而实际是「进了又被撤」。建议：候选层排除 `commit.revert`（或重罚），`verdict` 增加 `reverted_in_customer`，`others` 减掉 `customerLineIds`。**未改**（涉及结论语义，等你确认口径）。

### 4.3 长 hash 无法命中 hash 通道（8 位精确比较）

`search.js:64`（接受 8–40 位）/ `search.js:132`（`query.hashes.includes(commit.hash)`）/ `parse.js:50`（索引只存 8 位）/ `store.js:75`（`hashFull` 落盘时被裁掉）/ `matrix.js:20`（依赖 `hashFull` 的分支成为死代码）

实跑：

```
bug="8bf42a06"                                 → 8bf42a06:1114（命中，1000 分通道）
bug="8bf42a0612ab34cd56ef78901234567890123456" → 90417d77:406, def014a4:291（hash 通道未命中，纯噪声）
```

用户从 git / TB 复制全长 hash 是最自然的动作，结果 hash 通道完全失效、只剩标题相似度，叠加宽松闸门就会给出一个自信但无关的 `fixed_released`（配上 `model` 时）。建议：抽取后统一取前 8 位（或前缀匹配），并让 `store` 保留 `hashFull`。**未改。**

### 4.4 `flash.sh` 复用镜像只比体积，内容校验默认关闭

`src/flash/skills/flash/assets/flash.sh:464-475`（`precheck_local`）、`505-514`（`download_firmware` 复用）、`492-496`（未知镜像头只 warn）、`628-632`（`sha256` 仅在显式 `--sha256` 时比对）

```sh
[ "$(stat -c %s "$f")" = "$size" ] || continue   # 唯一判据：字节数相同
...
if [ -n "$SHA256_EXPECT" ] && [ "$FW_SHA" != "${SHA256_EXPECT,,}" ]; then die 3 ...
```

`~/Downloads` 里同名的旧镜像、别的机型恰好同长度的文件、下载中断后长度碰巧一致的文件，都会被判成「复用」并直接交给 `rk_upgrade_tool UF` / `openixcli flash`。这是**破坏性写盘且不可回滚**的路径。建议：下载写 `.part` 再 `mv`；完成后必须校验（`--sha256` > 随包 `sha256sum.txt`/ETag）；缓存复用前校验 sidecar hash；未知镜像头从 `warn` 改 `die`。**未改**（会改变现场可用性，需你确认是否有可靠校验源）。

### 4.5 `flash.sh verify` 不带 `--expect-version` 必然判失败（已修）

`flash.sh:1261-1264` 传 `setup_paths "verify"` → `STEM="verify"` → `run_assertions` 里 `exp=${EXPECT_VERSION:-$(version_from_name "verify")}` = 字面量 `verify` → 设备版本不含 `verify` → FAIL。

而 SKILL 第 5 步明确让人跑 `adb ... ; flash.sh verify --serial <S>`（不带 expect）。已加一行 `STEM=""`，让它落到「没有期望版本可比对 → WARN」。`bash -n` 通过。

### 4.6 `update-mdm-wifi.sh`：校验失败仍然删备份并照常 `reboot`

`src/cpservice/skills/cpservice/assets/update-mdm-wifi.sh:58-72`

```sh
[ -f "$src" ] || { log "skip missing fw: $f"; continue; }
cp -f "$src" "$dst" || { log "copy failed: $f"; continue; }
...
if [ "$s" = "$d" ]; then ... else log "fw md5 MISMATCH: ..." fi
...
rm -f /system/media/fw_cyw43438.bin /system/media/nvram_cyw43438.txt   # 无条件
```

全脚本没有 `set -e`，md5 不符只是日志；删的却是 `/system/media` 下**唯一可回退的原厂 WiFi 固件**，然后照常重启。设备可能带着半截固件起来，而备份已没了。建议：失败即 `exit 1` 并保留现场；`rm` 只在全部校验通过后执行（或先备份到 `/data`）。**未改**（改变设备端失败语义，需你确认）。

### 4.7 `rk-virtual-disk.sh`：`sm list-disks` 取第一块盘就 `partition … public`

`rk-virtual-disk.sh:34-45`

```sh
ID="$(vol_id)"; [ -n "$ID" ] && exit 0                    # 已挂载的公共卷：直接返回（这一步挡住了常见情况）
...
DISK="$(sh_ 'sm list-disks' | tr -d '\r' | head -1)"      # 不区分虚拟盘/真盘
[ -n "$DISK" ] || ...
sh_ "sm partition $DISK public" >/dev/null 2>&1 || true   # 会格式化，且吞掉失败
```

已挂载的真卡会被上面的早退挡住；但**插着但未挂载 / 私有卷 / 刚插入还没 mount 的卡**会立刻被 `list-disks` 返回，脚本直接把它 `partition public` 格式化。注释里其实已知虚拟盘是 `disk:7,0`。建议：`set-virtual-disk true` 前记录快照、之后取差集；或按 `disk:7,[0-9]+` 白名单；`partition` 前打印目标并去掉 `|| true`。**未改**（字段机型差异需实机确认）。

### 4.8 `import-docs` 二次导入不幂等（实测翻倍）

`src/docs/lib/import.js:172-175`、`192-196`：`prev.pages.push(...)` / `prev.entries.push(...)`，而 `importData` 全程不清理 `OUT`。

实测（`--out /tmp`，连跑两次）：

```
programming pages: 56   重复: 28
workpoint entries: 28   重复: 14
```

`README` 和 `npm run sync -- --all` 都引导用户「重建资料」，重建一次编程页就在 `/cp-docs` 里渲染两遍。当前仓库里的 `src/docs/data` 是单次生成，所以没暴露。建议：写前清 `OUT/models`（或临时目录 + 原子替换），最小改法是 push 前按 `slug`/`cpCode` 去重。**未改**（会改变导入的「累积」行为，虽符合直觉但需你确认）。

### 4.9 触发脚本对 env/argv 路径 `rm -rf`，唯一保护是「是不是挂载点」

`t3linux-trigger.sh:43-46`（`stage` 的 `dir="${2:-$USB}"`，`T3L_USB` 可覆盖）、`167-170`（`cleanup`）；`debian-trigger.sh:27-38`

```sh
if is_mount "$dir"; then die "是真实挂载点"; fi
sh_ "rm -rf '$dir'; mkdir -p '$dir'"
```

`T3L_USB=/data`、或 `stage <pkg> /Configs` 这类非挂载目录不会被 `is_mount` 拦住，直接在设备 root 上 `rm -rf`；`debian-trigger.sh` 的 `is_mount` 依赖设备上存在 `mountpoint` 命令且输出英文串，命令缺失时恒 false（fail-open）。建议：目标路径白名单（`/mnt/usb/sda1|/media/usb_disk|/mnt/installUsb`）或只用常量，判定改 `grep -F " $dir " /proc/mounts`，判定命令缺失时 fail-closed。**未改。**

### 4.10 `verify.sh` 把包名/日志路径/分辨率直接拼进设备 root shell

`assets/verify.sh:39,118,187,230`、`debian-trigger.sh:101`、`t3linux-trigger.sh:56,67`

```sh
adb shell "dumpsys package $p 2>/dev/null | grep ..."     # $p 来自位置参数，未加引号
adb shell "dpkg -l $p ...; dpkg-query -W -f='...' $p ..."
```

这些整串最终由**设备端 root shell** 解析：包名/路径里带 `;`、`'`、`$( )` 就能在设备上以 root 执行。输入通常来自客户资料粘贴，属于「外部可控文本 → root shell」。建议：统一单引号转义函数（`'` → `'\''`）或 `printf %q`；包名白名单 `^[A-Za-z0-9_.]+$`；`SIZE` 限 `^[0-9]+x[0-9]+$`。**未改。**

---

## 5. P2：健壮性 / 契约缺口（22 条）

| # | 位置 | 问题 | 状态 |
|---|---|---|---|
| 5.1 | `src/shared/skill.js`（重写） | 手写逐行正则 ≠ DSH 的 YAML：`description: >` 得到字面量 `>`、多行值静默截断、`"引号"` 连引号一起带出、`disable-model-invocation: true # 注释` 被当成 undefined（开关静默失效）、非法 name 照收 | ✅ 已修（fail-fast + 单测） |
| 5.2 | `scripts/check-package.mjs` | skill 只校验 `name:` 行与 description 非空：不查长度/行数/引用/权限/未知键；数据只数机型；「写死本机路径」只扫 `*.js` | ✅ 已修（4 类校验 + 负向验证） |
| 5.3 | `src/docs/data/models.json:3`、`references/rk-android.md:6/168/299`、`rk-debian.md:377`、`t3-linux.md:287` | 随包文本写死 `/home/my/...`（`models.json` 会真的发给用户），而校验器放行 | ✅ 已修（改相对路径 / `~/`） |
| 5.4 | `src/cpservice/.../assets/{setup-template,trigger,update-mdm-wifi}.sh` | 600 无执行位；`debian-*.sh` 是 711（组/其他人可执行但不可读，实际跑不起来）；打包后同样如此 | ✅ 已修（统一 755） |
| 5.5 | `src/cpservice/skills/cpservice/SKILL.md:392/397` | §10 同一段「验证不是排障」重复两遍；「整机线刷不在本 skill」与 §11 重复 | ✅ 已修（去重） |
| 5.6 | `README.md:99` | 链接指向 `docs/merge-review.md`，而 `files` 不含 `docs/` → 发布包里断链 | ✅ 已修（改仓库 URL） |
| 5.7 | `rk-debian.md`(392 行)、`rk-android.md`(314 行) | 超过 300 行无目录，规范要求有 | ✅ 已修（只加 §目录，不改正文） |
| 5.8 | `src/shared/data-dir.js:65-72` + `src/docs/lib/store.js:20-31` | 首次拷贝逐文件覆盖写、无完成标记；`resolveWritableDir([dir])` 只试 `candidates[0]`，环境目录不可写时不回落而是静默只读 | 待定 |
| 5.9 | `src/docs/lib/import.js:111/126-127` + `store.js:59` | `spec.no` 未校验就拼路径：`no: "../../x"` 可写出 `--out` 之外；读取侧同理可越目录读 | 待定 |
| 5.10 | `src/docs/lib/packet.js:205-211`、`90` | 网页/OCR 文本逐行拼进 `role:'user'` 消息，规则（RULE）放在内容之后、无围栏，表格 caption/warnings 未清洗 → 提示注入面 | 待定 |
| 5.11 | `src/docs/index.js:130` | 「资料完全相同则合并」比较的是整段渲染（首行含唯一 id），分支永假；歧义时只会让用户换写法 | 待定 |
| 5.12 | `src/firmware/lib/tb-live.js:254-258` | 详情补拉预算 25 条按搜索顺序占用，版本父任务常落在预算外 → `stage` 为空、已归档版本被当在制 | 待定 |
| 5.13 | `src/firmware/index.js:1999` | `firmware_models` 无索引时直接抛错，虽然它描述了 alist 兜底；`readBoard` 的失败靠错误文案正则分发 | 待定 |
| 5.14 | `src/firmware/index.js:367/458` | board 直写非原子（其余缓存都是 tmp+rename），损坏后 `JSON.parse` 抛 SyntaxError 且无兜底；旧 `format` 不校验 | 待定 |
| 5.15 | `src/firmware/alist.js:241-276` + `index.js:1198` | 缓存只增不删、`text:` 条目存整份正文；`ttlMs: 0` 时每次 miss 都全量重写整个缓存 | 待定 |
| 5.16 | `src/firmware/alist.js:111-113/282-284` | 不跟随 3xx、无响应体上限、失败全塌缩成 `null`/`''` → 「403/token 失效/代理拦截」与「无此版本」不可区分，且 sha256 会静默丢失 | 待定 |
| 5.17 | `src/firmware/login.js:261-271` | 登录浏览器带 `--remote-allow-origins=*` + `--no-sandbox` + `--password-store=basic`，而该 profile 里是活的 TB 会话，CDP 端口对同机进程敞开 | 待定 |
| 5.18 | `src/firmware/login.js:234-247` | `openExternal` 恒返回 true（`spawn` 的错误是异步事件），候选回退与失败提示都不会生效 | 待定 |
| 5.19 | `src/firmware/login.js:454-473` | `inflight` 单飞锁不含 `dataDir`/`options`：多工作区并发登录会拿到别人目录的结果，`force` 也被吞 | 待定 |
| 5.20 | `src/firmware/index.js:383`、`lib/issues.js:345` | 两处 TB 抓取无 `AbortSignal`/无 `exec.signal`，最坏情况远超工具描述的 60–90 秒，取消也无效 | 待定 |
| 5.21 | `lib/fix/store.js:175` | `loadIndex` 不校验 commits 表：只有 `index.json` 时仍算「健康」，`fix_check` 输出 `not_found` 而不是 `needs_sync` | 待定 |
| 5.22 | `lib/fix/sync.js:108-115` | 本次发现失败（网络抖动/列目录失败）也当成「产品线下线」，**连带删除 meta 记录与本地 raw/parsed** | 待定 |

另有两条同类项并入 5.8/5.19 叙述：`fix/store.js:55`、`fix/alist.js:257` 的 tmp 名只用 pid（同进程并发互踩）；`fix/alist.js:41-57` 不校验 scheme，`http://` base 会以 `ERR_INVALID_PROTOCOL` 被无谓重试 3 次。

---

## 6. P3：建议（10 条）

1. `index.js:401` 的 `normalizeFields` 比 `tb-live.js:25` 少了 `lookup2`，同一字段两条路径归一出不同类型（建议合并成一份）。
2. `index.js:1525` 把 `args.customer ?? 'CP'` 提前填死，`tb-live` 的 `customerDefaulted` 恒 false，「（默认 CP）」标注永远不出现。
3. `login.js:356-357` 的 `mode: 0o700/0o600` 只对新建生效，已存在路径不会被收紧；`writeToken` 非原子。
4. `fix/sync.js:44` `new RegExp(only)` 未转义、未限复杂度（`(a+)+$` 可回溯）。
5. `fix/store.js:157` `generatedAt` 每次重建都刷新，即使全线跳过，索引「新鲜度」失真。
6. `import.js:217` 用 `argv[1]` 的 basename 判断「是否入口」，同名脚本 import 会触发多余写盘。
7. `packet.js:207` 只有 packet 有 40k 上限，question / 机型清单回显不设限。
8. `t3linux-setup-template.sh:72-76` 锁打开失败被当成「已有安装进程」并 `exit 0`（假成功）。
9. `add-icon-device.sh:171-173` SQL 全部字符串拼接（应用名带 `'` 会失败，带 `');` 可注入 launcher.db）。
10. `t3linux-setup-template.sh:118` 以 root 直接 `tar xf` U 盘包，不校验成员路径/符号链接。

---

## 7. 机械修复明细（已落盘，未提交）

| 文件 | 改动 | 为什么算机械 |
|---|---|---|
| `src/shared/skill.js` | 重写 frontmatter 解析：允许键白名单、块标量/重复键/未知键/非法布尔值一律抛错、name 按 kebab 校验、引号去壳 | 只把「静默猜值」改成「显式报错」，合法文件的解析结果不变 |
| `test/shared/skill.test.mjs` | +6 个用例（块标量、未知键、非法布尔、非法 name、引号、缺 frontmatter） | 纯新增 |
| `scripts/check-package.mjs` | 新增：frontmatter 键白名单、name、description 长度/尖括号/块标量、SKILL.md ≤500 行、引用路径存在、`.sh` 可执行位、docs 数据引用逐条可读、`src/**` 文本扫描本机绝对路径 | 只加校验，不改产物 |
| `src/docs/data/models.json` | `source` 改相对路径 | 该字段无人读取（`grep` 确认） |
| `src/docs/lib/import.js` | `source` 写相对路径 | 同上 |
| `references/rk-android.md`、`rk-debian.md`、`t3-linux.md` | `/home/my/...` → `~/...` | 纯文本替换，语义不变 |
| `references/rk-debian.md`、`rk-android.md` | 顶部加 `## 目录`（按标题生成锚点） | 只插入目录块 |
| `assets/*.sh`（cpservice） | 统一 755（git 里只会记录 exec 位变化） | 权限修正 |
| `cpservice/SKILL.md` | 删 §10 中重复的 2 条（一条与 392 重复、一条与 §11 重复） | 删重复段落 |
| `README.md` | 断链改仓库 URL | 链接修正 |
| `src/firmware/index.js:2199` | `jsonSafe(await loginWithCookie(...))` | 缺一个 `await` |
| `flash.sh:1261-1264` | 加 `STEM=""`（含注释） | 一行，修正期望版本来源 |

改动量：15 个文件、+237/−37；`npm test` 9 个套件全绿，`npm run check` 通过，`shellcheck -S warning` 0 条，官方 `quick_validate.py` 3/3 通过。

### 7.1 新校验的负向验证（证明它真能拦住）

临时把 `cpservice` description 加 40 字符、改一处引用为不存在、去掉一个脚本的 exec 位：

```
✗ 3 个问题：
  - cpservice: description 1048 字符，超出规范上限 1024
  - cpservice: SKILL.md 引用了不存在的 assets/not-exist.sh
  - cpservice: .../trigger.sh 缺可执行位（SKILL 里按一条命令跑）
```

恢复后重新通过。

---

## 8. 明确没做（需要你点头）

1. **`cpservice` description 瘦身**到 300 字符内 + 关键词表压到 20–30 个（会改变触发面，建议先跑一轮触发评估）。
2. **`cpservice` 正文拆分**：§5.2 / §7.4 / §8 下沉到 references，正文只留指针。
3. **`fix_check` 结论口径**：revert 的判定与文案（4.2）、长 hash 归一（4.3）——改的是对外结论，需你确认「已合入又被 revert」该怎么报。
4. **`flash` 镜像校验策略**（4.4）：是否强制 sha256、没有校验源时是否拒绝刷。
5. **设备端脚本的失败语义**（4.6/4.9）：`update-mdm-wifi` 失败是否 `exit 1`、`rm -rf` 是否加白名单。
6. `import` 幂等（4.8）：清空重建 vs 去重追加。
7. `vendor/` 28 MB 二进制的来源与许可补齐（`VanCoreT3-*.apk` 无 license 文件；`rk_upgrade_tool` 待查）。
8. 加 `engines`、eslint/prettier、`index.json` 的 categories/labels。

---

## 9. 做对了、别改

- **零 npm 依赖**：没有供应链面，`vendor/` 之外没有第三方 JS。
- **凭据**：`token.json` 0600、数据目录 0700（已有路径的收紧见 P3）、`.gitignore` 覆盖 `.tbfw/.fixfinder/.cpdocs/*.bak-*`。
- **子进程**：`spawn`/`execFileSync` 全部数组参数，没有 `shell: true`；`flash.sh` 的 `curl` 有 `--fail`、`--noproxy` 明确处理本机代理。
- **测试**：9 个离线套件 + 契约测试（四个子插件都导出 Cordis 契约、id 沿用旧名，升级兼容有保障）；`verify.mjs` 统一入口、失败打印尾部。
- **SKILL 的「先验证再出包」「只比版本号」「不把 adb 掉线判成失败」**：这些是把现场踩坑写成了判定口径，正是 skill 该有的样子。
- **fail-fast 的打包校验**（本次加强后）：`npm run check` 现在是「发布前的最后一道闸」，建议把它挂到 `prepublishOnly`。

---

## 10. 复跑

```bash
cd /home/my/Documents/deepseek-harness/default-workspace/plugins/cp-tools

npm test                      # 9 个离线套件
npm run check                 # 包清单 + skill 规范（本次加强）
shellcheck -S warning src/cpservice/skills/cpservice/assets/*.sh \
  src/flash/skills/flash/assets/flash.sh
for s in firmware flash cpservice; do
  python3 ~/.claude/skills/skill-creator/scripts/quick_validate.py src/$s/skills/$s
done
node --test test/shared/skill.test.mjs     # frontmatter 解析的 8 个用例
```

复现两个关键 P1：

```bash
# 4.2 / 4.3：fix_check 的 revert 与长 hash（用 .fixfinder 真实索引）
cat > /tmp/fixprobe.mjs <<'JS'
import fs from 'node:fs';
const root = '/home/my/Documents/deepseek-harness/default-workspace/plugins/cp-tools';
const { executeCheck } = await import(`${root}/src/firmware/lib/fix/check.js`);
const { loadIndex } = await import(`${root}/src/firmware/lib/fix/store.js`);
const index = await loadIndex('/home/my/Documents/deepseek-harness/default-workspace/.fixfinder');
const dictionary = JSON.parse(fs.readFileSync(`${root}/src/firmware/keywords.json`, 'utf8'));
const run = (args) => {
  const r = executeCheck({ index, dictionary, args });
  console.log(args, '→', r.verdict, (r.notes || []).join(' | '));
  console.log('  cands:', (r.candidates || []).slice(0, 3).map((c) => `${c.hash}:${c.score}${c.revert ? ':REVERT' : ''}`).join(', '));
};
run({ bug: 'debug ops 打不开', model: 'APOLLO2-MIX', os: 'ANDROID', customer: 'CP' });   // 4.2
run({ bug: '8bf42a06' });                                                              // 4.3：命中 1000 分通道
run({ bug: '8bf42a0612ab34cd56ef78901234567890123456' });                              // 4.3：不命中
JS
node /tmp/fixprobe.mjs

# 4.8：导入不幂等
SRC=/home/my/Documents/deepseek-harness/default-workspace/work/cpdoc/ai-readable
rm -rf /tmp/cpdoc-test
node scripts/import-docs.mjs --src $SRC --out /tmp/cpdoc-test
node scripts/import-docs.mjs --src $SRC --out /tmp/cpdoc-test   # 再跑一次：pages 28 → 56，工作点 14 → 28
```

---

## 附录：审核证据来源

- 官方规范：`anthropics/skills` HEAD（`2c5958e`）；`skills/skill-creator/SKILL.md`、`scripts/quick_validate.py`、`scripts/package_skill.py`（与本地 `~/.claude/skills/skill-creator` 逐字一致）；`spec/agent-skills-spec.md` 指向 `agentskills.io/specification`。
- DSH 契约：`@deepseek-ai/dsh-skill-filesystem` 的 `README.zh.md` 与 `lib/index.js`（`parseFrontmatter`、`frontmatterBoolean`）。
- 实跑：`npm test`、`npm run check`、`shellcheck`、`quick_validate.py`、`npm pack --dry-run`、`.fixfinder` 真实索引、`docs/materials` 真实源数据。
- 未验证：所有真机结论（adb/flash/安装）均为静态审查。
