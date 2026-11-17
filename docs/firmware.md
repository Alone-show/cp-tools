# firmware

DeepSeek Harness 子插件：只做**固件查找**；入口是 `/firmware` 命令（或模型加载 `firmware` skill）。

1. 先给机型目录（规范名 / 别名 / 变体，含每个尺寸的系统、客户、最新版本），机型由模型按证据选，工具不猜；
2. 选定机型后，在 Teambition 发版看板与 alist `/PROD` 里定位量产固件，给线刷 / OTA 直链。

```text
/firmware models                      # 先看机型目录（规范名 / 别名 / 变体 + 尺寸 / 客户 / 最新版本）
/firmware RK / SPRING2-10PRO 安卓      # 规范名直接查
/firmware APOLLO2 debian               # 跨尺寸会回目录，选 LCD7 / LCD12 再查
```

共享固件（只开两组）：`APOLLO2-7A` 与 `APOLLO2` 的 7 寸固件通用、`APOLLO2-12A` 与 `APOLLO2` 的 12 寸固件通用——查任一边都会同时给出另一边的版本（`firmwareSharing`，行首 `[共享]`），客户仍不可混刷；10 寸与 12PRO/12PLUS 不参与。

机型不再由工具模糊归一：空格/符号差异与去尾 `A` 视为同一机型（`APOLLO2-7` ≡ `APOLLO2-7A`）；省略尺寸段（`spring2pro`）或认不出的写法先返回目录（`status=needs_confirmation` + `candidates`），由模型按系统 / 客户 / 尺寸 / 最新版本选定后，带精确 `model`（跨尺寸时加 `lcd`）二次调用。

## 工具

| 工具 | 用途 |
|---|---|
| `firmware_models` | 机型目录：规范名、别名、变体 + 每个尺寸的系统/客户/最新版本 |
| `firmware_find` | 精确机型（跨尺寸加 `lcd`）+ 系统 + 客户 → 版本、构建日期、客户、线刷/OTA 链接 |

## 边界

- 不查工单/任务号、子任务状态、历史 bug 是否修复；这些由 `tickets` 子插件负责（`/tickets`）。
- 与 tickets 共用 `.tbfw`（`board-<projectId>.json`、`token.json`）与 alist 缓存；firmware **只读**。
- TB 看板索引由 tickets 同步；缺失时 `firmware_find` 仍走 alist，并在 note 里说明。
- `DSH_FIRMWARE_NO_PROBE=1` 关闭实时探测，`DSH_ALIST_DISABLE=1` 关闭 alist。
