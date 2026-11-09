# 1.7 APOLLO 7A 二代

**系列**：APOLLO 二代 ｜ **尺寸**：200*134*32.52 mm ｜ **重量**：0.69 kg

**简介**：高端坚固型车载平板，行业首创防眩晕全面屏，线束和SPRING2系列共用可和SPRING2机型无缝切换，方便客户操作。支持2路经典CAN，支持2路RS232，支持1路RS485，支持2路ADC_IN检测（选配），最大输入电压12V，支持2路DC_OUPUT，支持2路IO_INPUT输入，支持AHD摄像头*2，广泛应用于农业机械自动化，工程机械自动化，人机交互等。

### 关键参数速查

| 字段 | 值 |
| --- | --- |
| CPU | 4核，2.0GHz |
| 内存 | 2G RAM，支持最高8G |
| 存储 | 16G ROM，支持最高256G |
| 操作系统 | Android 11.0<br>Linux 5.10，Qt 5.15 |
| 屏幕尺寸(inch) | 7 |
| 分辨率 | 1024*600px |
| 亮度 | 750cd/m² |
| 触摸 | 电容触摸显示屏，支持5指触控 |
| 蜂窝网络 | 4G / 5G |
| WiFi | WIFI 802.11a/b/g/n/ac，2.4G/5G |
| 蓝牙 | BT 4.2 |
| GNSS | （可选配米级 / 亚米级 / 厘米级定位板卡） |
| CAN | 支持2路CAN |
| RS232 | 支持2路RS232 |
| RS485 | 支持1路RS485 |
| DC输出 | 支持2路DC_OUPUT输出，12V，每路电流最大2A。 |
| IO输入 | 支持2路INPUT输入 |
| ADC输入 | 支持2路ADC_IN检测，最大输入电压12V （选配功能，1路与1PPS复用，1路与INPUT2复用） |
| 摄像头输入 | 支持2路AHD摄像头 |
| 麦克风 | 麦克风*1 |
| 电源输入 | 电源 5-36V 直流输入 |
| ACC检测 | 开机打火 ACC 状态检测 |
| 防护等级 | IP67 |
| 震动标准 | MIL-STD-810 |
| 工作温度 | -30℃~+70℃ |
| 存储温度 | -40℃~ +85℃ |
| 湿度 | 0% - 90%RH |
| 盐雾 | 整机盐雾48小时 |
| 连接器 | 26PIN 连接器*1<br>SMA 接头*1<br>TNC 接头*1<br>USB2.0*1 |
| 功能按键 | 电源开关键*1，自定义功能按键*1 |

### 产品参数｜3.1 产品参数
*图3.1 配置信息*

| 分类 | 内容 |
| --- | --- |
| 系统 | 4核，2.0GHz<br>2G RAM，支持最高8G<br>16G ROM，支持最高256G<br>Android 11.0<br>Linux 5.10，Qt 5.15 |
| 通讯和接口 | 4G / 5G<br>WIFI 802.11a/b/g/n/ac，2.4G/5G<br>BT 4.2<br>GNSS（可选配米级 / 亚米级 / 厘米级定位板卡）<br>外部接口（26P） //支持电源输入：B+/B-/ACC<br>//支持2路CAN，支持2路RS232，支持1路RS485<br>//支持2路ADC_IN检测，最大输入电压12V （选配功能，1路与1PPS复用，1路与INPUT2复用）<br>//支持2路DC_OUPUT输出，12V，每路电流最大2A。<br>//支持2路INPUT输入<br>//支持2路AHD摄像头<br>支持 CP ISOBUS VT |
| 环境参数 | 防护等级：IP67<br>震动：MIL-STD-810<br>道路车辆标准：ISO16750<br>工作温度：-30℃~+70℃，湿度：0% - 90%RH<br>存储温度：-40℃~ +85℃<br>盐雾：整机盐雾48小时 |
| 功能按键 | 电源开关键*1，自定义功能按键*1 |
| 显示 | 7" 电容触摸显示屏，支持5指触控<br>分辨率：1024*600px<br>亮度：750cd/m²<br>强光下防眩晕显示屏 |
| 影音和传感 | AHD 摄像头 720p*2 / 1080p*2<br>麦克风*1<br>G-Sensor*1 |
| 电源管理 | 电源 5-36V 直流输入<br>开机打火 ACC 状态检测<br>供电电源电压检测<br>过流过压欠压，防反接保护 |
| 连接器 | 26PIN 连接器*1<br>SMA 接头*1<br>TNC 接头*1<br>USB2.0*1 |
| 规格 | 尺寸(W*H*D)：200*134*32.52mm<br>重量：0.69kg |
| 灯靶 | 支持1路灯靶，16个 LED |

