"""
将棋盤写真から81マスのセル画像を抽出するスクリプト。

必要パッケージ:
  pip install opencv-python numpy

使い方:
  python extract_cells.py <画像ファイル>
  python extract_cells.py <画像ファイル> --corners "x1,y1,x2,y2,x3,y3,x4,y4"
  python extract_cells.py <画像ファイル> --gote   # 後手視点の写真

corners を省略するとOpenCVウィンドウで4点クリック指定できます。
出力: ./cells/<basename>_r<row>c<col>.png  (81枚)
"""

import sys, os, re, argparse
import numpy as np
import cv2

_click_pts = []

def _on_mouse(event, x, y, flags, param):
    if event == cv2.EVENT_LBUTTONDOWN and len(_click_pts) < 4:
        _click_pts.append((x, y))
        cv2.circle(param, (x, y), 8, (0, 200, 0), -1)
        cv2.imshow("四隅をクリック: 左上→右上→右下→左下  [Enter=確定]", param)

def pick_corners(img):
    disp = img.copy()
    win = "四隅をクリック: 左上→右上→右下→左下  [Enter=確定]"
    cv2.namedWindow(win)
    cv2.setMouseCallback(win, _on_mouse, disp)
    print("将棋盤の四隅を 左上→右上→右下→左下 の順でクリックし、Enterで確定してください。")
    while True:
        cv2.imshow(win, disp)
        key = cv2.waitKey(20)
        if key == 13 and len(_click_pts) == 4:
            break
        if key == 27:
            sys.exit(0)
    cv2.destroyAllWindows()
    return np.array(_click_pts, dtype=np.float32)

def warp_board(img, corners, size=576):
    dst = np.array([[0,0],[size,0],[size,size],[0,size]], dtype=np.float32)
    M = cv2.getPerspectiveTransform(corners.astype(np.float32), dst)
    return cv2.warpPerspective(img, M, (size, size))

def extract_cell(board, row, col, size=576, pad=0.12):
    c = size // 9
    crop = board[row*c:(row+1)*c, col*c:(col+1)*c]
    p = round(c * pad)
    crop = crop[p:-p, p:-p]
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    return cv2.resize(gray, (64, 64), interpolation=cv2.INTER_AREA)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("image")
    ap.add_argument("--corners", help="x1,y1,x2,y2,x3,y3,x4,y4 (TL TR BR BL)")
    ap.add_argument("--out", default="cells")
    ap.add_argument("--gote", action="store_true", help="後手視点（180度反転）")
    args = ap.parse_args()

    img = cv2.imread(args.image)
    if img is None:
        sys.exit(f"読み込めません: {args.image}")

    if args.corners:
        nums = list(map(float, re.split(r"[,\s]+", args.corners.strip())))
        corners = np.array(nums, dtype=np.float32).reshape(4, 2)
    else:
        corners = pick_corners(img)

    if args.gote:
        corners = corners[[2, 3, 0, 1]]

    board = warp_board(img, corners)
    os.makedirs(args.out, exist_ok=True)
    base = os.path.splitext(os.path.basename(args.image))[0]

    for r in range(9):
        for c in range(9):
            cell = extract_cell(board, r, c)
            cv2.imwrite(os.path.join(args.out, f"{base}_r{r}c{c}.png"), cell)

    print(f"✓ 81枚を {args.out}/ に保存しました")
    print(f"  次: python label_cells.py {args.out}/")

if __name__ == "__main__":
    main()
