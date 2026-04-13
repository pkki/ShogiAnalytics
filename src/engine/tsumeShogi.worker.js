/**
 * tsumeShogi.worker.js
 * 詰将棋ソルバーを UI スレッドをブロックせずバックグラウンドで実行する。
 *
 * messages:
 *   受信: { cmd: 'solve', board, hands, attacker, maxMoves }
 *   送信:
 *     { type: 'progress', currentDepth, maxDepth }   — 各深さ探索開始時
 *     { type: 'solution', solution, numMoves }        — 解発見
 *     { type: 'failed' }                              — maxMoves まで解なし
 */
import { solveTsume } from './tsumeShogi.js';

self.onmessage = ({ data }) => {
  if (data.cmd !== 'solve') return;
  const { board, hands, attacker, maxMoves } = data;

  for (let n = 1; n <= maxMoves; n += 2) {
    self.postMessage({ type: 'progress', currentDepth: n, maxDepth: maxMoves });

    // timeoutMs = 0 → この深さの探索はタイムアウトなし
    // Worker ごと terminate() されれば即停止する
    const sol = solveTsume(board, hands, attacker, n, 0);
    if (sol) {
      self.postMessage({ type: 'solution', solution: sol, numMoves: n });
      return;
    }
  }

  self.postMessage({ type: 'failed' });
};
