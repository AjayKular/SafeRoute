/**
 * process-csv.ts
 * Reads /data/raw/collisions.csv and outputs /data/collisions.json
 * Run with: npm run process-csv
 */

import * as fs from "fs";
import * as path from "path";
import Papa from "papaparse";

const INPUT_PATH = path.join(__dirname, "../data/raw/collisions.csv");
const OUTPUT_PATH = path.join(__dirname, "../data/collisions.json");
const CLUSTER_RADIUS_M = 50;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RawRow {
  LATITUDE: string;
  LONGITUDE: string;
  ACCIDENTDATE: string;
  ACCIDENT_YEAR: string;
  ACCIDENT_HOUR: string;
  CLASSIFICATIONOFACCIDENT: string;
  PEDESTRIANINVOLVED: string;
  CYCLISTINVOLVED: string;
  COLLISIONTYPE: string;
  INITIALIMPACTTYPE: string; // descriptive type values: "Rear end", "Angle", etc.
  XMLIMPORTNOTES: string;
}

interface WorkingCluster {
  id: string;
  name: string;
  count: number;
  _sumLat: number;
  _sumLng: number;
  types: {
    rearEnd: number;
    turning: number;
    pedestrian: number;
    cyclist: number;
    angle: number;
    other: number;
  };
  severity: {
    fatal: number;
    injury: number;
    pdo: number;
  };
  _hours: number[];
  peakTime: string;
  riskScore: number;
}

