// NEStalgia — assembly playground demo programs. Each demo is a complete
// 6502 source that assembles with src/lib/asm.mjs into a 16K/8K NROM cart.
// These run headless in tests AND inside the browser playground.
import { drawFontInto } from './font.mjs';

const PPU_CONSTS = `
PPUCTRL   = $2000
PPUMASK   = $2001
PPUSTATUS = $2002
OAMADDR   = $2003
OAMDMA    = $4014
PPUSCROLL = $2005
PPUADDR   = $2006
PPUDATA   = $2007

  .org $8000
`;

const VBLANK_WAIT = `
  BIT PPUSTATUS
vw1: BIT PPUSTATUS
  BPL vw1
vw2: BIT PPUSTATUS
  BPL vw2
`;

// tile $02 = solid color1, tile $03 = solid color2 (BG pattern table)
export function buildPlaygroundCHR() {
  const chr = new Uint8Array(8192);
  const dot = [0x00, 0x18, 0x18, 0x00, 0x00, 0x18, 0x18, 0x00];
  dot.forEach((v, r) => { chr[0x10 + r] = v; });
  drawFontInto(chr, 0);
  for (let r = 0; r < 8; r++) { chr[0x20 + r] = 0xFF; chr[0x28 + r] = 0x00; } // $02 solid color1
  for (let r = 0; r < 8; r++) { chr[0x30 + r] = 0x00; chr[0x38 + r] = 0xFF; } // $03 solid color2
  // ball sprite in pattern table 1 ($1000 + $A0*16)
  const ball = [0x18, 0x3C, 0x7E, 0xFF, 0xFF, 0x7E, 0x3C, 0x18];
  ball.forEach((v, r) => { chr[0x1000 + 0xA0 * 16 + r] = v; });
  return chr;
}

