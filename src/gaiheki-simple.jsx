import { useState, useRef, useEffect } from "react";

const C = {
  bg: "#f4f1ec", card: "#ffffff", navy: "#1a2840", navyD: "#0f1a28",
  navyL: "#243555", gold: "#b8922a", goldL: "#d4ab4a", goldBg: "#fdf6e8",
  cream: "#ede8df", text: "#1a2030", muted: "#6b7a8d", border: "#ddd8cf",
  danger: "#c0392b", dangerBg: "#fdf0ee", warn: "#9a6200", warnBg: "#fdf6e3",
  ok: "#1a6b4a", okBg: "#eaf5ef", white: "#ffffff",
};
const font = "'Noto Sans JP', 'Hiragino Kaku Gothic ProN', sans-serif";

// ===== 単価データ =====
const PAINT = {
  wood: {
    silicon:   { wall: [2800, 4200], label: "シリコン系", years: 12 },
    inorganic: { wall: [5500, 8000], label: "無機・セラミック系", years: 20 },
    fluoro:    { wall: [4500, 6500], label: "フッ素系", years: 15 },
  },
  rc: {
    silicon:   { wall: [3200, 5000], label: "シリコン系", years: 12 },
    inorganic: { wall: [6500, 9500], label: "無機・セラミック系", years: 20 },
    fluoro:    { wall: [5000, 7500], label: "フッ素系", years: 15 },
  },
};

const ROOF_MAT = {
  slate:     { label: "スレート（コロニアル）", workCost: [2500, 4500], note: "塗装時はタスペーサー必須" },
  galvalume: { label: "ガルバリウム鋼板", workCost: [3000, 5000], note: "専用プライマー必須・10年ごと塗り替え" },
  kawara:    { label: "瓦", workCost: [15000, 25000], note: "耐震のためガルバリウムへの葺き替えを推奨" },
  asphalt:   { label: "アスファルトシングル", workCost: [6000, 10000], note: "砂の状態によりカバー工法推奨" },
  flat:      { label: "陸屋根（防水）", workCost: [4000, 8000], note: "防水工事が必要" },
  other:     { label: "その他・わからない", workCost: [3000, 6000], note: "" },
};

const SCAFFOLD = [700, 1000];
const SEAL_UNIT = [800, 1400];
const HIGHWASH = [150, 250];
const SOLAR_COST = [150000, 350000];

function wan(n) { return Math.round(n / 10000); }
function fmt(n) { return n.toLocaleString("ja-JP"); }

// ===== 写真からAI解析 =====
async function analyzeExterior(files) {
  const images = [];
  for (const file of files) {
    const base64 = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result.split(",")[1]);
      r.onerror = rej;
      r.readAsDataURL(file);
    });
    images.push({ type: "image", source: { type: "base64", media_type: file.type || "image/jpeg", data: base64 } });
  }

  const prompt = `これらは戸建て住宅の外観写真です。写真から読み取れる情報をもとに、以下をJSON形式のみで返してください（前置き・Markdownなし）。

{
  "floors": 数値（階数。1または2または3）,
  "shape": "square"または"rect"または"Lshape"（建物の平面形状の推定）,
  "roofType": "slate"または"galvalume"または"kawara"または"asphalt"または"flat"または"other"（屋根材の推定）,
  "roofShape": "katagare"または"kirizuma"または"yosemune"または"flat"（屋根形状）,
  "wallMaterial": "サイディング"または"モルタル"または"タイル"または"ALC"または"その他"（外壁材の推定）,
  "degradation": "good"または"fair"または"poor"（外壁・屋根の劣化状態の推定）,
  "degradationNote": "劣化状況のコメント（日本語・1〜2文）",
  "hasSolar": true/false（太陽光パネルの有無）,
  "estimatedWidth": 数値（建物の間口の推定m。不明なら0）,
  "estimatedDepth": 数値（建物の奥行きの推定m。不明なら0）,
  "note": "写真から読み取った特記事項（日本語）",
  "confidence": "high"または"medium"または"low"
}

写真から判断できないものはデフォルト値を返してください。`;

  const content = [...images, { type: "text", text: prompt }];

  const res = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      messages: [{ role: "user", content }],
    }),
  });
  const data = await res.json();
  const text = data.content.map(b => b.text || "").join("");
  return JSON.parse(text.replace(/```json|```/g, "").trim());
}

// ===== 壁面積推計（図面なし版）=====
function estimateWallArea(floorArea, floors, shape, roofShape, slope = 3) {
  const shapeFactor = { square: 4.0, rect: 4.4, Lshape: 5.0 }[shape] || 4.0;
  const sideLen = Math.sqrt(floorArea / floors);
  const standardWall = sideLen * shapeFactor * 2.8 * floors;

  // 片流れの場合は妻壁の三角部分を加算
  if (roofShape === "katagare") {
    const rise = sideLen * (slope / 10);
    const triangleArea = sideLen * rise;
    return Math.round(standardWall + triangleArea);
  }
  // 切妻の場合も妻壁を追加
  if (roofShape === "kirizuma") {
    const rise = sideLen * 0.3;
    return Math.round(standardWall + sideLen * rise * 0.5);
  }
  return Math.round(standardWall);
}

function estimateRoofArea(floorArea, floors, roofShape) {
  const base = floorArea / floors;
  const f = { katagare: 1.2, kirizuma: 1.25, yosemune: 1.2, flat: 1.05 }[roofShape] || 1.2;
  return Math.round(base * f);
}

// ===== UI部品 =====
function Card({ children, style = {} }) {
  return (
    <div style={{
      background: C.card, borderRadius: 16, padding: 24,
      boxShadow: "0 2px 20px rgba(0,0,0,0.07)",
      border: `1px solid ${C.border}`, ...style,
    }}>{children}</div>
  );
}

function Alert({ type = "warn", title, children }) {
  const m = {
    warn: { bg: C.warnBg, bd: "#e8c97a", ic: "⚠️", tx: C.warn },
    ng:   { bg: C.dangerBg, bd: "#f5a9a3", ic: "❌", tx: C.danger },
    ok:   { bg: C.okBg, bd: "#9fd4b8", ic: "✅", tx: C.ok },
    info: { bg: "#eef4fb", bd: "#a8c8f0", ic: "💡", tx: "#1a4a7a" },
  };
  const c = m[type] || m.info;
  return (
    <div style={{ background: c.bg, border: `1px solid ${c.bd}`, borderRadius: 10, padding: "12px 14px", marginTop: 10 }}>
      <p style={{ margin: "0 0 4px", fontWeight: 700, color: c.tx, fontSize: 13 }}>{c.ic} {title}</p>
      <div style={{ fontSize: 12, color: c.tx, lineHeight: 1.8 }}>{children}</div>
    </div>
  );
}

