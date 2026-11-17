---
name: cp-docs
description: 查 CP 机型的本地产品资料（参数 / 接口 / 线束 / 编程节点 / 工作点），全程离线读本机 .cpdocs。用户问某机型的屏幕尺寸、RS232/RS485 引脚、GPIO、工作温度、设备节点，或直接发 /cp-docs 时，调用 cp_docs 工具取该机型整包资料再作答；机型按目录归一（与 firmware 共用 model-core），认不出就问用户，不要凭记忆补机型。不负责固件版本与线刷直链（走 firmware）、工单与历史 bug（走 tickets）、U 盘包与刷机（cpservice / flash）。
---

# 产品资料（cp-docs）

本 skill 只负责「按机型查本地产品资料」。数据来自本机 `.cpdocs`（由 `scripts/import-docs.mjs` 生成），**不联网**。

## 怎么用

调用工具 `cp_docs`，`query` 传自然语言，且必须带机型写法：

- `SPRING2PRO 的屏幕尺寸`
- `SPRING2PRO 的 RS232 引脚在第几脚`
- `APOLLO2 12PRO 的工作温度范围`
- `CP023 的 INPUT1 接到哪个 GPIO`
- `支持哪些机型`（返回目录）

工具返回三种形态：

| status | 含义 | 你该做什么 |
|---|---|---|
| `ok` | 命中了唯一机型，`packet` 是该机型整包资料 | 基于 `packet` 作答，标注来自哪张表/哪一节，**不要补充 packet 之外的信息** |
| `needs_confirmation` | 机型写法对应多个候选 | 把候选列给用户，让他选；选定后带精确机型再调一次 |
| `catalog` | 只要目录 | 列出机型，提示用户挑一个再问 |
| `error` | 没认出机型或缺资料文件 | 回用法（`/cp-docs <自然语言>`），不要猜 |

## 边界

- 不查固件版本、构建日期、线刷/OTA 直链 → `firmware`
- 不查工单、任务号、bug 是否修进正式版 → `tickets`
- 不做 U 盘升级包、不刷机 → `cpservice` / `/flash`
- 资料里没有的字段就说没有，不要用知识库或工单反推
