"""
将棋駒認識CNN 学習スクリプト。

★ Python 3.14 は TensorFlow 未対応のため、以下のいずれかで実行してください:
   - Google Colab (推奨・無料GPU・手順は下記)
   - Python 3.12 環境 (pyenv / conda)

── Google Colab での使い方 ──────────────────────────────────────────────
1. Colab を開く: https://colab.research.google.com/
2. 左サイドバー「ファイル」から dataset/ フォルダをアップロード
3. このスクリプトもアップロードして実行:
     !pip install tensorflowjs
     !python train.py --data dataset/
4. 生成された model_out/ フォルダをダウンロード
5. public/shogi-model/ に上書きコピー
────────────────────────────────────────────────────────────────────────

必要パッケージ:
  pip install tensorflow tensorflowjs opencv-python numpy

使い方:
  python train.py --data dataset/       # 基本
  python train.py --data dataset_aug/   # データ拡張済みを使う（推奨）

dataset/ 構造 (label_cells.py が自動生成):
  dataset/
    sente_K/  sente_R/  sente_B/ ... (先手 14クラス)
    gote_K/   gote_R/   gote_B/  ... (後手 14クラス)
    empty/                            (空マス)
  合計 29クラス

クラス順 (pieceClassifier.js と完全一致):
  0-13:  先手 K G S N L B R P +S +N +L +B +R +P
  14-27: 後手 (同順)
  28:    empty
"""

import os, sys, argparse
import numpy as np
import cv2

# ── クラス定義 (pieceClassifier.js と一致させること) ───────────────────
PIECE_ORDER = ['K','G','S','N','L','B','R','P','+S','+N','+L','+B','+R','+P']
CLASS_NAMES = (
    [f"sente_{t}" for t in PIECE_ORDER] +  # 0-13
    [f"gote_{t}"  for t in PIECE_ORDER] +  # 14-27
    ["empty"]                               # 28
)
NUM_CLASSES = len(CLASS_NAMES)  # 29
EMPTY_IDX   = NUM_CLASSES - 1  # 28
IMG_SIZE    = 64

def load_dataset(data_dir):
    images, labels = [], []
    for cls_idx, cls_name in enumerate(CLASS_NAMES):
        d = os.path.join(data_dir, cls_name)
        if not os.path.isdir(d):
            print(f"  [skip] {cls_name} (フォルダなし)")
            continue
        files = [f for f in os.listdir(d) if f.lower().endswith(('.png','.jpg','.jpeg'))]
        for fname in files:
            img = cv2.imread(os.path.join(d, fname), cv2.IMREAD_GRAYSCALE)
            if img is None: continue
            img = cv2.resize(img, (IMG_SIZE, IMG_SIZE), interpolation=cv2.INTER_AREA)
            images.append(img.astype(np.float32) / 255.0)
            labels.append(cls_idx)
        if files:
            print(f"  {cls_name}: {len(files)} 枚")
    return (
        np.array(images, dtype=np.float32)[..., np.newaxis],  # [N, 64, 64, 1]
        np.array(labels, dtype=np.int32)
    )

def build_model():
    import tensorflow as tf
    from tensorflow import keras
    inp = keras.Input(shape=(IMG_SIZE, IMG_SIZE, 1))
    x = inp
    for filters in [32, 64, 128, 128]:
        x = keras.layers.Conv2D(filters, 3, padding='same', activation='relu')(x)
        x = keras.layers.BatchNormalization()(x)
        x = keras.layers.MaxPooling2D(2)(x)
    x = keras.layers.GlobalAveragePooling2D()(x)
    x = keras.layers.Dense(256, activation='relu')(x)
    x = keras.layers.Dropout(0.4)(x)
    out = keras.layers.Dense(NUM_CLASSES, activation='softmax')(x)
    return keras.Model(inp, out)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--data',   default='dataset',   help='データセットディレクトリ')
    ap.add_argument('--out',    default='model_out', help='出力ディレクトリ')
    ap.add_argument('--epochs', type=int,   default=60)
    ap.add_argument('--batch',  type=int,   default=32)
    ap.add_argument('--lr',     type=float, default=1e-3)
    ap.add_argument('--val',    type=float, default=0.15)
    args = ap.parse_args()

    import tensorflow as tf
    from tensorflow import keras

    print(f"TensorFlow: {tf.__version__}")
    print(f"\n=== データ読み込み: {args.data}/ ===")
    X, y = load_dataset(args.data)
    print(f"合計: {len(X)} 枚 / {NUM_CLASSES} クラス")

    if len(X) == 0:
        sys.exit("データが0枚です。dataset/ を確認してください。")

    # シャッフル + split
    rng = np.random.default_rng(42)
    idx = rng.permutation(len(X))
    X, y = X[idx], y[idx]
    split = int(len(X) * (1 - args.val))
    X_tr, X_val = X[:split], X[split:]
    y_tr, y_val = y[:split], y[split:]
    print(f"train: {len(X_tr)}  val: {len(X_val)}")

    # クラス重み（データ不均衡対策）
    counts = np.bincount(y_tr, minlength=NUM_CLASSES).astype(float)
    counts[counts == 0] = 1
    class_weight = {i: len(y_tr) / (NUM_CLASSES * counts[i]) for i in range(NUM_CLASSES)}

    print("\n=== 学習開始 ===")
    model = build_model()
    model.compile(
        optimizer=keras.optimizers.Adam(args.lr),
        loss='sparse_categorical_crossentropy',
        metrics=['accuracy'],
    )
    model.summary()

    callbacks = [
        keras.callbacks.EarlyStopping(patience=10, restore_best_weights=True, verbose=1),
        keras.callbacks.ReduceLROnPlateau(factor=0.5, patience=5, verbose=1),
    ]
    model.fit(
        X_tr, y_tr,
        validation_data=(X_val, y_val),
        epochs=args.epochs,
        batch_size=args.batch,
        class_weight=class_weight,
        callbacks=callbacks,
    )

    loss, acc = model.evaluate(X_val, y_val, verbose=0)
    print(f"\n検証精度: {acc*100:.1f}%  損失: {loss:.4f}")

    # H5形式で保存 → CLIでTF.js LayersModelに変換
    import subprocess, sys
    os.makedirs(args.out, exist_ok=True)
    h5_path  = os.path.join(args.out, 'model.h5')
    tfjs_path = os.path.join(args.out, 'tfjs')
    model.save(h5_path)
    print(f"\nKerasモデルを {h5_path} に保存しました")

    converter = os.path.join(os.path.dirname(sys.executable), 'tensorflowjs_converter')
    result = subprocess.run([
        converter,
        '--input_format=keras',
        h5_path,
        tfjs_path,
    ], capture_output=True, text=True)
    if result.returncode != 0:
        print(f"変換エラー:\n{result.stderr}")
        sys.exit(1)

    print(f"\n✓ TF.js モデルを {tfjs_path}/ に保存完了")
    print(f"  中身: {os.listdir(tfjs_path)}")
    print(f"  → {tfjs_path}/ の中身を public/shogi-model/ に上書きしてください")

if __name__ == '__main__':
    main()
