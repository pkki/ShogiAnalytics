/**
 * tsumeGenerator.worker.js
 * 詰将棋局面生成を UI スレッドをブロックせずバックグラウンドで実行する。
 *
 * messages:
 *   受信: { cmd: 'generate', numMoves, useRetrograde? }
 *   送信:
 *     { type: 'progress', attempt, max }
 *     { type: 'result', board, hands, attacker, solution, numMoves, method }
 *     { type: 'failed' }
 */
import { generateTsumePosition } from '../utils/tsumeGenerator.js';
import { generateRetrogradeTsume } from '../utils/tsumeRetrograde.js';

self.onmessage = ({ data }) => {
  if (data.cmd !== 'generate') return;
  const { numMoves, useRetrograde } = data;

  const onProgress = (attempt, max) => self.postMessage({ type: 'progress', attempt, max });

  let result = null;

  if (useRetrograde) {
    result = generateRetrogradeTsume(numMoves, Date.now(), onProgress);
    // フォールバック: 逆算失敗時はランダム生成
    if (!result) {
      result = generateTsumePosition(numMoves, Date.now() ^ 0xabcd, onProgress);
    }
  } else {
    result = generateTsumePosition(numMoves, Date.now(), onProgress);
  }

  if (result) {
    self.postMessage({
      type: 'result',
      ...result,
      method: useRetrograde ? 'retrograde' : 'random',
    });
  } else {
    self.postMessage({ type: 'failed' });
  }
};
