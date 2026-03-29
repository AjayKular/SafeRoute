"use client";

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  type CSSProperties,
} from "react";
import type { CollisionCluster } from "@/lib/types";
import { analyze, fixDescriptions, type Fix, type ImpactLevel } from "@/lib/analyze";
import { simulate, type SimulationResult } from "@/lib/simulate";

// ─── Types ───────────────────────────────────────────────────────────────────

type View = "leaderboard" | "analysis" | "simulate";

interface SidebarProps {
  selectedCluster: CollisionCluster | null;
  /** Top-5 clusters for the leaderboard, fetched once by page.tsx */
  leaderboardClusters: CollisionCluster[];
  loadingClusters: boolean;
  /** Set when "My Risk Score" geolocation found a cluster nearby. */
  locationMeta?: { clusterId: string; distanceMeters: number } | null;
  /** Increments each time geolocation ran but found nothing within 1 km. */
  noNearbyCluster?: number;
}

// ─── Tiny design tokens ───────────────────────────────────────────────────────

const C = {
  bgBase: "#0A0C0F",
  bgSurface: "#111318",
  bgElevated: "#181C24",
  border: "#1E2229",
  red: "#E63946",
  amber: "#F4A261",
  orange: "#F97316",
  teal: "#2A9D8F",
  text: "#F0F2F5",
  muted: "#6B7280",
  dim: "#3D4450",
};

const MONO: CSSProperties = { fontFamily: "var(--font-dm-mono), monospace" };
const SANS: CSSProperties = { fontFamily: "var(--font-dm-sans), sans-serif" };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function impactColor(level: ImpactLevel): string {
  if (level === "HIGH") return C.red;
  if (level === "MEDIUM") return C.amber;
  return C.teal;
}

function Badge({
  label,
  color,
}: {
  label: string;
  color: string;
}): React.ReactElement {
  return (
    <span
      style={{
        ...MONO,
        fontSize: "10px",
        fontWeight: 500,
        letterSpacing: "0.07em",
        color,
        border: `1px solid ${color}`,
        borderRadius: "999px",
        padding: "1px 7px",
        whiteSpace: "nowrap" as const,
        opacity: 0.9,
      }}
    >
      {label}
    </span>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        ...MONO,
        fontSize: "10px",
        letterSpacing: "0.12em",
        color: C.muted,
        textTransform: "uppercase" as const,
        marginBottom: "10px",
      }}
    >
      {children}
    </div>
  );
}

function Divider() {
  return (
    <div style={{ borderTop: `1px solid ${C.border}`, margin: "18px 0" }} />
  );
}

// ─── useCountUp — animates a number from 0 to target ─────────────────────────

function useCountUp(target: number, durationMs: number, active: boolean) {
  const [value, setValue] = useState(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!active) {
      setValue(0);
      return;
    }
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min((now - start) / durationMs, 1);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(Math.round(target * eased));
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [target, durationMs, active]);

  return value;
}

// ─── Breakdown bar row ────────────────────────────────────────────────────────

function BreakdownRow({
  label,
  count,
  total,
  color,
  animate,
}: {
  label: string;
  count: number;
  total: number;
  color: string;
  animate: boolean;
}) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  const width = animate ? `${pct}%` : "0%";

  return (
    <div style={{ marginBottom: "10px" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginBottom: "4px",
        }}
      >
        <span style={{ ...SANS, fontSize: "12px", color: C.muted }}>{label}</span>
        <span style={{ ...MONO, fontSize: "12px", color: C.text }}>
          {count}&nbsp;
          <span style={{ color: C.dim }}>({pct}%)</span>
        </span>
      </div>
      <div
        style={{
          height: "5px",
          background: C.bgElevated,
          borderRadius: "999px",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width,
            background: color,
            borderRadius: "999px",
            transition: "width 0.75s cubic-bezier(0.16, 1, 0.3, 1)",
          }}
        />
      </div>
    </div>
  );
}

// ─── Score bar row (simulate panel) ──────────────────────────────────────────

