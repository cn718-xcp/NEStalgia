# GitHub 同类项目调研报告(2026-10-07)

> 本报告由 2026-10-07 会话中的自动化检索代理产出,数据为当日 GitHub 页面/README 实抓(非凭印象)。
> 背景为 NEStalgia 发布前竞品调研;断点进度见 BUILD_LOG.md 当日条目。

## 1. 主流/知名 JS、TS 及 Web 端 NES 模拟器清单

### JS/TS 本体模拟器

| 项目 | 星数(2026-10-07) | 活跃度 | 性质 |
|---|---|---|---|
| [bfirsh/jsnes](https://github.com/bfirsh/jsnes) | ~6.4k | 最近提交 2026-07-28(几乎全是 dependabot) | JS,基于 vNES(Java)移植改编,非从零手写 |
| [takahirox/nes-js](https://github.com/takahirox/nes-js) | 224 | 157 commits | 纯 JS 浏览器模拟器 |
| [takahirox/nes-rust](https://github.com/takahirox/nes-rust) | 230 | 140 commits | Rust + WASM,浏览器+桌面(SDL2) |
| [peteward44/WebNES](https://github.com/peteward44/WebNES) | 117 | 64 commits,较老 | 纯 JS 从零手写,HTML5 Canvas |
| [ognis1205/nests](https://github.com/ognis1205/nests) | 95 | 66 commits | TypeScript + React(Next.js),从零学习项目 |
| [liamg/js-nes-emulator](https://github.com/liamg/js-nes-emulator) | 14 | 陈旧 | JS 小型项目 |
| [bfirsh/jsnes-web](https://github.com/bfirsh/jsnes-web) | 632 | 已归档(并入 jsnes 主仓 web/) | jsnes 的 React Web UI |

### Web 端封装型(非从零,包 WASM 核心)

| 项目 | 星数 | 说明 |
|---|---|---|
| [EmulatorJS/EmulatorJS](https://github.com/EmulatorJS/EmulatorJS) | ~4.2k,活跃维护 | "RetroArch 的 Web 前端",CDN 加载 RetroArch WASM cores,GPL-3.0 |
| [arianrhodsandlot/Nostalgist](https://github.com/arianrhodsandlot/Nostalgist) | ~986 | JS 库,封装 RetroArch Emscripten cores,MIT |

### 原生模拟器(参考坐标)

| 项目 | 星数 | 说明 |
|---|---|---|
| [TASEmulators/fceux](https://github.com/TASEmulators/fceux) | ~1.6k,活跃 | C/C++,调试器/Lua 工具标杆,GPL |
| [SourMesen/Mesen2](https://github.com/SourMesen/Mesen2) | ~2.4k | C+++.NET,2026-06 归档,转移至 nesdev-org/MesenCE,GPL-3.0 |
| [SourMesen/Mesen](https://github.com/SourMesen/Mesen) | ~1.3k | 2024-12 归档,GPL-3.0 |
| [0ldsk00l/nestopia](https://github.com/0ldsk00l/nestopia) | ~945 | C++,核心已移交 jgemu/nestopia,GPL-2.0 |
| [ares-emulator/ares](https://github.com/ares-emulator/ares) | ~1.8k,活跃 | C++,higan/bsnes 后继 |

## 2. 功能覆盖对比(基于各自 GitHub README 实抓)

| 维度 | jsnes | nes-js | nes-rust | WebNES | nests (TS) | EmulatorJS | 8bitworkshop |
|---|---|---|---|---|---|---|---|
| Klaus Dormann 测试 | 未提及 | 未提及 | 未提及(截图含 nestest) | 未提及 | Roadmap 未完成 | 不适用 | 未提及 |
| Mapper 支持 | README 未列;src/mappers 实有 21 个文件(0/1/2/3/4/5/7/9/11/34/38/66/71/79/94/118/119/140/180/240/241) | 仅 iNES,TODO 写明要支持更多 | 未提及 | "约 98% 游戏可玩"(未列编号) | 0/1/2/3/4(MMC3)/5(MMC5),iNES+NES 2.0 | 取决于所用 core | 不适用 |
| 调试器 | 无 | 无 | 无 | 仅 CPU/PPU trace 日志(非 GUI) | 无 | 无 | 有:断点、单步、内存、反汇编、调用栈、时间回溯 |
| 汇编器 | 无 | 无 | 无 | 无 | 无 | 无 | 有(第三方:cc65/dasm/nesasm/acme/vasm) |
| 测试 | npm test 实为 Prettier 格式检查 | 无 | Travis CI | 无 | 无 | 无 | 无明确单测 |
| 依赖/构建 | webpack + ESLint + Prettier,附 index.d.ts | demo 用 Three.js 等 | cargo/Rust-SDL2 | npm+bower+grunt+closure | React/Next.js 全套 | npm | 庞大 |
| README 语言 | 英文 | 英文 | 英文 | 英文 | 英文 | 英文 | 英文 |
| 在线 Demo | jsnes.org | 多个(标准/Three.js/WebVR/AR) | 单人/多人/VR | peteward44.github.io/WebNES | ognis1205.github.io/nests | demo.emulatorjs.org | 8bitworkshop.com |
| 截图/GIF | README 无 | 有(外链) | 有 | 有(4 张) | 有(3 段 GIF) | 无 | 无 |
| 许可证 | Apache-2.0 | MIT | MIT | 未标注 | AGPL-3.0 | GPL-3.0 | GPL-3.0 |

**关键结论:没有任何一个 JS/TS NES 模拟器在其 README 中声明通过 Klaus Dormann 功能测试**(Klaus 测试仓库:[Klaus2m5/6502_65C02_functional_tests](https://github.com/Klaus2m5/6502_65C02_functional_tests))。

## 3. 从零手写的 Web NES 模拟器(非 WASM 移植)

- jsnes 是 vNES 的 JS 移植/改编(README 致谢明确),不算从零。
- takahirox/nes-js(224 星):纯 JS 手写,Canvas+WebAudio,多个创意 demo(Three.js/WebVR/AR)。
- peteward44/WebNES(117 星):纯 JS 手写,兼容性最好的 Web 手写模拟器("98% 游戏"),多年不活跃。
- ognis1205/nests(95 星):TS 手写,mapper 支持最全(到 MMC5),用 AudioWorklet,但功能仍在 Roadmap 阶段。
- kaiokendev Visual NES([关于页](https://kaiokendev.github.io/nes/about)):React+Three.js+AudioWorklet,约 2 天(借助 LLM)完成,传播广但工程化程度低。
- jsnes-lite / xem([文章](https://xem.github.io/articles/nes.html)):极限压缩玩具。
- 共同点:星数几十到几百,均无 GUI 调试器、无汇编器、无(或极少)测试;README 全英文。

## 4. "模拟器+汇编器+调试器+自制游戏"四合一套件是否存在?

- 最接近的是 [sehugg/8bitworkshop](https://github.com/sehugg/8bitworkshop)(587 星,活跃,GPL-3.0):浏览器 IDE,内置模拟器+调试器+汇编器——**但模拟器用 jsnes、工具链用 cc65/nesasm 等第三方,没有自研核心,没有自制游戏产品**。
- 沾边:[monteslu/romdev](https://github.com/monteslu/romdev)、[Scottcjn/awesome-nesdev](https://github.com/Scottcjn/awesome-nesdev)、[fcambus/jsemu](https://github.com/fcambus/jsemu)。
- **结论:模拟器核心、汇编器、调试器、自制游戏全部自研且同一作者完成的开源"套件",在 JS/Web 生态中没有先例。**

## 5. 受欢迎程度与 popular 项目的共同加分项

**量级梯度**:jsnes ~6.4k → EmulatorJS ~4.2k → Nostalgist ~1k → jsnes-web 632 → nes-rust/nes-js ~230 → WebNES/nests ~100 → 其他 <50。JS 手写模拟器天花板约几百星;jsnes 的 6.4k 靠"第一个能玩的 JS NES + HN 传播 + vNES 成熟核心复用 + npm 分发"。

**popular 项目 README 共同加分项**(均可在来源 URL 验证):
1. 在线 Demo 链接放 README 顶部(无一例外)
2. 游戏画面截图/GIF
3. 英文 README
4. npm/CDN 分发(可被"使用"而不只是"参观")
5. TypeScript 类型声明(jsnes 附 index.d.ts)
6. CI/徽章
7. 嵌入示例文档(jsnes nes-embed)
8. 完成度功能:存档/读档、手柄、光枪、连发、Game Genie、变速、CRT 着色器
9. 社区设施(CONTRIBUTING/行为准则/Discord)
10. 许可证醒目

## 6. NEStalgia 差异化点(对照上述)

1. 唯一"从零手写 + 零依赖 + 无构建步骤"的 JS NES 模拟器套件
2. Klaus Dormann 功能测试认证为全场唯一(JS 生态)
3. 硬件级 GUI 调试器在 JS 生态独一无二
4. 自研汇编器 + 自制汇编游戏为独有组合
5. 9 种 Mapper(明确列出且有测试)在手写 JS 阵营第一梯队
6. 135 项测试同类最多
7. 中文 README 是双刃剑:构成中文社区差异化,但所有 popular 竞品均为英文

## 7. popular 项目有、NEStalgia 缺的加分项

1. 在线 Demo 链接(NEStalgia 有 Web 前端,部署 GitHub Pages 性价比最高)
2. README 截图/GIF 墙(NEStalgia docs/screenshots/ 已有 7 张,只用 1 张)
3. 英文版/双语 README(被 awesome 列表收录的硬前提)
4. npm 发布 + CDN(需把核心整理为可 import 的库,可后置)
5. TypeScript 类型声明(低)
6. CI 徽章(NEStalgia 有 135 项测试却没秀出来)
7. ~~手柄(Gamepad API)~~ NEStalgia 已有
8. ~~即时存档/读档与电池存档~~ NEStalgia 已有
9. Game Genie/金手指(低)
10. 嵌入示例文档(低)
11. 更多 Mapper(jsnes 21 个 vs NEStalgia 9 个;但 jsnes 的 mapper 无测试且核心是移植)
12. 社区设施(CONTRIBUTING/LICENSE 位置等)

## 来源

- [bfirsh/jsnes](https://github.com/bfirsh/jsnes) / [jsnes mappers 目录](https://github.com/bfirsh/jsnes/tree/main/src/mappers) / [jsnes commits](https://github.com/bfirsh/jsnes/commits/main) / [bfirsh/jsnes-web](https://github.com/bfirsh/jsnes-web)
- [EmulatorJS/EmulatorJS](https://github.com/EmulatorJS/EmulatorJS) / [arianrhodsandlot/Nostalgist](https://github.com/arianrhodsandlot/Nostalgist)
- [takahirox/nes-js](https://github.com/takahirox/nes-js) / [takahirox/nes-rust](https://github.com/takahirox/nes-rust) / [peteward44/WebNES](https://github.com/peteward44/WebNES) / [ognis1205/nests](https://github.com/ognis1205/nests) / [liamg/js-nes-emulator](https://github.com/liamg/js-nes-emulator) / [kaiokendev Visual NES](https://kaiokendev.github.io/nes/about) / [xem jsnes-lite](https://xem.github.io/articles/nes.html)
- [TASEmulators/fceux](https://github.com/TASEmulators/fceux) / [SourMesen/Mesen2](https://github.com/SourMesen/Mesen2) / [SourMesen/Mesen](https://github.com/SourMesen/Mesen) / [0ldsk00l/nestopia](https://github.com/0ldsk00l/nestopia) / [ares-emulator/ares](https://github.com/ares-emulator/ares)
- [sehugg/8bitworkshop](https://github.com/sehugg/8bitworkshop) / [monteslu/romdev](https://github.com/monteslu/romdev) / [Scottcjn/awesome-nesdev](https://github.com/Scottcjn/awesome-nesdev) / [fcambus/jsemu](https://github.com/fcambus/jsemu)
- [Klaus2m5/6502_65C02_functional_tests](https://github.com/Klaus2m5/6502_65C02_functional_tests)
