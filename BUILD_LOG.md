# NEStalgia 构建日志

> 目标：从零编写完整 NES 模拟器套件 —— 6502 CPU / 2C02 PPU / 2A03 APU / Mapper / 6502 汇编器 / 硬件调试器 / 自制游戏。零第三方依赖。

## 日志

### 2026-10-06 M5 主机整合
- 总线仲裁（RAM 镜像/PPU/APU/手柄/OAM DMA）、3:1 点时序、NMI 边沿注入、整机存档。
- 集成测试 8 项：颜色条/精灵场景像素断言、sprite-0 命中闭环（PPU 标志 → 6502 分支 → RAM 标记）、DMA、手柄移位寄存器、存档确定性重放。
- 调试耗时较长：测试帧数不足（初始化占约 2.5 帧）、DMA 下一步生效时序、测试侧调色板表混淆——核心零缺陷。

### 2026-10-06 M6 APU
- 双脉冲（占空比/包络/滑音/长度）、三角波（线性计数器）、噪声 LFSR、DMC（总线取样本）、4/5 步帧序列器、NESdev 混音公式。
- 修复：4 步序列末尾漏半帧 tick；DMC 重启未预取首字节。

### 2026-10-06 M7 自制游戏 STARFALL
- 完整 6502 汇编游戏：NMI 主循环、OAM DMA、LFSR 随机生成、碰撞/无敌帧/计分、APU 音效、JS 生成字库与屏幕数据。
- 重大发现：PPU 预取窗口应为 [321,337]（原写 [322,337] 导致整条背景流水线滞后 8 像素；纯色测试对此免疫，字形一上屏即暴露）。
- 游戏侧修复：LFSR 零种子不动点、NMI 忘设 frameReady、Start 边沿检测时序、分支超界蹦床 ×3。


### 2026-10-06 M8+M9 Web 前端与调试器
- 零依赖静态服务器（node:http，/core 与 /lib 直接以 ES Modules 直出核心源码，无构建步骤）。
- 播放器：60.0988Hz rAF 节拍、AudioWorklet 环形缓冲（欠发静音策略）、Gamepad API、IndexedDB 游戏库（拖拽入库/缩略图/电池 SRAM）、存档槽、按住 Backspace 的确定性倒带环（每 10 帧快照 ×180）、CRT 扫描线滤镜、截图导出。
- 调试器：实时反汇编（共享核心反汇编器）、点击行设断点+命中自动暂停、内存十六进制、图案表/命名表/OAM/调色板四个可视化画布。
- 修复：精灵图案表基址 (control&8)*0x100 → 硬件真值 $1000（此前与 CHR 生成器的同款错误互相抵消，OAM 查看器按正确基址读才暴露）；命名表查看器缩放数学；状态栏 fps/frame 实时刷新。

### 2026-10-06 M10 浏览器 E2E
- browser-use 实机验证：库→卡片→自动播放 60fps、音频零欠发、Enter/方向键真实键盘事件全链路（playerX 精确 120→240）、断点命中自动暂停（反汇编 PC 行高亮正确解码 BNE $80cc）、存档→跑 3 帧→读档逐位一致、CRT 滤镜。
- 实测发现并修复：showPlayer 尾部多余 reset 吞掉标题画面（改为进入即玩）；浏览器 IndexedDB 缓存旧版 ROM 需清除重载。

### 2026-10-06 M11 文档与发布
- README.md（架构图/快速开始/验证方法论/已知限制）+ docs/DEMO.md（5 幕演示手册，全部配真实模拟输出截图）+ 终版 tag v1.0.0。

### 2026-10-06 M12-M14 兼容性 / 画质 / 性能
- M12: Mapper 4 (MMC3) 完整实现（命令/值寄存器对、CHR 2K/1K 窗口与模式互换、PRG 模式、扫描线 IRQ 计数器），PPU 增加 onA12 扫描线钩子（dot 260），Console 仲裁 cart.irqLine；另加 mapper 11/34/66。支持阵容达 9 种 mapper（约 85% 游戏库）。MMC3 集成测试 ROM 演示了 bank 物理布局要点：代码必须放进固定的最后两个 8K bank（物理 0x1C000+）。
- M13: PPU 颜色强调位（$2001 bit5-7 → 8 组惰性调色板变体）；顺带修正精灵左裁剪位为 bit2（此前误用 bit0 与灰度位冲突）。
- M14: 新增 scripts/bench.mjs。V8 cpu-profile 实测：PPU tick 35.6% + renderPixel 15.7%、console 帧循环 10.5%、APU 12.6%、CPU 10%。优化（APU 静音通道门控上提到调用点、CPU 页跨越惩罚预计算进 opcode 表、renderPixel 局部变量/内联调色板镜像）：基线 ~400fps → ~430-445fps（±5% 方差）。结论：逐点 PPU（精度核心）占 51% 是该架构的性能地板，~430fps ≈ 7 倍实时，进一步收益需扫描线批处理重构，风险收益不成比例，保留现状。
- 附带修复：console.dmaPending 显式初始化（此前依赖 undefined>=0===false 的偶然行为）。

