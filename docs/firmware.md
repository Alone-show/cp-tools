# firmware

DeepSeek Harness 子插件：只做**固件查找**。

1. 按机型 + 系统 + 客户，在 Teambition 发版看板与 alist `/PROD` 里定位量产固件，给线刷 / OTA 直链；
2. 机型族、同族别名、变体与写法归一。

```text
/firmware spring2pro 安卓
/firmware apollo 12 pro debian --customer CP
/firmware models
```

## 工具

| 工具 | 用途 |
|---|---|
| `firmware_find` | 机型 + 系统 + 客户 → 版本、构建日期、客户、线刷/OTA 链接 |
| `firmware_models` | TB 看板里的机型族、别名、变体；机型写法拿不准时先查 |

## 边界

- 不查工单/任务号、子任务状态、历史 bug 是否修复；这些由 `tickets` 子插件负责（`/tickets`）。
- 与 tickets 共用 `.tbfw`（`board-<projectId>.json`、`token.json`）与 alist 缓存；firmware **只读**。
- TB 看板索引由 tickets 同步；缺失时 `firmware_find` 仍走 alist，并在 note 里说明。
- `DSH_FIRMWARE_NO_PROBE=1` 关闭实时探测，`DSH_ALIST_DISABLE=1` 关闭 alist。
