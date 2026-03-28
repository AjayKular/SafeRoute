"use client";

import { useState, useCallback, useEffect } from "react";
import dynamic from "next/dynamic";
import Header from "@/components/Header";
import Sidebar from "@/components/Sidebar";
import type { CollisionCluster } from "@/lib/types";

// Map uses browser APIs — skip SSR
const Map = dynamic(() => import("@/components/Map"), { ssr: false });

export default function Home() {
  // ── Cluster data (single source of truth for both Header and Sidebar) ──
  const [clusters, setClusters] = useState<CollisionCluster[]>([]);
  const [loadingClusters, setLoadingClusters] = useState(true);

  useEffect(() => {
    fetch("/api/clusters")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<CollisionCluster[]>;
      })
      .then((data) => {
        setClusters(data);
        setLoadingClusters(false);
      })
      .catch(() => {
        // Silent fallback — API route already falls back to collisions-fallback.json
        // but if even that fails, keep an empty array and stop loading
        setLoadingClusters(false);
      });
  }, []);

  // ── Selected cluster (map click → sidebar analysis) ───────────────────
  const [selected, setSelected] = useState<CollisionCluster | null>(null);

  const handleSelect = useCallback((cluster: CollisionCluster) => {
    setSelected(cluster);
  }, []);

  // Top 5 by riskScore for the leaderboard — clusters are already sorted
  // by riskScore desc from /api/clusters
  const leaderboardClusters = clusters.slice(0, 5);

  return (
    <div
      style={{
        height: "100dvh",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        backgroundColor: "#0A0C0F",
      }}
    >
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <Header clusters={clusters} loading={loadingClusters} />

      {/* ── Main area (map + sidebar) ──────────────────────────────────── */}
      <div
        style={{
          flex: 1,
          display: "flex",
          overflow: "hidden",
          // minHeight 0 is critical: lets flex children shrink below their
          // natural content height so the row never overflows the viewport.
          minHeight: 0,
        }}
      >
        {/* Map */}
        <div style={{ flex: 1, position: "relative", minWidth: 0 }}>
          <Map onSelect={handleSelect} />
        </div>

        {/* Sidebar */}
        <div
          style={{
            width: "380px",
            flexShrink: 0,
            borderLeft: "1px solid #1E2229",
            overflow: "hidden",
          }}
        >
          <Sidebar
            selectedCluster={selected}
            leaderboardClusters={leaderboardClusters}
            loadingClusters={loadingClusters}
          />
        </div>
      </div>
    </div>
  );
}
