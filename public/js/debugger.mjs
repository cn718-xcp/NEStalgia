// Hardware debugger panel: CPU state, live disassembly with breakpoints,
// memory hex viewer, pattern-table / nametable / OAM / palette viewers.
import { disassemble } from '/lib/disasm.mjs';
import { SCREEN_W, SCREEN_H, NES_PALETTE } from '/core/ppu.mjs';

const FLAGS = ['C', 'Z', 'I', 'D', 'B', 'U', 'V', 'N'];

export class Debugger {
  constructor(player) {
    this.player = player;
    this.breakpoints = new Set();
    this.visible = false;
    this.followPC = true;
    this.buildDOM();
  }

  get c() { return this.player.console; }

  buildDOM() {
    const root = document.getElementById('debugger');
    root.innerHTML = `
      <div class="dbg-col">
        <h3>CPU</h3>
        <div class="cpu-regs" id="dbg-regs"></div>
        <div class="dbg-controls">
          <button id="dbg-pause">⏸ 暂停</button>
          <button id="dbg-step">⏭ 单步</button>
          <button id="dbg-frame">🎞 帧步进</button>
          <label><input type="checkbox" id="dbg-follow" checked> 跟随 PC</label>
        </div>
        <h3>断点 <span class="hint">每帧末检查 PC</span></h3>
        <div class="bp-row">
          <input id="dbg-bp-input" placeholder="PC 如 8000" maxlength="4">
          <button id="dbg-bp-add">添加</button>
        </div>
        <div id="dbg-bps" class="bp-list"></div>
        <h3>写入观察点 <span class="hint">RAM 写入即暂停</span></h3>
        <div class="bp-row">
          <input id="dbg-wp-input" placeholder="地址 如 0001" maxlength="4">
          <button id="dbg-wp-add">添加</button>
        </div>
        <div id="dbg-wps" class="bp-list"></div>
        <div id="dbg-wp-last" class="wp-last"></div>
        <h3>内存</h3>
        <div class="bp-row">
          <input id="dbg-mem-goto" placeholder="地址 如 0200" maxlength="4" value="0000">
          <button id="dbg-mem-go">跳转</button>
        </div>
        <div id="dbg-mem" class="mem-view"></div>
      </div>
      <div class="dbg-col dbg-mid">
        <h3>反汇编</h3>
        <div id="dbg-disasm" class="disasm"></div>
      </div>
      <div class="dbg-col">
        <h3>图案表 (CHR)</h3>
        <canvas id="dbg-pattern" width="256" height="128" class="dbg-canvas"></canvas>
        <h3>命名表</h3>
        <canvas id="dbg-nametable" width="256" height="120" class="dbg-canvas"></canvas>
        <h3>OAM 精灵</h3>
        <canvas id="dbg-oam" width="256" height="64" class="dbg-canvas"></canvas>
        <h3>调色板</h3>
        <div id="dbg-pal" class="pal-grid"></div>
      </div>
    `;

    document.getElementById('dbg-pause').onclick = () => this.togglePause();
    document.getElementById('dbg-step').onclick = () => { this.player.pause(); this.c.cpu.step(); this.player.render(); this.refresh(); };
    document.getElementById('dbg-frame').onclick = () => { this.player.pause(); this.player.stepFrame(); this.player.render(); this.refresh(); };
    document.getElementById('dbg-follow').onchange = (e) => { this.followPC = e.target.checked; this.refresh(); };
    document.getElementById('dbg-bp-add').onclick = () => this.addBP();
    document.getElementById('dbg-bp-input').onkeydown = (e) => { if (e.key === 'Enter') this.addBP(); };
    document.getElementById('dbg-wp-add').onclick = () => this.addWP();
    document.getElementById('dbg-wp-input').onkeydown = (e) => { if (e.key === 'Enter') this.addWP(); };
    document.getElementById('dbg-mem-go').onclick = () => this.refresh();
    this.memBase = 0;
    this.disBase = 0;
    this.watchSet = new Set();
    this.lastWrite = null;
  }

  // bind this debugger's watch set to a (fresh) console instance
  attach(console_) {
    console_.watchWrites = this.watchSet;
    console_.onWatchHit = (addr, val) => {
      this.lastWrite = { addr, val, pc: console_.cpu.PC };
      this.player.pause();
      const el = document.getElementById('debugger');
      el.classList.add('bp-hit');
      setTimeout(() => el.classList.remove('bp-hit'), 400);
      this.refresh();
    };
  }

  addBP() {
    const input = document.getElementById('dbg-bp-input');
    const v = parseInt(input.value, 16);
    if (!isNaN(v)) { this.breakpoints.add(v & 0xFFFF); input.value = ''; this.renderBPs(); }
  }
  toggleBP(addr) {
    if (this.breakpoints.has(addr)) this.breakpoints.delete(addr);
    else this.breakpoints.add(addr);
    this.renderBPs();
  }
  renderBPs() {
    const el = document.getElementById('dbg-bps');
    el.innerHTML = '';
    for (const bp of [...this.breakpoints].sort((a, b) => a - b)) {
      const row = document.createElement('div');
      row.className = 'bp-item';
      row.innerHTML = `<span class="bp-addr">$${bp.toString(16).padStart(4, '0')}</span>`;
      const del = document.createElement('button');
      del.textContent = '×';
      del.onclick = () => { this.breakpoints.delete(bp); this.renderBPs(); };
      row.appendChild(del);
      el.appendChild(row);
    }
  }

