// Minimal sequential test harness. scripts/run-tests.mjs imports test files
// in order; this module aggregates results and prints a final summary.
const state = { passed: 0, failed: 0, failures: [], file: '' };

export function test(name, fn) {
  try {
    fn();
    state.passed++;
  } catch (err) {
    state.failed++;
    state.failures.push({ file: state.file, name, err: String((err && err.message) || err) });
  }
}

export function eq(actual, expected, msg = '') {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${msg ? msg + ' — ' : ''}expected ${b}, got ${a}`);
}

export function ok(cond, msg = '') {
  if (!cond) throw new Error(msg || 'assertion failed');
}

export function near(actual, expected, tol, msg = '') {
  if (Math.abs(actual - expected) > tol) {
    throw new Error(`${msg ? msg + ' — ' : ''}expected ${expected} ±${tol}, got ${actual}`);
  }
}

export function fileDone(name) {
  console.log(`  ${name}: ${state.passed + state.failed} checks`);
}

export function summary() {
  console.log(`\n${state.passed} passed, ${state.failed} failed`);
  for (const f of state.failures) console.error(`  FAIL [${f.file}] ${f.name}: ${f.err}`);
  return state.failed === 0;
}

export function setFile(name) { state.file = name; }
export function _state() { return state; }
