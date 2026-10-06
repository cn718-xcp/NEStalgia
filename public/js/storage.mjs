// IndexedDB storage: ROM library, save states, battery PRG-RAM, thumbnails.
const DB_NAME = 'nestalgia';
const DB_VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('roms')) db.createObjectStore('roms', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('states')) db.createObjectStore('states', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('sram')) db.createObjectStore('sram', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(store, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function putRom(meta, bytes) {
  return tx('roms', 'readwrite', (s) => s.put({ ...meta, id: meta.id, data: bytes }));
}
export async function getRom(id) {
  return tx('roms', 'readonly', (s) => s.get(id));
}
export async function listRoms() {
  return tx('roms', 'readonly', (s) => s.getAll());
}
export async function deleteRom(id) {
  return tx('roms', 'readwrite', (s) => s.delete(id));
}

export async function putState(key, state, thumb) {
  return tx('states', 'readwrite', (s) => s.put({ key, state, thumb, at: Date.now() }));
}
export async function getState(key) {
  return tx('states', 'readonly', (s) => s.get(key));
}
export async function listStates(prefix) {
  const all = await tx('states', 'readonly', (s) => s.getAll());
  return all.filter((r) => r.key.startsWith(prefix));
}

export async function putSRAM(id, data) {
  return tx('sram', 'readwrite', (s) => s.put({ id, data }));
}
export async function getSRAM(id) {
  return tx('sram', 'readonly', (s) => s.get(id));
}
