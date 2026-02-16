"use client";

import { useState } from "react";

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
  const range = race === "100mile" ? { startH: 20, endH: 35 } : { startH: 10, endH: 31 };
  const options: string[] = [];
  for (let h = range.startH; h <= range.endH; h++) {
    options.push(h + ":00:00");
    if (h < range.endH) { options.push(h + ":30:00"); }
  }
  return options;
}

function timeLabel(hms: string): string {
  const parts = hms.split(":");
  return parts[0] + "時間" + parts[1] + "分";
}

interface Section { name: string; distanceKm: number; elevationGainM: number; }
interface BundleResponse {
  race: string; startTimeJST: string; target: string;
  base: { rank: string; name: string; finishTime: string; finishSec: number; splits: Record<string, string>; };
  sections: Section[];
  summary: { totalDistanceKm: number; totalElevationGainM: number; };
  adjustment?: { multipliers: number[]; sleepMinutes: number; notes: string; };
  error?: string;
}
interface TableRow {
  name: string; distanceKm: number; cumulativeDistanceKm: number; elevationGainM: number;
  sectionTime: string; cumulative: string; realTime: string; dayOffset: number; pace: string;
}

export default function Home() {
  const [race, setRace] = useState("100k");
  const [targetInput, setTargetInput] = useState("15:00:00");
  const timeOptions = generateTimeOptions(race);
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
    if (!targetInput.trim()) { setError("目標タイムを入力してください"); return; }
    setLoading(true); setError(""); setBundle(null);
    try {
      let url = "/api/bundle?race=" + race + "&target=" + encodeURIComponent(targetInput.trim());
      if (strategyInput.trim()) { url += "&strategy=" + encodeURIComponent(strategyInput.trim()); }
      const res = await fetch(url);
      const data = await res.json();
      if (data.error) { setError(data.error + (data.detail ? ": " + data.detail : "")); return; }
      setBundle(data);
    } catch (e: any) { setError("通信エラー: " + e.message);
    } finally { setLoading(false); }
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
    let prevBaseSec = 0;
    let cumAdjustedSec = 0;
    let cumDist = 0;
    return sections.map((sec: Section, i: number) => {
      if (i >= splitKeys.length) return null;
      const baseSplitSec = hmsToSeconds(splits[splitKeys[i]]);
      const baseSectionSec = baseSplitSec - prevBaseSec;
      prevBaseSec = baseSplitSec;
      const scaledSectionSec = Math.round(baseSectionSec * scale);
      const mult = multipliers && multipliers[i] !== undefined ? multipliers[i] : 1.0;
      const adjustedSectionSec = Math.round(scaledSectionSec * mult);
      cumAdjustedSec += adjustedSectionSec;
      cumDist += sec.distanceKm;
      const pace = sec.distanceKm > 0 ? (adjustedSectionSec / 60 / sec.distanceKm).toFixed(1) : "-";
      const rt = addSecondsToStart(startTime, cumAdjustedSec);
      return { name: sec.name, distanceKm: sec.distanceKm, cumulativeDistanceKm: Math.round(cumDist * 10) / 10,
        elevationGainM: sec.elevationGainM, sectionTime: secondsToHMS(adjustedSectionSec), cumulative: secondsToHMS(cumAdjustedSec),
        realTime: rt.time, dayOffset: rt.dayOffset, pace };
    }).filter(Boolean) as TableRow[];
  };

  const table = generateTable();
  const dayLabel = (offset: number) => { if (offset === 0) return ""; if (offset === 1) return "翌"; return "+" + offset + "日 "; };

  return (
    <main style={{ maxWidth: 480, margin: "0 auto", padding: "0 0 40px", background: "#fafafa", minHeight: "100vh",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Hiragino Kaku Gothic ProN', 'Noto Sans JP', sans-serif" }}>

      <div style={{ background: "linear-gradient(135deg, #1a5c2e 0%, #2d8a4e 100%)", padding: "28px 20px 22px", color: "#fff" }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0, letterSpacing: "0.02em" }}>彩の国トレイルランニング 2026</h1>
        <p style={{ fontSize: 13, margin: "4px 0 0", opacity: 0.85 }}>Race Timetable Maker</p>
      </div>

      <div style={{ padding: "16px 16px 0" }}>
        <div style={{ background: "#fff", borderRadius: 12, padding: "20px 16px", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#555", marginBottom: 8 }}>種目</label>
            <div style={{ display: "flex", gap: 8 }}>
              {[{ value: "100mile", label: "100mile" }, { value: "100k", label: "100km" }].map((opt) => (
                <button key={opt.value} onClick={() => handleRaceChange(opt.value)} style={{
                  flex: 1, padding: "10px 0", border: "2px solid", borderColor: race === opt.value ? "#1a5c2e" : "#e0e0e0",
                  borderRadius: 8, background: race === opt.value ? "#f0f8f3" : "#fff", cursor: "pointer" }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: race === opt.value ? "#1a5c2e" : "#333" }}>{opt.label}</div>
                </button>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#555", marginBottom: 8 }}>目標タイム</label>
            <select value={targetInput} onChange={(e) => setTargetInput(e.target.value)} style={{
              width: "100%", padding: "12px 14px", fontSize: 18, fontWeight: 600,
              border: "2px solid #e0e0e0", borderRadius: 8, boxSizing: "border-box",
              textAlign: "center", background: "#fff", color: "#333",
              appearance: "none", WebkitAppearance: "none",
              backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23999' d='M6 8L1 3h10z'/%3E%3C/svg%3E\")",
              backgroundRepeat: "no-repeat", backgroundPosition: "right 14px center" }}>
              {timeOptions.map((t) => (<option key={t} value={t}>{timeLabel(t)}</option>))}
            </select>
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#555", marginBottom: 8 }}>
              戦略調整 <span style={{ fontWeight: 400, color: "#aaa" }}>（任意）</span>
            </label>
            <textarea rows={2} placeholder="例: ナイトランが苦手。ニューサンピアで20分仮眠したい"
              value={strategyInput} onChange={(e) => setStrategyInput(e.target.value)}
              style={{ width: "100%", padding: "10px 12px", fontSize: 14, border: "2px solid #e0e0e0",
                borderRadius: 8, boxSizing: "border-box", resize: "vertical", fontFamily: "inherit", outline: "none" }}
              onFocus={(e) => (e.target.style.borderColor = "#1a5c2e")}
              onBlur={(e) => (e.target.style.borderColor = "#e0e0e0")} />
            <span style={{ fontSize: 11, color: "#aaa", marginTop: 4, display: "block" }}>AIが戦略に合わせて区間タイムを調整します</span>
          </div>

          <button onClick={handleSubmit} disabled={loading} style={{
            width: "100%", padding: "14px 0", fontSize: 16, fontWeight: 700, color: "#fff",
            background: loading ? "#999" : "#1a5c2e", border: "none", borderRadius: 10, cursor: loading ? "default" : "pointer" }}>
            {loading ? "生成中..." : "タイムテーブル生成"}
          </button>
          {error && <p style={{ color: "#d32f2f", fontSize: 13, marginTop: 10, textAlign: "center" }}>{error}</p>}
        </div>
      </div>

      {bundle && bundle.base && (
        <div style={{ padding: "12px 16px 0" }}>
          <div style={{ background: "#fff", borderRadius: 12, padding: "14px 16px", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
            <div style={{ fontSize: 11, color: "#999", fontWeight: 600, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>Base Runner（2025）</div>
            <div style={{ fontSize: 14, color: "#333" }}>
              <span style={{ fontWeight: 700 }}>{bundle.base.rank}位</span> {bundle.base.name}
              <span style={{ color: "#999", margin: "0 6px" }}>|</span>{bundle.base.finishTime}
            </div>
            <div style={{ fontSize: 11, color: "#aaa", marginTop: 4 }}>目標 {bundle.target} に合わせてスケーリング</div>
          </div>
        </div>
      )}

      {bundle && bundle.adjustment && (
        <div style={{ padding: "12px 16px 0" }}>
          <div style={{ background: "#fffbf0", borderRadius: 12, padding: "14px 16px",
            boxShadow: "0 1px 3px rgba(0,0,0,0.06)", border: "1px solid #f0e6d0" }}>
            <div style={{ fontSize: 11, color: "#b8860b", fontWeight: 600, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>AI Strategy</div>
            <div style={{ fontSize: 13, color: "#555", lineHeight: 1.6 }}>{bundle.adjustment.notes}</div>
            {bundle.adjustment.sleepMinutes > 0 && (
              <div style={{ fontSize: 12, color: "#b8860b", fontWeight: 600, marginTop: 8 }}>
                仮眠・休憩: +{bundle.adjustment.sleepMinutes}分
              </div>
            )}
          </div>
        </div>
      )}

      {bundle && bundle.summary && table.length > 0 && (
        <div style={{ padding: "12px 16px 0" }}>
          <div style={{ display: "flex", gap: 8 }}>
            {[{ label: "総距離", value: bundle.summary.totalDistanceKm + "km" },
              { label: "累積標高", value: bundle.summary.totalElevationGainM + "m" },
              { label: "目標", value: bundle.target }].map((item, i) => (
              <div key={i} style={{ flex: 1, background: "#fff", borderRadius: 10, padding: "10px 8px",
                textAlign: "center", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
                <div style={{ fontSize: 10, color: "#999", fontWeight: 600, marginBottom: 2 }}>{item.label}</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: "#333" }}>{item.value}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {table.length > 0 && (
        <div style={{ padding: "16px 16px 0" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#555", marginBottom: 10 }}>タイムテーブル</div>
          {table.map((row, i) => (
            <div key={i} style={{ background: "#fff", borderRadius: 10, padding: "12px 14px", marginBottom: 8,
              boxShadow: "0 1px 2px rgba(0,0,0,0.04)", borderLeft: "4px solid " + (row.dayOffset > 0 ? "#e67e22" : "#1a5c2e") }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#333", flex: 1, minWidth: 0 }}>
                  <span style={{ display: "inline-block", background: "#f0f0f0", borderRadius: 4, padding: "1px 6px",
                    fontSize: 11, fontWeight: 600, color: "#888", marginRight: 6 }}>{i + 1}</span>
                  {row.name}
                </div>
                <div style={{ fontSize: 22, fontWeight: 800, color: "#1a5c2e", marginLeft: 8, whiteSpace: "nowrap" }}>
                  {row.dayOffset > 0 && <span style={{ fontSize: 11, color: "#e67e22", fontWeight: 600, marginRight: 2 }}>{dayLabel(row.dayOffset)}</span>}
                  {row.realTime}
                </div>
              </div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {[{ label: "距離", value: row.distanceKm + "km" }, { label: "累積", value: row.cumulativeDistanceKm + "km" },
                  { label: "標高+", value: row.elevationGainM + "m" }, { label: "区間", value: row.sectionTime },
                  { label: "累積", value: row.cumulative }, { label: "ペース", value: row.pace + "min/km" }].map((d, j) => (
                  <div key={j} style={{ fontSize: 11, color: "#777", background: "#f8f8f8", borderRadius: 4, padding: "2px 7px" }}>
                    <span style={{ color: "#aaa" }}>{d.label}</span> <span style={{ fontWeight: 600, color: "#555" }}>{d.value}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
