"use client";

import { useState, useRef } from "react";

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
  const captureRef = useRef<HTMLDivElement>(null);
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

  const handleSaveImage = async () => {
    if (!captureRef.current) return;
    setSaving(true);
    try {
      const html2canvas = (await import("html2canvas")).default;
      const canvas = await html2canvas(captureRef.current, {
        backgroundColor: "#0a0a0a",
        scale: 2,
        useCORS: true,
      });
      // iOS判定: Safari/Chrome/その他すべてのiOSブラウザはWebKitベースのため同じ制限あり
      // iPadOS 13+は "Macintosh" を返すため touchpoints でも判定
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
        || (navigator.userAgent.includes("Macintosh") && navigator.maxTouchPoints > 1);
      if (isIOS) {
        // iOS: data URI downloadが使えないため新しいタブで画像を表示（Safari/Chrome共通）
        canvas.toBlob((blob) => {
          if (!blob) { alert("画像の生成に失敗しました"); return; }
          const url = URL.createObjectURL(blob);
          const w = window.open(url, "_blank");
          if (!w) {
            const a = document.createElement("a");
            a.href = url;
            a.target = "_blank";
            a.click();
          }
          setTimeout(() => { alert("画像が表示されたら長押しで保存してください"); }, 500);
        }, "image/png");
      } else {
        const link = document.createElement("a");
        link.download = "timetable_" + race + "_" + bundle?.target?.replace(/:/g, "") + ".png";
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
    <main ref={captureRef} style={{
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

          {/* 戦略調整 */}
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#b0b8c1", textTransform: "uppercase" as const, letterSpacing: "0.08em", marginBottom: 10 }}>
              戦略調整 <span style={{ fontWeight: 400, color: "#6b7280", textTransform: "none" as const }}>（任意）</span>
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
              AIが戦略に合わせて区間タイムを調整します
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
                  {row.name}
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
