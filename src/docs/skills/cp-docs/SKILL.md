---
name: cp-docs
description: 查 CP 机型的本地产品资料（参数 / 接口 / 线束 / 编程节点 / 工作点 / 图片），全程离线读本机 .cpdocs。用户问某机型的屏幕尺寸、RS232/RS485 引脚、GPIO、工作温度、设备节点，或要按机型查资料、要线束图/接口图/安装图时，用 cp_docs 取整包资料、用 cp_docs_images 取带「作用」标注的图片路径；机型按目录归一（与 firmware 共用 model-core），认不出就问用户，不要凭记忆补机型。不负责固件版本与线刷直链（走 firmware）、工单与历史 bug（走 tickets）、U 盘包与刷机（cpservice / flash）。
user-invocable: false
---

# 产品资料（cp-docs）

> 由 `skill` 工具加载本页后，`cp_docs` 与 `cp_docs_images` 工具在**下一步**才出现；`/cp-docs` 命令直读资料，不经过工具。

本 skill 只负责「按机型查本地产品资料」。数据来自本机 `.cpdocs`（由包脚本 `npm run import:docs` 生成），**不联网**。

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

## 发图 / 找图

用户要「某机型的线束图 / 接口图 / 安装图 / 那张参数表」，或问「有哪些图」时，用 `cp_docs_images`：

```text
cp_docs_images { model: "TANK2" }                    → 该机型全部图（图号 + 作用 + 路径 + 建议名）
cp_docs_images { model: "TANK2", keyword: "线束" }    → 只要线束相关
```

- 每条返回 `caption`（图号标题）、`purpose`（**作用**，说明这张图拿来干什么）、`path`（已存在的文件，直接可用）、`deliverAs`（建议文件名）。
- 发文件：用 `path` 调 `dsh_im_return_file`；只有用户明确要干净文件名时才按 `deliverAs` 复制到 `/tmp` 再发。
- 回复里**必须写图号 + 作用**（例：「图4.1.2 26P接线图：线序/针位/线径/线色总表，线束制作用」），不要只丢文件。
- 同一轮不重复发同一张图；`exists:false` 的图不要发，改为提示重建索引：`node scripts/import-docs.mjs`。
- 关键词认不出时换用词表里的词：`线束 / 接线 / 线序 / 接口 / 针脚 / 参数 / 安装 / 外观 / 坐标`。
- 整包 `packet` 里只有图片标题摘要（最多 6 条），完整清单与路径一律走 `cp_docs_images`。

## 边界

- 不查固件版本、构建日期、线刷/OTA 直链 → `firmware`
- 不查工单、任务号、bug 是否修进正式版 → `tickets`
- 不做 U 盘升级包、不刷机 → `cpservice` / `/flash`
- 资料里没有的字段就说没有，不要用知识库或工单反推
