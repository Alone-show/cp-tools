> **合并后说明（2026-11-09）**：本文件是合并前的详细说明，保留作为子插件文档。
> 包名已改为 `@local/cp-tools`，入口为 `@local/cp-tools/{docs,firmware,cpservice}`；
> 源码路径已移到 `src/<子插件>/`，固定流程改用 `scripts/` 下的脚本。安装与总览见根 `README.md`。

# cp-docs

DSH（DeepSeek Harness）插件：**只用一个斜杠命令 `/cp-docs` + 自然语言**，先做机型归一；**命中机型后把该机型全部本地资料整包返回**（参数 / 全部接口与线束表 / 图内文字 / 编程节点 / 硬件工作点），由模型自行定位作答。

```
/cp-docs SPRING2PRO 的屏幕尺寸是多少
/cp-docs SPRING2PRO 的 RS232 引脚在第几脚
/cp-docs APOLLO2 12PRO 的工作温度范围
/cp-docs CP023 的 INPUT1 接到哪个 GPIO
/cp-docs APOLLO 7 PRO 的 RS485 设备节点
/cp-docs 支持哪些机型
```

- **触发方式**：只有用户手动输入 `/cp-docs ...` 才会执行。插件不注册模型工具，模型无法自行发起检索。
- **检索链路**：100% 读本地数据，不联网、不需要登录。
- **输出**：命令把「问题 + 该机型全部资料 + 出处」作为一条**上下文消息**推给会话（`source.kind = cp-docs`）——对话框里只显示一行默认折叠的卡片，点开可见全文；模型拿到的仍是整包资料（数值不会被改写）。

## 功能

| 类别 | 示例问法 |
|---|---|
| 产品参数 | 屏幕尺寸 / 分辨率 / 亮度 / CPU / 内存 / 存储 / 系统 / 4G / WiFi / 蓝牙 / GNSS / CAN / RS232 / RS485 / USB / 网口 / 摄像头 / 电源 / 防护等级 / 工作温度 / 整机尺寸 / 重量 |
| 接口定义表 | `26P 接口第 5 脚是什么` / `RS232 的引脚在哪个位置` |
| 线束定义表 | `摄像头航空插座线束` |
| 编程节点 | `RS485 设备节点` → `/dev/ttyWK1` |
| 硬件工作点 | `INPUT1 接到哪个 GPIO` → `[MCU] PC0` |
| 图内文字 | `APOLLO 7 PRO 的安装孔距` → `4*M5，38.00 / 30.00`（安装图识读） |
| 机型目录 | `支持哪些机型` |

命中机型后命令不再挑选“该问题对应的那一条”，而是把该机型的参数、全部表格、编程节点、工作点一起交给模型，因此**自然问法不会再因为词表没覆盖而漏检**（例如「RS232 的引脚在哪个位置」）。