function ScoreBar({
  value,
  max,
  color,
  animate,
  delay,
}: {
  value: number;
  max: number;
  color: string;
  animate: boolean;
  delay: number;
}) {
  const [fired, setFired] = useState(false);
  useEffect(() => {
    if (!animate) { setFired(false); return; }
    const t = setTimeout(() => setFired(true), delay);
    return () => clearTimeout(t);
  }, [animate, delay]);

  const width = fired ? `${(value / max) * 100}%` : "0%";

  return (
    <div
      style={{
        height: "6px",
        background: C.bgElevated,
        borderRadius: "999px",
        overflow: "hidden",
        marginBottom: "6px",
      }}
    >
      <div
        style={{
          height: "100%",
          width,
          background: color,
          borderRadius: "999px",
          transition: `width 0.9s cubic-bezier(0.16, 1, 0.3, 1) ${delay}ms`,
        }}
      />
    </div>
  );
}

// ─── Leaderboard view ─────────────────────────────────────────────────────────

function LeaderboardView({
  clusters,
  loading,
  onSelect,
  showNoNearby,
}: {
  clusters: CollisionCluster[];
  loading: boolean;
  onSelect: (c: CollisionCluster) => void;
  showNoNearby: boolean;
}) {
  const maxCount = clusters[0]?.count ?? 1;

  return (
    <div style={{ flex: 1, overflowY: "auto" as const, padding: "20px 20px 0" }}>

      {/* No-nearby-cluster banner — auto-dismissed by parent timer */}
      {showNoNearby && (
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: "10px",
            background: "rgba(244,162,97,0.08)",
            border: `1px solid rgba(244,162,97,0.25)`,
            borderRadius: "7px",
            padding: "10px 14px",
            marginBottom: "16px",
          }}
        >
          <span style={{ color: C.amber, fontSize: "15px", lineHeight: 1 }}>◎</span>
          <p style={{ ...SANS, fontSize: "12px", color: C.amber, margin: 0, lineHeight: 1.5 }}>
            No high-risk zones found near you.
          </p>
        </div>
      )}

      <SectionLabel>Top Risk Zones</SectionLabel>

      {loading ? (
        // Skeleton shimmer for 5 items
        Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            style={{
              background: C.bgElevated,
              borderRadius: "8px",
              padding: "14px",
              marginBottom: "10px",
            }}
          >
            <div className="skeleton" style={{ height: "13px", width: "60%", marginBottom: "8px" }} />
            <div className="skeleton" style={{ height: "5px", width: "80%", marginBottom: "8px" }} />
            <div className="skeleton" style={{ height: "11px", width: "40%" }} />
          </div>
        ))
      ) : (
        clusters.map((c, i) => (
          <div
            key={c.id}
            style={{
              background: C.bgElevated,
              borderRadius: "8px",
              padding: "14px 14px 12px",
              marginBottom: "10px",
              border: `1px solid ${C.border}`,
            }}
          >
            {/* Rank + name */}
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: "10px",
                marginBottom: "9px",
              }}
            >
              <span
                style={{
                  ...MONO,
                  fontSize: "13px",
                  color: i === 0 ? C.red : i === 1 ? C.amber : C.muted,
                  fontWeight: 600,
                  minWidth: "26px",
                  flexShrink: 0,
                  paddingTop: "1px",
                }}
              >
                #{i + 1}
              </span>
              <span
                style={{
                  ...SANS,
                  fontSize: "13px",
                  color: C.text,
                  fontWeight: 600,
                  lineHeight: 1.3,
                  flex: 1,
                }}
              >
                {c.name}
              </span>
            </div>

            {/* Progress bar */}
            <div
              style={{
                height: "4px",
                background: C.border,
                borderRadius: "999px",
                overflow: "hidden",
                marginBottom: "10px",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${(c.count / maxCount) * 100}%`,
                  background:
                    c.riskScore >= 9
                      ? C.red
                      : c.riskScore >= 7
                        ? C.amber
                        : C.orange,
                  borderRadius: "999px",
                }}
              />
            </div>

            {/* Meta + View button */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <span style={{ ...MONO, fontSize: "11px", color: C.muted }}>
                  {c.count} collisions
                </span>
                <span
                  style={{
                    ...MONO,
                    fontSize: "11px",
                    color:
                      c.riskScore >= 8
                        ? C.red
                        : c.riskScore >= 6
                          ? C.amber
                          : C.muted,
                    fontWeight: 600,
                  }}
                >
                  RISK {c.riskScore}/10
                </span>
              </div>
              <button
                onClick={() => onSelect(c)}
                style={{
                  ...MONO,
                  fontSize: "11px",
                  color: C.teal,
                  background: "none",
                  border: `1px solid ${C.teal}`,
                  borderRadius: "4px",
                  padding: "3px 10px",
                  cursor: "pointer",
                  letterSpacing: "0.04em",
                  transition: "background 0.15s ease, color 0.15s ease",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background = C.teal;
                  (e.currentTarget as HTMLButtonElement).style.color = C.bgBase;
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background = "none";
                  (e.currentTarget as HTMLButtonElement).style.color = C.teal;
                }}
              >
                View →
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// ─── Analysis view ────────────────────────────────────────────────────────────

function AnalysisView({
  cluster,
  onBack,
  onSimulate,
  proximityMeters,
}: {
  cluster: CollisionCluster;
  onBack: () => void;
  onSimulate: () => void;
  /** Distance in metres from the user's location — shown as amber banner when set. */
  proximityMeters?: number | null;
}) {
  const [barsReady, setBarsReady] = useState(false);
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const analysis = analyze(cluster);
  const total = cluster.count;

  useEffect(() => {
    setBarsReady(false);
    const t = setTimeout(() => setBarsReady(true), 80);
    return () => clearTimeout(t);
  }, [cluster.id]);

  // Reset copied state on cluster change and clean up timer on unmount
  useEffect(() => {
    setCopied(false);
    return () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    };
  }, [cluster.id]);

  const buildReport = (): string => {
    const date = new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    const lines: string[] = [
      "SAFEROUTE KW — INTERSECTION SAFETY REPORT",
      `Generated: ${date}`,
      `INTERSECTION: ${cluster.name}`,
      `RISK SCORE: ${cluster.riskScore}/10`,
      `TOTAL COLLISIONS (2015–2022): ${cluster.count}`,
      `PEAK TIME: ${cluster.peakTime}`,
      "COLLISION BREAKDOWN",
      `Rear-end: ${cluster.types.rearEnd}`,
      `Turning: ${cluster.types.turning}`,
      `Pedestrian: ${cluster.types.pedestrian}`,
      `Cyclist: ${cluster.types.cyclist}`,
      `Angle: ${cluster.types.angle}`,
      "WHY IT'S DANGEROUS",
      analysis.whyDangerous,
      "RECOMMENDED FIXES",
      "",
    ];

    for (const fix of analysis.fixes) {
      lines.push(`${fix.intervention} — ${fix.impact} IMPACT / ${fix.cost} COST`);
      lines.push(fix.reason);
      lines.push("");
    }

    lines.push("Data source: City of Kitchener Open Data");
    lines.push("SafeRoute KW — saferouting.vercel.app");

    return lines.join("\n");
  };

  const handleExport = () => {
    const text = buildReport();
    navigator.clipboard.writeText(text).then(() => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      setCopied(true);
      copiedTimerRef.current = setTimeout(() => setCopied(false), 3_000);
    }).catch(() => {
      // Clipboard unavailable — silently ignore
    });
  };

  const typeRows: { label: string; key: keyof CollisionCluster["types"]; color: string }[] = [
    { label: "Rear-end",   key: "rearEnd",    color: C.red },
    { label: "Turning",    key: "turning",    color: C.amber },
    { label: "Pedestrian", key: "pedestrian", color: C.orange },
    { label: "Cyclist",    key: "cyclist",    color: "#60A5FA" },
    { label: "Angle",      key: "angle",      color: "#A78BFA" },
    { label: "Other",      key: "other",      color: C.dim },
  ];

  const riskColor =
    cluster.riskScore >= 8 ? C.red : cluster.riskScore >= 6 ? C.amber : C.muted;

  return (
    <div
      style={{
        flex: 1,
        overflowY: "auto" as const,
        padding: "0 20px 20px",
        display: "flex",
        flexDirection: "column" as const,
        gap: "0",
      }}
    >
      {/* Back */}
      <button
        onClick={onBack}
        style={{
          ...MONO,
          fontSize: "11px",
          color: C.muted,
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: "14px 0 12px",
          textAlign: "left" as const,
          letterSpacing: "0.04em",
          display: "flex",
          alignItems: "center",
          gap: "4px",
        }}
      >
        ← Back
      </button>

      {/* Proximity banner — shown only when arriving via "My Risk Score" */}
      {proximityMeters != null && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            background: "rgba(244,162,97,0.08)",
            border: `1px solid rgba(244,162,97,0.28)`,
            borderRadius: "7px",
            padding: "10px 14px",
            marginBottom: "14px",
          }}
        >
          <span style={{ color: C.amber, fontSize: "15px", lineHeight: 1, flexShrink: 0 }}>◎</span>
          <span style={{ ...SANS, fontSize: "12px", color: C.amber, lineHeight: 1.45 }}>
            Nearest danger zone to you&nbsp;—&nbsp;
            <strong style={{ fontWeight: 700 }}>{proximityMeters} metres</strong> away
          </span>
        </div>
      )}

      {/* Cluster header */}
      <div style={{ marginBottom: "16px" }}>
        <h2
          style={{
            ...SANS,
            fontSize: "16px",
            fontWeight: 700,
            color: C.text,
            margin: "0 0 6px",
            lineHeight: 1.3,
            textTransform: "uppercase" as const,
            letterSpacing: "0.03em",
          }}
        >
          {cluster.name}
        </h2>
        <div
          style={{
            ...MONO,
            fontSize: "11px",
            color: C.muted,
            display: "flex",
            gap: "8px",
            flexWrap: "wrap" as const,
          }}
        >
          <span>{total} collisions</span>
          <span style={{ color: C.dim }}>·</span>
          <span>Peak: {cluster.peakTime}</span>
          <span style={{ color: C.dim }}>·</span>
          <span style={{ color: riskColor }}>Risk {cluster.riskScore}/10</span>
        </div>
      </div>

      <Divider />

      {/* Collision breakdown */}
      <SectionLabel>Collision Breakdown</SectionLabel>
      {typeRows
        .filter((r) => cluster.types[r.key] > 0)
        .map((r) => (
          <BreakdownRow
            key={r.key}
            label={r.label}
            count={cluster.types[r.key]}
            total={total}
            color={r.color}
            animate={barsReady}
          />
        ))}

      <Divider />

      {/* Why dangerous */}
      <SectionLabel>Why It&apos;s Dangerous</SectionLabel>
      <p
        style={{
          ...SANS,
          fontSize: "13px",
          color: C.muted,
          lineHeight: 1.65,
          margin: "0 0 4px",
        }}
      >
        {analysis.whyDangerous}
      </p>

      <Divider />

      {/* Recommended fixes */}
      <SectionLabel>Recommended Fixes</SectionLabel>
      <div style={{ display: "flex", flexDirection: "column" as const, gap: "10px" }}>
        {analysis.fixes.map((fix: Fix, i: number) => (
          <FixCard key={fix.intervention} fix={fix} rank={i + 1} />
        ))}
      </div>

      <Divider />

      {/* Simulate fix button */}
      <button
        onClick={onSimulate}
        style={{
          ...MONO,
          fontSize: "13px",
          fontWeight: 600,
          letterSpacing: "0.06em",
          color: C.bgBase,
          background: C.teal,
          border: "none",
          borderRadius: "6px",
          padding: "12px 0",
          cursor: "pointer",
          width: "100%",
          textAlign: "center" as const,
          transition: "opacity 0.15s ease",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.opacity = "0.88";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.opacity = "1";
        }}
      >
        ▶ SIMULATE FIX
      </button>

      {/* Export report button */}
      <button
        onClick={handleExport}
        style={{
          ...MONO,
          fontSize: "12px",
          fontWeight: 600,
          letterSpacing: "0.06em",
          color: copied ? C.teal : C.muted,
          background: C.bgElevated,
          border: `1px solid ${copied ? C.teal : C.border}`,
          borderRadius: "6px",
          padding: "10px 0",
          cursor: "pointer",
          width: "100%",
          textAlign: "center" as const,
          marginTop: "8px",
          transition: "color 0.2s ease, border-color 0.2s ease",
        }}
        onMouseEnter={(e) => {
          if (!copied) {
            (e.currentTarget as HTMLButtonElement).style.color = C.text;
            (e.currentTarget as HTMLButtonElement).style.borderColor = C.dim;
          }
        }}
        onMouseLeave={(e) => {
          if (!copied) {
            (e.currentTarget as HTMLButtonElement).style.color = C.muted;
            (e.currentTarget as HTMLButtonElement).style.borderColor = C.border;
          }
        }}
      >
        {copied ? "✓ REPORT COPIED TO CLIPBOARD" : "↗ EXPORT REPORT"}
      </button>

    </div>
  );
}

function FixCard({ fix, rank }: { fix: Fix; rank: number }) {
  return (
    <div
      style={{
        background: C.bgElevated,
        border: `1px solid ${C.border}`,
        borderRadius: "7px",
        padding: "12px",
      }}
    >
      {/* Rank + title + badges */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: "8px",
          marginBottom: "6px",
        }}
      >
        <div style={{ display: "flex", gap: "8px", alignItems: "flex-start" }}>
          <span style={{ ...MONO, fontSize: "11px", color: C.dim, paddingTop: "1px", minWidth: "14px" }}>
            {rank}.
          </span>
          <span style={{ ...SANS, fontSize: "13px", color: C.text, fontWeight: 600, lineHeight: 1.3 }}>
            {fix.intervention}
          </span>
        </div>
        <div style={{ display: "flex", gap: "5px", flexShrink: 0, paddingTop: "1px" }}>
          <Badge label={fix.impact} color={impactColor(fix.impact)} />
          <Badge
            label={`${fix.cost} COST`}
            color={impactColor(fix.cost)}
          />
        </div>
      </div>
      {/* Reason */}
      <p
        style={{
          ...SANS,
          fontSize: "12px",
          color: C.dim,
          lineHeight: 1.55,
          margin: "0 0 0 22px",
        }}
      >
        {fix.reason}
      </p>
    </div>
  );
}

// ─── Simulate view ────────────────────────────────────────────────────────────

function SimulateView({
  cluster,
  result,
  onBack,
}: {
  cluster: CollisionCluster;
  result: SimulationResult;
  onBack: () => void;
}) {
  const [active, setActive] = useState(false);

  useEffect(() => {
    setActive(false);
    const t = setTimeout(() => setActive(true), 120);
    return () => clearTimeout(t);
  }, [cluster.id]);

  const { before, after, topFix, reductionPct } = result;

  // Animated numbers (safetyScore is already display-ready from simulate.ts)
  const beforeSafety = useCountUp(before.safetyScore, 900, active);
  const afterSafety = useCountUp(after.safetyScore, 1100, active);
  const beforeCPY = useCountUp(before.collisionsPerYear, 900, active);
  const afterCPY = useCountUp(after.collisionsPerYear, 1100, active);
  const beforeFlow = useCountUp(before.trafficFlow, 900, active);
  const afterFlow = useCountUp(after.trafficFlow, 1100, active);

  const delta = (a: number, b: number) => {
    const d = b - a;
    return d > 0 ? `▲ +${d}` : `▼ ${d}`;
  };

  const rowStyle: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    marginBottom: "20px",
  };

  const rowLabelStyle: CSSProperties = {
    ...MONO,
    fontSize: "10px",
    letterSpacing: "0.1em",
    color: C.muted,
    textTransform: "uppercase",
  };

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "0 20px 20px" }}>
      {/* Back */}
      <button
        onClick={onBack}
        style={{
          ...MONO,
          fontSize: "11px",
          color: C.muted,
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: "14px 0 12px",
          textAlign: "left",
          letterSpacing: "0.04em",
        }}
      >
        ← Back
      </button>

      {/* Header */}
      <div
        style={{
          ...MONO,
          fontSize: "10px",
          letterSpacing: "0.1em",
          color: C.teal,
          textTransform: "uppercase",
          marginBottom: "4px",
        }}
      >
        Simulating
      </div>
      <h3
        style={{
          ...SANS,
          fontSize: "15px",
          fontWeight: 700,
          color: C.text,
          margin: "0 0 6px",
          lineHeight: 1.3,
        }}
      >
        {topFix}
      </h3>
      {fixDescriptions[topFix] && (
        <p
          style={{
            ...SANS,
            fontSize: "12px",
            color: C.muted,
            margin: "0 0 10px",
            lineHeight: 1.6,
          }}
        >
          {fixDescriptions[topFix]}
        </p>
      )}
      <p
        style={{
          ...MONO,
          fontSize: "11px",
          color: C.dim,
          margin: "0 0 18px",
          letterSpacing: "0.03em",
        }}
      >
        {cluster.name}
      </p>

      <div style={{ borderTop: `1px solid ${C.border}`, marginBottom: "20px" }} />

      {/* ── Safety Score ── */}
      <div style={rowStyle}>
        <span style={rowLabelStyle}>Safety Score</span>

        <div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "5px" }}>
            <span style={{ ...SANS, fontSize: "12px", color: C.muted }}>Before</span>
            <span style={{ ...MONO, fontSize: "12px", color: C.red }}>
              {beforeSafety}/10
            </span>
          </div>
          <ScoreBar value={before.safetyScore} max={10} color={C.red} animate={active} delay={0} />
        </div>

        <div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "5px" }}>
            <span style={{ ...SANS, fontSize: "12px", color: C.muted }}>After</span>
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <span style={{ ...MONO, fontSize: "12px", color: C.teal }}>
                {afterSafety}/10
              </span>
              {active && (
                <span style={{ ...MONO, fontSize: "10px", color: C.teal }}>
                  {delta(before.safetyScore, after.safetyScore)}
                </span>
              )}
            </div>
          </div>
          <ScoreBar value={after.safetyScore} max={10} color={C.teal} animate={active} delay={150} />
        </div>
      </div>

      <div style={{ borderTop: `1px solid ${C.border}`, marginBottom: "20px" }} />

      {/* ── Collisions / Year ── */}
      <div style={rowStyle}>
        <span style={rowLabelStyle}>Collisions / Year</span>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ ...SANS, fontSize: "12px", color: C.muted }}>Before</span>
          <span style={{ ...MONO, fontSize: "18px", fontWeight: 600, color: C.red }}>
            {beforeCPY}
          </span>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ ...SANS, fontSize: "12px", color: C.muted }}>After</span>
          <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
            <span style={{ ...MONO, fontSize: "18px", fontWeight: 600, color: C.teal }}>
              {afterCPY}
            </span>
            {active && reductionPct > 0 && (
              <span style={{ ...MONO, fontSize: "11px", color: C.teal }}>
                ▼ {reductionPct}% reduction
              </span>
            )}
          </div>
        </div>
      </div>

      <div style={{ borderTop: `1px solid ${C.border}`, marginBottom: "20px" }} />

      {/* ── Traffic Flow ── */}
      <div style={rowStyle}>
        <span style={rowLabelStyle}>Traffic Flow</span>

        <div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "5px" }}>
            <span style={{ ...SANS, fontSize: "12px", color: C.muted }}>Before</span>
            <span style={{ ...MONO, fontSize: "12px", color: C.muted }}>
              {beforeFlow}/10
            </span>
          </div>
          <ScoreBar value={before.trafficFlow} max={10} color={C.muted} animate={active} delay={0} />
        </div>

        <div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "5px" }}>
            <span style={{ ...SANS, fontSize: "12px", color: C.muted }}>After</span>
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <span style={{ ...MONO, fontSize: "12px", color: C.teal }}>
                {afterFlow}/10
              </span>
              {active && (
                <span style={{ ...MONO, fontSize: "10px", color: C.teal }}>
                  {delta(before.trafficFlow, after.trafficFlow)}
                </span>
              )}
            </div>
          </div>
          <ScoreBar value={after.trafficFlow} max={10} color={C.teal} animate={active} delay={300} />
        </div>
      </div>

      <div style={{ borderTop: `1px solid ${C.border}`, marginBottom: "14px" }} />

      {/* Credibility footnote */}
      <p
        style={{
          ...SANS,
          fontSize: "11px",
          color: C.dim,
          lineHeight: 1.6,
          margin: 0,
          fontStyle: "italic",
        }}
      >
        Based on outcomes from similar intersection upgrades in Ontario.
      </p>
    </div>
  );
}

// ─── Main Sidebar ─────────────────────────────────────────────────────────────

export default function Sidebar({
  selectedCluster,
  leaderboardClusters,
  loadingClusters,
  locationMeta,
  noNearbyCluster = 0,
}: SidebarProps) {
  const [view, setView] = useState<View>("leaderboard");
  const [fading, setFading] = useState(false);
  const [currentCluster, setCurrentCluster] = useState<CollisionCluster | null>(null);

  // ── "No nearby cluster" toast — auto-dismisses after 6 s ──────────────
  const [showNoNearby, setShowNoNearby] = useState(false);
  const noNearbyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (noNearbyTimerRef.current) clearTimeout(noNearbyTimerRef.current);
    if (noNearbyCluster === 0) {
      setShowNoNearby(false);
      return;
    }
    setShowNoNearby(true);
    noNearbyTimerRef.current = setTimeout(() => setShowNoNearby(false), 6_000);
    return () => {
      if (noNearbyTimerRef.current) clearTimeout(noNearbyTimerRef.current);
    };
  }, [noNearbyCluster]);

  // Simulation result — computed from currentCluster, never stale
  const simResult: SimulationResult | null = currentCluster
    ? simulate(currentCluster)
    : null;

  // Navigate with a brief fade transition
  const navigateTo = useCallback((to: View) => {
    setFading(true);
    setTimeout(() => {
      setView(to);
      setFading(false);
    }, 160);
  }, []);

  // When the map selects a cluster, jump to analysis
  useEffect(() => {
    if (!selectedCluster) return;
    setCurrentCluster(selectedCluster);
    navigateTo("analysis");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCluster?.id]);

  const handleLeaderboardSelect = useCallback(
    (c: CollisionCluster) => {
      setCurrentCluster(c);
      navigateTo("analysis");
    },
    [navigateTo]
  );

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: C.bgSurface,
        overflow: "hidden",
      }}
    >
      {/* ── Sliding content area ────────────────────────────────────────── */}
      <div
        style={{
          flex: 1,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          opacity: fading ? 0 : 1,
          transform: fading ? "translateX(10px)" : "translateX(0)",
          transition: "opacity 0.16s ease, transform 0.16s ease",
        }}
      >
        {view === "leaderboard" && (
          <LeaderboardView
            clusters={leaderboardClusters}
            loading={loadingClusters}
            onSelect={handleLeaderboardSelect}
            showNoNearby={showNoNearby}
          />
        )}

        {view === "analysis" && currentCluster && (
          <AnalysisView
            cluster={currentCluster}
            onBack={() => navigateTo("leaderboard")}
            onSimulate={() => navigateTo("simulate")}
            proximityMeters={
              locationMeta?.clusterId === currentCluster.id
                ? locationMeta.distanceMeters
                : null
            }
          />
        )}

        {view === "simulate" && currentCluster && simResult && (
          <SimulateView
            cluster={currentCluster}
            result={simResult}
            onBack={() => navigateTo("analysis")}
          />
        )}
      </div>

      {/* ── Footer (always visible) ─────────────────────────────────────── */}
      <div
        style={{
          borderTop: `1px solid ${C.border}`,
          padding: "12px 20px",
          flexShrink: 0,
        }}
      >
        <p
          style={{
            ...MONO,
            fontSize: "10px",
            color: C.dim,
            margin: 0,
            letterSpacing: "0.06em",
          }}
        >
          Kitchener pilot&nbsp;·&nbsp;Waterloo &amp; Cambridge on roadmap
        </p>
      </div>
    </div>
  );
}
