// NEStalgia web app controller: library, playback, persistence.
import { Player, BTN } from './player.mjs';
import { AudioManager } from './audio.mjs';
import { Debugger } from './debugger.mjs';
import {
  putRom, getRom, listRoms, deleteRom,
  putState, getState, putSRAM, getSRAM,
} from './storage.mjs';

const $ = (id) => document.getElementById(id);

const audio = new AudioManager();
const player = new Player($('screen'), audio);
const debuggerPanel = new Debugger(player);
setInterval(() => {
  if (!player.console) return;
  $('st-fps').textContent = `${player.fps} fps`;
  $('st-frame').textContent = `frame ${player.frameCount}`;
}, 500);
player.onFrame = (c) => {
  if (debuggerPanel.visible && debuggerPanel.breakpoints.size) debuggerPanel.frameHook();
  if (debuggerPanel.visible && c.ppu.frameCount % 15 === 0) debuggerPanel.refresh();
};

let currentRom = null;
let sramTimer = 0;

function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.hidden = true; }, 2200);
}

function showLibrary() {
  player.pause();
  $('view-player').hidden = true;
  $('view-library').hidden = false;
  renderLibrary();
}

async function showPlayer(id) {
  const rec = await getRom(id);
  if (!rec) return;
  currentRom = rec;
  $('view-library').hidden = true;
  $('view-player').hidden = false;
  $('st-rom').textContent = rec.name;
  $('st-mapper').textContent = `mapper ${rec.mapper} · PRG ${Math.round(rec.data.length / 1024)}KB`;

  // battery save
  let sram = null;
  if (hasBattery(rec.data)) sram = (await getSRAM(id))?.data ?? null;
  player.onBatteryFlush = (data) => {
    clearTimeout(sramTimer);
    sramTimer = setTimeout(() => putSRAM(id, data.slice()), 3000);
  };
  player.loadRom(rec.data, { sram });
  debuggerPanel.attach(player.console);

  // thumbnail for the library (first boot frame)
  for (let i = 0; i < 30; i++) player.stepFrame();
  player.render();
  const thumb = $('screen').toDataURL('image/png');
  await putRom({ ...metaOf(rec), thumb }, rec.data);
  // enter play immediately (the card click counts as the audio gesture)
  await audio.start();
  player.play();
  $('btn-pause').textContent = '⏸ 暂停';
}

function hasBattery(rom) { return (rom[6] & 0x02) !== 0; }
function mapperOf(rom) { return ((rom[7] & 0xF0) | (rom[6] >> 4)); }
function metaOf(rec) {
  return { id: rec.id, name: rec.name, mapper: rec.mapper, size: rec.size, added: rec.added, thumb: rec.thumb };
}

async function renderLibrary() {
  const grid = $('rom-grid');
  const roms = await listRoms();
  grid.innerHTML = '';
  roms.sort((a, b) => (a.added || 0) - (b.added || 0));
  for (const r of roms) {
    const card = document.createElement('div');
    card.className = 'rom-card';
    const thumb = r.thumb
      ? `<img src="${r.thumb}" alt="">`
      : '<span>NO SIGNAL</span>';
    card.innerHTML = `
      <div class="rom-thumb">${thumb}</div>
      <div class="rom-meta">
        <div class="rom-name">${r.name}</div>
        <div class="rom-sub">
          <span>mapper ${r.mapper} · ${(r.size / 1024).toFixed(0)}KB</span>
          <span class="del" title="删除">✕</span>
        </div>
      </div>`;
    card.onclick = (e) => {
      if (e.target.classList.contains('del')) return;
      showPlayer(r.id);
    };
    card.querySelector('.del').onclick = async () => {
      await deleteRom(r.id);
      renderLibrary();
    };
    grid.appendChild(card);
  }
}

