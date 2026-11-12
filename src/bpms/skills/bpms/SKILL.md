---
name: bpms
description: 登录 BPMS（CPSales）并读写订单需求表：查记录、按「分区/字段名」改字段、上传附件、备份与回滚；订单链路里拉 OS版本 交 /flash 刷机、把 cpservice 做好的安装包传进「预装软件文件上传」（状态非暂存只出包不传）。BPMS, CPSales, 订单需求表, 需求编号, CPS-SY, 改字段, 上传, 安装包, 刷机, 登录, token, 租户。
---

# BPMS 订单需求表（登录 + 编辑）

三件事：**怎么登录**、**怎么安全地改一条记录**、**怎么把做好的安装包传上去**（订单链路的入口在本页，刷机/出包分别交给 `/flash`、`/cpservice`）。

## 快速路由

| 你说 | 走什么 |
|---|---|
| 「登录 BPMS」/ 任何工具报 `needs_config`、`auth_failed` | `bpms_login` |
| 「这张单有哪些字段」 | `bpms_fields` |
| 「看下 CPS-SY… 这张单」 | `bpms_get`（可直接给需求编号） |
| 「把 xx 字段改成 yy」 | `bpms_update`（先 dry-run） |
| 「这个订单帮我更新 MDM / 做个 logo 包」 | 本页「订单链路」五步：拉版本 → 刷机 → 出包 → 验证 → 确认后上传 |
| 「把包传上去」/「帮我上传」 | `bpms_update` 带 `expectStatus:0`，先 dry-run 给用户看，再 `apply` |

工具返回的 `status`：`ok` / `needs_config` / `auth_failed` / `not_found` / `ambiguous` / `conflict` / `rejected` / `error` / `status_mismatch`（`expectStatus` 不符，未上传未写库）。
`needs_config` 时按返回的 `paths` 建配置文件再登录，不要自己拼登录请求。

## 订单链路：拉版本 → 刷机 → 出包 → 验证 → 确认 → 上传

用户给出订单链接/编号 + 「帮我做包 / 更新 MDM / 做个 logo 包」时，按这五步走。**不要反问要不要刷机，也不要另找版本来源。**

| 步 | 做什么 | 谁执行 |
|---|---|---|
| 1 拉版本 | `bpms_get` 拿摘要（状态），`bpms_fields` 取：`软件需求信息/OS版本`（**这就是目标固件版本**）、`软件需求信息/系统`、`基本信息/品名`、`定制图案图片上传`、`硬件需求信息/LOGO图样上传`、`软件需求信息/预装软件文件上传` | 本 skill |
| 2 判刷机 | 进 `/flash`：adb 读设备当前版本 vs 订单版本，顺带核对机型/屏参 | 直接进 flash skill（**不用等用户输 `/flash`**） |
| 3 刷机 | 版本不一致 → 刷到订单版本（会清 userdata，刷前一行说明）；一致 → 跳过并说明原因 | flash |
| 4 出包 | 预装包为空 → cpservice 从零出包；不空 → 下载原包 + `merge-package.sh` 增量合并；然后真机验证 | cpservice |
| 5 上传 | 汇报「包路径 + 验证结论 + 目标字段 + 当前状态」→ **等用户说「传」** → `bpms_update(expectStatus:0, apply:true)` | 本 skill |

### 硬规则

