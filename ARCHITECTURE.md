# アーキテクチャ概要

## システム全体図

```
┌─────────────────┐     ┌──────────────────────────┐     ┌──────────────────┐
│                  │     │   Vercel                 │     │                  │
│  ユーザー端末    │────▶│   Next.js 14 (App Router) │     │  Google Apps     │
│  (iOS / PC)      │◀────│                          │────▶│  Script (GAS)    │
│                  │     │  ┌──────────┐            │◀────│                  │
└─────────────────┘     │  │ page.tsx  │ フロント   │     │  レース区間データ │
                        │  └──────────┘            │     │  基準ランナー実績 │
                        │  ┌──────────────────┐    │     └──────────────────┘
                        │  │ /api/bundle      │    │
                        │  │ route.ts         │────────▶┌──────────────────┐
                        │  │ (サーバーサイド)    │◀───────│  Claude API      │
                        │  └──────────────────┘    │     │  (Sonnet 4)      │
                        └──────────────────────────┘     │  戦略調整         │
                                                         └──────────────────┘
```

---

## リクエストフロー

ユーザーが「生成する」ボタンを押すと、以下の順序でデータが流れます。

### 1. フロントエンド → API Route

```
GET /api/bundle?race=100k&target=15:00:00&strategy=夜間は苦手。20分仮眠したい
```

`page.tsx` が `/api/bundle` にリクエストを送信。`strategy` はカスタムオーダーが入力された場合のみ付与されます。

### 2. API Route → GAS

```
GET https://script.google.com/.../exec?action=bundle&race=100k&target=15:00:00
```

GASはスプレッドシート上のレースデータを参照し、以下を返します：

- **基準ランナー（base）**: 2025年大会の実績データ（順位・氏名・完走タイム・区間スプリット）
- **区間情報（sections）**: 区間名・距離km・獲得標高m
- **サマリー（summary）**: 総距離・累積獲得標高

### 3. API Route → Claude API（strategyがある場合のみ）

`strategy` パラメータが存在する場合、Claude APIを呼び出して戦略調整を取得します。

Claude への入力：各区間の名前・距離・標高・基準タイム・目標スケール後タイムと、ユーザーの戦略テキスト

Claude からの出力（JSON）：

```json
{
  "multipliers": [1.0, 0.95, 1.1, ...],   // 区間ごとのペース倍率
  "restMinutes": [0, 0, 15, 0, ...],       // 区間ごとの休憩分数
  "notes": "戦略の説明テキスト"
}
```

### 4. API Route → フロントエンド

GASデータとClaude調整結果を統合して `BundleResponse` として返却。

### 5. フロントエンドでテーブル生成

`generateTable()` が以下を計算：

- 基準ランナーのスプリットからスケールファクター（目標タイム / 基準タイム）を算出
- 各区間の基準タイムにスケールファクターを掛け、さらにClaudeの `multipliers` を適用
- `restMinutes` の休憩時間を加算
- スタート時刻（JST）から累積して実時刻・日付跨ぎを計算

---

## 主要データ構造

### BundleResponse（APIレスポンス）

```typescript
interface BundleResponse {
  race: string;                    // "100k" or "100mile"
  startTimeJST: string;           // "2026-06-07 05:00" 等
  target: string;                  // "15:00:00"
  base: {
    rank: string;                  // "42"
    name: string;                  // ランナー名
    finishTime: string;            // "14:32:10"
    finishSec: number;             // 秒換算
    splits: Record<string, string>;// 区間名 → "H:MM:SS"
  };
  sections: {
    name: string;                  // "ニューサンピア IN"
    distanceKm: number;            // 8.2
    elevationGainM: number;        // 450
  }[];
  summary: {
    totalDistanceKm: number;
    totalElevationGainM: number;
  };
  adjustment?: {                   // カスタムオーダー利用時のみ
    multipliers: number[];         // 区間数と同じ長さ
    restMinutes: number[];         // 区間数と同じ長さ
    notes: string;
  };
}
```

### TableRow（フロント表示用）

```typescript
interface TableRow {
  name: string;                    // 区間名
  distanceKm: number;
  cumulativeDistanceKm: number;
  elevationGainM: number;
  sectionTime: string;             // "1:23:45"
  cumulative: string;              // "5:30:00"
  realTime: string;                // "10:30"
  dayOffset: number;               // 0=当日, 1=翌日
  pace: string;                    // "10.1"
  restMin: number;                 // 休憩分数
}
```

---

## 画像生成アーキテクチャ

`handleSaveImage` は HTML を経由せず、Canvas 2D API でゼロから描画します。

```
データ（bundle, table）
  ↓
高さ計算（テキスト折り返し考慮）
  ↓
Canvas生成（W=960 × dpr=2 → 実1920px）
  ↓
各セクションを順番に描画
  ├── ヘッダー（バッジ + タイトル）
  ├── レース情報
  ├── Base Runnerカード
  ├── AI Strategyカード（カスタムオーダー時）
  ├── サマリー3カード
  └── 区間カード ×N
  ↓
出力分岐
  ├── iOS: canvas.toBlob → Blob URL → 新タブで <img> 表示（長押し保存）
  └── PC: canvas.toDataURL → <a download> でPNGダウンロード
```

---

## UIコンポーネント構成

page.tsx は単一ファイルで全UIを構成しています（コンポーネント分割なし）。

```
<main> ── 全体コンテナ (max-width: 480px, 背景 #0a0a0a)
  ├── ヘッダー（バッジ + タイトル + サブタイトル）
  ├── レース切替ボタン（100mile / 100km）
  ├── 目標タイム <select>
  ├── カスタムオーダー <textarea>（任意）
  ├── 生成ボタン
  ├── ローディング表示
  ├── エラー表示
  └── 結果エリア（bundle取得後に表示）
      ├── Base Runnerカード
      ├── AI Strategyカード
      ├── サマリー3カード（総距離・累積標高・目標）
      ├── タイムテーブル見出し
      ├── 区間カード ×N（番号・名前・時刻・タグ群）
      └── 画像保存ボタン
```