async function addRomFile(file) {
  const data = new Uint8Array(await file.arrayBuffer());
  if (data.length < 16 || data[0] !== 0x4E || data[1] !== 0x45 || data[2] !== 0x53 || data[3] !== 0x1A) {
    toast(`"${file.name}" 不是有效的 iNES 文件`);
    return;
  }
  const id = `${file.name.replace(/\.nes$/i, '')}_${data.length}`;
  const mapper = mapperOf(data);
  await putRom({ id, name: file.name.replace(/\.nes$/i, ''), mapper, size: data.length, added: Date.now() }, data);
  toast(`已加载 ${file.name} (mapper ${mapper})`);
  renderLibrary();
}

// ---- bundled homebrew -------------------------------------------------------
async function ensureBundled() {
  const id = 'STARFALL_builtin';
  const existing = await getRom(id);
  if (existing) return;
  try {
    const res = await fetch('/roms/starfall.nes');
    const data = new Uint8Array(await res.arrayBuffer());
    await putRom({ id, name: 'STARFALL ★ 自制游戏', mapper: 0, size: data.length, added: 0, builtin: true }, data);
  } catch { /* dev server without roms/ — ignore */ }
}

// ---- drag & drop --------------------------------------------------------------
document.addEventListener('dragover', (e) => { e.preventDefault(); document.body.classList.add('dragging'); });
document.addEventListener('dragleave', (e) => { if (e.target === document.body) document.body.classList.remove('dragging'); });
document.addEventListener('drop', async (e) => {
  e.preventDefault();
  document.body.classList.remove('dragging');
  for (const f of e.dataTransfer.files) if (f.name.toLowerCase().endsWith('.nes')) await addRomFile(f);
});

// ---- toolbar ------------------------------------------------------------------
$('btn-open').onclick = () => $('file-input').click();
$('file-input').onchange = async (e) => {
  for (const f of e.target.files) await addRomFile(f);
  e.target.value = '';
};
$('btn-library').onclick = showLibrary;
$('btn-back').onclick = showLibrary;
$('btn-pause').onclick = async () => {
  if (player.running) { player.pause(); $('btn-pause').textContent = '▶ 继续'; }
  else { await audio.start(); player.play(); $('btn-pause').textContent = '⏸ 暂停'; }
};
$('btn-reset').onclick = () => { player.reset(); toast('已重置'); };
$('btn-save-state').onclick = async () => {
  if (!player.console) return;
  const thumb = $('screen').toDataURL('image/png');
  await putState(`state_${currentRom.id}`, player.saveState(), thumb);
  toast('状态已保存');
};
$('btn-load-state').onclick = async () => {
  if (!player.console) return;
  const rec = await getState(`state_${currentRom.id}`);
  if (!rec) { toast('没有存档'); return; }
  player.loadState(rec.state);
  toast('状态已读取');
};
$('btn-shot').onclick = async () => {
  const blob = await player.screenshot();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${currentRom?.id || 'nestalgia'}_frame${player.frameCount}.png`;
  a.click();
  URL.revokeObjectURL(a.href);
};
$('btn-crt').onclick = (e) => {
  const ov = $('crt-overlay');
  ov.hidden = !ov.hidden;
  e.currentTarget.classList.toggle('on', !ov.hidden);
};
$('btn-turbo').onclick = (e) => {
  player.turbo = !player.turbo;
  e.currentTarget.classList.toggle('on', player.turbo);
};
$('btn-fs').onclick = () => {
  const el = $('screen-wrap');
  if (document.fullscreenElement) document.exitFullscreen();
  else el.requestFullscreen?.();
};
$('btn-debugger').onclick = (e) => {
  const dbg = $('debugger');
  dbg.hidden = !dbg.hidden;
  debuggerPanel.visible = !dbg.hidden;
  e.currentTarget.classList.toggle('on', debuggerPanel.visible);
  if (debuggerPanel.visible) debuggerPanel.refresh();
};
$('vol').oninput = (e) => audio.setVolume(e.target.value / 100);

// keyboard shortcuts: pause with P; also start audio ctx on first key
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyP' && !e.repeat && player.console) $('btn-pause').click();
}, { capture: false });

// boot
ensureBundled().then(renderLibrary);
window.NESTALGIA = { player, audio, get console() { return player.console; }, BTN, debuggerPanel };
