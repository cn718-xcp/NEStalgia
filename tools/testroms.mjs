// NEStalgia — test ROM sources assembled with tools/asm.mjs. Each builder
// returns { rom, chr } for headless verification of the integrated console.
import { assemble, buildINES } from './asm.mjs';

function buildPrg(src, { prgBlocks = 1 } = {}) {
  const { chunks } = assemble(src);
  const size = prgBlocks * 16384;
  const prg = new Uint8Array(size);
  // 16K PRG is mirrored across $8000-$FFFF; vector chunks at $FFFA land
  // physically at $BFFA, so mask the offset into the PRG window.
  for (const c of chunks) prg.set(c.bytes, (c.addr - 0x8000) % size);
  return prg;
}

const PPU_INIT = `
PPUCTRL   = $2000
PPUMASK   = $2001
PPUSTATUS = $2002
OAMADDR   = $2003
OAMDMA    = $4014
PPUSCROLL = $2005
PPUADDR   = $2006
PPUDATA   = $2007

  .org $8000

reset:
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
vwait2:
  BIT PPUSTATUS
  BPL vwait2
`;

const BG_FILL = `
  LDA #$20
  STA PPUADDR
  LDA #$00
  STA PPUADDR
  LDY #$00
fillrow:
  LDX #$00
fillcol:
  TXA
  AND #$01
  STA PPUDATA
  INX
  CPX #32
  BNE fillcol
  INY
  CPY #30
  BNE fillrow
  LDA #$E4
  LDY #$00
attrfill:
  STA PPUDATA
  INY
  CPY #64
  BNE attrfill
`;

const SHOW_BG = `
  LDA #$00
  STA PPUSCROLL
  STA PPUSCROLL
  STA PPUADDR
  STA PPUADDR
  LDA #%00001010
  STA PPUMASK
`;

export function makeColorBars() {
  const src = `
${PPU_INIT}
  LDA #$3F
  STA PPUADDR
  LDA #$00
  STA PPUADDR
  LDX #$00
palloop:
  LDA paltable,X
  STA PPUDATA
  INX
  CPX #32
  BNE palloop
${BG_FILL}
${SHOW_BG}
mainloop:
  JMP mainloop

paltable:
  .byte $0F,$01,$21,$02, $0F,$06,$26,$02, $0F,$0A,$2A,$02, $0F,$0C,$2C,$02
  .byte $0F,$14,$24,$34, $0F,$1A,$2A,$3A, $0F,$02,$12,$22, $0F,$16,$26,$36

  .org $FFFA
  .word 0, reset, 0
`;
  const prg = buildPrg(src);
  const chr = new Uint8Array(8192);
  for (let r = 0; r < 8; r++) { chr[0x00 + r] = 0xFF; chr[0x08 + r] = 0x00; } // tile 0 = color 1
  for (let r = 0; r < 8; r++) { chr[0x10 + r] = 0x00; chr[0x18 + r] = 0xFF; } // tile 1 = color 2
  return { rom: buildINES({ prg, chr, mapper: 0, mirroring: 'H' }), chr };
}

const OAM_COPY = `
  LDX #$00
oamcopy:
  LDA oamtable,X
  STA $0200,X
  INX
  CPX #16
  BNE oamcopy
  LDA #$02
  STA OAMDMA
`;

export function makeSpriteScene() {
  const src = `
${PPU_INIT}
  LDA #$3F
  STA PPUADDR
  LDA #$00
  STA PPUADDR
  LDX #$00
palloop:
  LDA paltable,X
  STA PPUDATA
  INX
  CPX #32
  BNE palloop
${BG_FILL}
${OAM_COPY}
${SHOW_BG}
  LDA #%00011010
  STA PPUMASK
mainloop:
  JMP mainloop

oamtable:
  .byte 60, 2, $00, 60
  .byte 80, 3, $40, 60
  .byte 100, 2, $01, 60
  .byte 120, 3, $80, 60

paltable:
  .byte $0F,$21,$02,$00, $0F,$06,$26,$02, $0F,$0A,$2A,$02, $0F,$0C,$2C,$02
  .byte $0F,$14,$24,$34, $0F,$1A,$2A,$3A, $0F,$02,$12,$22, $0F,$16,$26,$36

  .org $FFFA
  .word 0, reset, 0
`;
  const prg = buildPrg(src);
  const chr = new Uint8Array(8192);
  for (let r = 0; r < 8; r++) { chr[0x00 + r] = 0xFF; chr[0x08 + r] = 0x00; }
  for (let r = 0; r < 8; r++) { chr[0x10 + r] = 0x00; chr[0x18 + r] = 0xFF; }
  // tile 2: solid color 1 (plane0 only)
  for (let r = 0; r < 8; r++) { chr[0x20 + r] = 0xFF; chr[0x28 + r] = 0x00; }
  // tile 3: plane0 row0 = 0x0F (right half), rest empty; used for flip tests
  chr[0x30] = 0x0F;
  for (let r = 1; r < 8; r++) chr[0x30 + r] = 0x00;
  for (let r = 0; r < 8; r++) chr[0x38 + r] = 0x00;
  return { rom: buildINES({ prg, chr, mapper: 0, mirroring: 'H' }), chr };
}

export function makeSpriteZeroHit() {
  const src = `
${PPU_INIT}
  LDA #$3F
  STA PPUADDR
  LDA #$00
  STA PPUADDR
  LDX #$00
palloop:
  LDA paltable,X
  STA PPUDATA
  INX
  CPX #32
  BNE palloop
  ; solid background: all tile 0
  LDA #$20
  STA PPUADDR
  LDA #$00
  STA PPUADDR
  LDY #$00
solidfill:
  LDA #$00
  STA PPUDATA
  INY
  BNE solidfill
  LDA #$E4
  LDY #$00
attrfill:
  STA PPUDATA
  INY
  CPY #64
  BNE attrfill
  ; sprite 0 via DMA
${OAM_COPY}
  LDA #$00
  STA PPUSCROLL
  STA PPUSCROLL
  STA PPUADDR
  STA PPUADDR
  LDA #%00011010
  STA PPUMASK
pollhit:
  BIT PPUSTATUS
  BVC pollhit
  LDA #$01
  STA $0200
  ; repaint backdrop white so the test screenshot shows success
  LDA #$3F
  STA PPUADDR
  LDA #$00
  STA PPUADDR
  LDA #$30
  STA PPUDATA
mainloop:
  JMP mainloop

oamtable:
  .byte 50, 2, $00, 100
  .byte $F8, 0, 0, 0

paltable:
  .byte $0F,$21,$02,$00, $0F,$06,$26,$02, $0F,$0A,$2A,$02, $0F,$0C,$2C,$02
  .byte $0F,$14,$24,$34, $0F,$1A,$2A,$3A, $0F,$02,$12,$22, $0F,$16,$26,$36

  .org $FFFA
  .word 0, reset, 0
`;
  const prg = buildPrg(src);
  const chr = new Uint8Array(8192);
  for (let r = 0; r < 8; r++) { chr[0x00 + r] = 0xFF; chr[0x08 + r] = 0x00; }
  for (let r = 0; r < 8; r++) { chr[0x20 + r] = 0xFF; chr[0x28 + r] = 0x00; }
  return { rom: buildINES({ prg, chr, mapper: 0, mirroring: 'H' }), chr };
}
