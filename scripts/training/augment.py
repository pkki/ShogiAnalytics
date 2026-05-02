"""
データ拡張スクリプト。
少ない素材をオーグメンテーションで水増しする。

使い方:
  python augment.py dataset/ --times 10 --out dataset_aug/

各画像につき --times 枚の拡張画像を生成します。
"""

import os
import sys
import glob
import argparse
import numpy as np
import cv2

def augment(img):
    """1枚から1枚のランダム拡張画像を生成"""
    h, w = img.shape[:2]

    # ランダム回転 ±15度
    angle = np.random.uniform(-15, 15)
    M = cv2.getRotationMatrix2D((w/2, h/2), angle, 1.0)
    img = cv2.warpAffine(img, M, (w, h), borderValue=255)

    # ランダムアフィン（歪み）
    if np.random.rand() < 0.5:
        src = np.float32([[0,0],[w,0],[0,h]])
        shift = w * 0.06
        dst = src + np.random.uniform(-shift, shift, src.shape).astype(np.float32)
        M2 = cv2.getAffineTransform(src, dst)
        img = cv2.warpAffine(img, M2, (w, h), borderValue=255)

    # 明るさ・コントラスト
    alpha = np.random.uniform(0.7, 1.3)
    beta  = np.random.randint(-30, 30)
    img = np.clip(img.astype(np.float32) * alpha + beta, 0, 255).astype(np.uint8)

    # ガウシアンノイズ
    if np.random.rand() < 0.4:
        noise = np.random.normal(0, 8, img.shape).astype(np.float32)
        img = np.clip(img.astype(np.float32) + noise, 0, 255).astype(np.uint8)

    # ランダムクロップ→リサイズ（5%以内）
    if np.random.rand() < 0.5:
        margin = int(w * 0.05)
        x1 = np.random.randint(0, margin+1)
        y1 = np.random.randint(0, margin+1)
        x2 = w - np.random.randint(0, margin+1)
        y2 = h - np.random.randint(0, margin+1)
        img = cv2.resize(img[y1:y2, x1:x2], (w, h), interpolation=cv2.INTER_AREA)

    return img

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('data', help='元データセットディレクトリ（dataset/）')
    parser.add_argument('--times', type=int, default=10, help='1枚あたり生成枚数')
    parser.add_argument('--out', default='dataset_aug', help='出力ディレクトリ')
    args = parser.parse_args()

    total = 0
    for cls_name in os.listdir(args.data):
        src_dir = os.path.join(args.data, cls_name)
        if not os.path.isdir(src_dir):
            continue
        dst_dir = os.path.join(args.out, cls_name)
        os.makedirs(dst_dir, exist_ok=True)

        files = glob.glob(os.path.join(src_dir, '*.png')) + \
                glob.glob(os.path.join(src_dir, '*.jpg'))
        for fpath in files:
            img = cv2.imread(fpath, cv2.IMREAD_GRAYSCALE)
            if img is None:
                continue
            # 元画像もコピー
            cv2.imwrite(os.path.join(dst_dir, os.path.basename(fpath)), img)
            # 拡張画像を生成
            stem = os.path.splitext(os.path.basename(fpath))[0]
            for j in range(args.times):
                aug = augment(img)
                cv2.imwrite(os.path.join(dst_dir, f"{stem}_aug{j:04d}.png"), aug)
                total += 1

        count = len(glob.glob(os.path.join(dst_dir, '*.png')))
        print(f"  {cls_name}: {len(files)} → {count} 枚")

    print(f"\n✓ 合計 {total} 枚の拡張画像を {args.out}/ に保存しました")

if __name__ == '__main__':
    main()