export const DEMOS = [
  {
    name: 'HELLO — 静态文字与色条',
    source: `${PPU_CONSTS}
reset:
  SEI
  CLD
  LDX #$FF
  TXS
  LDA #$00
  STA PPUCTRL
  STA PPUMASK
${VBLANK_WAIT}
  ; palette
  LDA #$3F
  STA PPUADDR
  LDA #$00
  STA PPUADDR
  LDX #$00
palloop:
  LDA pal,X
  STA PPUDATA
  INX
  CPX #32
  BNE palloop
  ; text "HELLO 6502" at row 10, col 8 -> $2148
  LDA #$21
  STA PPUADDR
  LDA #$48
  STA PPUADDR
  LDX #$00
textloop:
  LDA text,X
  BEQ textDone
  STA PPUDATA
  INX
  BNE textloop
textDone:
  ; two color bars (rows 20-21 -> $2280, rows 24-25 -> $2300)
  LDA #$22
  STA PPUADDR
  LDA #$80
  STA PPUADDR
  LDX #$00
bar1:
  LDA #$02
  STA PPUDATA
  INX
  CPX #64
  BNE bar1
  LDA #$23
  STA PPUADDR
  LDA #$00
  STA PPUADDR
  LDX #$00
bar2:
  LDA #$03
  STA PPUDATA
  INX
  CPX #64
  BNE bar2
  LDA #$00
  STA PPUSCROLL
  STA PPUSCROLL
  STA PPUADDR
  STA PPUADDR
  LDA #%00001010
  STA PPUMASK
forever:
  JMP forever

text:
  .byte 'H','E','L','L','O','6','5','0','2',0
pal:
  .byte $0F,$30,$21,$11, $0F,$16,$26,$36, $0F,$1A,$2A,$3A, $0F,$28,$38,$08
  .byte $0F,$14,$24,$34, $0F,$27,$37,$07, $0F,$15,$25,$35, $0F,$00,$10,$20

  .org $FFFA
  .word 0, reset, 0
`,
  },
  {
    name: 'BOUNCE — NMI 驱动的弹跳球',
    source: `${PPU_CONSTS}
bx   = $00
by   = $01
dxr  = $02
dyr  = $03

reset:
  SEI
  CLD
  LDX #$FF
  TXS
  LDA #$00
  STA PPUCTRL
  STA PPUMASK
${VBLANK_WAIT}
  LDA #$3F
  STA PPUADDR
  LDA #$00
  STA PPUADDR
  LDX #$00
palloop:
  LDA pal,X
  STA PPUDATA
  INX
  CPX #32
  BNE palloop
  ; starting position / velocity
  LDA #100
  STA bx
  STA by
  LDA #3
  STA dxr
  LDA #1
  STA dyr
  ; ball sprite: OAM slot 0 (y, tile, attr, x)
  LDA #100
  STA $0200
  LDA #$A0
  STA $0201
  LDA #$00
  STA $0202
  LDA #100
  STA $0203
  ; NMI on, sprites from pattern table $1000
  LDA #$90
  STA PPUCTRL
  LDA #%00011010
  STA PPUMASK
forever:
  JMP forever

nmi:
  PHA
  TXA
  PHA
  TYA
  PHA
  LDA #$00
  STA OAMADDR
  LDA #$02
  STA OAMDMA
  ; position += velocity
  LDA bx
  CLC
  ADC dxr
  STA bx
  LDA by
  CLC
  ADC dyr
  STA by
  ; bounce on right wall (x >= 244)
  LDA bx
  CMP #244
  BCC xLow
  LDA #$FF
  STA dxr
  JMP xDone
xLow:
  LDA bx
  CMP #12
  BCS xDone
  LDA #$01
  STA dxr
xDone:
  ; bounce on floor (y >= 216)
  LDA by
  CMP #216
  BCC yLow
  LDA #$FF
  STA dyr
  JMP yDone
yLow:
  LDA by
  CMP #16
  BCS yDone
  LDA #$01
  STA dyr
yDone:
  ; push position into OAM
  LDA by
  STA $0200
  LDA bx
  STA $0203
  LDA #$00
  STA PPUSCROLL
  STA PPUSCROLL
  PLA
  TAY
  PLA
  TAX
  PLA
  RTI

pal:
  .byte $0F,$30,$21,$11, $0F,$16,$26,$36, $0F,$1A,$2A,$3A, $0F,$28,$38,$08
  .byte $0F,$14,$24,$34, $0F,$27,$37,$07, $0F,$15,$25,$35, $0F,$00,$10,$20

  .org $FFFA
  .word nmi, reset, 0
`,
  },
  {
    name: 'INPUT — 手柄控制移动',
    source: `${PPU_CONSTS}
bx      = $00
by      = $01
buttons = $0A

reset:
  SEI
  CLD
  LDX #$FF
  TXS
  LDA #$00
  STA PPUCTRL
  STA PPUMASK
${VBLANK_WAIT}
  LDA #$3F
  STA PPUADDR
  LDA #$00
  STA PPUADDR
  LDX #$00
palloop:
  LDA pal,X
  STA PPUDATA
  INX
  CPX #32
  BNE palloop
  LDA #120
  STA bx
  STA by
  LDA #120
  STA $0200
  LDA #$A0
  STA $0201
  LDA #$01
  STA $0202
  LDA #120
  STA $0203
  LDA #$90
  STA PPUCTRL
  LDA #%00011010
  STA PPUMASK
forever:
  JMP forever

nmi:
  PHA
  TXA
  PHA
  TYA
  PHA
  LDA #$00
  STA OAMADDR
  LDA #$02
  STA OAMDMA
  ; read controller 1
  LDA #$01
  STA $4016
  STA $4016
  LDA #$00
  STA $4016
  LDX #$08
readloop:
  LDA $4016
  LSR A
  ROL buttons
  DEX
  BNE readloop
  ; right = bit0, left = bit1
  LDA buttons
  AND #$01
  BEQ noRight
  LDA bx
  CMP #240
  BCS noRight
  CLC
  ADC #2
  STA bx
noRight:
  LDA buttons
  AND #$02
  BEQ noLeft
  LDA bx
  CMP #8
  BCC noLeft
  SEC
  SBC #2
  STA bx
noLeft:
  LDA by
  STA $0200
  LDA bx
  STA $0203
  LDA #$00
  STA PPUSCROLL
  STA PPUSCROLL
  PLA
  TAY
  PLA
  TAX
  PLA
  RTI

pal:
  .byte $0F,$30,$21,$11, $0F,$16,$26,$36, $0F,$1A,$2A,$3A, $0F,$28,$38,$08
  .byte $0F,$14,$24,$34, $0F,$27,$37,$07, $0F,$15,$25,$35, $0F,$00,$10,$20

  .org $FFFA
  .word nmi, reset, 0
`,
  },
];
