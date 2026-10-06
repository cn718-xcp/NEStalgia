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

export function makeSpriteZeroHit() {  const src = `
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

// ---- MMC3 (mapper 4) IRQ + bank-switching integration ROM -------------------
// 128K PRG. Code and vectors live in the physically fixed last two banks
// (CPU $C000-$FFFF -> PRG offset $18000+). Signature bytes are placed in
// physical banks 0 and 1 so bank switching can be verified through the
// $8000/$A000 windows.
export function makeMmc3IrqRom() {
  const src = `
PPUCTRL   = $2000
PPUMASK   = $2001
PPUSTATUS = $2002
PPUSCROLL = $2005
PPUADDR   = $2006
PPUDATA   = $2007

  .org $8000
sigA:
  .byte $5A, $5A, $5A, $5A

  .org $A000
sigB:
  .byte $A5, $A5, $A5, $A5

  .org $C000
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
  ; backdrop = dark blue, color1 = medium blue
  LDA #$3F
  STA PPUADDR
  LDA #$00
  STA PPUADDR
  LDA #$0F
  STA PPUDATA
  LDA #$11
  STA PPUDATA
  ; solid background: 1024 x tile 0
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
  ; MMC3 bank-switch verification: R6=0 -> $8000 shows bank 0
  LDA #$06
  STA $8000
  LDA #$00
  STA $8001
  LDA #$07
  STA $8000
  LDA #$01
  STA $8001
  LDX $8000
  STX $0310
  LDX $A000
  STX $0311
  ; scanline IRQ: latch 30, reload, enable
  LDA #30
  STA $C000
  STA $C001
  LDA #$00
  STA $E000
  STA $E001
  ; scroll + enable BG, then unmask IRQs
  LDA #$00
  STA PPUSCROLL
  STA PPUSCROLL
  STA PPUADDR
  STA PPUADDR
  LDA #%00001010
  STA PPUMASK
  LDA #$80
  STA PPUCTRL
  CLI
main:
  JMP main

nmi:
  PHA
  TXA
  PHA
  TYA
  PHA
  LDA $0300
  CMP #$03
  BCC nmiOut
  ; after enough IRQs, repaint color1 white (safe: we are in vblank)
  LDA #$3F
  STA PPUADDR
  LDA #$01
  STA PPUADDR
  LDA #$30
  STA PPUDATA
nmiOut:
  LDA #$00
  STA PPUSCROLL
  STA PPUSCROLL
  PLA
  TAY
  PLA
  TAX
  PLA
  RTI

irq:
  INC $0300
  LDA #$00
  STA $E000
  LDA #$01
  STA $E001
  RTI

  .org $FFFA
  .word nmi, reset, irq
`;
  const { chunks } = assemble(src);
  const prg = new Uint8Array(8 * 16384); // 128K: 16 x 8KB banks
  for (const c of chunks) {
    if (c.addr >= 0xC000) prg.set(c.bytes, 0x1C000 + (c.addr - 0xC000));      // fixed 8KB banks n8-2 / n8-1
    else if (c.addr >= 0xA000) prg.set(c.bytes, 0x02000 + (c.addr - 0xA000)); // R7=1 view
    else prg.set(c.bytes, 0x00000 + (c.addr - 0x8000));                       // R6 window, bank 0
  }
  const chr = new Uint8Array(8192);
  for (let r = 0; r < 8; r++) { chr[0x00 + r] = 0xFF; chr[0x08 + r] = 0x00; } // tile 0 solid color 1
  return { rom: buildINES({ prg, chr, mapper: 4, mirroring: 'H' }), chr };
}
