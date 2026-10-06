// 6502 disassembler built on the CPU core's opcode table.
import { TABLE } from '../core/cpu.mjs';

const MODE_FMT = {
  imp: () => ({ len: 1, text: '' }),
  acc: () => ({ len: 1, text: ' A' }),
  imm: (r) => ({ len: 2, text: ` #$${r(1).toString(16).padStart(2, '0')}` }),
  zp: (r) => ({ len: 2, text: ` $${r(1).toString(16).padStart(2, '0')}` }),
  zpx: (r) => ({ len: 2, text: ` $${r(1).toString(16).padStart(2, '0')},X` }),
  zpy: (r) => ({ len: 2, text: ` $${r(1).toString(16).padStart(2, '0')},Y` }),
  abs: (r) => ({ len: 3, text: ` $${(r(1) | (r(2) << 8)).toString(16).padStart(4, '0')}` }),
  absx: (r) => ({ len: 3, text: ` $${(r(1) | (r(2) << 8)).toString(16).padStart(4, '0')},X` }),
  absy: (r) => ({ len: 3, text: ` $${(r(1) | (r(2) << 8)).toString(16).padStart(4, '0')},Y` }),
  ind: (r) => ({ len: 3, text: ` ($${(r(1) | (r(2) << 8)).toString(16).padStart(4, '0')})` }),
  izx: (r) => ({ len: 2, text: ` ($${r(1).toString(16).padStart(2, '0')},X)` }),
  izy: (r) => ({ len: 2, text: ` ($${r(1).toString(16).padStart(2, '0')}),Y` }),
  rel: (r, addr) => {
    const off = r(1) < 0x80 ? r(1) : r(1) - 0x100;
    const target = (addr + 2 + off) & 0xFFFF;
    return { len: 2, text: ` $${target.toString(16).padStart(4, '0')}` };
  },
};

// Disassemble one instruction at `addr`. readFn(addr) -> byte.
export function disassemble(readFn, addr) {
  const op = readFn(addr);
  const info = TABLE[op];
  if (!info) return { text: `.byte $${op.toString(16).padStart(2, '0')}`, len: 1, name: '???' };
  const [name, mode] = info;
  const fmt = MODE_FMT[mode] || MODE_FMT.imp;
  const { len, text } = fmt((i) => readFn((addr + i) & 0xFFFF), addr);
  const bytes = [];
  for (let i = 0; i < len; i++) bytes.push(readFn((addr + i) & 0xFFFF).toString(16).padStart(2, '0'));
  return {
    text: `${name}${text}`,
    len,
    name,
    bytes: bytes.join(' '),
    addr,
  };
}
