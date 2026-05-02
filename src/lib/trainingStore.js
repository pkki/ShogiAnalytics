// IndexedDB でラベル済みセル画像を永続管理する

const DB_NAME    = 'shogi_training';
const DB_VERSION = 1;
const STORE      = 'samples';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const s = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        s.createIndex('label', 'label', { unique: false });
      }
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

/** { label, imageDataUrl, source } を保存し、採番した id を返す */
export async function saveSample(sample) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE, 'readwrite');
    const req = tx.objectStore(STORE).add({ ...sample, timestamp: Date.now() });
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

/** 全サンプルを返す */
export async function getAllSamples() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

/** クラスごとの件数を返す { label: count } */
export async function getSampleCounts() {
  const all = await getAllSamples();
  const counts = {};
  for (const s of all) counts[s.label] = (counts[s.label] || 0) + 1;
  return counts;
}

/** 全削除 */
export async function clearAllSamples() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readwrite').objectStore(STORE).clear();
    req.onsuccess = () => resolve();
    req.onerror   = e => reject(e.target.error);
  });
}

/** JSZip を使って dataset/ 構造の ZIP を生成し Blob で返す */
export async function exportZip() {
  const [{ default: JSZip }, samples] = await Promise.all([
    import('jszip'),
    getAllSamples(),
  ]);
  const zip = new JSZip();
  const counters = {};
  for (const s of samples) {
    const n = (counters[s.label] = (counters[s.label] || 0) + 1);
    const base64 = s.imageDataUrl.split(',')[1];
    zip.file(`dataset/${s.label}/${s.label}_${String(n).padStart(5, '0')}.png`, base64, { base64: true });
  }
  return zip.generateAsync({ type: 'blob' });
}