  addWP() {
    const input = document.getElementById('dbg-wp-input');
    const v = parseInt(input.value, 16);
    if (!isNaN(v)) { this.watchSet.add(v & 0x7FF); input.value = ''; this.renderWPs(); }
  }
  removeWP(addr) { this.watchSet.delete(addr); this.renderWPs(); }
  renderWPs() {
    const el = document.getElementById('dbg-wps');
    el.innerHTML = '';
    for (const wp of [...this.watchSet].sort((a, b) => a - b)) {
      const row = document.createElement('div');
      row.className = 'bp-item';
      row.innerHTML = `<span class="wp-addr">$${wp.toString(16).padStart(2, '0')}</span>`;
      const del = document.createElement('button');
      del.textContent = '×';
      del.onclick = () => this.removeWP(wp);
      row.appendChild(del);
      el.appendChild(row);
    }
    const last = document.getElementById('dbg-wp-last');
    if (this.lastWrite) {
      last.textContent = `最后命中: $${this.lastWrite.addr.toString(16).padStart(2, '0')} ← ${this.lastWrite.val.toString(16).padStart(2, '0')} @ PC $${this.lastWrite.pc.toString(16).padStart(4, '0')}`;
    }
  }

  togglePause() {
    if (this.player.running) this.player.pause();
    else this.player.play();
    this.refresh();
  }

  // called by the player each rendered frame when the panel is open
  frameHook() {
    const pc = this.c.cpu.PC;
    if (this.breakpoints.has(pc)) {
      this.player.pause();
      this.flashBreak();
    }
  }

  flashBreak() {
    const el = document.getElementById('debugger');
    el.classList.add('bp-hit');
    setTimeout(() => el.classList.remove('bp-hit'), 400);
    this.refresh();
  }

  refresh() {
    if (!this.visible || !this.c) return;
    this.renderRegs();
    this.renderDisasm();
    this.renderMem();
    this.renderPattern();
    this.renderNametable();
    this.renderOAM();
    this.renderPalette();
    const btn = document.getElementById('dbg-pause');
    btn.textContent = this.player.running ? '⏸ 暂停' : '▶ 继续';
  }

  renderRegs() {
    const { cpu } = this.c;
    let flags = '';
    for (let i = 0; i < 8; i++) {
      const set = (cpu.P >> i) & 1;
      flags += `<span class="flag ${set ? 'on' : ''}">${FLAGS[i]}</span>`;
    }
    document.getElementById('dbg-regs').innerHTML = `
      <div class="reg"><b>PC</b> $${cpu.PC.toString(16).padStart(4, '0')}</div>
      <div class="reg"><b>A</b> $${cpu.A.toString(16).padStart(2, '0')} <b>X</b> $${cpu.X.toString(16).padStart(2, '0')} <b>Y</b> $${cpu.Y.toString(16).padStart(2, '0')}</div>
      <div class="reg"><b>S</b> $${cpu.S.toString(16).padStart(2, '0')}</div>
      <div class="reg flags">${flags}</div>
      <div class="reg"><b>cycles</b> ${cpu.cycles}</div>
    `;
  }

  renderDisasm() {
    const { cpu } = this.c;
    const el = document.getElementById('dbg-disasm');
    const base = this.followPC
      ? (cpu.PC - 8) & 0xFFFF
      : this.disBase;
    this._disRows = [];
    let addr = base;
    let html = '';
    for (let i = 0; i < 28; i++) {
      const d = disassemble((a) => this.readBus(a), addr);
      this._disRows.push(addr);
      const isPC = addr === cpu.PC;
      const hasBP = this.breakpoints.has(addr);
      html += `<div class="dis-row ${isPC ? 'pc' : ''} ${hasBP ? 'bp' : ''}" data-addr="${addr}">
        <span class="dis-addr">${addr.toString(16).padStart(4, '0')}</span>
        <span class="dis-bytes">${d.bytes}</span>
        <span class="dis-text">${d.text}</span></div>`;
      addr = (addr + d.len) & 0xFFFF;
    }
    el.innerHTML = html;
    el.querySelectorAll('.dis-row').forEach((row) => {
      row.onclick = () => this.toggleBP(parseInt(row.dataset.addr, 16));
    });
  }

  readBus(addr) {
    // debugger view of the CPU bus without side effects for PPU regs
    if (addr < 0x2000) return this.c.ram[addr & 0x7FF];
    if (addr < 0x4000) return 0;
    if (addr < 0x4020) return 0;
    if (addr < 0x8000) return this.c.cart.cpuRead(addr);
    return this.c.cart.cpuRead(addr);
  }

