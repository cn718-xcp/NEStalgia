// NEStalgia — "STARFALL": a complete NES game written in 6502 assembly,
// assembled by tools/asm.mjs and playable on the NEStalgia core (and on real
// hardware, in principle). Screens/font/sprites are generated here in JS and
// injected as data; all game logic is hand-written 6502.
import { assemble, buildINES } from './asm.mjs';

// ---- 5x7 pixel font (rows top->bottom, 5 bits left-aligned in a byte) ------
const GLYPHS = {
  A: [0x0E, 0x11, 0x11, 0x1F, 0x11, 0x11, 0x11],
  C: [0x0E, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0E],
  E: [0x1F, 0x10, 0x10, 0x1E, 0x10, 0x10, 0x1F],
  F: [0x1F, 0x10, 0x10, 0x1E, 0x10, 0x10, 0x10],
  G: [0x0E, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0F],
  I: [0x0E, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0E],
  L: [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1F],
  M: [0x11, 0x1B, 0x15, 0x15, 0x11, 0x11, 0x11],
  N: [0x11, 0x19, 0x19, 0x15, 0x13, 0x13, 0x11],
  O: [0x0E, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0E],
  P: [0x1E, 0x11, 0x11, 0x1E, 0x10, 0x10, 0x10],
  R: [0x1E, 0x11, 0x11, 0x1E, 0x14, 0x12, 0x11],
  S: [0x0F, 0x10, 0x10, 0x0E, 0x01, 0x01, 0x1E],
  T: [0x1F, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
  V: [0x11, 0x11, 0x11, 0x11, 0x11, 0x0A, 0x04],
  W: [0x11, 0x11, 0x11, 0x15, 0x15, 0x15, 0x0A],
  '0': [0x0E, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0E],
  '1': [0x04, 0x0C, 0x04, 0x04, 0x04, 0x04, 0x0E],
  '2': [0x0E, 0x11, 0x01, 0x06, 0x08, 0x10, 0x1F],
  '3': [0x0E, 0x11, 0x01, 0x06, 0x01, 0x11, 0x0E],
  '4': [0x02, 0x06, 0x0A, 0x12, 0x1F, 0x02, 0x02],
  '5': [0x1F, 0x10, 0x1E, 0x01, 0x01, 0x11, 0x0E],
  '6': [0x06, 0x08, 0x10, 0x1E, 0x11, 0x11, 0x0E],
  '7': [0x1F, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
  '8': [0x0E, 0x11, 0x11, 0x0E, 0x11, 0x11, 0x0E],
  '9': [0x0E, 0x11, 0x11, 0x0F, 0x01, 0x02, 0x0C],
};

function makeCHR() {
  const chr = new Uint8Array(8192);
  // tile 1: small decorative dot (bg, color 1)
  const dot = [0x00, 0x18, 0x18, 0x00, 0x00, 0x18, 0x18, 0x00];
  dot.forEach((v, r) => { chr[0x10 + r] = v; });
  // font tiles at ASCII indices ('0' = $30 … 'Z' = $5A)
  for (const [ch, rows] of Object.entries(GLYPHS)) {
    const base = ch.charCodeAt(0) * 16;
    rows.forEach((v, r) => { chr[base + r] = v; });
    // color-1 plane only; plane1 stays 0
  }
  // sprites at $A0+ live in pattern table 1 (PPU $1000+), matching the
  // hardware's sprite pattern-table select bit
  const starP0 = [0x18, 0x3C, 0x7E, 0xFF, 0xFF, 0x7E, 0x3C, 0x18];
  starP0.forEach((v, r) => { chr[0x1000 + 0xA0 * 16 + r] = v; });
  const shipTop = [0x18, 0x3C, 0x7E, 0xDB, 0xDB, 0x7E, 0x24, 0x00];
  shipTop.forEach((v, r) => { chr[0x1000 + 0xA2 * 16 + r] = v; });
  const shipBot = [0x00, 0x3C, 0x7E, 0xDB, 0xFF, 0xBD, 0x24, 0x66];
  shipBot.forEach((v, r) => { chr[0x1000 + 0xA3 * 16 + r] = v; });
  return chr;
}

// ---- screen data (1024 bytes: 960 NT + 64 AT) -------------------------------
function blankScreen() { return new Uint8Array(1024).fill(0); }
function putText(nt, row, col, str) {
  for (let i = 0; i < str.length; i++) nt[row * 32 + col + i] = str.charCodeAt(i);
}
function sprinkleStars(nt, seed) {
  let r = seed;
  for (let i = 0; i < 60; i++) {
    r = ((r * 109 + 89) & 0xFF);
    const y = 3 + (r % 26);
    r = ((r * 109 + 89) & 0xFF);
    const x = r % 32;
    if (nt[y * 32 + x] === 0) nt[y * 32 + x] = 1;
  }
}
function titleScreen() {
  const nt = blankScreen();
  sprinkleStars(nt, 7);
  putText(nt, 10, 12, 'STARFALL');
  putText(nt, 14, 10, 'PRESS START');
  putText(nt, 26, 6, 'A GAME WRITTEN IN 6502');
  return nt;
}
function overScreen() {
  const nt = blankScreen();
  sprinkleStars(nt, 31);
  putText(nt, 10, 11, 'GAME OVER');
  putText(nt, 14, 10, 'PRESS START');
  return nt;
}
function playScreen() {
  const nt = blankScreen();
  putText(nt, 2, 2, 'SCORE');
  putText(nt, 2, 13, 'LIVES');
  return nt;
}

const PALETTES = [
  0x0F, 0x30, 0x10, 0x00, // bg universal + pal0 (white text)
  0x0F, 0x28, 0x38, 0x18, // pal1 bg (dim stars)
  0x0F, 0x21, 0x11, 0x01, // pal2 bg (blue tint)
  0x0F, 0x2A, 0x1A, 0x0A, // pal3 bg (green tint)
  0x0F, 0x27, 0x37, 0x17, // spr pal0 (yellow stars / ship)
  0x0F, 0x16, 0x26, 0x06, // spr pal1 (red dark stars)
  0x0F, 0x30, 0x20, 0x10, // spr pal2
  0x0F, 0x02, 0x12, 0x22, // spr pal3
];

function blob(name, data) {
  const lines = [`${name}:`];
  for (let i = 0; i < data.length; i += 16) {
    lines.push('  .byte ' + [...data.slice(i, i + 16)].map(v => '$' + v.toString(16).padStart(2, '0')).join(','));
  }
  return lines.join('\n');
}

const ASM = `
PPUCTRL   = $2000
PPUMASK   = $2001
PPUSTATUS = $2002
OAMADDR   = $2003
OAMDMA    = $4014
PPUSCROLL = $2005
PPUADDR   = $2006
PPUDATA   = $2007

; ---- zero page -------------------------------------------------------------
state        = $00
score        = $01
lives        = $02
playerX      = $03
frameReady   = $05
spawnTimer   = $06
spawnInt     = $07
rand         = $08
invuln       = $09
prevButtons  = $0A
buttons      = $0B
scoreDirty   = $0C
tmp1         = $0D
tmp2         = $0E
starsY       = $10
starsX       = $15
starsSpd     = $1A
starsTyp     = $1F
starsOn      = $24

  .org $8000

; ---- NMI --------------------------------------------------------------------
NMI:
  PHA
  TXA
  PHA
  TYA
  PHA
  LDA #$00
  STA OAMADDR
  LDA #$02
  STA OAMDMA
  ; controller 1
  LDA #$01
  STA $4016
  STA $4016
  LDA #$00
  STA $4016
  LDX #$08
ctrlLoop:
  LDA $4016
  LSR A
  ROL buttons
  DEX
  BNE ctrlLoop
  ; score/lives digits
  LDA scoreDirty
  BEQ noScoreDraw
  LDA #$20
  STA PPUADDR
  LDA #$48
  STA PPUADDR
  LDA score
  LDX #$00
div10:
  CMP #$0A
  BCC divDone
  SEC
  SBC #$0A
  INX
  JMP div10
divDone:
  STA tmp1
  TXA
  CLC
  ADC #$30
  STA PPUDATA
  LDA tmp1
  CLC
  ADC #$30
  STA PPUDATA
  LDA #$20
  STA PPUADDR
  LDA #$53
  STA PPUADDR
  LDA lives
  CLC
  ADC #$30
  STA PPUDATA
  LDA #$00
  STA scoreDirty
noScoreDraw:
  LDA #$00
  STA PPUSCROLL
  STA PPUSCROLL
  INC frameReady
  PLA
  TAY
  PLA
  TAX
  PLA
  RTI

; ---- reset ------------------------------------------------------------------
RESET:
  SEI
  CLD
  LDX #$FF
  TXS
  LDA #$00
  STA PPUCTRL
  STA PPUMASK
  BIT PPUSTATUS
vwait1:
  BIT PPUSTATUS
  BPL vwait1
  LDA #$00
  STA $4015
vwait2:
  BIT PPUSTATUS
  BPL vwait2
  ; clear RAM
  LDX #$00
  LDA #$00
clearRam:
  STA $00,X
  STA $0100,X
  STA $0300,X
  STA $0400,X
  STA $0500,X
  STA $0600,X
  STA $0700,X
  INX
  BNE clearRam
  JSR clearOAM
  JSR loadTitle
  LDA #$88
  STA PPUCTRL
  LDA #$1E
  STA PPUMASK

mainLoop:
  LDA frameReady
  BNE gotFrame
  JMP mainLoop
gotFrame:
  LDA #$00
  STA frameReady
  ; ---- title state ----
  LDA state
  BNE notTitle
  LDA buttons
  AND #$10
  BEQ notTitle
  LDA prevButtons
  AND #$10
  BNE notTitle      ; ignore held Start
  JSR initPlay
notTitle:
  ; ---- play state ----
  LDA state
  CMP #$01
  BNE checkOver
  JSR updatePlay
  JMP frameEnd
checkOver:
  LDA state
  CMP #$02
  BNE frameEnd
  LDA buttons
  AND #$10
  BEQ frameEnd
  LDA prevButtons
  AND #$10
  BNE frameEnd
  JSR loadTitle
frameEnd:
  LDA buttons
  STA prevButtons
  JMP mainLoop

; ---- play update --------------------------------------------------------------
updatePlay:
  ; movement
  LDA buttons
  AND #$02
  BEQ noLeft
  LDA playerX
  CMP #$08
  BCC noLeft
  SEC
  SBC #$02
  STA playerX
noLeft:
  LDA buttons
  AND #$01
  BEQ noRight
  LDA playerX
  CMP #$F0
  BCS noRight
  CLC
  ADC #$02
  STA playerX
noRight:
  ; invulnerability timer
  LDA invuln
  BEQ noInv
  DEC invuln
noInv:
  ; spawn
  DEC spawnTimer
  BNE noSpawn
  JSR spawnStar
noSpawn:
  ; update stars
  LDX #$00
starLoop:
  LDA starsOn,X
  BNE starActive
  JMP nextStar
starActive:
  LDA starsSpd,X
  CLC
  ADC starsY,X
  STA starsY,X
  CMP #$E6
  BCC checkCatch
  LDA #$00
  STA starsOn,X
  LDA #$F8
  STA starsY,X
  JMP updOam
checkCatch:
  CMP #$C8
  BCS bandLo
  JMP updOam
bandLo:
  CMP #$D8
  BCC bandHi
  JMP updOam
bandHi:
  ; horizontal
  LDA starsX,X
  SEC
  SBC playerX
  BCC negDx
  CMP #$06
  BCC doContact
  JMP updOam
negDx:
  LDA playerX
  SEC
  SBC starsX,X
  CMP #$06
  BCC doContact
  JMP updOam
doContact:
  LDA starsTyp,X
  BEQ doCatch
  ; dark star: damage if not invulnerable
  LDA invuln
  BEQ invOk
  JMP updOam
invOk:
  DEC lives
  LDA #30
  STA invuln
  JSR sfxHit
  LDA #1
  STA scoreDirty
  LDA lives
  BNE killStar
  JSR loadGameOver
  JMP mainLoop2
killStar:
  LDA #$00
  STA starsOn,X
  LDA #$F8
  STA starsY,X
  JMP updOam
doCatch:
  INC score
  LDA #1
  STA scoreDirty
  JSR sfxCatch
  LDA #$00
  STA starsOn,X
  LDA #$F8
  STA starsY,X
updOam:
  TXA
  ASL A
  ASL A
  CLC
  ADC #$04
  TAY
  LDA starsY,X
  STA $0204,Y
  LDA #$A0
  STA $0205,Y
  LDA starsTyp,X
  BEQ starBright
  LDA #$01
  STA $0206,Y
  JMP starXY
starBright:
  LDA #$00
  STA $0206,Y
starXY:
  LDA starsX,X
  STA $0207,Y
nextStar:
  INX
  CPX #$05
  BEQ starDone
  JMP starLoop
starDone:
mainLoop2:
  ; player OAM
  LDA #207
  STA $0200
  LDA #$A2
  STA $0201
  LDA #$00
  STA $0202
  LDA playerX
  STA $0203
  LDA #215
  STA $0204
  LDA #$A3
  STA $0205
  LDA #$00
  STA $0206
  LDA playerX
  STA $0207
  ; flicker when invulnerable
  LDA invuln
  BEQ noFlick
  LSR A
  BCC noFlick
  LDA #$F8
  STA $0200
  STA $0204
noFlick:
  RTS

; ---- spawn -----------------------------------------------------------------
spawnStar:
  LDX #$00
findSlot:
  LDA starsOn,X
  BEQ gotSlot
  INX
  CPX #$05
  BNE findSlot
  RTS            ; no free slot
gotSlot:
  LDA #$01
  STA starsOn,X
  LDA #$00
  STA starsY,X
  JSR stepRand
  LDA rand
  AND #$F8
  CMP #$F0
  BCC xOk
  LDA #$C0
xOk:
  STA starsX,X
  ; speed = 1 + score/8, cap 4
  LDA score
  LSR A
  LSR A
  LSR A
  CLC
  ADC #$01
  CMP #$05
  BCC spdOk
  LDA #$04
spdOk:
  STA starsSpd,X
  ; type from random bit
  LDA rand
  AND #$40
  BEQ typSet
  LDA #$01
typSet:
  STA starsTyp,X
  ; interval shrinks as score rises
  LDA score
  CLC
  ADC #20
  CMP #60
  BCC intOk
  LDA #60
intOk:
  STA spawnInt
  STA spawnTimer
  RTS

stepRand:
  LDA rand
  LSR A
  BCC noTap
  EOR #$B8
noTap:
  STA rand
  RTS

; ---- sfx ---------------------------------------------------------------------
sfxCatch:
  LDA $4015
  ORA #$01
  STA $4015
  LDA #$9F
  STA $4000
  LDA #$40
  STA $4001
  LDA #$40
  STA $4002
  LDA #$08
  STA $4003
  RTS
sfxHit:
  LDA $4015
  ORA #$08
  STA $4015
  LDA #$1F
  STA $400C
  LDA #$84
  STA $400E
  LDA #$80
  STA $400F
  RTS

; ---- screens -------------------------------------------------------------------
; All VRAM loads happen with rendering OFF: the renderer's v-register updates
; would otherwise fight the $2006/$2007 writes mid-frame.
loadTitle:
  LDA #$00
  STA PPUMASK
  LDA #<titleData
  STA $FA
  LDA #>titleData
  STA $FB
  JSR copyNT
  JSR loadPal
  JSR clearOAM
  LDA #$00
  STA state
  STA scoreDirty
  STA frameReady
  LDA #$1E
  STA PPUMASK
  RTS
loadGameOver:
  LDA #$00
  STA PPUMASK
  LDA #<overData
  STA $FA
  LDA #>overData
  STA $FB
  JSR copyNT
  LDA #$02
  STA state
  LDA #1
  STA scoreDirty
  LDA #$1E
  STA PPUMASK
  RTS
initPlay:
  LDA #$00
  STA PPUMASK
  LDA #$00
  STA score
  STA invuln
  STA frameReady
  LDA #$41          ; non-zero LFSR seed (seed 0 is a fixed point)
  STA rand
  LDA #$03
  STA lives
  LDA #120
  STA playerX
  LDA #60
  STA spawnTimer
  STA spawnInt
  LDX #$00
initStars:
  LDA #$00
  STA starsOn,X
  STA starsY,X
  LDA #$F8
  STA $0200,X
  INX
  CPX #$05
  BNE initStars
  ; clear full OAM
  JSR clearOAM
  LDA #<playData
  STA $FA
  LDA #>playData
  STA $FB
  JSR copyNT
  LDA #1
  STA scoreDirty
  LDA #$01
  STA state
  LDA #$1E
  STA PPUMASK
  RTS

clearOAM:
  LDX #$00
  LDA #$F8
clrOam:
  STA $0200,X
  INX
  BNE clrOam
  RTS

copyNT:
  LDA #$20
  STA PPUADDR
  LDA #$00
  STA PPUADDR
  LDY #$00
  LDX #$04
ntPage:
  LDA ($FA),Y
  STA PPUDATA
  INY
  BNE ntPage
  INC $FB
  DEX
  BNE ntPage
  RTS

loadPal:
  LDA #$3F
  STA PPUADDR
  LDA #$00
  STA PPUADDR
  LDX #$00
palLoop:
  LDA palData,X
  STA PPUDATA
  INX
  CPX #32
  BNE palLoop
  RTS

  .org $FFFA
  .word NMI
  .word RESET
  .word 0
`;

export function buildStarfall() {
  const titleData = titleScreen();
  const overData = overScreen();
  const playData = playScreen();
  const palData = new Uint8Array(PALETTES);
  const src = [
    ASM,
    '.org $A000\n' + blob('titleData', titleData),
    '.org $A400\n' + blob('overData', overData),
    '.org $A800\n' + blob('playData', playData),
    '.org $AC00\n' + blob('palData', palData),
  ].join('\n');
  const { chunks, symbols } = assemble(src);
  const prg = new Uint8Array(32768);
  for (const c of chunks) prg.set(c.bytes, (c.addr - 0x8000) % 32768);
  const rom = buildINES({ prg, chr: makeCHR(), mapper: 0, mirroring: 'H' });
  return { rom, symbols, screens: { titleData, overData, playData } };
}