- **状态门**：`status === 0`（暂存）才上传。`1 待审核 / 2 打回修改 / 3 已审核 / 4 需求完结` → **包照做、验证照跑，但不上传**，回复里明确提醒（例：「状态 3=已审核，按约定只出包不上传」）。
- **确认门**：`bpms_update` 默认 dry-run 就是第一道闸；用户没明确说「传 / 上传」就不 `apply`。
- **版本只认订单 `OS版本`**：去掉 `.img` 后缀；`firmware_find(version=<该串>)` 只用来取线刷直链，不参与选版本。查不到直链（客户定制版）→ 停，不拿「最新量产」顶。
- **平台映射**（交给 cpservice 选 reference）：`Android 6.0` → T3 安卓；`Android 11.x` → RK 安卓；`Debian` → RK Debian；`Buildroot` → T3 Linux。机型/客户用 `firmware_models` / `firmware_find` 归一，有多解就停下来问。
- **已有包 = 增量**：`预装软件文件上传` 非空时，先下载原包（`mdmobs.cpuniverse.cn` 直链可匿名 GET；403/过期就重拉详情取新 url），再用 `merge-package.sh` 合资源——**保持包内布局与 xml 引用名**，分辨率/logo 帧数以包内既有资源为准（如 `video_demo.yuv` 215,654,400 B = 1024x600、`logo` 4,915,200 B = 2 帧）。
- **上传写法**：`patch: { "软件需求信息/预装软件文件上传": [{ path: "/abs/…zip", name: "原包名_20261112.zip" }] }`，只留合并后的新包（`attachmentMode` 默认 replace，别用 append 把旧包留着）。`apply:false` 时只校验文件、不上传。
- **SN 写入手动确认**：刷机清数据后，订单 `SN写入=是` + `序列号范围-SN` 不在本链路代做，提示用户单独处理。
- **不越界**：只改用户点名的字段；打包事实（logo 生成、xml 动作、验证口径）一律以 `/cpservice` 为准，本页不另写一套。

## 配置（账号密码填这里）

按优先级找配置文件，命中第一个就用：

1. 环境变量 `BPMS_CONFIG` 指向的文件
2. `~/.dsh/cp-tools/bpms.json`（推荐：插件升级不会覆盖）
3. 插件目录 `bpms_config.json`（本地填写方便，已 gitignore）

内容：

```json
{
  "base_url": "https://bpms.cpuniverse.cn",
  "username": "你的 BPMS 用户名",
  "password": "你的 BPMS 密码",
  "tenant_name": "从平",
  "timeout_seconds": 20
}
```

- `tenant_name` 是登录页顶部那个租户名（从平）；名字错会直接报「租户名不存在」。
- 页面只需要用户名和密码：地址与租户名有默认值（`https://bpms.cpuniverse.cn` / `从平`），一般不用改；改也只改配置文件。
- 也可以在 **DSH Web → 插件 → 从平工具集 → 「BPMS 账号」** 里直接改（写的就是 `~/.dsh/cp-tools/bpms.json`，密码只写不回显），页面的 **测试登录** 用当前填写值验一次，不写 token、不改文件。页面里若提示「当前生效的是另一份配置」，说明环境变量或插件目录的配置优先，改页面不会生效。
- 文件建议 `chmod 600`；权限过宽工具会给 warning，但不阻断。
- 仓库里只有 `bpms_config.example.json` 占位，**不要把真实口令提交进 git**。
- 也可用 `BPMS_USERNAME` / `BPMS_PASSWORD` / `BPMS_BASE_URL` / `BPMS_TENANT` 临时覆盖，仅排障用。

## 登录流程（工具内部已实现，这里是对账用）

1. 租户：`GET /admin-api/system/tenant/get-id-by-name?name=<tenant_name>` → `data` 即 tenant id。
2. 登录：`POST /admin-api/system/auth/login`，body `{username,password}`，头 `tenant-id` + `Content-Type: application/json`。
3. 返回 `data.accessToken / refreshToken / expiresTime`；token 缓存到 `~/.dsh/cp-tools/bpms-token.json`（0600），未过期直接复用。
4. 业务请求统一带 `Authorization: Bearer <token>`、`tenant-id`、`Referer`、`User-Agent`。
5. 遇到 401 自动重登一次再重放；仍失败才报 `auth_failed`。
6. 密码与 token 永远不出现在返回值、日志、报告里。

常见失败：密码错（`code!=0` 带 msg）、账号停用、租户名写错、网络不通（`network`，不要误判成未登录）。

## 接口清单（实测）