> 注：原图为「分类|内容|分类|内容」4 列并排，已按左栏自上而下→右栏自上而下折叠为 2 列。

> 原图：https://mdmobs.cpuniverse.cn/gitbook/01-%E4%BA%A7%E5%93%81%E4%BB%8B%E7%BB%8D/%E5%8F%82%E6%95%B0%E8%A1%A8/APOLLO%207A.png

### 接口定义｜3.2 接口定义
*图3.2.2 26P接口定义表*

| 安费诺-26P | PIN定义 | 安费诺-26P | PIN定义 |
| --- | --- | --- | --- |
| 1 | B+ | 14 | RS232_A_TX |
| 2 | B- | 15 | INPUT2(DIH-高有效)/ADC_IN2/CAMERA_2 |
| 3 | ACC | 16 | CAMERA_1 |
| 4 | CAN1_H | 17 | RS232_B_RX/MIC_P(手麦咪头) |
| 5 | CAN1_L | 18 | PHY_MDI_1-/NC |
| 6 | OUTPUT1 | 19 | PHY_MDI_0-/NC |
| 7 | OUTPUT2/SPKN(手麦喇叭) | 20 | RS232_A_RX |
| 8 | GND | 21 | INPUT1(DIH-高有效)/INPUT1(DIL-低有效)PTT(手麦按键) |
| 9 | RS485-A | 22 | CAMERA_0 |
| 10 | RS485-B | 23 | CAMERA_12V |
| 11 | CAN2_H | 24 | RS232_B_TX/MIC_N(手麦咪头) |
| 12 | CAN2_L | 25 | PHY_MDI_1+/NC |
| 13 | NC/ADC_IN1/1PPS/SPKP(手麦喇叭)//CAMERA_3 | 26 | PHY_MDI_0+/NC |

> 注：表标题为「APOLLO2 7A/12A/12A特别版 26P接口定义」。表格下方备注原文逐条抄录：1. PIN18,19,25,26为兼容设计的百兆以太网接口，默认百兆以太网，如需要千兆以太网可从M12航插引出。2. 支持选配手麦功能，需要牺牲OUTPUT2,RS232,INPUT1功能。3. 支持4路摄像头，需要牺牲INPUT2, ADC和手麦功能。4. INTPU1有两种属性，DIH-高有效，和DIL-低有效，默认DIH-高有效。（原文即写作 INTPU1）

> 原图：https://mdmobs.cpuniverse.cn/gitbook/01-%E4%BA%A7%E5%93%81%E4%BB%8B%E7%BB%8D/APOLLO%207A/APOLLO2%207A%E6%8E%A5%E5%8F%A3%E5%AE%9A%E4%B9%89.png

### 接口定义｜3.2 接口定义
*图3.2.3 M12以太网接口定义表*

| PIN 脚 | 定义 |
| --- | --- |
| 1 | PHY_MDI_0+ |
| 2 | PHY_MDI_0- |
| 3 | PHY_MDI_1+ |
| 4 | PHY_MDI_1- |
| 5 | PHY_MDI_3+ |
| 6 | PHY_MDI_3- |
| 7 | PHY_MDI_2- |
| 8 | PHY_MDI_2+ |

