import { useMemo, useState } from "react";

const QUESTIONS = [
  { key: "crack", label: "外壁に幅0.3mm以上のひび割れがある" },
  { key: "chalk", label: "手で触ると白い粉（チョーキング）が付く" },
  { key: "leak", label: "雨染み・漏水の跡がある" },
  { key: "seal", label: "シーリングに割れ・痩せ・剥離がある" },
  { key: "peel", label: "塗膜の浮き・剥がれがある" },
  { key: "rust", label: "鉄部にサビが広がっている" },
];

function getJudgement(score) {
  if (score >= 4) {
    return {
      level: "高",
      title: "早急に専門業者へ相談",
      message:
        "劣化が進んでいる可能性があります。安全確保と建物寿命の観点から、早めの現地診断を推奨します。",
      color: "#b91c1c",
      bg: "#fee2e2",
    };
  }
  if (score >= 2) {
    return {
      level: "中",
      title: "半年以内に点検推奨",
      message:
        "複数の劣化サインが見られます。雨漏りや躯体劣化につながる前に、計画的な点検を行いましょう。",
      color: "#b45309",
      bg: "#fef3c7",
    };
  }
  return {
    level: "低",
    title: "経過観察レベル",
    message:
      "現時点では緊急度は高くありません。年1回を目安に目視点検し、変化があれば再診断してください。",
    color: "#166534",
    bg: "#dcfce7",
  };
}

export default function GaihekiSimple() {
  const [checks, setChecks] = useState(
    () =>
      Object.fromEntries(
        QUESTIONS.map((question) => [question.key, false]),
      ),
  );

  const score = useMemo(
    () => Object.values(checks).filter(Boolean).length,
    [checks],
  );
  const result = useMemo(() => getJudgement(score), [score]);

  return (
    <main
      style={{
        maxWidth: 760,
        margin: "40px auto",
        fontFamily:
          "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        lineHeight: 1.6,
        padding: "0 16px",
      }}
    >
      <h1 style={{ marginBottom: 8 }}>外壁修繕セルフチェック</h1>
      <p style={{ marginTop: 0, color: "#374151" }}>
        気になる症状にチェックを入れると、修繕の優先度を簡易判定します。
      </p>

      <section
        style={{
          border: "1px solid #e5e7eb",
          borderRadius: 12,
          padding: 16,
          background: "#ffffff",
        }}
      >
        {QUESTIONS.map((question) => (
          <label
            key={question.key}
            style={{
              display: "block",
              padding: "10px 0",
              borderBottom: "1px solid #f3f4f6",
            }}
          >
            <input
              type="checkbox"
              checked={checks[question.key]}
              onChange={(event) =>
                setChecks((prev) => ({
                  ...prev,
                  [question.key]: event.target.checked,
                }))
              }
              style={{ marginRight: 10 }}
            />
            {question.label}
          </label>
        ))}
      </section>

      <section
        style={{
          marginTop: 18,
          padding: 16,
          borderRadius: 12,
          background: result.bg,
          border: `1px solid ${result.color}`,
        }}
      >
        <p style={{ margin: 0 }}>
          判定スコア: <strong>{score}</strong> / {QUESTIONS.length}
        </p>
        <h2 style={{ margin: "8px 0", color: result.color }}>{result.title}</h2>
        <p style={{ margin: 0 }}>{result.message}</p>
      </section>

      <p style={{ color: "#6b7280", fontSize: 14, marginTop: 14 }}>
        ※ 本アプリは簡易診断です。最終判断は専門業者の現地調査に基づいてください。
      </p>
    </main>
  );
}
