import { NextResponse } from "next/server";

const GAS_URL =
  "https://script.google.com/macros/s/AKfycbxmvho0M9C8RUdiP8Y3v4sokifm_iq0g_tqk5UlkS-O4JYYyXl0JsUFJWMvPSskO-zr/exec";

// ============================================================
// Claude API 戦略チューニング
// ============================================================
async function getStrategyAdjustment(
  bundle: any,
  strategy: string
): Promise<{
  multipliers: number[];
  restMinutes: number[];
  notes: string;
} | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const sectionNames = bundle.sections.map((s: any) => s.name);
  const sectionCount = sectionNames.length;

  // ベースランナーのスプリットから区間タイムを計算
  const splitKeys = Object.keys(bundle.base.splits);
  const sectionDetails = sectionNames.map((name: string, i: number) => {
    const sec = bundle.sections[i];
    const splitSec = hmsToSec(bundle.base.splits[splitKeys[i]] || "0:00:00");
    const prevSplitSec = i > 0 ? hmsToSec(bundle.base.splits[splitKeys[i - 1]] || "0:00:00") : 0;
    const sectionTimeSec = splitSec - prevSplitSec;
    const targetTotalSec = hmsToSec(bundle.target);
    const baseTotalSec = bundle.base.finishSec;
    const scale = baseTotalSec > 0 ? targetTotalSec / baseTotalSec : 1;
    const scaledSectionMin = Math.round((sectionTimeSec * scale) / 60);
    return `${i + 1}. ${name}（${sec.distanceKm}km, 標高+${sec.elevationGainM}m, 目標ペースでの区間予想: 約${scaledSectionMin}分）`;
  });

  const prompt = `あなたはトレイルランニングの戦略アドバイザーです。

以下のレースデータと選手の戦略希望をもとに、区間ごとのタイム補正とエイド休憩を提案してください。

## レース情報
- 種目: ${bundle.race}
- 目標タイム: ${bundle.target}
- スタート: ${bundle.startTimeJST}
- ベースランナー実績: ${bundle.base.finishTime}（${bundle.base.rank}位）

## 区間一覧（${sectionCount}区間）
${sectionDetails.join("\n")}

## 選手の戦略希望
${strategy}

## 出力ルール
- multipliersは${sectionCount}個の数値配列で、各区間の走行時間補正係数です
  - 1.0 = 変更なし、1.1 = 10%遅くする、0.9 = 10%速くする
  - 休憩を追加する分、他の区間を速めて全体タイムが目標から大きくずれないよう調整してください
- restMinutesは${sectionCount}個の数値配列で、各区間の終了地点（エイド）での追加休憩分数です
  - 通常は0。休憩・仮眠の希望がある場合のみ該当区間に分数を設定
  - 重要: 選手が「○○で△分休憩」と指定した場合、restMinutesの該当区間に正確にその分数を設定してください
  - 例: 「ニューサンピアで20分休憩」→ ニューサンピアIN→ニューサンピアOUT の区間（エイドでの滞在を表す区間）のrestMinutesに設定。到着する区間（...→ニューサンピアIN）ではなく、エイド滞在区間（ニューサンピアIN→ニューサンピアOUT）に設定してください
- notesは戦略の解説（日本語で3-5文、簡潔に）
  - 重要: notesには必ずrestMinutesで設定した実際の休憩分数を正確に記載してください
  - 例: 「ニューサンピアIN2で20分の追加休憩を設定しました」
  - notesとrestMinutesの数値が矛盾しないようにしてください

以下のJSON形式のみで回答してください。JSON以外のテキストは含めないでください。
{
  "multipliers": [${sectionCount}個の数値],
  "restMinutes": [${sectionCount}個の数値],
  "notes": "解説テキスト"
}`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        messages: [
          { role: "user", content: prompt },
        ],
      }),
    });

    const result = await response.json();

    if (result.error) {
      console.error("Claude API error:", result.error);
      return null;
    }

    const text = result.content?.[0]?.text || "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);

    // バリデーション
    if (
      !Array.isArray(parsed.multipliers) ||
      parsed.multipliers.length !== sectionCount
    ) {
      console.error("Invalid multipliers length:", parsed.multipliers?.length, "expected:", sectionCount);
      return null;
    }

    // restMinutesが無い場合はゼロ配列で補完
    const restMinutes = Array.isArray(parsed.restMinutes) && parsed.restMinutes.length === sectionCount
      ? parsed.restMinutes.map(Number)
      : new Array(sectionCount).fill(0);

    return {
      multipliers: parsed.multipliers.map(Number),
      restMinutes,
      notes: String(parsed.notes || ""),
    };
  } catch (e: any) {
    console.error("Claude API call failed:", e.message);
    return null;
  }
}

// HH:MM:SS → 秒
function hmsToSec(hms: string): number {
  const parts = hms.split(":").map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 3600 + parts[1] * 60;
  return 0;
}

// ============================================================
// API Route
// ============================================================
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const race = searchParams.get("race");
  const target = searchParams.get("target");
  const strategy = searchParams.get("strategy");

  if (!race || !target) {
    return NextResponse.json(
      { error: "Missing parameters", required: ["race", "target"] },
      { status: 400 }
    );
  }

  try {
    // GASからbundleデータ取得
    const gasUrl = `${GAS_URL}?action=bundle&race=${encodeURIComponent(race)}&target=${encodeURIComponent(target)}`;
    const gasRes = await fetch(gasUrl);
    const bundle = await gasRes.json();

    if (bundle.error) {
      return NextResponse.json(
        { error: "GAS error", detail: bundle.error },
        { status: 500 }
      );
    }

    // 戦略テキストがあればClaude APIで補正を取得
    if (strategy && strategy.trim()) {
      const adjustment = await getStrategyAdjustment(bundle, strategy.trim());
      if (adjustment) {
        return NextResponse.json({ ...bundle, adjustment });
      }
    }

    return NextResponse.json(bundle);
  } catch (error: any) {
    return NextResponse.json(
      { error: "処理失敗", detail: error.message },
      { status: 500 }
    );
  }
}
