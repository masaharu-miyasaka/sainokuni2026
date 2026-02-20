# 技術的な判断とトラブルシュート記録

このドキュメントでは、開発中に行った主要な技術的判断と、発生した問題の解決過程を記録しています。

---

## 1. 画像保存: html2canvas → Canvas 2D API への全面移行

### 背景

タイムテーブルをPNG画像として保存する機能を実装。当初は `html2canvas` ライブラリを使用してDOMをそのままキャプチャする方式を採用。

### 問題

iOS Safari/Chrome で画像保存時に **"The operation is insecure"** エラーが発生。

### 原因調査の経緯

1. **初期仮説: `toDataURL()` の制限** → iOS向けに `toBlob()` + `window.open()` に変更 → 失敗
2. **iPad対応漏れ?** → iPadOS 13+は `userAgent` が `Macintosh` を返すため `maxTouchPoints > 1` で検出追加 → 失敗
3. **SVGがcanvasを汚染?** → `<select>` の背景SVGデータURIやインラインSVGを除去してからキャプチャ → 失敗
4. **根本原因判明**: iOS WebKit は html2canvas による DOM→Canvas 変換自体でcanvasを「汚染（tainted）」する。SVGの有無に関わらず、DOM由来のcanvasは `toDataURL()` も `toBlob()` もセキュリティエラーになる

### 解決策

html2canvas を完全に廃止し、**Canvas 2D API で構造化データから直接描画**する方式に変更。DOMからの変換が一切発生しないため、canvasが汚染されない。

### 判断理由

- html2canvas のDOM変換はブラウザ間の互換性が不安定（特にモバイル）
- Canvas 2D直接描画はデータから決定的に描画するため再現性が高い
- 描画内容を完全にコントロールできる（フォントサイズ、レイアウト等）
- 依存ライブラリが不要になる（package.jsonにはhtml2canvasが残っているが未使用）

---

## 2. iOS画像保存のUX設計

### 問題

iOS では `<a download>` によるファイルダウンロードが機能しない。

### 解決策

iOS向けに専用のフローを実装：

```
canvas.toBlob() → URL.createObjectURL(blob) → 新タブ → document.write で <img> 表示
```

新タブに画像とともに「画像を長押ししして「写真に追加」で保存」というガイドテキストを表示。

### ポップアップブロック対策

新タブが開けない場合（ポップアップブロック時）のフォールバックとして、現在のページ上にオーバーレイを表示する方式も実装。

### iOS検出ロジック

```typescript
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
  || (navigator.userAgent.includes("Macintosh") && navigator.maxTouchPoints > 1);
```

iPadOS 13以降は userAgent に `Macintosh` が含まれるため、`maxTouchPoints` で補完。なお、iOS上のChromeやFirefox等もすべて内部はWebKitエンジンのため、同じ処理で対応できる。

### 重要な発見: data URL vs Blob URL

当初 `document.write` で data URL を `<img src>` に設定したが、iOSで長押し保存ができなかった。**Blob URL** (`URL.createObjectURL`) に変更することで長押し保存が可能に。

---

## 3. Canvas描画の解像度とサイズ設計

### 課題

Retinaディスプレイで文字がぼやけないようにしつつ、iOS端末で適切なサイズで表示する必要がある。

### 最終設計

| パラメータ | 値 | 説明 |
|-----------|-----|------|
| 論理幅 (W) | 960px | Canvas座標系の幅 |
| デバイスピクセル比 (dpr) | 2 | 実際のピクセル数は W×dpr = 1920px |
| 表示幅 (max-width) | 480px | iOS新タブでの表示サイズ |

### 経緯

- 初回: W=960, dpr=2, 表示480px → 左右が圧縮されて見えた
- 修正1: W=480, dpr=2 → 動作したが文字が小さすぎた
- 最終: W=960, dpr=2, 表示480px に戻し、フォントサイズを全面的に拡大（Sオブジェクトで一元管理）

---

## 4. フォントサイズの一元管理（Sオブジェクト）

### 課題

Canvas描画のフォントサイズをあちこちでハードコードしていたため、一括調整が困難だった。

### 解決策

サイズ定数を `S` オブジェクトに集約：

```typescript
const S = {
  badgeFont: 22, badgeW: 320, badgeH: 44, badgeR: 22,
  title: 52, subTitle: 26,
  raceInfo: 24,
  sectionName: 26, realTime: 48, dayLabel: 20,
  tagFont: 22, tagH: 36, tagPadX: 14, tagGap: 8, tagLineH: 42,
  cardPad: 20, cardR: 16, cardGap: 12,
  // ... 他
};
```

画面表示と同等の見た目になるよう、元のCSSサイズの約2倍の値を設定。

---

## 5. 日付跨ぎ対応

### 課題

100mileレースは夜通し走るため、スタート日の翌日・翌々日に区間通過するケースがある。

### 解決策

`addSecondsToStart()` で実時刻を計算する際に `dayOffset`（日付差）を算出。`dayOffset > 0` の区間はアクセントカラーをオレンジ（`#f59e0b`）に変更し、「翌日」「翌々日」ラベルを表示。

---

## 6. Claude APIプロンプト設計のポイント

### 休憩時間の配置ルール

Claude への指示で最も重要だったのは、**休憩はエイドを「出る」区間に設定する**というルール。例えばエイド「ニューサンピア」で休む場合、「ニューサンピア IN」ではなく **「ニューサンピア OUT」** の `restMinutes` に値を入れる。これはランナーの移動時間計算と整合性を取るため。

### レスポンス検証

Claude のJSON応答に対して以下を検証：

- `multipliers` 配列の長さが区間数と一致するか
- `restMinutes` 配列の存在確認（欠損時は全0で埋める）
- 各値が数値型であることの確認（`Number()` で変換）

---

## 7. デプロイワークフロー

### 構成

GitHub push → Vercel自動ビルド・デプロイ

### 開発環境（Cowork）からの反映手順

Cowork環境からは直接 `git push` できないため、以下のワークフローを採用：

1. Cowork環境でコード変更・ビルド確認
2. 変更箇所をbase64エンコードしたPythonスクリプトを生成
3. ユーザーのMacターミナルでスクリプトを実行し `page.tsx` を更新
4. `npm run build` でビルド確認 → `git push` でデプロイ

### キャッシュに関する注意

Vercelデプロイ後もブラウザキャッシュが残っている場合がある。テスト時はキャッシュクリアまたは `?v=N` パラメータ付きでアクセスする。

---

## 8. UIデザインの選択: ダークモード/ネオンテーマ

### 決定

「B案」として提案されたダークモード＋ネオンアクセントのテーマを採用。

### カラーパレット

- 背景: `#0a0a0a`（ほぼ黒）
- カード背景: `#141414`
- プライマリアクセント: `#22c55e`（グリーン）— 通常区間
- セカンダリアクセント: `#f59e0b`（アンバー）— 翌日区間
- AI戦略: `#fbbf24`（ゴールド）テキスト / `#1a1406` 背景

### スタイリング方式

CSSファイルは使用せず、すべてReactのインラインスタイルで記述。単一ファイル構成のため、外部CSSを持たない方がシンプルに保てると判断。

---

## 9. iOS Safari 自動ズーム防止

### 問題

iOS Safari では `font-size` が16px未満の `<input>` / `<select>` にフォーカスすると自動ズームが発生する。

### 解決策

フォーム要素の `font-size` を `16px` に設定。
