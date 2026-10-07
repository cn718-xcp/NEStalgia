// Assembly playground: live 6502 editing → the built-in assembler (the very
// same src/lib/asm.mjs used for all project test ROMs) → instant play.
import { assemble, buildINES } from '../lib/asm.mjs';
import { buildPlaygroundCHR, DEMOS } from '../lib/demos.mjs';

const $ = (id) => document.getElementById(id);

export class Playground {
  constructor({ onRun }) {
    this.onRun = onRun; // (romBytes) => void — hands the built ROM to the player
    this.buildEditor();
  }

  buildEditor() {
    const sel = $('pg-demo');
    for (const d of DEMOS) {
      const opt = document.createElement('option');
      opt.textContent = d.name;
      sel.appendChild(opt);
    }
    sel.onchange = () => this.loadDemo();
    $('pg-run').onclick = () => this.run();
    $('pg-editor').addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        const el = e.target;
        const s = el.selectionStart, t = el.selectionEnd;
        el.value = el.value.slice(0, s) + '  ' + el.value.slice(t);
        el.selectionStart = el.selectionEnd = s + 2;
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        this.run();
      }
    });
    this.loadDemo(0);
  }

  loadDemo(idx = 0) {
    $('pg-editor').value = DEMOS[idx ?? $('pg-demo').selectedIndex].source;
    $('pg-error').hidden = true;
  }

  buildRom(source) {
    const { chunks } = assemble(source);
    const prg = new Uint8Array(16384);
    for (const c of chunks) prg.set(c.bytes, (c.addr - 0x8000) % 16384);
    return buildINES({ prg, chr: buildPlaygroundCHR(), mapper: 0, mirroring: 'H' });
  }

  run() {
    const errBox = $('pg-error');
    errBox.hidden = true;
    try {
      const rom = this.buildRom($('pg-editor').value);
      this.onRun(rom);
    } catch (e) {
      errBox.textContent = e.message;
      errBox.hidden = false;
    }
  }
}
