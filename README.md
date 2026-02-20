# 彩の国 TTホイホイ

彩の国トレイルランニングレース2026のタイムテーブル生成ツール。目標タイムとカスタムオーダー（任意）を入力すると、過去の実績データとClaude AIによる戦略調整をベースに、区間ごとの通過予定時刻・ペース・累積タイムを算出します。

**本番URL:** https://sainokuni2026.vercel.app
**GitHub:** https://github.com/masaharu-miyasaka/sainokuni2026

---

## 主な機能

- **レース選択** — 100mile / 100km の切り替え
- **目標タイム設定** — 30分刻みのドロップダウンで選択
- **カスタムオーダー（AI戦略調整）** — 自由テキストで走り方の要望を入力すると、Claude AIが区間ごとのペース配分と休憩を最適化
- **タイムテーブル表示** — 区間名・通過時刻・区間タイム・累積タイム・ペース・標高差をカード形式で表示。日付跨ぎにも対応
- **画像保存** — タイムテーブルをPNG画像として保存。iOS（Safari/Chrome）・デスクトップ両対応

---

## 技術スタック

| レイヤー | 技術 |
|----------|------|
| フロントエンド | Next.js 14 (App Router) / React 18 / TypeScript 5 |
| バックエンド | Next.js API Routes（`/api/bundle`） |
| データソース | Google Apps Script (GAS) — レース区間・基準ランナー実績 |
| AI | Claude API (`claude-sonnet-4-20250514`) — 戦略調整 |
| ホスティング | Vercel（GitHub push で自動デプロイ） |
| 画像生成 | Canvas 2D API（純粋なCanvas描画、html2canvas不使用） |

---

## ローカル開発

### 前提条件

- Node.js 18以上
- Anthropic API キー

### セットアップ

```bash
git clone https://github.com/masaharu-miyasaka/sainokuni2026.git
cd sainokuni2026
npm install
```

### 環境変数

`.env.local` を作成：

```
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxx
```

### 起動

```bash
npm run dev
```

http://localhost:3000 で開きます。

### ビルド

```bash
npm run build
npm start
```

---

## デプロイ

GitHubの `main` ブランチにプッシュすると、Vercelが自動でビルド・デプロイします。

```bash
git add app/page.tsx
git commit -m "変更内容"
git push
```

Vercelダッシュボード上で `ANTHROPIC_API_KEY` を環境変数として設定する必要があります。

---

## ファイル構成

```
sainokuni-ai/
├── app/
│   ├── api/bundle/
│   │   └── route.ts       ← API: GAS取得 + Claude戦略調整
│   ├── layout.tsx          ← ルートレイアウト（メタ情報・フォント）
│   └── page.tsx            ← メインUI（全画面・ロジック・画像生成）
├── .env.local              ← 環境変数（git管理外）
├── next.config.js
├── package.json
└── tsconfig.json
```

---

## 関連ドキュメント

- [ARCHITECTURE.md](./ARCHITECTURE.md) — システム構成とデータフロー
- [TECHNICAL_DECISIONS.md](./TECHNICAL_DECISIONS.md) — 技術的な判断とトラブルシュートの記録
- [ENV_SETUP.md](./ENV_SETUP.md) — 環境変数・外部サービスの設定一覧