| 用途 | 方法与路径 |
|---|---|
| 详情 | `GET /admin-api/crm/order-requirements/detail/{id}` |
| 列表 | `POST /admin-api/crm/order-requirements/select-list` |
| 更新 | `POST /admin-api/crm/order-requirements/update` |
| 附件上传 | `POST /admin-api/infra/file/upload`，multipart 字段 `file`（可选 `directory`），返回 `{code:0,data:"<url>"}`；`bpms_upload` / `bpms_update` 的 `{path}` 已封装 |

`id` 是详情页 URL 里的数字主键（如 `2000550683162509709`）；`requirementsNumber`（`CPS-SY2026DX0949`）只是业务编号，两者别混用。

## 数据结构

详情返回「模板平铺字段 + `parameters`（JSON 字符串）」，`parameters` 里有：

- `basicInfoList`：基本信息（label/value）
- `orderSummaryList`：订单配置总结
- `orderFittingList`：配件表（按 partNumber，不走 label 寻址）
- `requireInfoList`：分区（软件/硬件/外观/包装/认证），每个分区 `fieldList` 才是字段

附件字段形如 `{type:"upload", label, value:[{name,url,uid,status}]}`；改字段就是改这些 `value`。

## 寻址规则（重要）

- 一律按 **`分区/字段名`**（如 `产品外观工艺/铭牌图样上传`）寻址，工具在运行时解析到具体下标。
- **不要**记 `requireInfoList[2].fieldList[5]` 这种下标——模板增删字段就会错位。
- 同一路径命中多个字段时工具返回 `ambiguous` + `candidates`，用更完整的路径重试，不要猜。
- 解析不到就停下并提示「模板可能已变更」，不要退回按下标硬改。

## 保存规则（踩过的坑）

1. **整包回写**：`update` 的 body 与 UI 抓包一致，`parameters` 必须重新序列化成字符串；只回传详情里那几个可写字段，`createTime/updateTime` 不回写。
2. **第一次接触写接口先抓包**：打开编辑页、什么都不改点一次「保存」，从浏览器 Network 拿真实 body，别靠猜字段。
3. **写前备份**：工具会存到 `~/.dsh/cp-tools/backups/<id>-<时间戳>.json`。
4. **并发校验**：写前重新拉一次详情，`updateTime` 与读取时不符 → `conflict` 中止。
5. **写后白名单 diff**：只允许本次 patch 的字段路径变化，出现别的差异 → 报错并给备份路径。
6. **权限 toast 是噪音**：编辑页会一直弹「没有该操作权限」，实际可以保存。以接口返回值为准，toast 只记日志。
7. **回滚**：`bpms_update` 传 `restoreFrom: <备份文件>`，用备份里的 parameters 原样写回。
8. **附件字段可以给本地文件**：`[{path:"/abs/x.zip"}]` 会在 apply 时先上传再写 URL；上传失败整次中止（不写库）；上传成功但保存失败会留下孤儿文件，报告里写清。
9. **状态门用 `expectStatus`**：上传安装包一律带 `expectStatus:0`；不符时工具返回 `status_mismatch`，既不备份也不上传。

## 红线

- 不把密码/token 写进命令行参数、日志、报告或 git。
- 没有备份不写库；`apply` 默认 false，先看 dry-run 的 diff。
- 订单状态不是暂存（0）不上传安装包；用户没说「传」不 `apply`。
- 白名单外的改动一律拒绝执行，不做「顺便帮你改一下」。
- 模板级元素（表头 logo、模板字段定义）只报告不改；改模板会影响所有用该模板的订单。
- 不把整包详情 JSON 丢进对话上下文；要细节用 `bpms_fields` / `bpms_get` 按需取。

## 故障排查

| 现象 | 处理 |
|---|---|
| `needs_config` | 按返回的 `paths` 建 `bpms.json`，填 username/password/tenant_name |
| `auth_failed` 密码错 | 改配置文件里的 password；确认 `tenant_name` 与登录页一致 |
| `not_found` | 确认 id 是数字主键，或直接给需求编号让工具查 |
| `ambiguous` | 用 `bpms_fields` 看完整 key 后重试 |
| `conflict` | 有人先改了：重新 `bpms_get` 后再决定是否重试 |
| `rejected` | 有越界改动，检查 patch 的 key 是否写错 |
