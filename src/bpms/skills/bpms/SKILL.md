---
name: bpms
description: 登录 BPMS（CPSales）并读写订单需求表：查记录、按「分区/字段名」改字段、备份与回滚。BPMS, CPSales, 订单需求表, 需求编号, CPS-SY, 改字段, 登录, token, 租户。
---

# BPMS 订单需求表（登录 + 编辑）

只关心两件事：**怎么登录**、**怎么安全地改一条记录**。

## 快速路由

| 你说 | 走什么 |
|---|---|
| 「登录 BPMS」/ 任何工具报 `needs_config`、`auth_failed` | `bpms_login` |
| 「这张单有哪些字段」 | `bpms_fields` |
| 「看下 CPS-SY… 这张单」 | `bpms_get`（可直接给需求编号） |
| 「把 xx 字段改成 yy」 | `bpms_update`（先 dry-run） |

工具返回的 `status`：`ok` / `needs_config` / `auth_failed` / `not_found` / `ambiguous` / `conflict` / `rejected` / `error`。
`needs_config` 时按返回的 `paths` 建配置文件再登录，不要自己拼登录请求。

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
- 也可以在 **DSH Web → 插件 → 从平工具集 → 「BPMS 账号」** 里直接改这几项（写的就是 `~/.dsh/cp-tools/bpms.json`，密码只写不回显）。页面里若提示「当前生效的是另一份配置」，说明环境变量或插件目录的配置优先，改页面不会生效。
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
| 附件上传 | `POST /admin-api/infra/file/upload`，multipart 字段 `file`，返回 url（本插件不封装） |

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

## 红线

- 不把密码/token 写进命令行参数、日志、报告或 git。
- 没有备份不写库；`apply` 默认 false，先看 dry-run 的 diff。
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
