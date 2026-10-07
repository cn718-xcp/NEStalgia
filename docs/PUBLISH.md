# NEStalgia 发布指南(GitHub)

> 结论:**可以发布**。竞品调研(见 [github-competitive-research.md](github-competitive-research.md))确认项目差异化明确;
> 合规要点全部通过;CI 与 Pages 部署工作流已就绪。以下约 10 分钟可完成。

## 合规自查(已核实)

- 模拟器本身合法:不含 Nintendo 的任何代码、ROM、BIOS、固件。模拟器属洁净室逆向成果,发布先例充分(jsnes、Nestopia、Mesen 等均公开托管多年)。
- 仓库无版权 ROM:`roms/` 仅含自制游戏 `starfall.nes`(自研汇编器产出,版权归项目);第三方 ROM(`nova.nes`)与 Klaus 测试二进制(`tmp/klaus.bin`)均已被 `.gitignore` 排除,不会入库。
- 许可:MIT,[LICENSE](../LICENSE) 已就位。版权人行当前为 "The NEStalgia Authors",可自行替换为真实姓名(替换后重新提交即可)。

## 发布步骤

1. **建仓**:GitHub → New repository → 名称建议 `NEStalgia`、Public;**不要**勾选自动生成 README/.gitignore/license(本地已齐)。

2. **推送**:
   ```bash
   git remote add origin https://github.com/<USERNAME>/NEStalgia.git
   git push -u origin main
   ```

3. **替换占位符**:`README.md` 与 `README.en.md` 顶部有注释掉的 CI / Demo 徽章——取消注释,并把两处 `USERNAME` 替换为你的 GitHub 用户名。

4. **开启 Pages**:仓库 Settings → Pages → Build and deployment → Source 选 **GitHub Actions**。
   push 已自动触发 `deploy-pages.yml`;也可到 Actions 页手动 "Run workflow"。完成后访问 `https://<USERNAME>.github.io/NEStalgia/`。

5. **部署验证**(一次性):
   - DevTools → Network:`/core/cpu.mjs` 返回 200,Content-Type 为 `text/javascript` 或 `application/javascript`;
   - STARFALL 可玩、有声音(先点一次页面,浏览器自动播放策略要求用户手势);
   - 汇编工作台能现场编译运行 HELLO/BOUNCE/INPUT。

6. **仓库门面**:
   - About:一句话描述 + Website 指向 Pages URL;
   - Topics 建议:`nes-emulator` `nes` `famicom` `6502` `emulator` `javascript` `retro-gaming` `homebrew` `assembler` `debugger` `zero-dependency`;
   - Social preview 上传 `docs/screenshots/web-player-debugger.png`。

7. **(可选)外部收录**:向 [fcambus/jsemu](https://github.com/fcambus/jsemu)、awesome-nesdev 等列表提 PR——英文 README 已备好,这是收录硬前提。

## 常见问题

- **为什么 Pages 不能直接从仓库根目录部署?**
  前端资源引用全部为**相对路径**(静态 import 相对模块自身、fetch/worklet 相对页面,因此天然兼容 Pages 的 `/<repo>/` 子路径)。
  本地由 `scripts/server.mjs` 在请求时把 `/core/`、`/lib/` 映射到 `src/`,`/roms/` 映射到 `roms/`;Pages 是纯静态托管、无法做 URL 映射,
  所以 `deploy-pages.yml` 在部署前把 `src/core`、`src/lib`、`roms` 复制进 `public/`,物化出相同布局。

- **.mjs 的 MIME 有问题吗?**
  GitHub Pages 对 `.mjs` 返回合法 JS MIME。若控制台报 MIME 错误,多为 CDN 缓存未更新,等几分钟或强制刷新。

- **私有仓可以吗?**
  CI 在私有仓照常运行;但 Pages 免费额度仅限公开仓库(私有需 Pro)。作为个人作品集项目,建议公开。

- **后续想加内容?**
  优先级建议:更多 Mapper(MMC5/VRC 系列,扩大兼容面)> Game Genie/金手指 > npm 发布(需把核心整理为可 import 的库)> TypeScript 声明。详见调研报告第 7 节。