> 注：同图转写（原归属 1.6 APOLLO 7 二代；原表：图3.2.3 M12以太网接口定义表）

> 原图：https://mdmobs.cpuniverse.cn/gitbook/01-%E4%BA%A7%E5%93%81%E4%BB%8B%E7%BB%8D/APOLLO2%2012/APOLLO2%20M12%E4%BB%A5%E5%A4%AA%E7%BD%91%E6%8E%A5%E5%8F%A3%E5%AE%9A%E4%B9%89.png

### 线束定义｜4.1.1
*图4.1.2 接线表*

| TE-26P | PIN定义 | 线径 | 线贴纸 | 线颜色 | M1_2P(AUDIO_OUT) | M2_4P(CAMERA_0) | M3_4P(CAMERA_1) | 网口（RJ45） | M4_4P(IO INPUT) | M5_3P(POWER) | DB9A （公头） | DB9B （公头） | DB9C(公头) | M6_4P (DC OUTPUT) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | B+ | 18# | B+ | 黑白色 |  |  |  |  |  | 2 |  |  |  |  |
| 2 | B− | 18# | B− | 黑灰色 |  |  |  |  |  | 3 |  |  |  |  |
| 3 | ACC | 18# | ACC | 黑紫色 |  |  |  |  |  | 1 |  |  |  |  |
| 4 | CAN1_H | 24# | CAN1_H | 黑蓝色 |  |  |  |  |  |  |  |  | 9/6 对绞线 |  |
| 5 | CAN1_L | 24# | CAN1_L | 黑绿色 |  |  |  |  |  |  |  |  |  |  |
| 6 | OUTPUT1 | 18# | OUTPUT1 | 黑色 |  |  |  |  |  |  |  |  |  | 2 |
| 7 | OUTPUT2 | 18# | OUTPUT2 | 黄色 | 1 |  |  |  |  |  |  |  |  | 3 |
| 8 | GND | 18# | GND | 白色 | 2 | 2 | 2 |  | 1-2 |  | 5 | 5 | 5 | 1 |
| 9 | RS485_A | 24# | RS485_A | 灰色 |  |  |  |  |  |  |  |  | 3/2 对绞线 |  |
| 10 | RS485_B | 24# | RS485_B | 紫色 |  |  |  |  |  |  |  |  |  |  |
| 11 | CAN2-H | 24# | CAN2-H | 蓝色 |  |  |  |  |  |  |  |  | 7/1 对绞线 |  |
| 12 | CAN2-L | 24# | CAN2-L | 绿色 |  |  |  |  |  |  |  |  |  |  |
| 13 | OUTPUT3 | 18# | OUTPUT3 | 红色 |  |  |  |  |  |  |  |  |  | 4 |
| 14 | RS232_TX1 | 24# | RS232_TX1 | 棕色 |  |  |  |  |  |  | 3（2/3对绞） |  |  |  |
| 15 | INPUT2 | 24# | INPUT2 | 粉红色 |  |  |  |  | 4 |  |  |  |  |  |
| 16 | CAMERA_1 | 24# | CAMERA_1 | 黑黄色 |  |  | 4 |  |  |  |  |  |  |  |
| 17 | RS232_RX2 | 24# | RS232_RX2 | 黑粉红色 |  |  |  |  |  |  |  | 2（2/3对绞） |  |  |
| 18 | RJ45 TX- | 24# | RJ45 TX- | 浅白色 |  |  |  | 2(1和2对绞) |  |  |  |  |  |  |
| 19 | RJ45_RX- | 24# | RJ45_RX- | 浅白色 |  |  |  | 6（3和6对绞） |  |  |  |  |  |  |
| 20 | RS232_RX1 | 24# | RS232_RX1 | 黑棕色 |  |  |  |  |  |  | 2（2/3对绞） |  |  |  |
| 21 | INPUT1 | 24# | INPUT1 | 黑色 |  |  |  |  | 3 |  |  |  |  |  |
| 22 | CAMERA_0 | 24# | CAMERA_0 | 浅白色 |  | 4 |  |  |  |  |  |  |  |  |
| 23 | CAMERA_PWR | 24# | CAMERA_PWR | 浅白色 |  | 1 | 1 |  |  |  |  |  |  |  |
| 24 | RS232_TX2 | 24# | RS232_TX2 | 浅白色 |  |  |  |  |  |  |  | 3（2/3对绞） |  |  |
| 25 | RJ45_TX+ | 24# | RJ45_TX+ | 黑色 |  |  |  | 1(1和2对绞) |  |  |  |  |  |  |
| 26 | RJ45_RX+ | 24# | RJ45_RX+ | 浅白色 |  |  |  | 3（3和6对绞） |  |  |  |  |  |  |

