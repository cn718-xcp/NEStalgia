import { assemble, evalExpr, buildINES } from '../tools/asm.mjs';
import { CPU } from '../src/core/cpu.mjs';
import { test, eq, ok } from './harness.mjs';

function flat(resultOrChunks) {
  const chunks = resultOrChunks.chunks || resultOrChunks;
  const out = [];
  for (const c of chunks) { while (out.length < c.addr) out.push(0); out.push(...c.bytes); }
  return new Uint8Array(out);
}

test('encodes immediate and implied', () => {
  const { chunks } = assemble('lda #$05\ntax');
  eq(chunks[0].addr, 0);
  eq([...chunks[0].bytes], [0xA9, 0x05, 0xAA]);
});

test('zero page vs absolute by value', () => {
  const { chunks } = assemble('lda $40\nlda $0240\nldx $40,Y\nldy $0240,X');
  eq([...chunks[0].bytes], [0xA5, 0x40, 0xAD, 0x40, 0x02, 0xB6, 0x40, 0xBC, 0x40, 0x02]);
});

test('all addressing modes of LDA', () => {
  const { chunks } = assemble([
    'lda #$10', 'lda $10', 'lda $10,X', 'lda $1010',
    'lda $1010,X', 'lda $1010,Y', 'lda ($10,X)', 'lda ($10),Y',
  ].join('\n'));
  const b = [...chunks[0].bytes];
  eq([b[0], b[2], b[4], b[6], b[9], b[12], b[15], b[17]],
     [0xA9, 0xA5, 0xB5, 0xAD, 0xBD, 0xB9, 0xA1, 0xB1]);
});

test('branch offsets forward and backward', () => {
  const { chunks } = assemble('loop:\n  beq next\n  bne loop\nnext:\n  nop');
  const b = [...chunks[0].bytes];
  eq(b[0], 0xF0);
  eq(b[1], 0x02, 'forward from $0002 to $0004');
  eq(b[2], 0xD0);
  eq(b[3], 0xFC, 'backward -4');
});

test('expressions and low/high byte operators', () => {
  const syms = {};
  eq(evalExpr('$10 + 4', syms), 0x14);
  eq(evalExpr("<$0240", syms), 0x40);
  eq(evalExpr(">$0240", syms), 0x02);
  eq(evalExpr('(2+3)*4', syms), 20);
  eq(evalExpr("'A'", syms), 0x41);
  eq(evalExpr('$0F & $03', syms), 3);
  eq(evalExpr('1 << 4', syms), 16);
  eq(evalExpr('~$0F & $FF', syms), 0xF0);
});

test('forward references incl word vectors', () => {
  const src = [
    '.org $8000',
    '  jmp start',
    'start:',
    '  lda #<handler',
    '  ldx #>handler',
    'handler:',
    '  nop',
    '.org $FFFA',
    'nmi:',
    '  .word handler, handler, handler',
  ].join('\n');
  const { chunks, symbols } = assemble(src);
  eq(symbols.handler, 0x8007);
  eq(symbols.start, 0x8003);
  const vec = chunks.find(c => c.addr === 0xFFFA);
  ok(vec, 'vector chunk exists');
  eq([...vec.bytes], [0x07, 0x80, 0x07, 0x80, 0x07, 0x80]);
  const code = chunks.find(c => c.addr === 0x8000);
  eq([...code.bytes], [0x4C, 0x03, 0x80, 0xA9, 0x07, 0xA2, 0x80, 0xEA]);
});

test('byte/word/align directives', () => {
  const rom = flat(assemble('.org $0400\n.byte $01, $02, \'A\'\n.word $1234\n.align 16\n.byte $EE'));
  eq([...rom.slice(0x400, 0x403)], [1, 2, 0x41]);
  eq([...rom.slice(0x403, 0x405)], [0x34, 0x12]);
  eq(rom[0x410], 0xEE, 'aligned up to 16');
});

test('end-to-end: assembled program runs correctly on the CPU core', () => {
  const { chunks, symbols } = assemble([
    '.org $0200',
    '  ldx #0',
    'loop:',
    '  lda table,X',
    '  sta $50,X',
    '  inx',
    '  cpx #5',
    '  bne loop',
    'done:',
    '  jmp done',
    'table:',
    '  .byte $11,$22,$33,$44,$55',
  ].join('\n'));
  const ram = new Uint8Array(0x10000);
  for (const c of chunks) for (let i = 0; i < c.bytes.length; i++) ram[c.addr + i] = c.bytes[i];
  const bus = { cpuRead: a => ram[a], cpuWrite: (a, v) => { ram[a] = v; } };
  const cpu = new CPU(bus);
  cpu.PC = 0x0200;
  for (let i = 0; i < 200 && cpu.PC !== symbols.done; i++) cpu.step();
  eq(cpu.PC, symbols.done);
  eq([ram[0x50], ram[0x51], ram[0x52], ram[0x53], ram[0x54]], [0x11, 0x22, 0x33, 0x44, 0x55]);
});

test('end-to-end with (zp),Y and abs,Y', () => {
  const { chunks, symbols } = assemble([
    '.org $0200',
    '  ldy #0',
    'copy:',
    '  lda src,Y',
    '  sta dst,Y',
    '  iny',
    '  cpy #3',
    '  bne copy',
    '  jmp copy',
    'src: .byte $AA,$BB,$CC',
    'dst: .byte 0,0,0',
  ].join('\n'));
  const ram = new Uint8Array(0x10000);
  for (const c of chunks) for (let i = 0; i < c.bytes.length; i++) ram[c.addr + i] = c.bytes[i];
  const bus = { cpuRead: a => ram[a], cpuWrite: (a, v) => { ram[a] = v; } };
  const cpu = new CPU(bus);
  cpu.PC = 0x0200;
  for (let i = 0; i < 200; i++) cpu.step();
  eq(ram[symbols.dst], 0xAA);
  eq(ram[symbols.dst + 2], 0xCC);
});

test('iNES header built correctly', () => {
  const rom = buildINES({ prg: 16384, chr: 8192, mapper: 1, mirroring: 'V', battery: true });
  eq(rom.length, 16 + 16384 + 8192);
  eq([...rom.slice(0, 4)], [0x4E, 0x45, 0x53, 0x1A]);
  eq(rom[4], 1); eq(rom[5], 1);
  eq(rom[6], 0x01 | 0x02 | 0x10, 'V-mirror + battery + mapper low nibble');
  eq(rom[7], 0x00);
});

test('encodings match CPU table opcodes', () => {
  const { chunks } = assemble('lda $1000\nsta $1000\nadc ($40),Y\ninc $FF,X\nbit $40\nrti');
  eq([...chunks[0].bytes], [0xAD, 0x00, 0x10, 0x8D, 0x00, 0x10, 0x71, 0x40, 0xF6, 0xFF, 0x24, 0x40, 0x40]);
});
