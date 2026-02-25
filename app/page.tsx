"use client";

import { useState } from "react";

// ============================================================
// ユーティリティ関数
// ============================================================

function hmsToSeconds(hms: string): number {
  const parts = hms.split(":").map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 3600 + parts[1] * 60;
  return 0;
}

function secondsToHMS(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.round(sec % 60);
  return h + ":" + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
}

/** 区間名から到着地点名のみを抽出（例: "くぬぎむら→慈光寺" → "慈光寺"） */
function destinationName(name: string): string {
  const idx = name.indexOf("→");
  return idx >= 0 ? name.substring(idx + 1).trim() : name;
}

function addSecondsToStart(startISO: string, sec: number): { time: string; dayOffset: number } {
  const date = new Date(startISO.replace(" ", "T"));
  const startDay = date.getDate();
  date.setSeconds(date.getSeconds() + sec);
  const endDay = date.getDate();
  const dayOffset = endDay - startDay;
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return { time: hh + ":" + mm, dayOffset };
}

function calcScaleFactor(targetSec: number, baseSec: number): number {
  if (baseSec <= 0) return 1;
  return targetSec / baseSec;
}

function generateTimeOptions(race: string): string[] {
  const range = race === "100mile"
    ? { startH: 20, endH: 35 }
    : { startH: 10, endH: 31 };
  const options: string[] = [];
  for (let h = range.startH; h <= range.endH; h++) {
    options.push(h + ":00:00");
    if (h < range.endH) {
      options.push(h + ":30:00");
    }
  }
  return options;
}

function timeLabel(hms: string): string {
  const parts = hms.split(":");
  return parts[0] + "時間" + parts[1] + "分";
}

// ============================================================
// 型定義
// ============================================================

interface Section {
  name: string;
  distanceKm: number;
  elevationGainM: number;
}

interface BundleResponse {
  race: string;
  startTimeJST: string;
  target: string;
  base: {
    rank: string;
    name: string;
    finishTime: string;
    finishSec: number;
    splits: Record<string, string>;
  };
  sections: Section[];
  summary: { totalDistanceKm: number; totalElevationGainM: number };
  adjustment?: {
    multipliers: number[];
    restMinutes: number[];
    notes: string;
  };
  error?: string;
}

interface TableRow {
  name: string;
  distanceKm: number;
  cumulativeDistanceKm: number;
  elevationGainM: number;
  sectionTime: string;
  cumulative: string;
  realTime: string;
  dayOffset: number;
  pace: string;
  restMin: number;
}

// ============================================================
// メインコンポーネント
// ============================================================

