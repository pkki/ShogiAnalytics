<div align="center">

# ♘ ShogiAnalytics

**将棋の力を分析する - 次世代の対局分析ツール**

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Version](https://img.shields.io/badge/version-0.0.0-green.svg)
![React](https://img.shields.io/badge/React-19.2.4-61DAFB?logo=react&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-8.0-646CFF?logo=vite&logoColor=white)

</div>

---

## 🎯 プロジェクト概要

**ShogiAnalytics** は、YaneuraOu USI エンジンと連携する、最新の将棋対局分析プラットフォームです。web ブラウザ及びモバイルデバイスから直感的に将棋の局面を分析し、棋力向上をサポートします。

このリポジトリは **フロントエンド部分** を管理しています。バックエンド（エンジン連携・分析API）は別リポジトリで開発・管理されています。

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

- **React 19** - 最新の UI フレームワーク
- **Vite** - 次世代の高速ビルドツール
- **TailwindCSS** v3 - ユーティリティ first のスタイリング
- **Socket.io Client** - リアルタイム通信
- **React Router** v7 - ページナビゲーション
- **Recharts** - 対局分析グラフの可視化
- **Lucide React** - モダンなアイコン
- **Capacitor** v7 - web アプリをモバイルネイティブ化
- **i18next** - 多言語対応 (日本語・英語)

---

## 📦 クイックスタート

### 必要な環境
- **Node.js** 18+
- **npm** または **yarn**

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
# 開発サーバーを起動 (http://localhost:5173)
npm run dev
```

> 📌 **注:** このリポジトリはフロントエンドのみです。バックエンド（エンジン連携・分析API）は別リポジトリで管理されています。

### 本番ビルド

```bash
# フロントエンドをビルド
npm run build

# ビルド結果は dist/ ディレクトリに出力されます
```

---

## 🚀 デプロイ・ビルド

ビルドされた `dist/` ディレクトリは、任意の静的ファイルサーバーでホストできます：

```bash
# ビルド
npm run build

# ビルド結果をプレビュー
npm run preview
```

**Android アプリ化:**

```bash
# Capacitor で Android アプリをビルド
npm run android:apk
```

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
├── public/                         # 静的アセット
├── vite.config.js
├── tailwind.config.js
├── package.json
└── android/                        # Capacitor Android プロジェクト
```

---

## 🔧 設定

### 環境変数

`.env` ファイルを作成して、バックエンドサーバーの URL を指定できます：

```
VITE_API_URL=http://localhost:3001
```

### ポート設定

- 開発サーバー: `http://localhost:5173`
- バックエンド API: `http://localhost:3001` (デフォルト)

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

本番環境にデプロイする際は、バックエンド（別リポジトリ）で以下の設定を確認してください：

- CORS（Cross-Origin Resource Sharing）の適切な設定
- Socket.io の認証・認可メカニズム
- API エンドポイントの入力検証

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
