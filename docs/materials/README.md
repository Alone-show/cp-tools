# AI 可读产品文档（从平 28 款机型）

## 文件
| 文件 | 用途 |
| --- | --- |
| `28-models.md` | 主文档：28 个机型，含关键参数速查、产品参数表、接口定义表、线束定义表、图内文字、原图链接 |
| `spec-matrix.csv` | 跨机型对比矩阵：行=机型，列=统一属性（Excel 可直接打开，UTF-8 BOM） |
| `spec.json` | 机器可读全量结构（字段最全，含表行与图内文字） |
| `specs/*.json` | 单机型原始转写结果（tables / figures / skipped，合并进 spec.json） |
| `manifest.json` | 页面图清单：360 条页面引用 / 177 张唯一图（URL / sha256 / 分类 / 章节 / 分辨率） |
| `issues.md` | 低置信、分辨率不足、图文冲突、同图不一致等待核对清单 |

## params_flat 字段字典
| key | 含义 | 示例 |
| --- | --- | --- |
| `cpu` | CPU | — |
| `gpu` | GPU | — |
| `npu` | NPU | — |
| `ram` | 内存 | — |
| `rom` | 存储 | — |
| `os` | 操作系统 | — |
| `screen_inch` | 屏幕尺寸(inch) | — |
| `resolution` | 分辨率 | — |
| `brightness` | 亮度 | — |
| `touch` | 触摸 | — |
| `cellular` | 蜂窝网络 | — |
| `wifi` | WiFi | — |
| `bluetooth` | 蓝牙 | — |
| `gnss` | GNSS | — |
| `can` | CAN | — |
| `rs232` | RS232 | — |
| `rs485` | RS485 | — |
| `dc_output` | DC输出 | — |
| `io_output` | IO输出 | — |
| `io_input` | IO输入 | — |
| `adc_input` | ADC输入 | — |
| `usb` | USB | — |
| `ethernet` | 以太网 | — |
| `camera_in` | 摄像头输入 | — |
| `speaker` | 扬声器 | — |
| `mic` | 麦克风 | — |
| `handset` | 手麦 | — |
| `power_input` | 电源输入 | — |
| `acc_detect` | ACC检测 | — |
| `protection` | 防护等级 | — |
| `vibration` | 震动标准 | — |
| `temp_operating` | 工作温度 | — |
| `temp_storage` | 存储温度 | — |
| `humidity` | 湿度 | — |
| `salt_spray` | 盐雾 | — |
| `cert` | 认证 | — |
| `connector` | 连接器 | — |
| `buttons` | 功能按键 | — |
| `indicator` | 指示灯 | — |
| `material` | 材质 | — |

## 数据口径
1. 表中数值来自原图识别，单位保留原文（mm / kg / inch / cd/m² / V / A）。
2. "选配/标配/复用/定制版/特别版"等原文表述原样保留，不做语义归一。
3. 识别不确定的字符写 `?`，并在 `issues.md` 标注，不猜测。
4. 一个机型的完整原始信息在 `spec.json` 的 `tables[].rows` 中，统一字段（params_flat）只是常用项映射；映射不到的内容仍在 rows 里。
5. 跨机型共用同一张图（同一 sha256）时，转写结果必须一致；本版已把共用表回填到使用该图的所有机型（各表 notes 标注原归属），共用关系与补齐记录见 issues.md。

## 覆盖率
- 机型：28/28
- 表格：154 张（产品参数 28、接口定义 66、线束定义 60），共 2048 行
- 图内文字：94 张（工程图/示意图的尺寸、孔位、针脚、接线说明，自动识读）
- 未转写的照片/示意图：116 张（在 28-models.md 各机型末尾列原图链接）
- 待核对项：见 issues.md
- 修订记录：2026-11-03 回填 20 个机型的 60 张共用表；补录图内文字（安装孔位/接口针位/接线方法）；线束外观图按策略降级为原图链接；页面图 100% 可回溯
