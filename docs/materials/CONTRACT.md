# 转写契约（所有 agent 必须遵守）

目标：把 CP DEVICE 产品的「图片参数表 / 接口定义表 / 线束定义表」用 **LLM 视觉通道 `read_image`** 读成结构化 JSON。
**禁止**使用任何 OCR 工具、禁止根据文件名臆测内容、禁止编造数值。

## 1. 你的输入
- 任务文件：`work/cpdoc/ai-readable/tasks/batch-<X>.json`（只做分配给你的 batch）
  - 每个机型字段：`no / model / family / out / page / intro / size_mm / weight_text / candidates[]`
  - `candidates[]` 里每张图：`sha256 / file / src / heading / caption / category / width / height`
  - `file` 是相对 `work/cpdoc/ai-readable/` 的路径，实际读图路径 = `work/cpdoc/ai-readable/<file>`
- 图片预处理（可选）：`python3 work/cpdoc/ai-readable/crop.py <sha256>.png --scale 2 [--parts 2]`
  - 宽度 > 1400px 或字号明显偏小 → 先 `--parts 2` 左右切两半分别读；分辨率 < 800px → `--scale 2` 放大后读
  - 输出路径会打印，直接传给 `read_image`

## 2. 你的输出
**每个机型写一个 JSON 文件**：`work/cpdoc/ai-readable/specs/<out>`（`out` 字段给了文件名）。
除 `specs/` 下自己的文件外，不要写任何其他文件；不要改动别人的文件。

```json
{
  "no": "1.1",
  "model": "APOLLO 7 PRO",
  "family": "APOLLO PRO",
  "intro": "（原样抄任务里的 intro，不要改写/压缩）",
  "size_mm": "194*127*29",
  "weight_kg": 0.7,
  "params_flat": {
    "cpu": "8核, 1.8GHz",
    "ram": "2G",
    "rom": "16G",
    "os": "Android 9.0",
    "screen_inch": "7",
    "resolution": "1024*600",
    "brightness": "750cd/m2",
    "touch": "电容触摸显示屏，支持5指触控",
    "cellular": "4G（可选配2G/3G/4G卡）",
    "wifi": "2.4G / 5G",
    "bluetooth": "BT 2.1+EDR / 3.0 / 4.1 LE / 4.2 BLE",
    "gnss": "（可选配）",
    "can": "CAN*2",
    "rs232": "RS232*2",
    "rs485": "RS485*1",
    "dc_output": "12V 直流对外供电*2",
    "usb": "USB 2.0*1",
    "ethernet": "以太网*1（可选）",
    "protection": "IP65",
    "temp_operating": "-30℃~+70℃"
  },
  "tables": [
    {
      "sha256": "…",
      "file": "images/store/….png",
      "src": "https://mdmobs.cpuniverse.cn/…",
      "section": "3.1 产品参数",
      "caption": "图3.1 配置信息",
      "kind": "param",
      "is_table": true,
      "header": ["分类", "内容"],
      "rows": [["系统", "8核, 1.8GHz\n2G RAM\n16G ROM\nAndroid 9.0"], ["显示", "7\" 电容触摸显示屏，支持5指触控\n亮度：750cd/m2\n分辨率：1024*600px"]],
      "confidence": "high",
      "notes": ""
    }
  ],
  "skipped": [{"sha256": "…", "file": "images/store/….png", "reason": "接口实物图，无文本表格"}],
  "warnings": []
}
```

## 2.1 共用图（同一 sha256 出现在多个机型页面）
- 一张图只转写一次即可，但**必须回填给所有使用该图（sha256 相同）的机型**：`rows`/`header`/`kind`/`confidence` 原样复制，`section`/`caption` 用各自页面上的标题，`notes` 标注原归属机型。
- 一张图内含多张表时，把同 sha256 的全部 table 记录一起回填，不要只复制第一条。
- 回填后仍要满足第 4 节自检第 2 条（每个机型的页面图全覆盖）。
- 现成工具：`python3 repair_shared.py`（幂等，会同时补齐 `skipped`）。

