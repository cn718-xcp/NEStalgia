# NEStalgia 构建日志

> 目标：从零编写完整 NES 模拟器套件 —— 6502 CPU / 2C02 PPU / 2A03 APU / Mapper / 6502 汇编器 / 硬件调试器 / 自制游戏。零第三方依赖。

## 日志

### 2026-10-06 M0 脚手架
- 环境侦察：Node 24.20.0，git 2.54.0，工作区确认。
- 技术决策：零 npm 依赖（node:http 静态服务器 + 原生 ES Modules + 自写测试执行器），规避 Windows npm 脚本 PATH 问题。
- 模块规划：CPU → 汇编器 → 卡带/Mapper → PPU → 主机整合 → APU → 自制游戏 → Web 前端 → 调试器 → E2E → 文档。
