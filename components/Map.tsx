"use client";

import { useEffect, useRef } from "react";
import type { CollisionCluster } from "@/lib/types";

interface MapProps {
  onSelect: (cluster: CollisionCluster) => void;
}

export default function Map({ onSelect }: MapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Stable ref so event listeners always call the latest onSelect without
  // needing to teardown and recreate the map on every render.
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    if (!containerRef.current) return;

    let mapInstance: import("mapbox-gl").Map | null = null;
    const pulseMarkers: import("mapbox-gl").Marker[] = [];
    let destroyed = false;

    const init = async () => {
      // Dynamic import keeps mapbox-gl out of the SSR bundle
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
          // collisions-fallback.json must be in public/data/ for direct fetch
          const res = await fetch("/data/collisions-fallback.json");
          clusters = await res.json();
        } catch {
          console.error("[SafeRoute] Fallback data also unavailable.");
        }
      }

      if (destroyed || !containerRef.current) return;

      // ── Create map ──────────────────────────────────────────────────────
      const map = new mapboxgl.Map({
        container: containerRef.current,
        style: "mapbox://styles/mapbox/dark-v11",
        center: [-80.4925, 43.4516],
        zoom: 12,
        attributionControl: false,
      });
      mapInstance = map;

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

        // Build GeoJSON — store complex objects as JSON strings because
        // Mapbox serialises feature properties to primitives only.
        const geojson: GeoJSON.FeatureCollection = {
          type: "FeatureCollection",
          features: clusters.map((c) => ({
            type: "Feature",
            geometry: {
              type: "Point",
              coordinates: [c.lng, c.lat],
            },
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

        // ── Source with Mapbox clustering ─────────────────────────────────
        map.addSource("clusters", {
          type: "geojson",
          data: geojson,
          cluster: true,
          clusterMaxZoom: 13, // Above zoom 13 every point is unclustered
          clusterRadius: 50,
        });

        // ── Layer: Mapbox aggregated super-clusters ────────────────────────
        // Colour step is based on how many of our pre-processed clusters
        // Mapbox has merged together at this zoom level.
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
        // Colour and size are based on the cluster's own collision `count`.
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
          const source = map.getSource("clusters") as mapboxgl.GeoJSONSource;
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

        // Cursor feedback on super-clusters
        map.on("mouseenter", "super-clusters", () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", "super-clusters", () => {
          map.getCanvas().style.cursor = "";
        });

        // ── CSS pulse markers for riskScore >= 8 ─────────────────────────
        // Only 6 clusters qualify. HTML markers give us real CSS animations
        // that WebGL layers can't provide natively.
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

          pulseMarkers.push(marker);
        }
      });
    };

    init().catch(console.error);

    return () => {
      destroyed = true;
      pulseMarkers.forEach((m) => m.remove());
      mapInstance?.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={containerRef}
      style={{ width: "100%", height: "100%", display: "block" }}
    />
  );
}