## 2.2 图内文字（工程图/示意图）
- 参数表/接口表/线束表之外，**安装图、接口图、接线方法图、线缆规格书**里的尺寸、孔位、针位、接线说明，转写进 `figures[]`（不是 `tables[]`）。
- **线束外观图/线束定义图默认不转写**：其针脚分配与同机型接线表重复，且工程图小字容易识读错位；一律给原图链接（`figure-policy.json` 记录降级清单与理由）。若图内其实是表（如 PORT1-6P），转进 `tables[]`。
- 字段：`sha256 / file / src / section / caption / kind(drawing|diagram|photo) / title / text / confidence`。
- `text` 只抄图上印出的内容，不补单位、不翻译、不推断；看不清写 `?`；纯实物照片（只有丝印）不建 figure，留在 `skipped`。
- 同一 sha256 的图内文字按图共享，但 `section`/`caption` 用各机型自己的页面标题。
- 工具：`python3 merge_figures.py`（合并 figure-out/*.json）→ `python3 repair_shared.py`（回填并挂到 specs）。

## 3. 字段与规则
- `kind`：`param`（产品参数）| `interface`（接口定义表）| `harness`（线束定义表）| `other`（其他文本表）
- `is_table`：读后发现是照片/示意图/纯图片无表格 → `false`，并放进 `skipped`（`tables` 里可省略该图）。
- **参数表排版**：常见「分类|内容|分类|内容」4 列并排。请**折叠成 2 列**（分类|内容），按"左栏自上而下 → 右栏自上而下"的阅读顺序，不要按视觉左右交错。单元格内换行用 `\n` 保留。
- **接口/线束表**：原样保留表头与全部行；PIN 号必须逐个核对、连续（1..n），不许跳行、不许合并。若原表有"序号/线色/定义/备注"等列，全保留。
- **原文用词原样保留**："选配/标配/复用/定制版/特别版"、单位（mm/kg/inch/cd/m²/W/V/A）都不要改写。
- 看不清的字符写 `?`（不要用相似字猜）。整图模糊 → `confidence`: `low`，并在 `notes` 写原因（如"分辨率 271px，数字模糊"）。
- `caption` 字段来自网页自动化抓取，**可能错位一行**，只作参考；以图中实际标题为准。
- `params_flat` 键固定如下（表中没有的键直接省略；清单外的项不要硬塞，保留在 `tables.rows` 里）：
  `cpu, gpu, npu, ram, rom, os, screen_inch, resolution, brightness, touch, cellular, wifi, bluetooth, gnss, can, rs232, rs485, dc_output, io_output, io_input, adc_input, usb, ethernet, camera_in, speaker, mic, handset, power_input, acc_detect, protection, vibration, temp_operating, temp_storage, humidity, salt_spray, cert, connector, buttons, indicator, material`
- `size_mm` / `weight_kg` 先用任务给的 `size_mm` / `weight_text` 解析；**若参数表里的尺寸/重量与之不同，以图为准**，并在 `warnings` 里记录两个值。

## 4. 自检（写完必做）
1. `python3 -c "import json;json.load(open('<你的文件>'))"` 能解析。
2. `tables` + `skipped` 的 sha256 集合 == `manifest.json` 中该机型页面图的 sha256 集合（不许漏读、不许静默丢图）。
   > 不要拿任务 `candidates` 当预期集：分发时同一 sha256 只派给一个机型，用它校验会漏掉"共用表没有回填"。
3. 接口/线束表的 PIN 序列连续；参数表分类无缺失；`figures[]` 的 text 非空且 sha256 属于本机型页面。
4. 尺寸/重量与任务给的值比对，不一致写进 `warnings`。

## 5. 回报格式（完成后发给 lead）
```
done: batch-X
models: 5/5
tables: 18 张（param 5 / interface 7 / harness 6）
low-confidence: 1.5 的 10寸接口定义1.png（242x281，PIN 3-4 模糊）
warnings: 1.28 参数表重量 1.3kg vs 页面文字 1.3 kg 一致
```