function SectionTitle({ n, children }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
      {n && (
        <div style={{
          width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
          background: `linear-gradient(135deg,${C.navy},${C.navyL})`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 13, fontWeight: 900, color: C.white,
        }}>{n}</div>
      )}
      <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: C.navy }}>{children}</h3>
    </div>
  );
}

const inpStyle = {
  width: "100%", padding: "11px 14px", borderRadius: 8,
  border: `1.5px solid ${C.border}`, fontSize: 15,
  background: C.white, color: C.text, outline: "none",
  fontFamily: font, boxSizing: "border-box",
};

function ChoiceBtn({ selected, onClick, children, sub, icon }) {
  return (
    <div onClick={onClick} style={{
      border: `2px solid ${selected ? C.navy : C.border}`,
      borderRadius: 12, padding: "12px 14px", cursor: "pointer",
      background: selected ? `linear-gradient(135deg,${C.navy},${C.navyL})` : C.white,
      transition: "all 0.15s",
      display: "flex", alignItems: "center", gap: 10,
    }}>
      {icon && <span style={{ fontSize: 22, flexShrink: 0 }}>{icon}</span>}
      <div>
        <p style={{ margin: 0, fontWeight: 800, fontSize: 14, color: selected ? C.white : C.navy }}>{children}</p>
        {sub && <p style={{ margin: "2px 0 0", fontSize: 11, color: selected ? "#a8c0e0" : C.muted }}>{sub}</p>}
      </div>
      {selected && <span style={{ marginLeft: "auto", color: C.gold, fontSize: 16, flexShrink: 0 }}>✓</span>}
    </div>
  );
}

function Toggle({ value, onChange, label, hint }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0" }}>
      <div>
        <p style={{ margin: "0 0 2px", fontWeight: 700, fontSize: 14, color: C.navy }}>{label}</p>
        {hint && <p style={{ margin: 0, fontSize: 12, color: C.muted }}>{hint}</p>}
      </div>
      <div onClick={onChange} style={{
        width: 46, height: 26, borderRadius: 13, cursor: "pointer",
        background: value ? C.navy : C.cream,
        position: "relative", transition: "background 0.2s", flexShrink: 0,
      }}>
        <div style={{
          width: 22, height: 22, borderRadius: "50%", background: C.white,
          position: "absolute", top: 2, left: value ? 22 : 2,
          transition: "left 0.2s", boxShadow: "0 1px 4px rgba(0,0,0,0.2)",
        }} />
      </div>
    </div>
  );
}

function ProgressBar({ value, max, color = C.gold }) {
  return (
    <div style={{ background: C.cream, borderRadius: 4, height: 6, overflow: "hidden" }}>
      <div style={{
        background: color, height: "100%", borderRadius: 4,
        width: `${Math.min(100, (value / max) * 100)}%`,
        transition: "width 0.5s ease",
      }} />
    </div>
  );
}

// ===== ステップバー =====
const STEPS = ["建物情報", "工事内容", "診断結果", "資金計画"];

function StepBar({ current }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 24 }}>
      {STEPS.map((s, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center" }}>
          <div style={{ textAlign: "center" }}>
            <div style={{
              width: 30, height: 30, borderRadius: "50%", margin: "0 auto 4px",
              background: i < current ? C.gold : i === current ? C.navy : C.cream,
              border: i === current ? `3px solid ${C.gold}` : "3px solid transparent",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: i < current ? C.navyD : i === current ? C.white : C.muted,
              fontWeight: 800, fontSize: 11,
              boxShadow: i === current ? `0 0 0 4px ${C.gold}33` : "none",
            }}>
              {i < current ? "✓" : i + 1}
            </div>
            <span style={{ fontSize: 9, fontWeight: i === current ? 800 : 400, color: i === current ? C.navy : C.muted, whiteSpace: "nowrap" }}>{s}</span>
          </div>
          {i < STEPS.length - 1 && (
            <div style={{ width: 16, height: 2, marginBottom: 16, background: i < current ? C.gold : C.cream }} />
          )}
        </div>
      ))}
    </div>
  );
}

