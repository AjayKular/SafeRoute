import type { CollisionCluster } from "./types";
import { analyze } from "./analyze";

export interface SimulationBefore {
  safetyScore: number;
  trafficFlow: number;
  collisionsPerYear: number;
}

export interface SimulationAfter {
  safetyScore: number;
  trafficFlow: number;
  collisionsPerYear: number;
}

export interface SimulationResult {
  before: SimulationBefore;
  after: SimulationAfter;
  topFix: string;
  reductionPct: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Traffic flow score 1–10. Higher rear-end and turning ratios signal
 * congestion and abrupt stopping — poor flow. Angle/pedestrian collisions
 * are less directly linked to throughput.
 */
function computeFlowScore(cluster: CollisionCluster): number {
  if (cluster.count === 0) return 5;
  const disruptors = cluster.types.rearEnd + cluster.types.turning;
  const ratio = disruptors / cluster.count;
  if (ratio > 0.6) return 3;
  if (ratio > 0.45) return 4;
  if (ratio > 0.3) return 5;
  if (ratio > 0.15) return 6;
  return 7;
}

/**
 * Improvement factor 0.4–0.7 based on the top fix's achievability.
 * HIGH impact + LOW cost = most gain, HIGH impact + HIGH cost = less gain
 * (harder to implement, more political resistance).
 */
function getImprovementFactor(cluster: CollisionCluster): number {
  const { fixes } = analyze(cluster);
  if (fixes.length === 0) return 0.5;
  const top = fixes[0];
  if (top.impact === "HIGH" && top.cost === "LOW") return 0.65;
  if (top.impact === "HIGH" && top.cost === "MEDIUM") return 0.55;
  if (top.impact === "HIGH" && top.cost === "HIGH") return 0.48;
  if (top.impact === "MEDIUM") return 0.43;
  return 0.40;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Scoring logic exactly as specified in SAFEROUTE_KW_MVP.md */
export function simulate(cluster: CollisionCluster): SimulationResult {
  const { fixes } = analyze(cluster);

  const before: SimulationBefore = {
    safetyScore: cluster.riskScore,
    trafficFlow: computeFlowScore(cluster),
    collisionsPerYear: Math.round(cluster.count / 5),
  };

  const improvement = getImprovementFactor(cluster);

  const after: SimulationAfter = {
    safetyScore: Math.min(
      Math.round(before.safetyScore + (10 - before.safetyScore) * improvement),
      9
    ),
    trafficFlow: Math.min(before.trafficFlow + 2, 10),
    collisionsPerYear: Math.round(
      before.collisionsPerYear * (1 - improvement * 0.6)
    ),
  };

  const reductionPct =
    before.collisionsPerYear > 0
      ? Math.round(
          ((before.collisionsPerYear - after.collisionsPerYear) /
            before.collisionsPerYear) *
            100
        )
      : 0;

  return {
    before,
    after,
    topFix: fixes[0]?.intervention ?? "Intersection upgrade",
    reductionPct,
  };
}