机型归一移植自 [`@local/firmware-finder`](https://github.com/Alone-show/firmware-finder)，支持业务写法与省略尺寸段：

| 输入 | 结果 |
|---|---|
| `SPRING2PRO` / `SP2-10PRO` / `RK / SPRING2-10PRO` / `CP023-SPRING2 10PRO` | 1.23 SPRING 10 PRO 二代 |
| `APOLLO2 12PRO` | 1.13 APOLLO 12 PRO |
| `SPRING2` | 不唯一 → 返回候选，不硬猜 |
| `APOLLO X` | 1.5（精确名优先，不被 `APOLLO 12X` 的 gap 命中拖成歧义） |

歧义时命令直接列出候选（不触发模型）；只有整包资料完全相同的机型才会合并作答；整包中确实没有的项，回答“资料中未收录”，不推断。

### 改造前后对比

| | v0.1.0（旧） | v0.2.0 / v0.2.1（当前） |
|---|---|---|
| 命中机型后 | 先判意图，只取字段/少量表行（≤12 行） | 整包返回参数 + 全部表格 + 图内文字 + 编程节点 + 工作点 |
| 「RS232 的引脚在哪个位置」 | 720 字符报文，只有 `RS232*2` → 答“文档未收录” | 11.5k 字符报文，26PIN 表完整 → 答 PIN 14/20/17/24 |
| 单机型报文体量 | 620–2,047 字符 | 5,074–17,408 字符（均值 9,220） |
| 对话框呈现 | 一条用户消息（简短） | v0.2.0 用户气泡整段展开；**v0.2.1 起改为默认折叠的上下文卡片**（点开可见全文） |

完整对照（逐条前后报文、缺陷映射、代价）见 [`docs/改造前后对比.md`](docs/改造前后对比.md)，原始报文留档在 `docs/baseline/`（旧）与 `docs/after/`（新）。

## 在 DSH Web 中安装

> **不需要先 clone**：直接把 git 地址填进 Web 的「添加插件」即可。插件以 Cordis bundle 安装，安装过程会请求一次审批。

### 方式 1：Web 界面填地址（最快，推荐）

1. 打开 DSH Web，点左侧边栏的 **「插件」**（Plugins）
2. 点 **「添加插件」**
3. 在「包名或地址」输入框里填：

   ```
   github:Alone-show/cp-docs
   ```

   也可以填完整地址 `https://github.com/Alone-show/cp-docs`
4. 点 **安装** → 通过一次审批 → 显示「已安装」
5. 回到对话输入框试：

   ```
   /cp-docs 支持哪些机型
   /cp-docs SPRING2PRO 的屏幕尺寸
   ```

> 输入框说明是「包名或地址」，支持 npm 包名、GitHub 仓库地址、本地目录路径三种。

### 方式 2：在对话里让助手安装

说一句：

```
把 github:Alone-show/cp-docs 装成插件
```

助手会调用（等价操作）：

```
plugin_manager
  action: install_bundle
  target: github:Alone-show/cp-docs
```

安装成功后返回 `application: "applied"`，命令立即可用（命令列表没刷新就刷新一次页面）。

### 方式 3：从插件市场索引安装（可发现、可更新）

本仓库自带插件市场索引 `index.json`：

1. 打开 DSH Web 的 **「发现」**（Discover）
2. 点 **「管理索引源」** → 添加索引 URL：

   ```
   https://raw.githubusercontent.com/Alone-show/cp-docs/main/index.json
   ```

3. 在发现页搜 `cp-docs` → 安装

### 方式 4：本地目录（开发插件时用）

改代码或调试时用本地 link 安装：

```bash
git clone https://github.com/Alone-show/cp-docs.git ~/.dsh/plugins/cp-tools
```

然后在对话里让助手执行 `plugin_manager install_bundle target=/home/<你>/.dsh/plugins/cp-tools`。
link 安装指向源码目录，`git pull` 或改代码后**重启 DSH Web** 生效。

### 安装之后

- **数据**：仓库自带 `data/`（28 机型，约 1.1MB）。**首次执行 `/cp-docs` 时**自动复制到当前会话工作区的 `.cpdocs/`，之后只读它。
  - 换数据目录：`DSH_CPDOCS_DIR=/path/to/.cpdocs`
  - 用自己的源资料重建：`node <.dsh/plugins/cp-tools>/scripts/import-docs.mjs`
- **更新**：插件页对该插件点「更新」（或卸载后按上面任一方式重装）。git 安装的代码在 profile 的 `node_modules` 里，不要直接改。
- **卸载**：插件页点卸载；或对话里 `plugin_manager action: remove_bundle target: @local/cp-tools/docs`。

### 验证清单

| 命令 | 预期 |
|---|---|
| `/cp-docs 支持哪些机型` | 28 款机型清单 |
| `/cp-docs SPRING2PRO 的屏幕尺寸` | 10.1 英寸（1024*600px） |
| `/cp-docs SPRING2PRO 的 RS232 引脚在哪个位置` | 26PIN 表：PIN 14 / 20（A）、17 / 24（B） |
| `/cp-docs SPRING2 屏幕尺寸` | 列候选（1.21/1.23/1.25） |
| `/cp-docs CP023 的 INPUT1 接到哪个 GPIO` | 列候选（CP023 对应 1.23/1.25，整包不同不合并） |

## 工作原理

```
/cp-docs <自然语言>
   ↓ 命令 handler（确定性、离线）
1. 从整句切出机型串（句首/句中、带"的"、省略尺寸段都能切）
2. 机型归一：canonModel / queryCores / gapScore / scoreCore / resolveModel
3. 读该机型全部本地资料：spec.json（参数+全部表格）/ programming.json / workpoints.json
4. renderPacket() 渲染整包 → agent.followup() 推给会话
   ↓
5. 模型在整包里自行定位答案（引用表名/章节；整包没有的才说未收录）
```

数据目录（自动生成到会话工作区）：

```
.cpdocs/
├── models.json          # 28 机型 + cores + 别名 + CP 编码
├── fields.json          # 字段字典（中文同义词）
└── models/<id>/
    ├── spec.json        # params_flat + 表格行 + figures 图内文字 + 图片来源
    ├── programming.json # 编程节点
    ├── workpoints.json  # 硬件工作点
    └── doc.md           # 可读版
```

## 资料（materials/）

`materials/` 是 AI 可读版资料的发布副本，随包提供，不参与运行：

| 文件 | 内容 |
| --- | --- |
| `28-models.md` | 28 机型主文档（参数速查 + 表格 + 图内文字 + 原图链接） |
| `spec.json` / `specs/` | 机器可读全量结构与单机型结果 |
| `spec-matrix.csv` | 跨机型参数矩阵 |
| `figure-texts.json` | 42 张工程图/示意图的图内文字（按 sha256） |
| `figure-policy.json` | 降级清单：22 张线束外观图只留原图链接（与接线表重复），2 张 6P 图转为表格 |
| `manifest.json` | 页面图清单（360 条引用 / 177 张唯一图） |
| `issues.md` / `CONTRACT.md` | 待核对清单与转写契约 |

含 177 张原图和离线页面的完整压缩包见 [Release v0.2.3](https://github.com/Alone-show/cp-docs/releases/tag/v0.2.3) 资产 `cp-device-docs-ai-readable-20261028.zip`。

## 开发

```bash
cd cp-docs
node --test test/*.test.mjs     # 23 个单测：机型归一/解析/整包渲染/命令/路径
node scripts/import-docs.mjs              # 从 work/cpdoc/ai-readable 重建 data/
```

- 机型别名：`scripts/import-docs.mjs` 顶部 `ALIASES` / `CP_CODES`
- 字段中文名：`lib/fields.js`（渲染整包时的参数标签）
- 命令入口：`index.js`；整包渲染：`lib/packet.js`；候选/目录：`lib/framing.js`
- 改造对照：`docs/改造前后对比.md`（原始报文在 `docs/baseline/` 与 `docs/after/`）

## 说明

- 数据来自产品文档（图片表格经视觉模型转写 + 人工抽检）。图文冲突（如个别机型尺寸/重量在页面文字与参数表不一致）在 `spec.json` 的 `warnings` 里保留双值，回答时会同时给出。
- 只覆盖这 28 款机型；资料里没有的机型/字段会明确说明，不做推断。
