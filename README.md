<div align="center">

# ♘ ShogiAnalytics

**将棋の力を分析する - 次世代の対局分析ツール**

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Version](https://img.shields.io/badge/version-0.0.0-green.svg)
![React](https://img.shields.io/badge/React-19.2.4-61DAFB?logo=react&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-Express-339933?logo=node.js&logoColor=white)

</div>

---

## 🎯 プロジェクト概要

**ShogiAnalytics** は、YaneuraOu USI エンジンを搭載した、最新の将棋対局分析プラットフォームです。web ブラウザ及びモバイルデバイスから将棋の局面を深く分析し、棋力向上をサポートします。

### ✨ 主な機能

- 🤖 **高性能エンジン連携** - YaneuraOu USI エンジンによる最強レベルの分析
- 📊 **視覚的な棋譜分析** - 評価値グラフと候補手の分析表示
- 🔄 **リアルタイム分析** - Socket.io による非同期分析結果の即座反映
- 📱 **モバイル対応** - Capacitor で iOS/Android ネイティブアプリ化
- 🌍 **多言語対応** - 日本語・英語自動切り替え (i18next)
- ♟️ **直感的な盤面操作** - タッチ操作対応の高速な駒の操作感
- 💾 **棋譜保存・管理** - 分析結果の永続化と管理機能

---

## 🛠️ 技術スタック

### フロントエンド
- **React 19** + **Vite** - 高速で最新の UI フレームワーク
- **TailwindCSS** v3 - ユーティリティ first のスタイリング
- **Socket.io Client** - リアルタイム通信
- **React Router** v7 - ページナビゲーション
- **Recharts** - 対局分析グラフの可視化
- **Lucide React** - モダンなアイコン

### バックエンド
- **Node.js** + **Express** - 軽量で高速なサーバー
- **Socket.io** - リアルタイム双方向通信
- **YaneuraOu USI** - 将棋エンジン統合

### モバイル
- **Capacitor** v7 - web アプリをネイティブアプリ化

---

## 📦 クイックスタート

### 必要な環境
- **Node.js** 18+
- **npm** または **yarn**
- **YaneuraOu エンジン** (Windows 対応版)

### インストール

```bash
# リポジトリのクローン
git clone https://github.com/yourusername/ShogiAnalytics.git
cd ShogiAnalytics

# 依存パッケージのインストール
npm install
```

### 開発サーバーの起動

```bash
# フロントエンド開発サーバー (http://localhost:5173)
npm run dev

# 別のターミナルでバックエンドサーバーを起動
cd server
npm install
npm start
# バックエンドは http://localhost:3001 で起動します
```

### 本番ビルド

```bash
# フロントエンドのビルド
npm run build

# バックエンドサーバーは自動的に dist/ を静的ファイルとして配信
cd server
npm start
```

---

## 🚀 デプロイ

### リモートアクセス (Cloudflare Tunnel)

モバイルデバイスからのリモートアクセスをサポート：

```bash
# Cloudflared のインストール
# https://developers.cloudflare.com/cloudflare-one/connections/connect-applications/install-and-setup/installation/

# トンネルの起動
cloudflared tunnel --url http://localhost:3001
```

トンネル URL が生成されたら、モバイルブラウザからアクセス可能です。

---

## 📁 プロジェクト構成

```
ShogiAnalytics/
├── src/
│   ├── App.jsx                      # メインアプリケーション
│   ├── components/
│   │   ├── ShogiBoard.jsx          # 盤面表示・操作コンポーネント
│   │   ├── GameSetupDialog.jsx     # AI 対局設定
│   │   └── NavigationPanel.jsx     # ナビゲーション
│   └── state/
│       └── gameState.js            # 棋譜・盤面ロジック
├── server/
│   └── index.js                    # Express + Socket.io + USI エンジン
├── vite.config.js
├── tailwind.config.js
└── package.json
```

---

## 🔧 設定

### YaneuraOu エンジンパス

`server/index.js` で YaneuraOu のパスを指定してください：

```javascript
const enginePath = "D:\\将棋エンジン\\YaneuraOu.exe";
```

### ポート設定

- フロントエンド: `5173` (dev) / `3001` (prod)
- バックエンド: `3001`

---

## 📋 スクリプト一覧

```bash
npm run dev              # 開発サーバーを起動
npm run build           # 本番ビルド
npm run lint            # ESLint でコード検査
npm run preview         # ビルド結果をプレビュー
npm run android:sync    # Android Capacitor を同期
npm run android:open    # Android Studio を開く
npm run android:apk     # Android APK をビルド
```

---

## 🎮 使い方

1. **初期局面から開始** または **棋譜を読み込み**
2. **AI 対手の強さを設定** (複数段階)
3. **盤面を操作** して対局進行
4. **分析パネル** で評価値・候補手を確認
5. **対局結果を保存** して後で確認

---

## 🔐 セキュリティ

- Socket.io は同一オリジンと localhost のみ許可
- 本番環境では CORS を適切に設定してください

---

## 🤝 コントリビューション

問題報告やプルリクエストをお気軽に！

1. Fork してください
2. Feature ブランチを作成 (`git checkout -b feature/AmazingFeature`)
3. コミット (`git commit -m 'Add some AmazingFeature'`)
4. プッシュ (`git push origin feature/AmazingFeature`)
5. Pull Request を作成

---

## 📝 ライセンス

このプロジェクトは **MIT License** の下でライセンスされています。詳細は [LICENSE](LICENSE) をご覧ください。

---

## 💬 お問い合わせ

- **GitHub Issues** - バグ報告・機能リクエスト
- **Discussions** - 議論・質問

---

<div align="center">

### 🌟 将棋の力を磨こう。ShogiAnalytics で。

**Built with ♥️ for Shogi lovers worldwide**

</div>
