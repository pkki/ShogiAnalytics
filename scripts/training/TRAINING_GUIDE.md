# 将棋駒認識モデル 学習ガイド（ローカル）

## 全体フロー

```
管理者ページでデータ収集 → ZIPエクスポート → ローカルで学習 → モデルをデプロイ
```

> Python 3.12 が必要（3.14はTensorFlow未対応）。  
> このPCには 3.12 がインストール済みなのでそのまま使える。  
> 作業ディレクトリ: `D:\shogi_training\`

---

## Step 1: 環境セットアップ（初回のみ）

`scripts/training/setup_local.bat` をダブルクリックして実行。

内部でやること:
- `D:\shogi_training\venv\` に Python 3.12 仮想環境を作成
- tensorflow / tensorflowjs / opencv / numpy をインストール
- train.py / augment.py を `D:\shogi_training\` にコピー

---

## Step 2: データ収集

1. `http://あなたのURL/admin/training` にアクセス
2. 将棋盤の写真をアップロード
3. コーナーを調整（①②③④をドラッグ）
4. 「セルを切り出す」→ 81マスが表示される
5. 各マスをクリックして駒種を選択（平手なら「平手初期配置を自動入力」）
6. 「ラベル済みを保存」→ ブラウザのIndexedDBに蓄積
7. 十分集まったら「ZIPエクスポート」でダウンロード

> **目安**: 1クラスあたり最低30枚、100枚以上あると安定

---

## Step 3: 学習

1. エクスポートした ZIP を `D:\shogi_training\` に置く
2. `scripts/training/run_training.bat` をダブルクリック
3. 対話形式で進む（データ拡張するか・何倍にするかを聞かれる）
4. 完了すると `D:\shogi_training\model_out\` にモデルが出力される

---

## Step 4: デプロイ

`D:\shogi_training\model_out\` の中身を `public\shogi-model\` に上書きコピー:

```
model.json            → ShogiAnalytics/public/shogi-model/model.json
group1-shard1of1.bin  → ShogiAnalytics/public/shogi-model/group1-shard1of1.bin
```

その後ビルド:

```bash
npm run build
```

---

## クラス定義

| インデックス | クラス名 |
|---|---|
| 0–13 | 先手: K G S N L B R P +S +N +L +B +R +P |
| 14–27 | 後手: K G S N L B R P +S +N +L +B +R +P |
| 28 | empty（空マス） |

合計 **29クラス**。`pieceClassifier.js` / `train.py` / `label_cells.py` すべて同じ定義。

---

## 検証精度の目安

| 精度 | 判断 |
|---|---|
| 95% 以上 | 実用レベル |
| 90〜95% | まあ使える、データ追加推奨 |
| 90% 未満 | データ不足か多様性が足りない |

精度が低い場合は、照明・角度・駒セットを変えて同じ局面を複数枚撮影する。
