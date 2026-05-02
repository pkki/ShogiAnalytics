import * as tf from '@tensorflow/tfjs';

// クラス順: train.py / label_cells.py と完全一致
// 0-13: 先手 K G S N L B R P +S +N +L +B +R +P
// 14-27: 後手 (同順)
// 28: empty
export const LABEL_TO_PIECE = ['K','G','S','N','L','B','R','P','+S','+N','+L','+B','+R','+P'];
const NUM_LABELS = LABEL_TO_PIECE.length; // 14
export const EMPTY_CLASS = NUM_LABELS * 2; // 28

const MODEL_PATH = '/shogi-model/model.json';

export async function loadModel() {
  const m = await tf.loadLayersModel(MODEL_PATH);
  // サニティチェック
  const test = tf.zeros([1, 64, 64, 1]);
  const pred = m.predict(test);
  const cls = (await pred.argMax(1).data())[0];
  test.dispose(); pred.dispose();
  if (cls !== EMPTY_CLASS) console.warn('[pieceClassifier] model sanity check failed: expected class', EMPTY_CLASS, 'got', cls);
  return m;
}

/**
 * 81マスを一括バッチ推論する。
 * cells: HTMLCanvasElement[81]  (row-major)
 * 戻り値: {type, player, promoted}[] 長さ81 (null = 空マス)
 */
export async function classifyBatch(model, cells) {
  return tf.tidy(() => {
    const tensors = cells.map(c => _cellToTensor(c));
    const batch = tf.stack(tensors); // [81, 64, 64, 1]
    const preds = model.predict(batch);
    const classIdxs = preds.argMax(1).arraySync();

    return classIdxs.map(idx => {
      if (idx === EMPTY_CLASS) return null;
      const player = idx < NUM_LABELS ? 1 : 2;
      const labelIdx = idx < NUM_LABELS ? idx : idx - NUM_LABELS;
      const type = LABEL_TO_PIECE[labelIdx];
      return { type, player, promoted: type.startsWith('+') };
    });
  });
}

function _cellToTensor(cellCanvas) {
  const SIZE = 64;
  const tmp = document.createElement('canvas');
  tmp.width = SIZE; tmp.height = SIZE;
  const ctx = tmp.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, SIZE, SIZE);

  // アスペクト比を保ってリサイズして中央配置（shogi-camera normalize_img 互換）
  const cw = cellCanvas.width, ch = cellCanvas.height;
  const scale = Math.min(SIZE / cw, SIZE / ch);
  const dw = Math.round(cw * scale), dh = Math.round(ch * scale);
  const ox = Math.round((SIZE - dw) / 2), oy = Math.round((SIZE - dh) / 2);
  ctx.drawImage(cellCanvas, ox, oy, dw, dh);

  const id = ctx.getImageData(0, 0, SIZE, SIZE);
  const gray = new Float32Array(SIZE * SIZE);
  for (let i = 0; i < gray.length; i++) {
    gray[i] = (id.data[i*4] * 0.299 + id.data[i*4+1] * 0.587 + id.data[i*4+2] * 0.114) / 255;
  }
  return tf.tensor(gray, [SIZE, SIZE, 1]);
}
