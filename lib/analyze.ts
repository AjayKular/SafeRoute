import type { CollisionCluster } from "./types";

export type ImpactLevel = "HIGH" | "MEDIUM" | "LOW";

export interface Fix {
  intervention: string;
  impact: ImpactLevel;
  cost: ImpactLevel;
  reason: string;
}

export type DominantType =
  | "rearEnd"
  | "turning"
  | "pedestrian"
  | "angle"
  | "highVolume";

export interface Analysis {
  dominantType: DominantType;
  whyDangerous: string;
  fixes: Fix[];
}

// ---------------------------------------------------------------------------
// Fix map — exactly as specified in SAFEROUTE_KW_MVP.md
// ---------------------------------------------------------------------------

const fixMap: Record<DominantType, Omit<Fix, "reason">[]> = {
  rearEnd: [
    { intervention: "Adaptive signal timing", impact: "HIGH", cost: "MEDIUM" },
    { intervention: "Advance warning signage", impact: "MEDIUM", cost: "LOW" },
    { intervention: "Reflective lane markings", impact: "LOW", cost: "LOW" },
  ],
  turning: [
    {
      intervention: "Protected left-turn phase",
      impact: "HIGH",
      cost: "MEDIUM",
    },
    { intervention: "Left-turn advance signal", impact: "HIGH", cost: "LOW" },
    { intervention: "Sight line clearing", impact: "MEDIUM", cost: "LOW" },
  ],
  pedestrian: [
    {
      intervention: "Pedestrian scramble phase",
      impact: "HIGH",
      cost: "MEDIUM",
    },
    {
      intervention: "Countdown pedestrian timers",
      impact: "MEDIUM",
      cost: "LOW",
    },
    { intervention: "Raised crosswalk", impact: "HIGH", cost: "HIGH" },
  ],
  angle: [
    { intervention: "Roundabout conversion", impact: "HIGH", cost: "HIGH" },
    {
      intervention: "All-way stop installation",
      impact: "HIGH",
      cost: "LOW",
    },
    { intervention: "Yield sign replacement", impact: "MEDIUM", cost: "LOW" },
  ],
  highVolume: [
    {
      intervention: "Full intersection redesign",
      impact: "HIGH",
      cost: "HIGH",
    },
    {
      intervention: "Traffic signal installation",
      impact: "HIGH",
      cost: "MEDIUM",
    },
    { intervention: "Speed reduction zone", impact: "MEDIUM", cost: "LOW" },
  ],
};

// One-sentence reason explaining why each fix works at this type of intersection
const fixReasons: Record<string, string> = {
  "Adaptive signal timing":
    "Adjusting green-phase intervals reduces the gap between unexpected stops and following traffic.",
  "Advance warning signage":
    "Early warning gives drivers extra reaction distance before the deceleration zone.",
  "Reflective lane markings":
    "High-visibility markings help maintain safe following distances in low-light and wet conditions.",
  "Protected left-turn phase":
    "A dedicated phase eliminates conflict with oncoming traffic — the primary cause of turning collisions.",
  "Left-turn advance signal":
    "An advance green gives turning vehicles a clear window before opposing traffic begins to move.",
  "Sight line clearing":
    "Removing visual obstructions lets drivers judge oncoming gaps before committing to the turn.",
  "Pedestrian scramble phase":
    "All-direction walking stops all vehicle movement, eliminating every vehicle-pedestrian conflict point.",
  "Countdown pedestrian timers":
    "Countdown signals reduce last-second crossing attempts and improve pedestrian timing predictability.",
  "Raised crosswalk":
    "An elevated platform slows approaching vehicles and increases pedestrian visibility at the crossing.",
  "Roundabout conversion":
    "Roundabouts eliminate perpendicular conflicts, reducing injury-causing angle collisions by over 70%.",
  "All-way stop installation":
    "Requiring all drivers to stop equalises right-of-way and forces gap judgement at low approach speed.",
  "Yield sign replacement":
    "Converting uncontrolled entry to yield reduces conflict speeds without the full cost of signalisation.",
  "Full intersection redesign":
    "When no single factor dominates, a comprehensive redesign addresses multiple contributing causes at once.",
  "Traffic signal installation":
    "Formalising right-of-way with signals directly reduces the ambiguity that causes multi-type collisions.",
  "Speed reduction zone":
    "Lower approach speeds reduce both collision frequency and severity across all collision types.",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getDominantType(cluster: CollisionCluster): DominantType {
  const total = cluster.count;
  if (total === 0) return "highVolume";

  const pct = (n: number) => n / total;

  // Thresholds match the spec exactly
  if (pct(cluster.types.rearEnd) > 0.4) return "rearEnd";
  if (pct(cluster.types.turning) > 0.35) return "turning";
  if (pct(cluster.types.pedestrian) > 0.2) return "pedestrian";
  if (pct(cluster.types.angle) > 0.35) return "angle";
  if (total >= 20) return "highVolume";

  // Fallback: whichever type has the highest raw count
  const entries = Object.entries(cluster.types) as [
    keyof CollisionCluster["types"],
    number,
  ][];
  const [top] = entries.sort((a, b) => b[1] - a[1]);
  const map: Record<keyof CollisionCluster["types"], DominantType> = {
    rearEnd: "rearEnd",
    turning: "turning",
    pedestrian: "pedestrian",
    cyclist: "pedestrian",
    angle: "angle",
    other: "highVolume",
  };
  return map[top[0]] ?? "highVolume";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function analyze(cluster: CollisionCluster): Analysis {
  const dominantType = getDominantType(cluster);
  const total = cluster.count;
  const name = cluster.name;
  const severityRate =
    (cluster.severity.fatal + cluster.severity.injury) / total;

  // ── Explanation — references actual name and count ────────────────────────
  let whyDangerous: string;

  switch (dominantType) {
    case "rearEnd":
      whyDangerous = `${name} recorded ${total} collisions over the study period. Most collisions here are rear-end impacts, suggesting drivers are caught off guard by sudden stops — likely due to poor signal timing or limited sight distance.`;
      break;
    case "turning":
      whyDangerous = `${name} recorded ${total} collisions over the study period. Turning collisions dominate this intersection, pointing to inadequate turn signal phases or poor visibility for drivers making left turns across traffic.`;
      break;
    case "pedestrian":
      whyDangerous = `${name} recorded ${total} collisions over the study period. A high proportion of pedestrian-involved collisions makes this one of the most dangerous intersections in Kitchener for people on foot.`;
      break;
    case "angle":
      whyDangerous = `${name} recorded ${total} collisions over the study period. Angle collisions indicate drivers are misjudging gaps or failing to yield — common at intersections with confusing right-of-way or missing traffic controls.`;
      break;
    case "highVolume":
    default:
      whyDangerous = `${name} recorded ${total} collisions over the study period. This intersection sees consistently high collision volume across multiple types, suggesting a fundamental design problem rather than a single contributing factor.`;
  }

  // Append severity note if fatal collisions exist or injury rate is high
  if (cluster.severity.fatal > 0 || severityRate > 0.3) {
    whyDangerous +=
      " The severity rate here is significantly above average, meaning collisions are more likely to result in serious injury.";
  }

  // ── Fixes with one-sentence reasons ──────────────────────────────────────
  const fixes: Fix[] = fixMap[dominantType].map((f) => ({
    ...f,
    reason: fixReasons[f.intervention] ?? "",
  }));

  return { dominantType, whyDangerous, fixes };
}