> 注：表中「x/y 对绞线」为纵向合并单元格：DB9C 列「9/6 对绞线」跨 PIN4-5、「3/2 对绞线」跨 PIN9-10、「7/1 对绞线」跨 PIN11-12；转写时记在合并区首行，续行留空。

> 原图：https://mdmobs.cpuniverse.cn/gitbook/01-%E4%BA%A7%E5%93%81%E4%BB%8B%E7%BB%8D/spring_10/spring2/%E6%8E%A5%E7%BA%BF%E8%A1%A8.png

### 图内文字（3 张）

#### 图3.2.1 接口图（3.2 接口定义）

接口/针脚：插座 左侧 1、8、14、20；右侧 7、13、19、26；13 针旁标 A  
接口/针脚：M12 Ethernet connector：1、2、3、4、5、6、7、8  

> 原图：https://mdmobs.cpuniverse.cn/gitbook/01-%E4%BA%A7%E5%93%81%E4%BB%8B%E7%BB%8D/APOLLO2%2012/12%E5%AF%B8%E6%8E%A5%E5%8F%A3%E5%9B%BE.png

#### 图4.1.3 M12以太网线束（4.1.3）
**图名**：CUSTOMER DRAWING（M12 X-CODE MALE TO RJ45 CABLE ASSEMBLY）

产品尺寸：LENGTH M(Meters)；53MM；44.5MM；M12*1；TOLERANCE 0-2.99 M = +100.0/-25.0mm；3-8.99 M = +150.0/-25.0mm；9-14.99 M = +300.0/-25.0mm；15-OVER M = +450.0/-25.0mm  
接口/针脚：P1 CONNECTOR: M12 X-CODE MALE（FACE VIEW 1 2 3 4 5 6 7 8）；P2 RJ45 MALE 8Pin（FACE VIEW 1 2 3 4 5 6 7 8）；WIRING DIAGRAM P1 1 2 3 4 5 6 7 8 —— P2 1 2 3 4 5 6 7 8，SHIELD，shell，TWIST PAIR  
线序：white-orange、orange、white-green、green、white-brown、brown、white-blue、blue  
备注：TPU BLACK OVERMOLD；CABLE,CAT6A 24AWG*4P,GREEN TPU JACKET  
Technical data: Ethernet cable assembly;M12 X-CODED 8-position to RJ45; CAT6A,S/FTP 4x2xAWG26,TPU;360° shielded, Plug Straight. Materials: Male Contact: Brass,Ni/Au plated；Shielding shell: Brass, Cu/Ni plated；Male plastic housing: PA66,black；Coupling nut: Brass, Cu/Ni plated；Cable: TPU blue；PLUG:RJ45  
Specifications: Rated current at 40℃: 0.5A；Rated voltage: 50V AC / 60V DC；Withstand voltages: 300V；Contact resistance: < 5 mΩ；Insulation resistance: Length 0~20M >100MΩ;Length 20~40M >20MΩ；Signal type: Ethernet CAT6A, 10 Gbps；Standards: M12 connector for IEC 61076-2-109；Protection:IP67(M12)；Operation temperature: -40 ℃~80 ℃；Storage conditions: Temperature 25±3℃; Humidity 35%~70%；RoHS conformity: Yes  
P/N NOTE: P82112-Mxxx；Mx INDICATES THE HARNESS LENGTH L；FOR EXAMPLE: M005,EXPRESS: L=0.5 M；M010,EXPRESS: L=1 M；M100,EXPRESS: L=10 M  
图号/版本：DWG NO. P82112-Mxxx；SIZE A4；SCALE NONE；REV 01；SHEET 1 OF 1；REVISIONS 01 NEW DRAWING 25May24 Jode Tommy  
Amphinol；Sine Systems；44724 Marley Drive；Clinton Township, MI 48036  