// ===== メインアプリ =====
export default function App() {
  const [step, setStep] = useState(1);

  // 写真
  const [photos, setPhotos] = useState([]);
  const [previews, setPreviews] = useState([]);
  const [aiAnalysis, setAiAnalysis] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState(null);

  // 建物情報（AI読み取り or 手動）
  const [btype, setBtype] = useState("wood");
  const [age, setAge] = useState("");
  const [floors, setFloors] = useState("2");
  const [floorArea, setFloorArea] = useState("");
  const [shape, setShape] = useState("square");
  const [roofShape, setRoofShape] = useState("kirizuma");
  const [roofMat, setRoofMat] = useState("slate");

  // 工事内容
  const [doWall, setDoWall] = useState(true);
  const [paintType, setPaintType] = useState("silicon");
  const [doRoof, setDoRoof] = useState(false);
  const [roofWorkType, setRoofWorkType] = useState("coat");
  const [doSeal, setDoSeal] = useState(true);
  const [doSolar, setDoSolar] = useState(false);

  // 結果
  const [result, setResult] = useState(null);

  const photoRef = useRef();

  // 写真追加
  const addPhotos = (files) => {
    const arr = Array.from(files);
    setPhotos(p => [...p, ...arr].slice(0, 6));
    arr.forEach(f => {
      const url = URL.createObjectURL(f);
      setPreviews(p => [...p, url].slice(0, 6));
    });
  };

  // AI解析
  const runAnalysis = async () => {
    if (photos.length === 0) return;
    setAnalyzing(true);
    setAnalyzeError(null);
    try {
      const r = await analyzeExterior(photos);
      setAiAnalysis(r);
      // 結果を各フィールドに反映
      if (r.floors) setFloors(String(r.floors));
      if (r.shape) setShape(r.shape);
      if (r.roofType) setRoofMat(r.roofType);
      if (r.roofShape) setRoofShape(r.roofShape);
      if (r.hasSolar) setDoSolar(true);
      // 間口・奥行きから面積推計
      if (r.estimatedWidth > 0 && r.estimatedDepth > 0) {
        const est = Math.round(r.estimatedWidth * r.estimatedDepth * parseInt(r.floors || 2));
        setFloorArea(String(est));
      }
    } catch (e) {
      setAnalyzeError("解析に失敗しました。写真を変えて再試行するか、手動で入力してください。");
    } finally {
      setAnalyzing(false);
    }
  };

  // 計算
  const calcResult = () => {
    const fa = parseFloat(floorArea) || 0;
    const fl = parseInt(floors) || 2;
    const ag = parseInt(age) || 0;
    const slope = roofShape === "katagare" ? 3 : 0;

    const wallA = estimateWallArea(fa, fl, shape, roofShape, slope);
    const roofA = estimateRoofArea(fa, fl, roofShape);
    const sealLen = doSeal ? Math.round(wallA * 0.35) : 0;
    const ageFactor = ag >= 30 ? 1.18 : ag >= 20 ? 1.08 : 1.0;

    const pp = PAINT[btype][paintType];
    const rm = ROOF_MAT[roofMat];

    const wallMin = doWall ? Math.round(wallA * pp.wall[0] * ageFactor) : 0;
    const wallMax = doWall ? Math.round(wallA * pp.wall[1] * ageFactor) : 0;
    const scafMin = Math.round(wallA * SCAFFOLD[0]);
    const scafMax = Math.round(wallA * SCAFFOLD[1]);
    const washMin = Math.round(wallA * HIGHWASH[0]);
    const washMax = Math.round(wallA * HIGHWASH[1]);
    const sealMin = doSeal ? Math.round(sealLen * SEAL_UNIT[0]) : 0;
    const sealMax = doSeal ? Math.round(sealLen * SEAL_UNIT[1]) : 0;

    let roofMin = 0, roofMax = 0;
    if (doRoof) {
      const rc = roofWorkType === "replace"
        ? [rm.workCost[0] * 2, rm.workCost[1] * 2]
        : rm.workCost;
      roofMin = Math.round(roofA * rc[0] / 1000 * ageFactor) * 1000;
      roofMax = Math.round(roofA * rc[1] / 1000 * ageFactor) * 1000;
    }
    const solarMin = doSolar ? SOLAR_COST[0] : 0;
    const solarMax = doSolar ? SOLAR_COST[1] : 0;

    const totalMin = wallMin + scafMin + washMin + sealMin + roofMin + solarMin;
    const totalMax = wallMax + scafMax + washMax + sealMax + roofMax + solarMax;
    const years = pp.years;
    const yearsLeft = Math.max(1, years - (ag % years));
    const midTotal = Math.round((totalMin + totalMax) / 2);
    // 未修繕超過の判定
    const isOverdue = ag >= years;
    const overdueYears = isOverdue ? ag % years : 0;

    setResult({
      wallA, roofA, sealLen,
      wall: { min: wallMin, max: wallMax },
      scaffold: { min: scafMin, max: scafMax },
      wash: { min: washMin, max: washMax },
      seal: { min: sealMin, max: sealMax },
      roof: { min: roofMin, max: roofMax },
      solar: { min: solarMin, max: solarMax },
      total: { min: totalMin, max: totalMax },
      yearsLeft, midTotal,
      monthly: Math.round(midTotal / (yearsLeft * 12)),
      paintLabel: pp.label, paintYears: years,
      roofMatLabel: rm.label,
      isOverdue, overdueYears,
    });
    setStep(3);
  };

  // ===== ヘッダー =====
  const Header = () => (
    <div style={{ background: `linear-gradient(135deg,${C.navyD},${C.navyL})`, padding: "0 20px", boxShadow: "0 4px 20px rgba(0,0,0,0.25)" }}>
      <div style={{ maxWidth: 640, margin: "0 auto", padding: "16px 0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 42, height: 42, borderRadius: 10, flexShrink: 0, background: `linear-gradient(135deg,${C.gold},${C.goldL})`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>🏠</div>
          <div>
            <h1 style={{ margin: 0, fontSize: 16, fontWeight: 900, color: C.white }}>外壁・屋根 かんたん修繕診断</h1>
            <p style={{ margin: "2px 0 0", fontSize: 10, color: C.goldL, letterSpacing: 1 }}>一級建築士監修 ✦ 写真を撮るだけ・3分で完了</p>
          </div>
        </div>
      </div>
    </div>
  );

  const wrap = { maxWidth: 640, margin: "0 auto", padding: "24px 16px 60px" };

  // ===== STEP 0: 写真撮影 =====
  const Step0 = () => (
    <div>
      {/* 導入 */}
      <div style={{ textAlign: "center", marginBottom: 24 }}>
        <div style={{ fontSize: 52, marginBottom: 8 }}>📸</div>
        <h2 style={{ margin: "0 0 8px", fontSize: 20, fontWeight: 900, color: C.navy }}>
          建物の外観写真を撮ってください
        </h2>
        <p style={{ margin: 0, fontSize: 13, color: C.muted, lineHeight: 1.8 }}>
          図面がなくてもOK。スマホで外観を撮るだけで<br />
          AIが建物を分析して修繕費用を診断します。
        </p>
      </div>

      <Card style={{ marginBottom: 16 }}>
        <SectionTitle n={null}>撮影のポイント</SectionTitle>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 20 }}>
          {[
            { icon: "🏠", label: "正面全体", hint: "建物全体が入るように" },
            { icon: "↔️", label: "側面（左右）", hint: "横幅・奥行きがわかる写真" },
            { icon: "🔍", label: "外壁の状態", hint: "ひび割れ・色あせ部分" },
            { icon: "🏚", label: "屋根まわり", hint: "屋根の形・材料がわかる写真" },
          ].map(p => (
            <div key={p.label} style={{ background: C.bg, borderRadius: 10, padding: 12, textAlign: "center" }}>
              <div style={{ fontSize: 24, marginBottom: 4 }}>{p.icon}</div>
              <p style={{ margin: "0 0 2px", fontWeight: 700, fontSize: 13, color: C.navy }}>{p.label}</p>
              <p style={{ margin: 0, fontSize: 11, color: C.muted }}>{p.hint}</p>
            </div>
          ))}
        </div>

        {/* アップロードエリア */}
        <label style={{
          display: "block",
          border: `2px dashed ${previews.length > 0 ? C.gold : C.border}`,
          borderRadius: 14, padding: 28, textAlign: "center",
          cursor: "pointer", background: previews.length > 0 ? C.goldBg : C.bg,
          transition: "all 0.2s", marginBottom: 16,
        }}>
          <input ref={photoRef} type="file" accept="image/*" multiple
            style={{ display: "none" }}
            onChange={e => { if (e.target.files.length > 0) addPhotos(e.target.files); }}
          />
          {previews.length === 0 ? (
            <div>
              <div style={{ fontSize: 40, marginBottom: 8 }}>📷</div>
              <p style={{ margin: "0 0 4px", fontWeight: 800, fontSize: 15, color: C.navy }}>
                タップして写真を選択
              </p>
              <p style={{ margin: 0, fontSize: 12, color: C.muted }}>
                複数枚まとめて選べます（最大6枚）
              </p>
            </div>
          ) : (
            <div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", marginBottom: 10 }}>
                {previews.map((url, i) => (
                  <img key={i} src={url} alt={`外観${i + 1}`}
                    style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 8, border: `2px solid ${C.gold}` }} />
                ))}
                {previews.length < 6 && (
                  <div style={{
                    width: 72, height: 72, borderRadius: 8,
                    border: `2px dashed ${C.border}`, background: C.bg,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 24, color: C.muted,
                  }}>+</div>
                )}
              </div>
              <p style={{ margin: 0, fontSize: 12, color: C.gold, fontWeight: 700 }}>
                {previews.length}枚選択済み（タップで追加・変更）
              </p>
            </div>
          )}
        </label>

        {/* AI解析ボタン */}
        {previews.length > 0 && !analyzing && !aiAnalysis && (
          <button onClick={runAnalysis} style={{
            width: "100%", padding: "14px", borderRadius: 10, fontSize: 15,
            fontWeight: 800, border: "none", cursor: "pointer",
            background: `linear-gradient(135deg,${C.gold},${C.goldL})`,
            color: C.navyD, boxShadow: `0 4px 16px ${C.gold}55`,
            marginBottom: 12,
          }}>
            🤖 AIで外観を解析する
          </button>
        )}

        {/* 解析中 */}
        {analyzing && (
          <div style={{ textAlign: "center", padding: "16px 0" }}>
            <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
            <div style={{ width: 40, height: 40, borderRadius: "50%", border: `4px solid ${C.cream}`, borderTop: `4px solid ${C.gold}`, margin: "0 auto 12px", animation: "spin 0.8s linear infinite" }} />
            <p style={{ margin: 0, fontWeight: 700, color: C.navy, fontSize: 14 }}>AIが外観を解析中...</p>
            <p style={{ margin: "4px 0 0", fontSize: 12, color: C.muted }}>屋根材・外壁・劣化状態を読み取っています</p>
          </div>
        )}

        {/* エラー */}
        {analyzeError && <Alert type="ng" title="解析エラー">{analyzeError}</Alert>}

        {/* AI解析結果 */}
        {aiAnalysis && (
          <div style={{ background: C.navy, borderRadius: 12, padding: 16 }}>
            <p style={{ margin: "0 0 12px", fontWeight: 800, fontSize: 13, color: C.goldL }}>
              🤖 AIが読み取った情報（精度：{aiAnalysis.confidence === "high" ? "高" : aiAnalysis.confidence === "medium" ? "中" : "低"}）
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
              {[
                { label: "階数", value: `${aiAnalysis.floors}階` },
                { label: "屋根材", value: ROOF_MAT[aiAnalysis.roofType]?.label || "不明" },
                { label: "外壁材", value: aiAnalysis.wallMaterial || "不明" },
                { label: "劣化状態", value: aiAnalysis.degradation === "good" ? "良好" : aiAnalysis.degradation === "fair" ? "要注意" : "劣化あり" },
              ].map(item => (
                <div key={item.label} style={{ background: "rgba(255,255,255,0.08)", borderRadius: 8, padding: "8px 10px" }}>
                  <p style={{ margin: "0 0 2px", fontSize: 10, color: "#7090b0" }}>{item.label}</p>
                  <p style={{ margin: 0, fontSize: 14, fontWeight: 800, color: C.white }}>{item.value}</p>
                </div>
              ))}
            </div>
            {aiAnalysis.degradationNote && (
              <p style={{ margin: "0 0 8px", fontSize: 12, color: "#a8c0e0", lineHeight: 1.7 }}>
                📋 {aiAnalysis.degradationNote}
              </p>
            )}
            {aiAnalysis.note && (
              <p style={{ margin: 0, fontSize: 11, color: "#7090b0" }}>💡 {aiAnalysis.note}</p>
            )}
          </div>
        )}
        {aiAnalysis && (
          <Alert type="warn" title="次の画面で数値を確認してください">
            AIの読み取りは参考値です。実際の面積・築年数は手動で入力してください。
          </Alert>
        )}
      </Card>

      {/* 写真あり→次へ / 写真なし→手動入力 の2ボタン */}
      {aiAnalysis ? (
        <button onClick={() => setStep(1)} style={{
          width: "100%", padding: "14px", borderRadius: 10, fontSize: 15,
          fontWeight: 800, border: "none", cursor: "pointer",
          background: `linear-gradient(135deg,${C.navy},${C.navyL})`,
          color: C.white, boxShadow: `0 4px 16px ${C.navy}44`,
        }}>次へ：建物情報を確認する →</button>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {previews.length > 0 && (
            <button onClick={() => setStep(1)} style={{
              width: "100%", padding: "13px", borderRadius: 10, fontSize: 14,
              fontWeight: 800, border: "none", cursor: "pointer",
              background: `linear-gradient(135deg,${C.navy},${C.navyL})`,
              color: C.white,
            }}>AI解析をスキップして手動入力する →</button>
          )}
          <button onClick={() => setStep(1)} style={{
            width: "100%", padding: "13px", borderRadius: 10, fontSize: 15,
            fontWeight: 800, cursor: "pointer",
            border: `2px solid ${C.navy}`,
            background: C.white, color: C.navy,
          }}>📝 写真なしで手動入力する →</button>
        </div>
      )}
    </div>
  );

  // ===== STEP 1: 建物情報 =====
  const Step1 = () => {
    const wallA = floorArea ? estimateWallArea(parseFloat(floorArea), parseInt(floors), shape, roofShape) : 0;
    const roofA = floorArea ? estimateRoofArea(parseFloat(floorArea), parseInt(floors), roofShape) : 0;

    return (
      <div>
        <Card style={{ marginBottom: 16 }}>
          <SectionTitle n="1">建物の基本情報</SectionTitle>
          {aiAnalysis && (
            <Alert type="ok" title="AIが読み取った値がセットされています">
              内容を確認して、違う場合は修正してください。
            </Alert>
          )}

          <div style={{ marginTop: 16 }}>
            <p style={{ margin: "0 0 8px", fontWeight: 700, fontSize: 13, color: C.navy }}>建物の構造</p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
              {[{ id: "wood", icon: "🪵", label: "木造", sub: "在来・2×4工法" }, { id: "rc", icon: "🏢", label: "RC・鉄骨造", sub: "コンクリート・鉄骨" }].map(b => (
                <ChoiceBtn key={b.id} selected={btype === b.id} onClick={() => setBtype(b.id)} icon={b.icon} sub={b.sub}>{b.label}</ChoiceBtn>
              ))}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
              <div>
                <p style={{ margin: "0 0 6px", fontWeight: 700, fontSize: 13, color: C.navy }}>延床面積（㎡）</p>
                <input style={{ ...inpStyle, borderColor: aiAnalysis?.estimatedWidth > 0 ? C.gold : C.border }} type="text" inputMode="numeric" pattern="[0-9]*" placeholder="例：120" value={floorArea} onChange={e => setFloorArea(e.target.value.replace(/[^0-9]/g, ''))} />
                <p style={{ margin: "4px 0 0", fontSize: 11, color: C.muted }}>わからない場合は間口×奥行×階数で概算</p>
              </div>
              <div>
                <p style={{ margin: "0 0 6px", fontWeight: 700, fontSize: 13, color: C.navy }}>階数</p>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
                  {["1", "2", "3"].map(f => (
                    <div key={f} onClick={() => setFloors(f)} style={{
                      border: `2px solid ${floors === f ? C.navy : C.border}`,
                      borderRadius: 8, padding: "10px 4px", cursor: "pointer", textAlign: "center",
                      background: floors === f ? `linear-gradient(135deg,${C.navy},${C.navyL})` : C.white,
                    }}>
                      <p style={{ margin: 0, fontWeight: 800, fontSize: 16, color: floors === f ? C.white : C.navy }}>{f}</p>
                      <p style={{ margin: 0, fontSize: 10, color: floors === f ? "#a8c0e0" : C.muted }}>階</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <p style={{ margin: "0 0 8px", fontWeight: 700, fontSize: 13, color: C.navy }}>築年数</p>
            <input style={inpStyle} type="text" inputMode="numeric" pattern="[0-9]*" placeholder="例：20" value={age} onChange={e => setAge(e.target.value.replace(/[^0-9]/g, ''))} />
            {parseInt(age) >= 30 && <Alert type="warn" title="築30年以上">下地補修費用が別途10〜30万円かかる場合があります。</Alert>}
          </div>
        </Card>

        <Card style={{ marginBottom: 16 }}>
          <SectionTitle n="2">建物の形・屋根</SectionTitle>

          <p style={{ margin: "0 0 8px", fontWeight: 700, fontSize: 13, color: C.navy }}>建物の形（平面から見た形）</p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 16 }}>
            {[{ id: "square", icon: "⬛", label: "四角形" }, { id: "rect", icon: "▬", label: "長方形" }, { id: "Lshape", icon: "⌐", label: "L字形" }].map(s => (
              <div key={s.id} onClick={() => setShape(s.id)} style={{
                border: `2px solid ${shape === s.id ? C.navy : C.border}`, borderRadius: 10, padding: 12,
                cursor: "pointer", textAlign: "center",
                background: shape === s.id ? `linear-gradient(135deg,${C.navy},${C.navyL})` : C.white,
              }}>
                <div style={{ fontSize: 24, marginBottom: 4 }}>{s.icon}</div>
                <p style={{ margin: 0, fontWeight: 800, fontSize: 12, color: shape === s.id ? C.white : C.navy }}>{s.label}</p>
              </div>
            ))}
          </div>

          <p style={{ margin: "0 0 8px", fontWeight: 700, fontSize: 13, color: C.navy }}>屋根の形</p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16 }}>
            {[
              { id: "kirizuma", icon: "🔺", label: "切妻", sub: "三角の屋根（よくある形）" },
              { id: "katagare", icon: "◿", label: "片流れ", sub: "一方向に傾いた屋根" },
              { id: "yosemune", icon: "🏠", label: "寄棟", sub: "四方に傾いた屋根" },
              { id: "flat",     icon: "🟫", label: "陸屋根", sub: "平らな屋根" },
            ].map(r => (
              <ChoiceBtn key={r.id} selected={roofShape === r.id} onClick={() => setRoofShape(r.id)} icon={r.icon} sub={r.sub}>{r.label}</ChoiceBtn>
            ))}
          </div>

          <p style={{ margin: "0 0 8px", fontWeight: 700, fontSize: 13, color: C.navy }}>屋根材の種類</p>
          <div style={{ display: "grid", gap: 8 }}>
            {Object.entries(ROOF_MAT).map(([id, mat]) => (
              <ChoiceBtn key={id} selected={roofMat === id} onClick={() => setRoofMat(id)} sub={mat.note || ""}>
                {mat.label}
              </ChoiceBtn>
            ))}
          </div>

          {/* 屋根材別アドバイス */}
          {roofMat === "kawara" && (
            <Alert type="ng" title="瓦屋根は葺き替えを推奨（一級建築士より）">
              地震による瓦の落下リスクがあります。ガルバリウム鋼板などの軽量屋根材への葺き替えを強く推奨します。
            </Alert>
          )}
          {roofMat === "asphalt" && (
            <Alert type="warn" title="砂の状態を確認してください（一級建築士より）">
              砂が剥がれている場合は塗装よりカバー工法が望ましいです。業者に必ず確認を。
            </Alert>
          )}
          {roofMat === "galvalume" && (
            <Alert type="info" title="ガルバリウム鋼板（一級建築士より）">
              約10年ごとの塗り替えを推奨します。錆が出る前の早めの対処が重要です。塗装時は専用プライマーが必須です。
            </Alert>
          )}

          {/* リアルタイム面積 */}
          {floorArea && (
            <div style={{ marginTop: 16, background: C.navy, borderRadius: 10, padding: 14, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {[{ label: "外壁面積（推計）", value: `${wallA}㎡` }, { label: "屋根面積（推計）", value: `${roofA}㎡` }].map(item => (
                <div key={item.label} style={{ textAlign: "center" }}>
                  <p style={{ margin: "0 0 2px", fontSize: 10, color: "#7090b0" }}>{item.label}</p>
                  <p style={{ margin: 0, fontSize: 20, fontWeight: 900, color: C.white }}>{item.value}</p>
                </div>
              ))}
            </div>
          )}
        </Card>

        <div style={{ display: "flex", gap: 12 }}>
          <button onClick={() => setStep(2)} disabled={!floorArea || !age} style={{
            flex: 1, padding: "13px", borderRadius: 8, fontSize: 15, fontWeight: 800,
            border: "none", cursor: !floorArea || !age ? "not-allowed" : "pointer",
            background: !floorArea || !age ? C.cream : `linear-gradient(135deg,${C.navy},${C.navyL})`,
            color: !floorArea || !age ? C.muted : C.white,
          }}>次へ：工事内容を選ぶ →</button>
        </div>
      </div>
    );
  };

  // ===== STEP 2: 工事内容 =====
  const Step2 = () => (
    <div>
      <Card style={{ marginBottom: 16 }}>
        <SectionTitle n="3">外壁塗装</SectionTitle>
        <Toggle value={doWall} onChange={() => setDoWall(v => !v)} label="外壁塗装を行う" hint="外壁の塗り替え・補修" />
        {doWall && (
          <div style={{ marginTop: 12 }}>
            <p style={{ margin: "0 0 8px", fontWeight: 700, fontSize: 13, color: C.navy }}>塗料の種類</p>
            <div style={{ display: "grid", gap: 8 }}>
              {[
                { id: "silicon",   badge: "✅ 推奨",   bc: C.ok,   bb: C.okBg,   sub: `耐用12年 ¥${fmt(PAINT[btype].silicon.wall[0])}〜${fmt(PAINT[btype].silicon.wall[1])}/㎡` },
                { id: "inorganic", badge: "◎ 長期推奨", bc: C.navy, bb: C.cream,  sub: `耐用20年 ¥${fmt(PAINT[btype].inorganic.wall[0])}〜${fmt(PAINT[btype].inorganic.wall[1])}/㎡` },
                { id: "fluoro",    badge: "⚠️ 注意あり", bc: C.warn, bb: C.warnBg, sub: `耐用15年 ¥${fmt(PAINT[btype].fluoro.wall[0])}〜${fmt(PAINT[btype].fluoro.wall[1])}/㎡` },
              ].map(p => (
                <div key={p.id} onClick={() => setPaintType(p.id)} style={{
                  border: `2px solid ${paintType === p.id ? C.navy : C.border}`, borderRadius: 10,
                  padding: 12, cursor: "pointer",
                  background: paintType === p.id ? `linear-gradient(135deg,${C.navy},${C.navyL})` : C.white,
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 6, background: paintType === p.id ? "rgba(255,255,255,0.15)" : p.bb, color: paintType === p.id ? C.goldL : p.bc }}>{p.badge}</span>
                      <p style={{ margin: "5px 0 2px", fontWeight: 800, fontSize: 14, color: paintType === p.id ? C.white : C.navy }}>{PAINT[btype][p.id].label}</p>
                      <p style={{ margin: 0, fontSize: 11, color: paintType === p.id ? "#a8c0e0" : C.muted }}>{p.sub}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {paintType === "fluoro" && (
              <Alert type="ng" title="フッ素系塗料のリスク（一級建築士より）">
                15年後の塗り替え時に特殊プライマーが必要になります。次回のコストが割高になる可能性があります。シリコン系・無機系を推奨します。
              </Alert>
            )}
          </div>
        )}
      </Card>

      <Card style={{ marginBottom: 16 }}>
        <SectionTitle n="4">屋根の工事</SectionTitle>
        <Alert type="info" title="スレート屋根は本来塗装しない方が長持ちします（一級建築士より）">
          隙間から空気を取り込み水分を乾燥させる働きがあります。色あせ程度なら工事不要な場合もあります。
        </Alert>
        <div style={{ marginTop: 12 }}>
          <Toggle value={doRoof} onChange={() => setDoRoof(v => !v)} label="屋根工事を行う" />
          {doRoof && (
            <div style={{ marginTop: 12 }}>
              <div style={{ display: "grid", gap: 8 }}>
                {[
                  { id: "coat",    icon: "🖌", label: "塗装・補修", sub: "色あせ・軽微な汚れ" },
                  { id: "replace", icon: "🔨", label: "葺き替え・カバー工法", sub: "ひび割れ・雨漏り・瓦屋根" },
                ].map(r => (
                  <ChoiceBtn key={r.id} selected={roofWorkType === r.id} onClick={() => setRoofWorkType(r.id)} icon={r.icon} sub={r.sub}>{r.label}</ChoiceBtn>
                ))}
              </div>
              {roofMat === "slate" && roofWorkType === "coat" && (
                <Alert type="warn" title="タスペーサーを必ず確認（スレート屋根のみ）">
                  業者に「タスペーサーを使いますか？」と確認してください。使わない業者との契約は再考を。
                </Alert>
              )}
            </div>
          )}
        </div>
      </Card>

      <Card style={{ marginBottom: 16 }}>
        <SectionTitle n="5">追加工事</SectionTitle>
        <Toggle value={doSeal} onChange={() => setDoSeal(v => !v)} label="シーリング打ち直し" hint="窓周り・外壁目地のゴム部分の交換" />
        {doSeal && (
          <Alert type="ok" title="塗装とセットが基本です">
            シーリング劣化は雨漏りの原因になります。同時施工で足場代の節約にもなります。
          </Alert>
        )}
        {paintType === "fluoro" && doSeal && (
          <Alert type="warn" title="フッ素系×シーリングの注意">
            フッ素塗料はシーリングとの相性が悪く、シーリングは塗装後の後打ちが必要です。業者に施工順序を確認してください。
          </Alert>
        )}
        <div style={{ marginTop: 4 }}>
          <Toggle value={doSolar} onChange={() => setDoSolar(v => !v)} label="太陽光発電パネルあり" hint="取り外し費用+15〜35万円が別途必要" />
          {doSolar && (
            <Alert type="warn" title="電気工事士の資格が必要です">
              パネルの取り外し・再設置に電気工事士が必要です。メーカー保証が無効になる場合があるため事前確認を。
            </Alert>
          )}
        </div>
      </Card>

      <div style={{ display: "flex", gap: 12 }}>
        <button onClick={() => setStep(1)} style={{ padding: "12px 20px", borderRadius: 8, fontSize: 14, fontWeight: 700, border: `1.5px solid ${C.border}`, background: C.white, color: C.navy, cursor: "pointer" }}>← 戻る</button>
        <button onClick={calcResult} style={{
          flex: 1, padding: "14px", borderRadius: 8, fontSize: 15, fontWeight: 800,
          border: "none", cursor: "pointer",
          background: `linear-gradient(135deg,${C.gold},${C.goldL})`,
          color: C.navyD, boxShadow: `0 4px 16px ${C.gold}55`,
        }}>🔍 修繕費用を診断する</button>
      </div>
    </div>
  );

  // ===== STEP 3: 診断結果 =====
  const Step3 = () => {
    if (!result) return null;
    const { wall, scaffold, wash, seal, roof, solar, total, wallA, roofA, sealLen } = result;
    const items = [
      { label: `外壁塗装（${result.paintLabel}）`, min: wall.min, max: wall.max, show: doWall },
      { label: "足場費用", min: scaffold.min, max: scaffold.max, show: true },
      { label: "高圧洗浄", min: wash.min, max: wash.max, show: true },
      { label: `シーリング打ち直し（約${sealLen}m）`, min: seal.min, max: seal.max, show: doSeal },
      { label: `屋根工事（${result.roofMatLabel}）`, min: roof.min, max: roof.max, show: doRoof },
      { label: "太陽光パネル取外し・再設置", min: solar.min, max: solar.max, show: doSolar },
    ].filter(i => i.show && (i.min > 0 || i.max > 0));

    return (
      <div>
        {/* メイン結果 */}
        <div style={{ background: `linear-gradient(135deg,${C.navyD},${C.navyL})`, borderRadius: 16, padding: 24, marginBottom: 16, boxShadow: `0 8px 32px ${C.navy}55` }}>
          <p style={{ margin: "0 0 4px", fontSize: 11, color: C.goldL, fontWeight: 700, letterSpacing: 2 }}>修繕費用の概算</p>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 44, fontWeight: 900, color: C.white }}>{wan(total.min)}〜{wan(total.max)}</span>
            <span style={{ fontSize: 22, color: "#a8c0e0" }}>万円</span>
          </div>
          <p style={{ margin: "0 0 10px", fontSize: 12, color: "#7090b0" }}>
            外壁{wallA}㎡ ／ {btype === "wood" ? "木造" : "RC・鉄骨"} ／ 築{age}年 ／ {result.roofMatLabel}
          </p>
          <div style={{ padding: "8px 12px", borderRadius: 8, background: "rgba(255,255,255,0.08)", fontSize: 11, color: "#a8c0e0" }}>
            ⚠️ 外観写真・手動入力からの概算です。図面解析版より誤差が大きい場合があります。
          </div>
        </div>

        {/* 内訳 */}
        <Card style={{ marginBottom: 16 }}>
          <SectionTitle n={null}>📊 費用内訳</SectionTitle>
          {items.map((item, i) => (
            <div key={i} style={{ marginBottom: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ fontSize: 13, color: C.muted }}>{item.label}</span>
                <span style={{ fontSize: 14, fontWeight: 800, color: C.navy }}>{wan(item.min)}〜{wan(item.max)}万円</span>
              </div>
              <ProgressBar value={wan(item.max)} max={wan(total.max)} color={C.navy} />
            </div>
          ))}
          <div style={{ marginTop: 16, paddingTop: 16, borderTop: `2px solid ${C.navy}`, display: "flex", justifyContent: "space-between" }}>
            <span style={{ fontWeight: 800, color: C.navy }}>合計</span>
            <span style={{ fontSize: 22, fontWeight: 900, color: C.navy }}>{wan(total.min)}〜{wan(total.max)}万円</span>
          </div>
        </Card>

        {/* 訪問営業チェック */}
        <Card style={{ marginBottom: 16 }}>
          <SectionTitle n={null}>🔍 訪問営業の相場チェック</SectionTitle>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {[
              { label: "30%以上安い", sub: "手抜き工事の可能性", price: wan(total.min * 0.7), type: "ng" },
              { label: "50%以上高い", sub: "要交渉・相見積もりを", price: wan(total.max * 1.5), type: "warn" },
            ].map(c => (
              <div key={c.label} style={{ background: c.type === "ng" ? C.dangerBg : C.warnBg, borderRadius: 10, padding: 12 }}>
                <p style={{ margin: "0 0 2px", fontSize: 11, fontWeight: 700, color: c.type === "ng" ? C.danger : C.warn }}>{c.label}</p>
                <p style={{ margin: "0 0 2px", fontSize: 22, fontWeight: 900, color: c.type === "ng" ? C.danger : C.warn }}>{c.price}万円以下</p>
                <p style={{ margin: 0, fontSize: 11, color: c.type === "ng" ? C.danger : C.warn }}>{c.sub}</p>
              </div>
            ))}
          </div>
        </Card>

        {/* LINE登録CTA */}
        <div style={{
          background: `linear-gradient(135deg, #06C755, #04a344)`,
          borderRadius: 16, padding: 24, marginBottom: 16, textAlign: "center",
          boxShadow: "0 6px 24px rgba(6,199,85,0.35)",
        }}>
          <p style={{ margin: "0 0 4px", fontSize: 11, color: "rgba(255,255,255,0.8)", fontWeight: 700, letterSpacing: 1.5 }}>
            📋 診断結果をLINEで保存する
          </p>
          <p style={{ margin: "0 0 6px", fontSize: 18, fontWeight: 900, color: C.white }}>
            詳細レポートを無料でお届け
          </p>
          <p style={{ margin: "0 0 16px", fontSize: 12, color: "rgba(255,255,255,0.85)", lineHeight: 1.8 }}>
            一級建築士が監修した詳細レポートを<br />
            LINEでお送りします。訪問営業対策・<br />
            業者選びのチェックリスト付き。
          </p>
          <a href="https://line.me/R/ti/p/@491fsuyy" target="_blank" rel="noopener noreferrer" style={{
            display: "inline-flex", alignItems: "center", gap: 10,
            background: C.white, color: "#06C755",
            padding: "13px 28px", borderRadius: 50,
            fontWeight: 900, fontSize: 15, textDecoration: "none",
            boxShadow: "0 4px 16px rgba(0,0,0,0.15)",
          }}>
            <span style={{ fontSize: 20 }}>💬</span>
            LINEで友達追加する（無料）
          </a>
          <p style={{ margin: "12px 0 0", fontSize: 11, color: "rgba(255,255,255,0.7)" }}>
            「カツヤス」@ 一級建築士に直接相談
          </p>
        </div>

        {/* 免責表示 */}
        <div style={{
          background: C.bg, border: `1px solid ${C.border}`,
          borderRadius: 12, padding: 16, marginBottom: 16,
        }}>
          <p style={{ margin: "0 0 8px", fontWeight: 800, fontSize: 12, color: C.muted }}>
            ⚠️ ご利用上の注意
          </p>
          <p style={{ margin: 0, fontSize: 11, color: C.muted, lineHeight: 1.9 }}>
            本診断の計算値は、外観写真・手動入力をもとにしたAIによる<strong>参考概算</strong>です。
            実際の修繕費用は建物の劣化状況・地域・業者・施工内容により大きく異なります。
            本診断結果を根拠とした契約・発注は行わないでください。
            正確な費用は一級建築士または専門業者による<strong>現地調査・相見積もり</strong>でご確認ください。
            本アプリは建築士法に基づく設計・工事監理業務を提供するものではありません。
          </p>
        </div>

        {/* 精度向上の提案 */}
        <Alert type="info" title="一級建築士に直接相談したい方へ">
          この概算をもとに、一級建築士が個別にアドバイスします。「見積もりが適正か確認したい」「どの業者を選べばいいか」など、LINEからお気軽にご相談ください。
        </Alert>

        <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
          <button onClick={() => setStep(2)} style={{ padding: "12px 16px", borderRadius: 8, fontSize: 13, fontWeight: 700, border: `1.5px solid ${C.border}`, background: C.white, color: C.navy, cursor: "pointer" }}>← 戻る</button>
          <button onClick={() => setStep(4)} style={{ flex: 1, padding: "13px", borderRadius: 8, fontSize: 14, fontWeight: 800, border: "none", cursor: "pointer", background: `linear-gradient(135deg,${C.navy},${C.navyL})`, color: C.white }}>資金計画を立てる →</button>
        </div>
      </div>
    );
  };

  // ===== STEP 4: 資金計画 =====
  const Step4 = () => {
    if (!result) return null;
    const { yearsLeft, monthly, midTotal, paintYears, paintLabel, total, isOverdue, overdueYears } = result;
    const urgency = yearsLeft <= 2 ? "ng" : yearsLeft <= 5 ? "warn" : "ok";
    const plans = [
      { label: "最低ライン", monthly: Math.round(total.min / (yearsLeft * 12)), total: total.min },
      { label: "推奨プラン ★", monthly, total: midTotal },
      { label: "安心プラン", monthly: Math.round(total.max * 1.1 / (yearsLeft * 12)), total: Math.round(total.max * 1.1) },
    ];

    return (
      <div>
        {isOverdue && overdueYears > 0 && (
          <Alert type="ng" title={`⚠️ 修繕を行っていない場合、すでに${overdueYears}年超過しています`}>
            築{age}年で一度も外壁・屋根の修繕を行っていない場合、修繕時期（{paintLabel}：約{paintYears}年）をすでに超過しています。
            放置すると雨漏り・外壁剥離・屋根腐食のリスクが高まります。早急に専門業者への点検をお勧めします。
          </Alert>
        )}
        {isOverdue && overdueYears === 0 && (
          <Alert type="warn" title={`⚠️ 修繕時期の目安に達しています`}>
            築{age}年は{paintLabel}（耐用年数：約{paintYears}年）の節目にあたります。
            まだ修繕を行っていない場合は、早めの点検・見積もりをお勧めします。
          </Alert>
        )}
        <Alert type={urgency} title={yearsLeft <= 2 ? `⚡ 次の修繕時期まであと約${yearsLeft}年` : yearsLeft <= 5 ? `⚠️ 修繕時期まであと約${yearsLeft}年` : `✅ 修繕時期まであと約${yearsLeft}年`}>
          {paintLabel}の耐用年数（約{paintYears}年）を基準に算出しています。{isOverdue ? "※過去に修繕済みの場合の次回目安です。" : ""}
        </Alert>

        <Card style={{ marginTop: 16, marginBottom: 16 }}>
          <SectionTitle n={null}>💰 毎月の積立プラン</SectionTitle>
          <div style={{ display: "grid", gap: 12 }}>
            {plans.map((p, i) => (
              <div key={i} style={{
                background: i === 1 ? `linear-gradient(135deg,${C.navy},${C.navyL})` : C.bg,
                borderRadius: 12, padding: 18,
                border: i === 1 ? "none" : `1px solid ${C.border}`,
                position: "relative",
              }}>
                {i === 1 && <div style={{ position: "absolute", top: 10, right: 12, background: C.gold, color: C.navyD, fontSize: 10, fontWeight: 800, padding: "2px 8px", borderRadius: 10 }}>おすすめ</div>}
                <p style={{ margin: "0 0 6px", fontSize: 11, fontWeight: 700, letterSpacing: 1, color: i === 1 ? C.goldL : C.muted }}>{p.label}</p>
                <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                  <span style={{ fontSize: 32, fontWeight: 900, color: i === 1 ? C.white : C.navy }}>¥{fmt(p.monthly)}</span>
                  <span style={{ fontSize: 13, color: i === 1 ? "#a8c0e0" : C.muted }}>/月</span>
                </div>
                <p style={{ margin: "4px 0 0", fontSize: 12, color: i === 1 ? "#7090b0" : C.muted }}>{yearsLeft}年積立 ／ 総額 約{wan(p.total)}万円</p>
              </div>
            ))}
          </div>
        </Card>

        {/* LINE CTA */}
        <div style={{
          background: `linear-gradient(135deg, #06C755, #04a344)`,
          borderRadius: 16, padding: 24, textAlign: "center", marginBottom: 16,
          boxShadow: "0 6px 24px rgba(6,199,85,0.35)",
        }}>
          <p style={{ margin: "0 0 6px", color: "rgba(255,255,255,0.85)", fontSize: 13, fontWeight: 800 }}>
            一級建築士に直接相談する
          </p>
          <p style={{ margin: "0 0 16px", color: "rgba(255,255,255,0.85)", fontSize: 12, lineHeight: 1.8 }}>
            この診断結果をもとに、現地調査・<br />
            適正見積もりの確認をご相談できます
          </p>
          <a href="https://line.me/R/ti/p/@491fsuyy" target="_blank" rel="noopener noreferrer" style={{
            display: "inline-flex", alignItems: "center", gap: 10,
            background: C.white, color: "#06C755",
            padding: "13px 28px", borderRadius: 50,
            fontWeight: 900, fontSize: 15, textDecoration: "none",
            boxShadow: "0 4px 16px rgba(0,0,0,0.15)",
          }}>
            <span style={{ fontSize: 20 }}>💬</span>
            LINEで無料相談する
          </a>
          <p style={{ margin: "10px 0 0", fontSize: 11, color: "rgba(255,255,255,0.7)" }}>
            「カツヤス」@ 一級建築士に直接相談
          </p>
        </div>

        <div style={{ display: "flex", gap: 12 }}>
          <button onClick={() => setStep(3)} style={{ padding: "12px 16px", borderRadius: 8, fontSize: 13, fontWeight: 700, border: `1.5px solid ${C.border}`, background: C.white, color: C.navy, cursor: "pointer" }}>← 診断に戻る</button>
          <button onClick={() => { setStep(1); setPhotos([]); setPreviews([]); setAiAnalysis(null); setFloorArea(""); setAge(""); setResult(null); }} style={{ flex: 1, padding: "12px 16px", borderRadius: 8, fontSize: 13, fontWeight: 700, border: `1.5px solid ${C.border}`, background: C.white, color: C.navy, cursor: "pointer" }}>
            🔄 最初からやり直す
          </button>
        </div>
      </div>
    );
  };

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: font }}>
      {Header()}
      <div style={wrap}>
        <StepBar current={step - 1} />
        {step === 0 && Step0()}
        {step === 1 && Step1()}
        {step === 2 && Step2()}
        {step === 3 && Step3()}
        {step === 4 && Step4()}
        <div style={{ textAlign: "center", marginTop: 32, fontSize: 10, color: C.muted }}>
          <p style={{ margin: 0 }}>本アプリの計算値はあくまで概算（参考値）です。正確な費用は現地調査・相見積もりをお勧めします。</p>
          <p style={{ margin: "4px 0 0" }}>一級建築士監修</p>
        </div>
      </div>
    </div>
  );
}