  renderMem() {
    const gotoEl = document.getElementById('dbg-mem-goto');
    const base = parseInt(gotoEl.value, 16) || this.memBase;
    this.memBase = base;
    const el = document.getElementById('dbg-mem');
    let html = '';
    for (let row = 0; row < 16; row++) {
      const a = (base + row * 16) & 0xFFFF;
      let cells = '';
      for (let i = 0; i < 16; i++) {
        const v = this.readBus((a + i) & 0xFFFF);
        cells += `<span>${v.toString(16).padStart(2, '0')}</span>`;
      }
      html += `<div class="mem-row"><span class="mem-addr">${a.toString(16).padStart(4, '0')}</span>${cells}</div>`;
    }
    el.innerHTML = html;
  }

  renderPattern() {
    const cv = document.getElementById('dbg-pattern');
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(128, 128);
    const u32 = new Uint32Array(img.data.buffer);
    for (let bank = 0; bank < 2; bank++) {
      for (let tile = 0; tile < 256; tile++) {
        const tx = (tile & 15) * 8 + bank * 128;
        const ty = (tile >> 4) * 8;
        const base = bank * 0x1000 + tile * 16;
        for (let py = 0; py < 8; py++) {
          const lo = this.c.cart.ppuRead(base + py);
          const hi = this.c.cart.ppuRead(base + py + 8);
          for (let px = 0; px < 8; px++) {
            const v = (((lo >> (7 - px)) & 1) | (((hi >> (7 - px)) & 1) << 1));
            const color = v ? this.c.ppu.paletteRead(v) : 0x0F;
            u32[(ty + py) * 256 + tx + px] = NES_PALETTE[color];
          }
        }
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  renderNametable() {
    const cv = document.getElementById('dbg-nametable');
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(256, 120); // 2 NTs side by side, quarter-scale tiles
    const u32 = new Uint32Array(img.data.buffer);
    for (let nt = 0; nt < 2; nt++) {
      for (let ty = 0; ty < 30; ty++) {
        for (let tx = 0; tx < 32; tx++) {
          const tile = this.c.ppu.vramRead(0x2000 + nt * 0x400 + ty * 32 + tx);
          const at = this.c.ppu.vramRead(0x23C0 + nt * 0x400 + ((ty >> 2) * 8) + (tx >> 2));
          const shift = ((ty & 2) << 1) | (tx & 2);
          const pal = ((at >> shift) & 3) * 4;
          for (let py = 0; py < 8; py += 2) {
            const lo = this.c.cart.ppuRead(tile * 16 + py);
            const hi = this.c.cart.ppuRead(tile * 16 + py + 8);
            for (let px = 0; px < 8; px += 2) {
              const v = (((lo >> (7 - px)) & 1) | (((hi >> (7 - px)) & 1) << 1));
              const color = v ? this.c.ppu.paletteRead(pal + v) : 0x0F;
              const dx = nt * 128 + tx * 4 + (px >> 1);
              const dy = ty * 4 + (py >> 1);
              u32[dy * 256 + dx] = NES_PALETTE[color];
            }
          }
        }
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  renderOAM() {
    const cv = document.getElementById('dbg-oam');
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(256, 64);
    const u32 = new Uint32Array(img.data.buffer);
    for (let s = 0; s < 64; s++) {
      const tile = this.c.ppu.oam[s * 4 + 1];
      const attr = this.c.ppu.oam[s * 4 + 2];
      const pal = (attr & 3) * 4;
      const ox = (s % 16) * 16;
      const oy = (s >> 4) * 16;
      for (let py = 0; py < 8; py++) {
        const lo = this.c.cart.ppuRead((this.c.ppu.control & 0x08 ? 0x1000 : 0) + tile * 16 + py);
        const hi = this.c.cart.ppuRead((this.c.ppu.control & 0x08 ? 0x1000 : 0) + tile * 16 + py + 8);
        for (let px = 0; px < 8; px++) {
          const v = (((lo >> (7 - px)) & 1) | (((hi >> (7 - px)) & 1) << 1));
          const color = v ? this.c.ppu.paletteRead(0x10 + pal + v) : 0x0F;
          for (let dy = 0; dy < 2; dy++) {
            u32[(oy + py * 2 + dy) * 256 + ox + px * 2] = NES_PALETTE[color];
            u32[(oy + py * 2 + dy) * 256 + ox + px * 2 + 1] = NES_PALETTE[color];
          }
        }
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  renderPalette() {
    const el = document.getElementById('dbg-pal');
    if (el.childElementCount !== 32) {
      el.innerHTML = '';
      for (let i = 0; i < 32; i++) {
        const sw = document.createElement('div');
        sw.className = 'swatch';
        el.appendChild(sw);
      }
    }
    const kids = el.children;
    for (let i = 0; i < 32; i++) {
      const color = this.c.ppu.paletteRead(i);
      const rgb = NES_PALETTE[color];
      const r = rgb & 0xFF, g = (rgb >> 8) & 0xFF, b = (rgb >> 16) & 0xFF;
      kids[i].style.background = `rgb(${r},${g},${b})`;
      kids[i].title = `$${(0x3F00 + i).toString(16)} = $${color.toString(16).padStart(2, '0')}`;
    }
  }
}