interface CollisionCluster {
  id: string;
  name: string;
  lat: number;
  lng: number;
  count: number;
  types: {
    rearEnd: number;
    turning: number;
    pedestrian: number;
    cyclist: number;
    angle: number;
    other: number;
  };
  severity: {
    fatal: number;
    injury: number;
    pdo: number;
  };
  peakTime: string;
  riskScore: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Haversine distance between two lat/lng points in metres */
function haversine(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Convert ALL CAPS street string to Title Case */
function toTitleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Parse an intersection name from XMLIMPORTNOTES.
 * Format: "STREET1; STREET2; Near/At; distance M"
 * We take the first two parts that look like street names (not addresses or
 * keywords) and join with " & ".
 */
function parseIntersectionName(notes: string): string {
  if (!notes || notes.trim() === "") return "";

  const parts = notes
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);

  const streets = parts.filter((p) => {
    if (!p) return false;
    // Skip address fragments starting with a house number e.g. "372 MORRISON RD"
    if (/^\d+\s+/.test(p)) return false;
    // Skip direction/proximity keywords
    if (/^(At|Near|Far|With)$/i.test(p)) return false;
    // Skip pure distance fragments like "30 M" or "M"
    if (/^\d*\s*M$/i.test(p)) return false;
    // Skip pure numbers
    if (/^\d+$/.test(p)) return false;
    return true;
  });

  if (streets.length === 0) return "";
  return streets
    .slice(0, 2)
    .map(toTitleCase)
    .join(" & ");
}

/** Robustly parse a boolean field that may be "True", "true", "TRUE", "1", "yes" */
function parseBool(value: string): boolean {
  const v = (value ?? "").trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

/** Map CLASSIFICATIONOFACCIDENT string to a severity key */
function parseSeverity(classification: string): "fatal" | "injury" | "pdo" {
  const c = classification.trim().toLowerCase();
  // "Fatal" classification — exact match first
  if (c === "fatal" || c.startsWith("fatal")) return "fatal";
  // "Non-fatal injury"
  if (c.includes("non-fatal") || c.includes("injury")) return "injury";
  // "P.D. only" → property damage only
  return "pdo";
}

/**
 * Map collision type.
 * Pedestrian/cyclist involvement takes precedence over impact type.
 * INITIALIMPACTTYPE has descriptive values used for the other categories.
 * Cyclists are tracked separately from pedestrians.
 */
function parseCollisionType(
  impactType: string,
  pedestrianInvolved: boolean,
  cyclistInvolved: boolean
): "rearEnd" | "turning" | "pedestrian" | "cyclist" | "angle" | "other" {
  if (pedestrianInvolved) return "pedestrian";
  if (cyclistInvolved) return "cyclist";
  const t = impactType.trim().toLowerCase();
  if (t.includes("rear end") || t === "approaching") return "rearEnd";
  if (t.includes("turning")) return "turning";
  if (t === "angle") return "angle";
  return "other";
}

/**
 * Find the most common 2-hour window (00–01, 02–03, …, 22–23)
 * and format it as "5pm–7pm".
 */
function computePeakTime(hours: number[]): string {
  if (hours.length === 0) return "Unknown";

  // 12 non-overlapping 2-hour windows
  const windowCounts = new Array(12).fill(0);
  for (const h of hours) {
    windowCounts[Math.floor(h / 2)]++;
  }
  const maxIdx = windowCounts.indexOf(Math.max(...windowCounts));
  const startH = maxIdx * 2;
  const endH = startH + 2;

  const fmt = (h: number): string => {
    if (h === 0 || h === 24) return "12am";
    if (h === 12) return "12pm";
    if (h < 12) return `${h}am`;
    return `${h - 12}pm`;
  };

  return `${fmt(startH)}–${fmt(endH)}`;
}

/** Risk score formula exactly as specified in SAFEROUTE_KW_MVP.md */
function computeRiskScore(c: WorkingCluster): number {
  let score = 0;
  // Volume (max 4 pts)
  if (c.count >= 30) score += 4;
  else if (c.count >= 15) score += 3;
  else if (c.count >= 6) score += 2;
  else score += 1;
  // Severity (max 4 pts)
  score += Math.min(c.severity.fatal * 4, 2);
  score += Math.min(c.severity.injury * 0.2, 2);
  // Vulnerable road user involvement (pedestrian + cyclist, max 2 pts)
  const vulnerable = c.types.pedestrian + c.types.cyclist;
  if (vulnerable > 0) {
    score += Math.min(vulnerable * 0.5, 2);
  }
  return Math.min(Math.round(score), 10);
}

/** Slugify a cluster name to create a stable id */
function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  console.log("SafeRoute KW — CSV Processor");
  console.log("================================");
  console.log(`Input:  ${INPUT_PATH}`);
  console.log(`Output: ${OUTPUT_PATH}`);
  console.log();

  // Read and parse CSV
  const csvContent = fs.readFileSync(INPUT_PATH, "utf-8");
  const parsed = Papa.parse<RawRow>(csvContent, {
    header: true,
    skipEmptyLines: true,
  });

  console.log(`CSV rows (including skipped): ${parsed.data.length}`);
  if (parsed.errors.length > 0) {
    console.warn(`  Parse warnings: ${parsed.errors.length}`);
  }

  const clusters: WorkingCluster[] = [];
  // Parallel array to cache centroids to avoid recomputing every iteration
  const centroids: Array<{ lat: number; lng: number }> = [];

  let processed = 0;
  let skipped = 0;

  for (const row of parsed.data) {
    const lat = parseFloat(row.LATITUDE);
    const lng = parseFloat(row.LONGITUDE);

    // Skip rows with missing or obviously invalid coordinates
    if (
      !row.LATITUDE ||
      !row.LONGITUDE ||
      isNaN(lat) ||
      isNaN(lng) ||
      lat === 0 ||
      lng === 0 ||
      Math.abs(lat) < 1 ||
      Math.abs(lng) < 1
    ) {
      skipped++;
      continue;
    }

    const hour = parseInt(row.ACCIDENT_HOUR ?? "0", 10);
    const severity = parseSeverity(row.CLASSIFICATIONOFACCIDENT ?? "");
    const pedestrian = parseBool(row.PEDESTRIANINVOLVED ?? "");
    const cyclist = parseBool(row.CYCLISTINVOLVED ?? "");
    const collisionType = parseCollisionType(
      row.INITIALIMPACTTYPE ?? "",
      pedestrian,
      cyclist
    );
    const name = parseIntersectionName(row.XMLIMPORTNOTES ?? "");

    // Find nearest existing cluster within 50 m
    let nearestIdx = -1;
    let nearestDist = Infinity;
    for (let i = 0; i < centroids.length; i++) {
      const d = haversine(lat, lng, centroids[i].lat, centroids[i].lng);
      if (d < CLUSTER_RADIUS_M && d < nearestDist) {
        nearestDist = d;
        nearestIdx = i;
      }
    }

    if (nearestIdx >= 0) {
      // Add to existing cluster and update running centroid
      const c = clusters[nearestIdx];
      c.count++;
      c._sumLat += lat;
      c._sumLng += lng;
      c.types[collisionType]++;
      c.severity[severity]++;
      c._hours.push(isNaN(hour) ? 0 : hour);
      // Update centroid average
      centroids[nearestIdx] = {
        lat: c._sumLat / c.count,
        lng: c._sumLng / c.count,
      };
    } else {
      // Create new cluster
      const baseName = name || `${lat.toFixed(3)},${lng.toFixed(3)}`;
      const id = toSlug(baseName);
      const newCluster: WorkingCluster = {
        id,
        name: baseName,
        count: 1,
        _sumLat: lat,
        _sumLng: lng,
        types: { rearEnd: 0, turning: 0, pedestrian: 0, cyclist: 0, angle: 0, other: 0 },
        severity: { fatal: 0, injury: 0, pdo: 0 },
        _hours: [isNaN(hour) ? 0 : hour],
        peakTime: "",
        riskScore: 0,
      };
      newCluster.types[collisionType]++;
      newCluster.severity[severity]++;
      clusters.push(newCluster);
      centroids.push({ lat, lng });
    }

    processed++;
  }

  // Finalise each cluster
  const output: CollisionCluster[] = clusters.map((c, i) => {
    c.peakTime = computePeakTime(c._hours);
    c.riskScore = computeRiskScore(c);

    // Deduplicate id if needed
    const lat = centroids[i].lat;
    const lng = centroids[i].lng;

    return {
      id: c.id,
      name: c.name,
      lat: parseFloat(lat.toFixed(6)),
      lng: parseFloat(lng.toFixed(6)),
      count: c.count,
      types: c.types,
      severity: c.severity,
      peakTime: c.peakTime,
      riskScore: c.riskScore,
    };
  });

  // Sort descending by riskScore, then count
  output.sort((a, b) => b.riskScore - a.riskScore || b.count - a.count);

  // Deduplicate ids (same street pair at different locations)
  const idCounts: Record<string, number> = {};
  for (const cluster of output) {
    if (idCounts[cluster.id] !== undefined) {
      idCounts[cluster.id]++;
      cluster.id = `${cluster.id}-${idCounts[cluster.id]}`;
    } else {
      idCounts[cluster.id] = 0;
    }
  }

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), "utf-8");

  // Summary stats
  const totalCollisions = output.reduce((s, c) => s + c.count, 0);
  const riskDist = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((score) => ({
    score,
    count: output.filter((c) => c.riskScore === score).length,
  }));

  console.log(`Rows processed:  ${processed}`);
  console.log(`Rows skipped:    ${skipped}`);
  console.log(`Clusters created: ${output.length}`);
  console.log(`Total collisions mapped: ${totalCollisions}`);
  console.log();
  console.log("Risk score distribution:");
  for (const { score, count } of riskDist) {
    if (count > 0) console.log(`  Score ${score}: ${count} cluster(s)`);
  }
  console.log();
  console.log("Top 5 clusters by risk score:");
  for (const c of output.slice(0, 5)) {
    console.log(
      `  [${c.riskScore}/10] ${c.name} — ${c.count} collisions (peak: ${c.peakTime})`
    );
  }
  console.log();
  console.log(`Output written to: ${OUTPUT_PATH}`);
}

main();
