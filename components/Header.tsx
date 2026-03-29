"use client";

import type { CSSProperties } from "react";
import type { CollisionCluster } from "@/lib/types";

interface HeaderProps {
  clusters: CollisionCluster[];
  loading: boolean;
}

const MONO: CSSProperties = { fontFamily: "var(--font-dm-mono), monospace" };
const SANS: CSSProperties = { fontFamily: "var(--font-dm-sans), sans-serif" };

// Stat pill — label + monospace value
function Stat({
  label,
  value,
  loading,
  color,
}: {
  label: string;
  value: string;
  loading: boolean;
  color?: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
      <span
        style={{
          ...SANS,
          fontSize: "11px",
          color: "var(--muted)",
          letterSpacing: "0.02em",
        }}
      >
        {label}
      </span>
      {loading ? (
        <span
          className="skeleton"
          style={{ display: "inline-block", width: "52px", height: "13px", borderRadius: "3px" }}
        />
      ) : (
        <span
          style={{
            ...MONO,
            fontSize: "13px",
            fontWeight: 600,
            color: color ?? "var(--text)",
            letterSpacing: "0.02em",
          }}
        >
          {value}
        </span>
      )}
    </div>
  );
}

export default function Header({ clusters, loading }: HeaderProps) {
  const totalCollisions = clusters.reduce((s, c) => s + c.count, 0);
  // "hotspots" = clusters with meaningful risk (score ≥ 5)
  const hotspots = clusters.filter((c) => c.riskScore >= 5).length;

  return (
    <header
      style={{
        height: "48px",
        flexShrink: 0,
        backgroundColor: "var(--bg-surface)",
        borderBottom: "1px solid var(--border)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 20px",
        gap: "16px",
        zIndex: 10,
      }}
    >
      {/* ── Logo ──────────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", gap: "10px", flexShrink: 0 }}>
        {/* Red dot accent */}
        <span
          style={{
            display: "inline-block",
            width: "8px",
            height: "8px",
            borderRadius: "50%",
            backgroundColor: "var(--red)",
            flexShrink: 0,
          }}
        />
        <span
          style={{
            ...MONO,
            fontSize: "14px",
            fontWeight: 500,
            color: "var(--text)",
            letterSpacing: "0.06em",
            whiteSpace: "nowrap",
          }}
        >
          SafeRoute KW
        </span>
      </div>

      {/* ── Stats ─────────────────────────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "20px",
          flexWrap: "nowrap" as const,
          overflow: "hidden",
        }}
      >
        <Stat
          label="Collisions"
          value={totalCollisions.toLocaleString()}
          loading={loading}
          color="var(--text)"
        />

        <span style={{ color: "var(--border)", fontSize: "16px", lineHeight: 1 }}>|</span>

        <Stat
          label="Hotspots"
          value={hotspots.toLocaleString()}
          loading={loading}
          color="var(--amber)"
        />

      </div>

      {/* ── Right badge ───────────────────────────────────────────────────── */}
      <div
        style={{
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: "6px",
        }}
      >
        <span
          style={{
            ...MONO,
            fontSize: "10px",
            color: "var(--teal)",
            border: "1px solid var(--teal)",
            borderRadius: "4px",
            padding: "2px 8px",
            letterSpacing: "0.08em",
            opacity: 0.8,
          }}
        >
          KITCHENER PILOT
        </span>
      </div>
    </header>
  );
}