> 原图：https://mdmobs.cpuniverse.cn/gitbook/01-%E4%BA%A7%E5%93%81%E4%BB%8B%E7%BB%8D/APOLLO2%2012/APOLLO2%20M12%E4%BB%A5%E5%A4%AA%E7%BD%91%E7%BA%BF%E6%9D%9F.png

#### 图2.1.1 正面图（5 安装方式）
**图名**：APOLLO2 7PRO　RAM 安装指导

产品尺寸  
产品尺寸：200.00、134.00、176.53、32.56、40.77  
安装孔：4*M5、38.00、30.00  
RAM 支架安装说明  
① 逆时针旋转支架把手，取出其中一个支架底座。  
② 箭头所示的为固定孔位，请选择其中一种安装方案。（或）  
③ 箭头所示的位置为产品背面与RAM支架固定位置。  
④ 将RAM支架底座序号与产品背部序号一一对应，使用螺丝紧固后。再放回RAM支架原位置，顺时针旋转支架把手，完成安装。  
标注：RAM 支架、RAM 支架底座、A  
备注：1.本版所示图形与实物可能有差异，请以实物为参考。  
备注：2.本版说明书仅限所述产品与RAM-101U系列支架组装，请根据实际需求安装。  
扭矩:2N.m　M5x10*4PCS  
深圳从平技术有限公司  

> 原图：https://mdmobs.cpuniverse.cn/gitbook/01-%E4%BA%A7%E5%93%81%E4%BB%8B%E7%BB%8D/spring_7/APOLLO2%207%E5%AE%89%E8%A3%85%E6%8C%87%E5%AF%BC.png

### 未转写的图片（无图内文字，见原图）

- 外观图｜图2.1.1 正面图：非表格，见原图：https://mdmobs.cpuniverse.cn/gitbook/01-%E4%BA%A7%E5%93%81%E4%BB%8B%E7%BB%8D/spring_10/%E6%AD%A3%E9%9D%A2%E5%9B%BE.png
- 外观图｜图2.1.2 背面图：非表格，见原图：https://mdmobs.cpuniverse.cn/gitbook/01-%E4%BA%A7%E5%93%81%E4%BB%8B%E7%BB%8D/spring_10/%E5%8F%8D%E9%9D%A2%E5%9B%BE.png
- 线束外观图｜图4.1.1 线束定义：非表格/无图内文字，见原图：https://mdmobs.cpuniverse.cn/gitbook/01-%E4%BA%A7%E5%93%81%E4%BB%8B%E7%BB%8D/spring_10/spring2/%E7%BA%BF%E6%9D%9F.png

### 数据提示

- 参数表「规格」与任务字段一致：尺寸 200*134*32.52mm、重量 0.69kg，无差异。
- 1.7 的线束外观图（fc6b9b9b…）与接线表（c4a0a94a…）src 指向 spring_10/spring2 目录，与 intro 中「线束和SPRING2系列共用」一致。
- 补齐共用表 1 张（同图转写，原归属见各表注）
- 补录图内文字 4 张（自动识读，? 处需核对原图）