export default function Home() {
  const [race, setRace] = useState("100k");
  const [targetInput, setTargetInput] = useState("15:00:00");
  const timeOptions = generateTimeOptions(race);
  const [saving, setSaving] = useState(false);

  const handleRaceChange = (newRace: string) => {
    setRace(newRace);
    setTargetInput(newRace === "100mile" ? "32:00:00" : "15:00:00");
    setBundle(null);
  };
  const [strategyInput, setStrategyInput] = useState("");
  const [bundle, setBundle] = useState<BundleResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async () => {
    if (!targetInput.trim()) {
      setError("目標タイムを入力してください");
      return;
    }
    setLoading(true);
    setError("");
    setBundle(null);
    try {
      let url = "/api/bundle?race=" + race + "&target=" + encodeURIComponent(targetInput.trim());
      if (strategyInput.trim()) {
        url += "&strategy=" + encodeURIComponent(strategyInput.trim());
      }
      const res = await fetch(url);
      const data = await res.json();
      if (data.error) {
        setError(data.error + (data.detail ? ": " + data.detail : ""));
        return;
      }
      setBundle(data);
    } catch (e: any) {
      setError("通信エラー: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  // ============================================================
  // 画像保存: 純粋Canvas 2D描画（html2canvas不使用・iOS完全対応）
  // ============================================================
  const handleSaveImage = async () => {
    if (!bundle || table.length === 0) return;
    setSaving(true);
    try {
      const W = 960; // 論理幅（大きく描画して表示時に縮小）
      const PAD = 32;
      const CONTENT_W = W - PAD * 2;
      const dpr = 2; // Retina解像度（実ピクセル 1920px）

      // --- フォントサイズ定数（画面表示と同等の見た目になるよう2倍） ---
      const S = { // size
        badgeFont: 22, badgeW: 320, badgeH: 44, badgeR: 22,
        title: 52, subTitle: 26,
        raceInfo: 24,
        baseLabel: 20, baseName: 26, baseCardH: 80,
        stratLabel: 20, stratNotes: 26, stratNotesLine: 36,
        summaryLabel: 20, summaryValue: 32, summaryCardH: 80,
        tableLabel: 26,
        numBadge: 22, numBadgeW: 40, numBadgeH: 40,
        sectionName: 26, realTime: 48, dayLabel: 20,
        tagFont: 22, tagH: 36, tagPadX: 14, tagGap: 8, tagLineH: 42,
        cardPad: 20, cardR: 16, cardGap: 12,
      };

      // --- 高さ計算用の仮canvasでテキスト計測 ---
      const tmpC = document.createElement("canvas");
      tmpC.width = 1; tmpC.height = 1;
      const tmpCtx = tmpC.getContext("2d")!;

      const font = (weight: number, size: number) => `${weight} ${size}px -apple-system, BlinkMacSystemFont, sans-serif`;
      const measureText = (text: string, size: number, weight = 400) => {
        tmpCtx.font = font(weight, size);
        return tmpCtx.measureText(text).width;
      };
      const wrapText = (ctx: CanvasRenderingContext2D, text: string, maxW: number, size: number, weight = 400): string[] => {
        ctx.font = font(weight, size);
        const lines: string[] = [];
        let line = "";
        for (const ch of text) {
          if (ch === "\n") { lines.push(line); line = ""; continue; }
          const test = line + ch;
          if (ctx.measureText(test).width > maxW && line.length > 0) { lines.push(line); line = ch; }
          else { line = test; }
        }
        if (line) lines.push(line);
        return lines;
      };

      // --- 高さ計算 ---
      let totalH = 0;
      totalH += 120;  // ヘッダー（タイトル + サブ）
      totalH += 28;   // レース情報行
      totalH += S.baseCardH + 16; // Base Runner
      if (bundle.adjustment) {
        const notesLines = wrapText(tmpCtx, bundle.adjustment.notes || "", CONTENT_W - 48, S.stratNotes);
        totalH += 70 + notesLines.length * S.stratNotesLine;
      }
      totalH += S.summaryCardH + 24; // サマリー3カード
      totalH += 36;  // "タイムテーブル" ラベル
      for (const row of table) {
        const tags = [
          "距離 " + row.distanceKm + "km",
          "累積 " + row.cumulativeDistanceKm + "km",
          "標高+ " + row.elevationGainM + "m",
          "区間 " + row.sectionTime,
          "累積 " + row.cumulative,
          "ペース " + row.pace + "min/km",
        ];
        if (row.restMin > 0) tags.push("休憩 +" + row.restMin + "分");
        let tagRowW = 0; let tagRows = 1;
        for (const t of tags) {
          const tw = measureText(t, S.tagFont, 400) + S.tagPadX * 2;
          if (tagRowW + tw + S.tagGap > CONTENT_W - S.cardPad * 2) { tagRows++; tagRowW = tw + S.tagGap; }
          else { tagRowW += tw + S.tagGap; }
        }
        totalH += 70 + tagRows * S.tagLineH + 20;
      }
      totalH += 80; // 下余白（見切れ防止）

      // --- 本描画 ---
      const canvas = document.createElement("canvas");
      canvas.width = W * dpr;
      canvas.height = totalH * dpr;
      const ctx = canvas.getContext("2d")!;
      ctx.scale(dpr, dpr);

      // 背景
      ctx.fillStyle = "#0a0a0a";
      ctx.fillRect(0, 0, W, totalH);

      let y = PAD;

      // Helper: 角丸四角
      const roundRect = (x: number, ry: number, w: number, h: number, r: number) => {
        ctx.beginPath();
        ctx.moveTo(x + r, ry);
        ctx.lineTo(x + w - r, ry);
        ctx.quadraticCurveTo(x + w, ry, x + w, ry + r);
        ctx.lineTo(x + w, ry + h - r);
        ctx.quadraticCurveTo(x + w, ry + h, x + w - r, ry + h);
        ctx.lineTo(x + r, ry + h);
        ctx.quadraticCurveTo(x, ry + h, x, ry + h - r);
        ctx.lineTo(x, ry + r);
        ctx.quadraticCurveTo(x, ry, x + r, ry);
        ctx.closePath();
      };

      // ===== ヘッダー =====
      roundRect(PAD, y, S.badgeW, S.badgeH, S.badgeR);
      ctx.fillStyle = "rgba(34,197,94,0.15)";
      ctx.fill();
      ctx.strokeStyle = "rgba(34,197,94,0.3)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = "#22c55e";
      ctx.font = font(700, S.badgeFont);
      ctx.fillText("2026 RACE PLANNER", PAD + 20, y + 30);
      y += S.badgeH + 16;

      ctx.fillStyle = "#fff";
      ctx.font = font(800, S.title);
      ctx.fillText("彩の国 TTホイホイ", PAD, y + 44);
      y += 64;

      // ===== レース情報 =====
      ctx.fillStyle = "#b0b8c1";
      ctx.font = font(600, S.raceInfo);
      const raceLabel = (race === "100mile" ? "100mile" : "100km") + " ｜ 目標 " + bundle.target;
      ctx.fillText(raceLabel, PAD, y + 20);
      y += 40;

      // ===== Base Runner =====
      roundRect(PAD, y, CONTENT_W, S.baseCardH, S.cardR);
      ctx.fillStyle = "#141414";
      ctx.fill();
      ctx.strokeStyle = "#222";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = "#6b7280";
      ctx.font = font(700, S.baseLabel);
      ctx.fillText("BASE RUNNER（2025）", PAD + S.cardPad, y + 30);
      ctx.fillStyle = "#fff";
      ctx.font = font(700, S.baseName);
      ctx.fillText(bundle.base.rank + "位", PAD + S.cardPad, y + 60);
      ctx.fillStyle = "#e5e7eb";
      ctx.font = font(400, S.baseName);
      const baseNameX = PAD + S.cardPad + measureText(bundle.base.rank + "位", S.baseName, 700) + 12;
      ctx.fillText(bundle.base.name + " | " + bundle.base.finishTime, baseNameX, y + 60);
      y += S.baseCardH + 16;

      // ===== AI Strategy =====
      if (bundle.adjustment) {
        const notesLines = wrapText(ctx, bundle.adjustment.notes || "", CONTENT_W - 48, S.stratNotes);
        const cardH = 60 + notesLines.length * S.stratNotesLine;
        roundRect(PAD, y, CONTENT_W, cardH, S.cardR);
        ctx.fillStyle = "#1a1406";
        ctx.fill();
        ctx.strokeStyle = "#332d10";
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = "#fbbf24";
        ctx.font = font(800, S.stratLabel);
        let stratLabel = "AI STRATEGY";
        if (totalRestMin > 0) stratLabel += "（休憩追加: 合計" + totalRestMin + "分）";
        ctx.fillText(stratLabel, PAD + S.cardPad, y + 30);
        ctx.fillStyle = "#fde68a";
        ctx.font = font(400, S.stratNotes);
        notesLines.forEach((line, li) => {
          ctx.fillText(line, PAD + S.cardPad, y + 60 + li * S.stratNotesLine);
        });
        y += cardH + 16;
      }

      // ===== サマリー3カード =====
      const summaryItems = [
        { label: "総距離", value: bundle.summary.totalDistanceKm + "km" },
        { label: "累積標高", value: bundle.summary.totalElevationGainM + "m" },
        { label: "目標", value: bundle.target },
      ];
      const cardGap = 12;
      const cardW = (CONTENT_W - cardGap * 2) / 3;
      summaryItems.forEach((item, i) => {
        const cx = PAD + i * (cardW + cardGap);
        roundRect(cx, y, cardW, S.summaryCardH, 12);
        ctx.fillStyle = "#141414";
        ctx.fill();
        ctx.strokeStyle = "#222";
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = "#6b7280";
        ctx.font = font(600, S.summaryLabel);
        ctx.textAlign = "center";
        ctx.fillText(item.label, cx + cardW / 2, y + 30);
        ctx.fillStyle = "#22c55e";
        ctx.font = font(800, S.summaryValue);
        ctx.fillText(item.value, cx + cardW / 2, y + 62);
        ctx.textAlign = "left";
      });
      y += S.summaryCardH + 20;

      // ===== タイムテーブルラベル =====
      ctx.fillStyle = "#b0b8c1";
      ctx.font = font(700, S.tableLabel);
      ctx.fillText("タイムテーブル", PAD, y + 24);
      y += 40;

      // ===== 各区間 =====
      table.forEach((row, i) => {
        const accentColor = row.dayOffset > 0 ? "#f59e0b" : "#22c55e";

        const tags: { text: string; isBold: boolean; bg: string; color: string }[] = [
          { text: "距離 " + row.distanceKm + "km", isBold: false, bg: "#1a1a1a", color: "#e5e7eb" },
          { text: "累積 " + row.cumulativeDistanceKm + "km", isBold: false, bg: "#1a1a1a", color: "#e5e7eb" },
          { text: "標高+ " + row.elevationGainM + "m", isBold: false, bg: "#1a1a1a", color: "#e5e7eb" },
          { text: "区間 " + row.sectionTime, isBold: false, bg: "#1a1a1a", color: "#e5e7eb" },
          { text: "累積 " + row.cumulative, isBold: false, bg: "#1a1a1a", color: "#e5e7eb" },
          { text: "ペース " + row.pace + "min/km", isBold: false, bg: "#1a1a1a", color: "#e5e7eb" },
        ];
        if (row.restMin > 0) {
          tags.push({ text: "休憩 +" + row.restMin + "分", isBold: true, bg: "#332d10", color: "#fbbf24" });
        }

        let tagRowW = 0; let tagRows = 1;
        for (const t of tags) {
          const tw = measureText(t.text, S.tagFont, 400) + S.tagPadX * 2;
          if (tagRowW + tw + S.tagGap > CONTENT_W - S.cardPad * 2) { tagRows++; tagRowW = tw + S.tagGap; }
          else { tagRowW += tw + S.tagGap; }
        }
        const rowH = 70 + tagRows * S.tagLineH + 12;

        // カード背景
        roundRect(PAD, y, CONTENT_W, rowH, S.cardR);
        ctx.fillStyle = "#141414";
        ctx.fill();
        ctx.strokeStyle = "#222";
        ctx.lineWidth = 1;
        ctx.stroke();
        // 左ボーダー
        ctx.fillStyle = accentColor;
        roundRect(PAD, y, 5, rowH, 2);
        ctx.fill();

        // 番号バッジ
        const numX = PAD + S.cardPad;
        roundRect(numX, y + 16, S.numBadgeW, S.numBadgeH, 8);
        ctx.fillStyle = "#1f2937";
        ctx.fill();
        ctx.fillStyle = "#b0b8c1";
        ctx.font = font(700, S.numBadge);
        ctx.textAlign = "center";
        ctx.fillText(String(i + 1), numX + S.numBadgeW / 2, y + 16 + S.numBadgeH * 0.7);
        ctx.textAlign = "left";

        // 区間名
        ctx.fillStyle = "#e5e7eb";
        ctx.font = font(700, S.sectionName);
        ctx.fillText(destinationName(row.name), numX + S.numBadgeW + 12, y + 44);

        // 実時刻（右寄せ）
        ctx.textAlign = "right";
        ctx.fillStyle = accentColor;
        ctx.font = font(800, S.realTime);
        ctx.fillText(row.realTime, PAD + CONTENT_W - S.cardPad, y + 52);
        if (row.dayOffset > 0) {
          const rtW = measureText(row.realTime, S.realTime, 800);
          ctx.font = font(600, S.dayLabel);
          ctx.fillText(dayLabel(row.dayOffset), PAD + CONTENT_W - S.cardPad - rtW - 6, y + 36);
        }
        ctx.textAlign = "left";

        // タグ
        let tx = PAD + S.cardPad;
        let ty = y + 70;
        tags.forEach((tag) => {
          ctx.font = font(tag.isBold ? 700 : 400, S.tagFont);
          const tw = ctx.measureText(tag.text).width + S.tagPadX * 2;
          if (tx + tw > PAD + CONTENT_W - S.cardPad) { tx = PAD + S.cardPad; ty += S.tagLineH; }
          roundRect(tx, ty, tw, S.tagH, 8);
          ctx.fillStyle = tag.bg;
          ctx.fill();
          ctx.fillStyle = tag.color;
          ctx.fillText(tag.text, tx + S.tagPadX, ty + S.tagH * 0.72);
          tx += tw + S.tagGap;
        });

        y += rowH + S.cardGap;
      });

      // ===== 画像出力 =====
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
        || (navigator.userAgent.includes("Macintosh") && navigator.maxTouchPoints > 1);

      if (isIOS) {
        // iOS: Blob URLで<img>を表示 → 長押し保存可能
        canvas.toBlob((blob) => {
          if (!blob) { alert("画像の生成に失敗しました"); setSaving(false); return; }
          const blobUrl = URL.createObjectURL(blob);
          const newTab = window.open("about:blank", "_blank");
          if (newTab) {
            // ページ読み込み後にimgを追加（document.writeはdata URL問題を避ける）
            newTab.document.open();
            newTab.document.write(
              '<!DOCTYPE html><html><head><meta charset="utf-8">' +
              '<meta name="viewport" content="width=device-width,initial-scale=1">' +
              '<title>タイムテーブル</title>' +
              '<style>*{margin:0;padding:0}body{background:#000;min-height:100vh;display:flex;flex-direction:column;align-items:center;padding:16px 0}' +
              'img{width:100%;max-width:480px;display:block}' +
              'p{color:#b0b8c1;font-size:14px;text-align:center;margin-top:16px;font-family:-apple-system,sans-serif}</style>' +
              '</head><body>' +
              '<img src="' + blobUrl + '" />' +
              '<p>画像を長押しして「写真に追加」で保存</p>' +
              '</body></html>'
            );
            newTab.document.close();
          } else {
            // ポップアップブロック時はそのページ内に表示
            const overlay = document.createElement("div");
            overlay.style.cssText = "position:fixed;top:0;left:0;right:0;bottom:0;z-index:9999;background:#000;overflow:auto;padding:16px;display:flex;flex-direction:column;align-items:center";
            const img = document.createElement("img");
            img.src = blobUrl;
            img.style.cssText = "width:100%;max-width:480px";
            const hint = document.createElement("p");
            hint.textContent = "画像を長押しして「写真に追加」で保存";
            hint.style.cssText = "color:#b0b8c1;font-size:14px;margin-top:16px;font-family:-apple-system,sans-serif";
            const closeBtn = document.createElement("button");
            closeBtn.textContent = "閉じる";
            closeBtn.style.cssText = "margin-top:20px;padding:12px 32px;background:#22c55e;color:#000;border:none;border-radius:8px;font-size:16px;font-weight:700";
            closeBtn.onclick = () => { document.body.removeChild(overlay); URL.revokeObjectURL(blobUrl); };
            overlay.appendChild(img);
            overlay.appendChild(hint);
            overlay.appendChild(closeBtn);
            document.body.appendChild(overlay);
          }
        }, "image/png");
      } else {
        const link = document.createElement("a");
        link.download = "timetable_" + race + "_" + (bundle?.target?.replace(/:/g, "") || "") + ".png";
        link.href = canvas.toDataURL("image/png");
        link.click();
      }
    } catch (e: any) {
      alert("画像の保存に失敗しました: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  const generateTable = (): TableRow[] => {
    if (!bundle || !bundle.base || !bundle.sections) return [];
    const { splits, finishSec } = bundle.base;
    const { sections } = bundle;
    const startTime = bundle.startTimeJST;
    const targetSec = hmsToSeconds(bundle.target);
    const scale = calcScaleFactor(targetSec, finishSec);
    const splitKeys = Object.keys(splits);
    const multipliers = bundle.adjustment?.multipliers;
    const restMins = bundle.adjustment?.restMinutes;
    let prevBaseSec = 0;
    let cumAdjustedSec = 0;
    let cumDist = 0;

    return sections
      .map((sec: Section, i: number) => {
        if (i >= splitKeys.length) return null;
        const baseSplitSec = hmsToSeconds(splits[splitKeys[i]]);
        const baseSectionSec = baseSplitSec - prevBaseSec;
        prevBaseSec = baseSplitSec;
        const scaledSectionSec = Math.round(baseSectionSec * scale);
        const mult = multipliers && multipliers[i] !== undefined ? multipliers[i] : 1.0;
        const adjustedSectionSec = Math.round(scaledSectionSec * mult);
        const restMin = restMins && restMins[i] ? restMins[i] : 0;
        const restSec = restMin * 60;
        const totalSectionSec = adjustedSectionSec + restSec;
        cumAdjustedSec += totalSectionSec;
        cumDist += sec.distanceKm;
        const pace = sec.distanceKm > 0 ? (adjustedSectionSec / 60 / sec.distanceKm).toFixed(1) : "-";
        const rt = addSecondsToStart(startTime, cumAdjustedSec);
        return {
          name: sec.name,
          distanceKm: sec.distanceKm,
          cumulativeDistanceKm: Math.round(cumDist * 10) / 10,
          elevationGainM: sec.elevationGainM,
          sectionTime: secondsToHMS(totalSectionSec),
          cumulative: secondsToHMS(cumAdjustedSec),
          realTime: rt.time,
          dayOffset: rt.dayOffset,
          pace,
          restMin,
        };
      })
      .filter(Boolean) as TableRow[];
  };

  const table = generateTable();

  const dayLabel = (offset: number) => {
    if (offset === 0) return "";
    if (offset === 1) return "翌";
    return "+" + offset + "日 ";
  };

  const totalRestMin = bundle?.adjustment?.restMinutes
    ? bundle.adjustment.restMinutes.reduce((a: number, b: number) => a + b, 0)
    : 0;

  return (
    <main style={{
      maxWidth: 480, margin: "0 auto", padding: "0 0 40px",
      background: "#0a0a0a", minHeight: "100vh",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Hiragino Kaku Gothic ProN', 'Noto Sans JP', sans-serif",
      color: "#fff",
    }}>
      {/* ===== ヘッダー ===== */}
      <div style={{ padding: "48px 20px 20px", position: "relative" }}>
        <div style={{
          display: "inline-block",
          background: "rgba(34,197,94,0.15)",
          border: "1px solid rgba(34,197,94,0.3)",
          borderRadius: 20,
          padding: "4px 12px",
          fontSize: 11,
          color: "#22c55e",
          marginBottom: 10,
          letterSpacing: "0.08em",
        }}>
          2026 RACE PLANNER
        </div>

        {/* 画像保存ボタン */}
        {table.length > 0 && (
          <button
            onClick={handleSaveImage}
            disabled={saving}
            style={{
              position: "absolute",
              top: 48,
              right: 20,
              background: "rgba(34,197,94,0.15)",
              border: "1px solid rgba(34,197,94,0.3)",
              borderRadius: 10,
              padding: "8px 12px",
              color: "#22c55e",
              fontSize: 12,
              fontWeight: 700,
              cursor: saving ? "default" : "pointer",
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            {saving ? "保存中..." : "画像保存"}
          </button>
        )}

        <h1 style={{
          fontSize: 26, fontWeight: 800, color: "#fff",
          margin: 0, letterSpacing: "-0.02em",
        }}>
          彩の国 TTホイホイ
        </h1>
        <p style={{ fontSize: 13, color: "#b0b8c1", marginTop: 4 }}>
          Race Timetable Maker
        </p>
      </div>

      {/* ===== 入力フォーム ===== */}
      <div style={{ padding: "0 16px" }}>
        <div style={{
          background: "#141414",
          border: "1px solid #222",
          borderRadius: 16,
          padding: 18,
          marginBottom: 12,
        }}>
          {/* 種目 */}
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#b0b8c1", textTransform: "uppercase" as const, letterSpacing: "0.08em", marginBottom: 10 }}>
              種目
            </label>
            <div style={{ display: "flex", background: "#1a1a1a", borderRadius: 10, padding: 3 }}>
              {[
                { value: "100mile", label: "100mile" },
                { value: "100k", label: "100km" },
              ].map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => handleRaceChange(opt.value)}
                  style={{
                    flex: 1, textAlign: "center", padding: "10px 0",
                    borderRadius: 8, border: "none",
                    fontSize: 14, fontWeight: 700, cursor: "pointer",
                    transition: "all 0.2s",
                    background: race === opt.value ? "#22c55e" : "transparent",
                    color: race === opt.value ? "#000" : "#b0b8c1",
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* 目標タイム */}
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#b0b8c1", textTransform: "uppercase" as const, letterSpacing: "0.08em", marginBottom: 10 }}>
              目標タイム
            </label>
            <select
              value={targetInput}
              onChange={(e) => setTargetInput(e.target.value)}
              style={{
                width: "100%", padding: "14px 16px", fontSize: 20, fontWeight: 700,
                textAlign: "center", border: "none",
                background: "#1a1a1a", borderRadius: 10, color: "#fff",
                appearance: "none" as const, WebkitAppearance: "none" as const,
                backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23b0b8c1' d='M6 8L1 3h10z'/%3E%3C/svg%3E\")",
                backgroundRepeat: "no-repeat",
                backgroundPosition: "right 14px center",
              }}
            >
              {timeOptions.map((t) => (
                <option key={t} value={t}>{timeLabel(t)}</option>
              ))}
            </select>
          </div>

          {/* カスタムオーダー */}
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#b0b8c1", textTransform: "uppercase" as const, letterSpacing: "0.08em", marginBottom: 10 }}>
              カスタムオーダー <span style={{ fontWeight: 400, color: "#6b7280", textTransform: "none" as const }}>（任意）</span>
            </label>
            <textarea
              rows={2}
              placeholder="例: ナイトランが苦手。ニューサンピアで20分仮眠したい"
              value={strategyInput}
              onChange={(e) => setStrategyInput(e.target.value)}
              style={{
                width: "100%", padding: "12px 14px", fontSize: 16,
                border: "none", background: "#1a1a1a", borderRadius: 10,
                color: "#e5e7eb", fontFamily: "inherit",
                resize: "vertical" as const, lineHeight: 1.5, outline: "none",
              }}
            />
            <span style={{ fontSize: 11, color: "#6b7280", marginTop: 6, display: "block" }}>
              AIがオーダーに合わせて区間タイムを調整します
            </span>
          </div>

          {/* 生成ボタン */}
          <button
            onClick={handleSubmit}
            disabled={loading}
            style={{
              width: "100%", padding: "16px", fontSize: 16, fontWeight: 700,
              background: loading ? "#374151" : "#22c55e",
              color: "#000", border: "none", borderRadius: 12,
              cursor: loading ? "default" : "pointer",
              letterSpacing: "0.02em",
              transition: "all 0.2s",
            }}
          >
            {loading ? "生成中..." : "タイムテーブル生成"}
          </button>

          {error && (
            <p style={{ color: "#ef4444", fontSize: 13, marginTop: 12, textAlign: "center" }}>
              {error}
            </p>
          )}
        </div>
      </div>




      {/* ===== キャプチャ用ヘッダー（画像保存時のみ表示される情報） ===== */}
      {bundle && table.length > 0 && (
        <div style={{ padding: "8px 16px 0" }}>
          <div style={{ fontSize: 11, color: "#b0b8c1", marginBottom: 2, fontWeight: 600 }}>
            彩の国 TTホイホイ ｜ {race === "100mile" ? "100mile" : "100km"} ｜ 目標 {bundle.target}
          </div>
        </div>
      )}

      {/* ===== 参考選手情報 ===== */}
      {bundle && bundle.base && (
        <div style={{ padding: "4px 16px 0" }}>
          <div style={{
            background: "#141414", border: "1px solid #222",
            borderRadius: 14, padding: "14px 16px", marginBottom: 10,
          }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#6b7280", textTransform: "uppercase" as const, letterSpacing: "0.1em" }}>
              Base Runner（2025）
            </div>
            <div style={{ fontSize: 14, color: "#e5e7eb", marginTop: 4 }}>
              <strong style={{ color: "#fff" }}>{bundle.base.rank}位</strong>{" "}
              {bundle.base.name}
              <span style={{ color: "#6b7280", margin: "0 6px" }}>|</span>
              {bundle.base.finishTime}
            </div>
          </div>
        </div>
      )}

      {/* ===== AI戦略カード ===== */}
      {bundle && bundle.adjustment && (
        <div style={{ padding: "0 16px" }}>
          <div style={{
            background: "linear-gradient(135deg, #1a1406, #1c1a0a)",
            border: "1px solid #332d10",
            borderRadius: 14, padding: "14px 16px", marginBottom: 10,
          }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: "#fbbf24", textTransform: "uppercase" as const, letterSpacing: "0.1em" }}>
              AI STRATEGY
              {totalRestMin > 0 && (
                <span style={{ fontWeight: 400, marginLeft: 8, fontSize: 10, color: "#fbbf24" }}>
                  （休憩追加: 合計{totalRestMin}分）
                </span>
              )}
            </div>
            <div style={{ fontSize: 13, color: "#fde68a", marginTop: 6, lineHeight: 1.6 }}>
              {bundle.adjustment.notes}
            </div>
          </div>
        </div>
      )}

      {/* ===== サマリー ===== */}
      {bundle && bundle.summary && table.length > 0 && (
        <div style={{ padding: "0 16px", marginBottom: 4 }}>
          <div style={{ display: "flex", gap: 8 }}>
            {[
              { label: "総距離", value: bundle.summary.totalDistanceKm + "km" },
              { label: "累積標高", value: bundle.summary.totalElevationGainM + "m" },
              { label: "目標", value: bundle.target },
            ].map((item, i) => (
              <div key={i} style={{
                flex: 1, background: "#141414", border: "1px solid #222",
                borderRadius: 12, padding: "12px 8px", textAlign: "center",
              }}>
                <div style={{ fontSize: 10, color: "#6b7280", fontWeight: 600 }}>
                  {item.label}
                </div>
                <div style={{ fontSize: 16, fontWeight: 800, color: "#22c55e", marginTop: 2 }}>
                  {item.value}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ===== タイムテーブル ===== */}
      {table.length > 0 && (
        <div style={{ padding: "14px 16px 0" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#b0b8c1", marginBottom: 10 }}>
            タイムテーブル
          </div>

          {table.map((row, i) => (
            <div
              key={i}
              style={{
                background: "#141414",
                border: "1px solid #222",
                borderRadius: 12,
                padding: "14px 16px",
                marginBottom: 8,
                borderLeft: "3px solid " + (row.dayOffset > 0 ? "#f59e0b" : "#22c55e"),
              }}
            >
              {/* 上段 */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#e5e7eb", flex: 1, minWidth: 0 }}>
                  <span style={{
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    width: 22, height: 22, background: "#1f2937", borderRadius: 6,
                    fontSize: 11, fontWeight: 700, color: "#b0b8c1", marginRight: 6,
                  }}>
                    {i + 1}
                  </span>
                  {destinationName(row.name)}
                </div>
                <div style={{
                  fontSize: 24, fontWeight: 800,
                  color: row.dayOffset > 0 ? "#f59e0b" : "#22c55e",
                  marginLeft: 8, whiteSpace: "nowrap" as const,
                }}>
                  {row.dayOffset > 0 && (
                    <span style={{ fontSize: 10, fontWeight: 600, marginRight: 2 }}>
                      {dayLabel(row.dayOffset)}
                    </span>
                  )}
                  {row.realTime}
                </div>
              </div>

              {/* 下段 */}
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" as const }}>
                {[
                  { label: "距離", value: row.distanceKm + "km" },
                  { label: "累積", value: row.cumulativeDistanceKm + "km" },
                  { label: "標高+", value: row.elevationGainM + "m" },
                  { label: "区間", value: row.sectionTime },
                  { label: "累積", value: row.cumulative },
                  { label: "ペース", value: row.pace + "min/km" },
                ].map((d, j) => (
                  <div key={j} style={{
                    fontSize: 10, padding: "3px 8px",
                    background: "#1a1a1a", borderRadius: 6, color: "#b0b8c1",
                  }}>
                    {d.label}{" "}
                    <span style={{ fontWeight: 700, color: "#e5e7eb" }}>{d.value}</span>
                  </div>
                ))}
                {row.restMin > 0 && (
                  <div style={{
                    fontSize: 10, padding: "3px 8px",
                    background: "#332d10", borderRadius: 6,
                    color: "#fbbf24", fontWeight: 700,
                  }}>
                    休憩 +{row.restMin}分
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}


    </main>
  );
}
