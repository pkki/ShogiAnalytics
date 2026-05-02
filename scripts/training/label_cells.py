"""
抽出したセル画像をキーボードで素早くラベリングするツール。

使い方:
  python label_cells.py ./cells/

キー操作:
  1 / 2      先手 / 後手 を選択（デフォルト: 先手）
  k          王
  r          飛車
  b          角
  g          金
  s          銀
  n          桂
  l          香
  p          歩
  R          竜 (+R)
  B          馬 (+B)
  S          全 (+S)
  N          圭 (+N)
  L          杏 (+L)
  P          と (+P)
  Space / e  空マス
  z          1枚戻る（やり直し）
  q / Esc    終了

出力: dataset/ フォルダにクラスごとに振り分け
"""

import sys, os, shutil, glob
import cv2
import numpy as np

# クラス定義 — train.py / pieceClassifier.js と完全一致させること
# 順序: K G S N L B R P +S +N +L +B +R +P  (先手0-13, 後手14-27, 空28)
PIECE_ORDER = ['K','G','S','N','L','B','R','P','+S','+N','+L','+B','+R','+P']

PIECE_KEYS = {
    'k': 'K', 'g': 'G', 's': 'S', 'n': 'N', 'l': 'L',
    'b': 'B', 'r': 'R', 'p': 'P',
    'R': '+R', 'B': '+B', 'S': '+S', 'N': '+N', 'L': '+L', 'P': '+P',
}

ALL_CLASSES = (
    [f"sente_{t}" for t in PIECE_ORDER] +
    [f"gote_{t}"  for t in PIECE_ORDER] +
    ["empty"]
)  # 29クラス

def make_dirs(ds):
    for cls in ALL_CLASSES:
        os.makedirs(os.path.join(ds, cls), exist_ok=True)

def show(path, player, hint):
    img = cv2.imread(path, cv2.IMREAD_GRAYSCALE)
    d = cv2.resize(img, (256, 256), interpolation=cv2.INTER_NEAREST)
    d = cv2.cvtColor(d, cv2.COLOR_GRAY2BGR)
    cv2.putText(d, f"player={'sente' if player==1 else 'gote'}  label={hint}",
                (4, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 255, 200), 1)
    cv2.imshow("Labeler  [1/2=player  k/r/b/g/s/n/l/p/R/B/S/N/L/P=piece  space=empty  z=undo  q=quit]", d)

def main():
    if len(sys.argv) < 2:
        sys.exit("使い方: python label_cells.py <cells_dir> [dataset_dir]")

    cells_dir   = sys.argv[1]
    dataset_dir = sys.argv[2] if len(sys.argv) > 2 else "dataset"
    make_dirs(dataset_dir)

    files = sorted(glob.glob(os.path.join(cells_dir, "*.png")))
    if not files:
        sys.exit(f"画像が見つかりません: {cells_dir}/*.png")

    print(f"{len(files)} 枚を読み込みました。q で終了。")
    player, hint, history, i = 1, "?", [], 0

    while i < len(files):
        show(files[i], player, hint)
        key = cv2.waitKey(0)

        if key in (ord('q'), 27):
            break
        if key == ord('z') and history:
            src, dst = history.pop()
            shutil.move(dst, src)
            i -= 1
            print(f"  ↩ 戻した: {os.path.basename(src)}")
            continue
        if key == ord('1'):
            player = 1; hint = "sente_?"; continue
        if key == ord('2'):
            player = 2; hint = "gote_?"; continue

        if key in (ord(' '), ord('e')):
            cls = "empty"
        elif chr(key) in PIECE_KEYS:
            piece = PIECE_KEYS[chr(key)]
            cls = f"{'sente' if player == 1 else 'gote'}_{piece}"
        else:
            continue

        dst_path = os.path.join(dataset_dir, cls, os.path.basename(files[i]))
        shutil.copy2(files[i], dst_path)
        history.append((files[i], dst_path))
        hint = cls
        print(f"  [{i+1}/{len(files)}] {os.path.basename(files[i])} → {cls}")
        i += 1

    cv2.destroyAllWindows()

    # 集計
    print(f"\n=== ラベリング集計 ===")
    for cls in ALL_CLASSES:
        n = len(glob.glob(os.path.join(dataset_dir, cls, "*.png")))
        if n > 0:
            print(f"  {cls}: {n}枚")
    print(f"\n完了: {dataset_dir}/ にデータを保存しました")
    print(f"次: python augment.py {dataset_dir}/  でデータ拡張")
    print(f"その後: Googleコラボ または Python 3.12 で train.py を実行")

if __name__ == "__main__":
    main()
