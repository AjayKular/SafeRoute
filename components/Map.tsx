"use client";

import { useEffect, useRef, useState } from "react";
import type mapboxgl from "mapbox-gl";
import type { CollisionCluster } from "@/lib/types";

type MapMode = "clusters" | "heatmap";

// ── Geo helpers ────────────────────────────────────────────────────────────────

function haversineMeters(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
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

function findNearestCluster(
  clusters: CollisionCluster[],
  lat: number,
  lng: number,
  maxMeters: number,
): { cluster: CollisionCluster; distanceMeters: number } | null {
  let nearest: CollisionCluster | null = null;
  let nearestDist = Infinity;
  for (const c of clusters) {
    const d = haversineMeters(lat, lng, c.lat, c.lng);
    if (d <= maxMeters && d < nearestDist) {
      nearest = c;
      nearestDist = d;
    }
  }
  return nearest
    ? { cluster: nearest, distanceMeters: Math.round(nearestDist) }
    : null;
}
type CollisionFilter = "all" | "pedestrian" | "cyclist" | "rearEnd" | "angle";

interface FilterOption {
  value: CollisionFilter;
  label: string;
}

const FILTER_OPTIONS: FilterOption[] = [
  { value: "all", label: "All" },
  { value: "pedestrian", label: "Pedestrian" },
  { value: "cyclist", label: "Cyclist" },
  { value: "rearEnd", label: "Rear-end" },
  { value: "angle", label: "Angle" },
];

const CLUSTER_LAYERS = [
  "super-clusters",
  "super-cluster-count",
  "unclustered-point",
];

function buildGeojson(clusters: CollisionCluster[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: clusters.map((c) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [c.lng, c.lat] },
      properties: {
        id: c.id,
        name: c.name,
        lat: c.lat,
        lng: c.lng,
        count: c.count,
        riskScore: c.riskScore,
        peakTime: c.peakTime,
        // Nested objects must be stringified
        types: JSON.stringify(c.types),
        severity: JSON.stringify(c.severity),
      },
    })),
  };
}

function applyFilter(
  clusters: CollisionCluster[],
  filter: CollisionFilter
): CollisionCluster[] {
  if (filter === "all") return clusters;
  return clusters.filter((c) => {
    switch (filter) {
      case "pedestrian": return c.types.pedestrian > 0;
      case "cyclist":    return c.types.cyclist > 0;
      case "rearEnd":    return c.types.rearEnd > 0;
      case "angle":      return c.types.angle > 0;
    }
  });
}

interface MapProps {
  onSelect: (cluster: CollisionCluster) => void;
  onNearbyResult: (cluster: CollisionCluster | null, distanceMeters: number) => void;
}

