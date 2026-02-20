# 環境変数・外部サービス設定一覧

---

## 環境変数

### ANTHROPIC_API_KEY

| 項目 | 内容 |
|------|------|
| 用途 | Claude API の認証 |
| 使用箇所 | `app/api/bundle/route.ts` |
| 設定先（ローカル） | `.env.local` |
| 設定先（本番） | Vercel ダッシュボード → Settings → Environment Variables |
| 取得方法 | [Anthropic Console](https://console.anthropic.com/) でAPIキーを発行 |
| 備考 | 未設定の場合、カスタムオーダー（AI戦略調整）が無効になるが、基本のタイムテーブル生成は動作する |
| アカウント | 個人アカウント（プライベート用）を使用。会社アカウントとは分離済み |

---

## 外部サービス

### Google Apps Script (GAS)

| 項目 | 内容 |
|------|------|
| 用途 | レース区間データ・基準ランナー実績の取得 |
| URL | `https://script.google.com/macros/s/AKfycbz.../exec` |
| 設定箇所 | `app/api/bundle/route.ts` の `GAS_URL` 定数（ハードコード） |
| データソース | Google スプレッドシート |
| 呼び出し形式 | `GET ?action=bundle&race={race}&target={target}` |
| レスポンス | JSON（レース区間、基準ランナースプリット、サマリー） |
| 認証 | 不要（公開デプロイ） |
| 注意 | GASのURLはデプロイごとに変わるため、GAS側を再デプロイした場合は `route.ts` のURLも更新が必要 |

### Claude API

| 項目 | 内容 |
|------|------|
| 用途 | ユーザーのカスタムオーダーに基づく区間ペース・休憩の最適化 |
| エンドポイント | `https://api.anthropic.com/v1/messages` |
| モデル | `claude-sonnet-4-20250514` |
| 認証 | `x-api-key` ヘッダー（ANTHROPIC_API_KEY） |
| APIバージョン | `2023-06-01` |
| max_tokens | 1024 |
| 入力 | レース区間詳細 + ユーザー戦略テキスト |
| 出力 | JSON（multipliers配列、restMinutes配列、notesテキスト） |

### Vercel

| 項目 | 内容 |
|------|------|
| 用途 | ホスティング・自動デプロイ |
| プロジェクトURL | https://sainokuni2026.vercel.app |
| デプロイ方法 | GitHub `main` ブランチへのプッシュで自動 |
| 環境変数 | `ANTHROPIC_API_KEY` を設定済み |
| フレームワーク設定 | Next.js（自動検出） |

### GitHub

| 項目 | 内容 |
|------|------|
| リポジトリ | https://github.com/masaharu-miyasaka/sainokuni2026 |
| ブランチ | `main` |
| Vercel連携 | プッシュ時に自動ビルド・デプロイ |

---

## ローカル環境のセットアップ手順

1. リポジトリをクローン:
   ```bash
   git clone https://github.com/masaharu-miyasaka/sainokuni2026.git
   cd sainokuni2026
   ```

2. 依存パッケージをインストール:
   ```bash
   npm install
   ```

3. `.env.local` を作成:
   ```
   ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxx
   ```

4. 開発サーバーを起動:
   ```bash
   npm run dev
   ```

---

## GAS再デプロイ時の注意

GASのウェブアプリを再デプロイすると新しいURLが発行されます。その場合：

1. `app/api/bundle/route.ts` の `GAS_URL` を新しいURLに更新
2. `npm run build` でビルド確認
3. `git push` でVercelに反映

---

## トラブルシューティング

### カスタムオーダーが反映されない

`ANTHROPIC_API_KEY` が正しく設定されているか確認。Vercelの場合は Environment Variables の設定とデプロイの再実行が必要な場合がある。

### GASからデータが取得できない

GASのデプロイURLが有効か確認。GASの実行権限が「全員」になっているか確認。GASの日次実行回数制限に達していないか確認。

### Vercelにデプロイされない

GitHubリポジトリとVercelプロジェクトの連携が有効か確認。Vercelダッシュボードの Deployments タブでビルドログを確認。