### 2026-10-06 M15-M18 迭代收尾
- M15: 调试器内存写入观察点（console.watchWrites 钩子 + UI 列表 + 命中显示 addr/val/PC 并自动暂停）。测试用 STARFALL 的 frameReady（colorbars 不写零页）。
- M16: 浏览器汇编工作台——汇编器迁至 src/lib/asm.mjs（浏览器可 /lib/ 直连），共享字库 src/lib/font.mjs，演示程序 src/lib/demos.mjs（HELLO/BOUNCE/INPUT，同一份代码兼作无头测试）。工作台运行实测 59fps。
- M17: WebM 录像（canvas.captureStream + 音频 MediaStreamDestination，vp9/opus 优先）。实测 2.5s → 47KB。注意：画布暂停时无帧，录像前需运行中。
- M18: 文档更新 + v1.1.0。
- E2E 实测记录：调试器观察点命中 $00←$AF（球的 x）并自动暂停；MediaRecorder 0 字节的假故障是测试自身先把游戏暂停了。

### 2026-10-07 Code review 修复（v1.1.1）
- 评审发现并修复 4+6 项（详见当轮 code review）：
  - P1 手柄松开不清除输入（keys 只 OR 不清零）→ 拆分 kbKeys/padBits，每帧重算合并掩码，手柄断开即释放；
  - P1 Backspace 倒带无法停止（keyup 未路由到 handleSpecial）→ keyup 同样路由，rewinding 正确复位；
  - P2 工作台 ROM 下存档/读档按钮崩溃（currentRom 为 null）→ 加守卫与提示；
  - P2 游戏库 ROM 名未转义（存储型 XSS）→ esc() 转义；
  - P3 render() 每帧分配 Uint32Array → 缓存视图；工作台 ROM 观察点接线缺失 → attach()；标签页切走后暂停按钮标签过期 → onPauseUi 统一同步；CNROM CHR bank 掩 2 位 → 4 位+模环绕；
  - P4 死代码清除（suppressVbl/shiftBG/NEScolor）、音频块零拷贝转移、toState 帧边界前置条件注释、MMC1 PRG-RAM 简化入文档。
- 测试基建：harness 支持异步用例；新增 server 防路径穿越回归测试与镜像地址观察点测试。119 项全绿。

### 2026-10-07 第二轮自主 code review 修复(v1.1.2)
- 评审方法:通读核心 5 文件 + 全部前端/脚本,Node 直跑核心复现周期类问题,真实浏览器验证输入捕获与服务端遍历。发现 5+5 项,逐条修复:
  - P1 键盘捕获吞编辑器输入:player 的 window 级 keydown 对 KEYMAP 命中键无条件 preventDefault,工作台编辑器打不出 x/z/j/k、换不了行(实测 7 键被吞);运行过 ROM 后 Backspace 触发倒带、P 误触暂停。修复:keydown 对可编辑目标(input/textarea/select/contentEditable)放行;keyup 保留不守卫,防止按住时切焦点导致卡键。浏览器复验:编辑区全放行、游戏区热键照常捕获、无卡键。
  - P2 server 路径检查缺分隔符:`startsWith(normalize(base))` 会放行前缀同名兄弟目录(实测 `/js/..%2f..%2fpublic-notes%2fsecret.txt` 返回 TOPSECRET)。修复:要求 `base + sep` 前缀;404 不再回显含绝对路径的 e.message;回归测试真实创建 public-notes/ 复现两条向量。
  - P2 音频采样率失配:APU 产样 47100/s vs 设备 48000/s,缺口 ~900 样本/s,16384 环形缓冲 ~18s 耗尽后周期性欠载。修复:AudioContext 固定 `sampleRate: 47100`(拒绝非标速率时回退),浏览器实测 ctx.sampleRate=47100。
  - P2 观察点越过 reset 失效:reset() 重建 watchWrites 并清 onWatchHit,调试器 attach 的 Set 被孤儿化(实测引用不等)。修复:reset 不再触碰这两个钩子;新增回归测试。
  - P3 非法 RMW (d),y 周期:SLO/RLA/SRE/RRA/DCP/ISB 的 0x13/33/53/73/D3/F3 实测跨页 9 周期,真机固定 8。修复:惩罚表中该 6 项置 false;对照组 LAX (d),y 跨页 6 周期不变。
  - P3 存档状态瘦身:apu.toState 剔除 8192 浮点 sampleBuf/头尾指针(倒带环 180 份 × 每份 8192 数组的内存浪费);播放环跨存档保持活性。
  - P3 DMA 精度与卫生:OAM DMA 改为 513/514 周期(奇时钟对齐周期,反馈进 cpu.cycles 保持相位自洽);DMA/DMC 总线取数走新的 console.dmaRead——$2000-$3FFF 段不再误触 $2002 清 vblank。
  - 小项:pushAudio 复用暂存缓冲、worklet 欠载消息按持续段节流、cpu.halted 死字段、调试器断点标注"每帧末检查 PC"。
- 基准不变(~430-460fps);测试 119 → 135 项全绿;package.json 版本与 tag 同步。