export default function Map({ onSelect, onNearbyResult }: MapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Stable ref so event listeners always call the latest onSelect without
  // needing to teardown and recreate the map on every render.
  const onSelectRef = useRef(onSelect);
  const mapRef = useRef<import("mapbox-gl").Map | null>(null);
  const pulseMarkersRef = useRef<import("mapbox-gl").Marker[]>([]);
  const allClustersRef = useRef<CollisionCluster[]>([]);

  const [mode, setMode] = useState<MapMode>("clusters");
  const [filter, setFilter] = useState<CollisionFilter>("all");
  const [mapReady, setMapReady] = useState(false);
  const [geoLoading, setGeoLoading] = useState(false);

  const onNearbyResultRef = useRef(onNearbyResult);
  useEffect(() => { onNearbyResultRef.current = onNearbyResult; }, [onNearbyResult]);

  const handleMyRiskScore = () => {
    if (!navigator.geolocation || allClustersRef.current.length === 0) return;
    setGeoLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeoLoading(false);
        const { latitude: lat, longitude: lng } = pos.coords;
        const result = findNearestCluster(allClustersRef.current, lat, lng, 1000);
        if (result) {
          mapRef.current?.flyTo({
            center: [result.cluster.lng, result.cluster.lat],
            zoom: Math.max(mapRef.current.getZoom(), 14),
            speed: 0.85,
            curve: 1.4,
          });
        }
        onNearbyResultRef.current(result?.cluster ?? null, result?.distanceMeters ?? 0);
      },
      () => {
        // Permission denied or unavailable — silently abort
        setGeoLoading(false);
      },
      { timeout: 10_000, maximumAge: 60_000 },
    );
  };

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  // ── One-time map initialisation ─────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;

    let destroyed = false;

    const init = async () => {
      const mapboxgl = (await import("mapbox-gl")).default;

      if (destroyed || !containerRef.current) return;

      const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
      if (!token) {
        console.error("[SafeRoute] NEXT_PUBLIC_MAPBOX_TOKEN is not set.");
        return;
      }
      mapboxgl.accessToken = token;

      // ── Load cluster data (API route → fallback JSON) ──────────────────
      let clusters: CollisionCluster[] = [];
      try {
        const res = await fetch("/api/clusters");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        clusters = await res.json();
      } catch (err) {
        console.warn("[SafeRoute] /api/clusters failed, using fallback", err);
        try {
          const res = await fetch("/data/collisions-fallback.json");
          clusters = await res.json();
        } catch {
          console.error("[SafeRoute] Fallback data also unavailable.");
        }
      }

      if (destroyed || !containerRef.current) return;

      allClustersRef.current = clusters;

      // ── Create map ──────────────────────────────────────────────────────
      const map = new mapboxgl.Map({
        container: containerRef.current,
        style: "mapbox://styles/mapbox/dark-v11",
        center: [-80.4925, 43.4516],
        zoom: 12,
        attributionControl: false,
      });
      mapRef.current = map;

      map.addControl(
        new mapboxgl.AttributionControl({ compact: true }),
        "bottom-right"
      );
      map.addControl(
        new mapboxgl.NavigationControl({ showCompass: false }),
        "bottom-right"
      );

      // ── Map ready ───────────────────────────────────────────────────────
      map.on("load", () => {
        if (destroyed) return;

        const geojson = buildGeojson(clusters);

        // ── Source with Mapbox clustering (clusters view) ─────────────────
        map.addSource("clusters", {
          type: "geojson",
          data: geojson,
          cluster: true,
          clusterMaxZoom: 13,
          clusterRadius: 50,
        });

        // ── Separate non-clustered source for heatmap ─────────────────────
        map.addSource("heatmap-source", {
          type: "geojson",
          data: geojson,
        });

        // ── Layer: Mapbox aggregated super-clusters ────────────────────────
        map.addLayer({
          id: "super-clusters",
          type: "circle",
          source: "clusters",
          filter: ["has", "point_count"],
          paint: {
            "circle-color": [
              "step",
              ["get", "point_count"],
              "#F4A261", // amber  — 1-5 merged points
              6,
              "#F97316", // orange — 6-15
              16,
              "#E63946", // red    — 16+
            ],
            "circle-radius": [
              "step",
              ["get", "point_count"],
              14,
              6,
              18,
              16,
              24,
            ],
            "circle-opacity": 0.88,
            "circle-stroke-width": 1.5,
            "circle-stroke-color": "rgba(0,0,0,0.35)",
          },
        });

        // ── Layer: super-cluster count label ──────────────────────────────
        map.addLayer({
          id: "super-cluster-count",
          type: "symbol",
          source: "clusters",
          filter: ["has", "point_count"],
          layout: {
            "text-field": "{point_count_abbreviated}",
            "text-font": ["DIN Offc Pro Medium", "Arial Unicode MS Bold"],
            "text-size": 12,
          },
          paint: {
            "text-color": "#F0F2F5",
          },
        });

        // ── Layer: individual pre-processed collision cluster dots ─────────
        map.addLayer({
          id: "unclustered-point",
          type: "circle",
          source: "clusters",
          filter: ["!", ["has", "point_count"]],
          paint: {
            "circle-color": [
              "step",
              ["get", "count"],
              "#F4A261", // amber  — 1-5 collisions
              6,
              "#F97316", // orange — 6-15
              16,
              "#E63946", // red    — 16+
            ],
            "circle-radius": [
              "interpolate",
              ["linear"],
              ["get", "count"],
              1, 7,
              10, 11,
              25, 15,
              50, 20,
            ],
            "circle-opacity": 0.9,
            "circle-stroke-width": 1,
            "circle-stroke-color": "#0A0C0F",
            "circle-stroke-opacity": 0.5,
          },
        });

        // ── Layer: heatmap (initially hidden) ─────────────────────────────
        map.addLayer({
          id: "collision-heatmap",
          type: "heatmap",
          source: "heatmap-source",
          layout: { visibility: "none" },
          paint: {
            "heatmap-weight": [
              "interpolate",
              ["linear"],
              ["get", "count"],
              0, 0,
              50, 1,
            ],
            "heatmap-intensity": [
              "interpolate",
              ["linear"],
              ["zoom"],
              10, 0.8,
              15, 2,
            ],
            "heatmap-radius": [
              "interpolate",
              ["linear"],
              ["zoom"],
              10, 20,
              15, 40,
            ],
            "heatmap-color": [
              "interpolate",
              ["linear"],
              ["heatmap-density"],
              0, "rgba(0,0,0,0)",
              0.35, "rgba(244,162,97,0.6)",
              0.65, "#F4A261",
              1, "#E63946",
            ],
            "heatmap-opacity": 0.85,
          },
        });

        // ── Hover popup ───────────────────────────────────────────────────
        const popup = new mapboxgl.Popup({
          closeButton: false,
          closeOnClick: false,
          offset: 14,
        });

        map.on("mouseenter", "unclustered-point", (e) => {
          map.getCanvas().style.cursor = "pointer";
          const feat = e.features?.[0];
          if (!feat) return;
          const p = feat.properties as Record<string, unknown>;
          const coords = (
            feat.geometry as GeoJSON.Point
          ).coordinates.slice() as [number, number];

          popup
            .setLngLat(coords)
            .setHTML(
              `<div class="sr-popup">
                <div class="sr-popup-name">${p.name}</div>
                <div class="sr-popup-meta">${p.count} collisions &nbsp;·&nbsp; Risk ${p.riskScore}/10</div>
              </div>`
            )
            .addTo(map);
        });

        map.on("mouseleave", "unclustered-point", () => {
          map.getCanvas().style.cursor = "";
          popup.remove();
        });

        // ── Click: individual cluster → select + fly ──────────────────────
        map.on("click", "unclustered-point", (e) => {
          const feat = e.features?.[0];
          if (!feat) return;
          const p = feat.properties as Record<string, unknown>;
          const coords = (feat.geometry as GeoJSON.Point).coordinates as [
            number,
            number,
          ];

          const cluster: CollisionCluster = {
            id: String(p.id),
            name: String(p.name),
            lat: Number(p.lat),
            lng: Number(p.lng),
            count: Number(p.count),
            riskScore: Number(p.riskScore),
            peakTime: String(p.peakTime),
            types:
              typeof p.types === "string"
                ? JSON.parse(p.types)
                : (p.types as CollisionCluster["types"]),
            severity:
              typeof p.severity === "string"
                ? JSON.parse(p.severity)
                : (p.severity as CollisionCluster["severity"]),
          };

          map.flyTo({
            center: coords,
            zoom: Math.max(map.getZoom(), 14),
            speed: 0.85,
            curve: 1.4,
          });

          onSelectRef.current(cluster);
        });

        // ── Click: super-cluster → zoom in ────────────────────────────────
        map.on("click", "super-clusters", (e) => {
          const feat = e.features?.[0];
          if (!feat) return;
          const clusterId = (feat.properties as Record<string, unknown>)
            .cluster_id as number;
          const source = map.getSource(
            "clusters"
          ) as mapboxgl.GeoJSONSource;
          source.getClusterExpansionZoom(clusterId, (err, zoom) => {
            if (err || zoom == null) return;
            map.flyTo({
              center: (feat.geometry as GeoJSON.Point).coordinates as [
                number,
                number,
              ],
              zoom,
              speed: 0.9,
            });
          });
        });

        map.on("mouseenter", "super-clusters", () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", "super-clusters", () => {
          map.getCanvas().style.cursor = "";
        });

        // ── CSS pulse markers for riskScore >= 8 ─────────────────────────
        const highRisk = clusters.filter((c) => c.riskScore >= 8);
        for (const c of highRisk) {
          const el = document.createElement("div");
          el.className = "pulse-marker";
          el.setAttribute("data-cluster-id", c.id);

          const marker = new mapboxgl.Marker({
            element: el,
            anchor: "center",
          })
            .setLngLat([c.lng, c.lat])
            .addTo(map);

          pulseMarkersRef.current.push(marker);
        }

        setMapReady(true);
      });
    };

    init().catch(console.error);

    return () => {
      destroyed = true;
      pulseMarkersRef.current.forEach((m) => m.remove());
      pulseMarkersRef.current = [];
      mapRef.current?.remove();
      mapRef.current = null;
      setMapReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Mode + filter: toggle layers and update source data ─────────────────
  // Single effect handles both so the two concerns always stay in sync.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const showClusters = mode === "clusters";

    // Toggle cluster layers
    CLUSTER_LAYERS.forEach((id) => {
      if (map.getLayer(id)) {
        map.setLayoutProperty(
          id,
          "visibility",
          showClusters ? "visible" : "none"
        );
      }
    });

    // Toggle heatmap layer
    if (map.getLayer("collision-heatmap")) {
      map.setLayoutProperty(
        "collision-heatmap",
        "visibility",
        showClusters ? "none" : "visible"
      );
    }

    // Filter source data for both cluster and heatmap sources
    const filtered = applyFilter(allClustersRef.current, filter);
    const filteredIds = new Set(filtered.map((c) => c.id));
    const geojson = buildGeojson(filtered);

    (map.getSource("clusters") as mapboxgl.GeoJSONSource)?.setData(geojson);
    (map.getSource("heatmap-source") as mapboxgl.GeoJSONSource)?.setData(geojson);

    // Pulse markers: visible only in cluster mode and when cluster passes filter
    pulseMarkersRef.current.forEach((m) => {
      const el = m.getElement() as HTMLElement;
      const id = el.getAttribute("data-cluster-id");
      el.style.display =
        showClusters && (!id || filteredIds.has(id)) ? "" : "none";
    });
  }, [mode, filter, mapReady]);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <div
        ref={containerRef}
        style={{ width: "100%", height: "100%", display: "block" }}
      />

      {/* ── Map controls overlay ────────────────────────────────────────── */}
      <div className="map-controls">

        {/* Row 1: mode toggle */}
        <div className="map-mode-toggle">
          <button
            className={`map-mode-btn${mode === "clusters" ? " map-mode-btn--active" : ""}`}
            onClick={() => setMode("clusters")}
          >
            Clusters
          </button>
          <button
            className={`map-mode-btn${mode === "heatmap" ? " map-mode-btn--active" : ""}`}
            onClick={() => setMode("heatmap")}
          >
            Heatmap
          </button>
        </div>

        {/* Row 2: filter pills — clusters mode only */}
        {mode === "clusters" && (
          <div className="map-filter-pills">
            {FILTER_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                className={`map-filter-pill${filter === opt.value ? " map-filter-pill--active" : ""}`}
                onClick={() => setFilter(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}

        {/* Row 3: My Risk Score */}
        <button
          className={`map-geo-btn${geoLoading ? " map-geo-btn--loading" : ""}`}
          onClick={handleMyRiskScore}
          disabled={geoLoading}
        >
          {geoLoading ? "Locating…" : "◎ My Risk Score"}
        </button>

      </div>
    </div>
  );
}
