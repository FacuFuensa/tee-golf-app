import React, { useEffect, useRef } from "react";
import { View } from "react-native";

import type { MapMarkerData, MapRegion, SatelliteMapProps } from "./SatelliteMap.types";

/**
 * Web satellite map using Leaflet + Esri World Imagery tiles. This avoids
 * react-native-maps' web path, which loads the Google Maps JS API and fails
 * with ApiProjectMapError when no billed Google key is configured. Esri's
 * imagery basemap needs no API key, so the green picker works in the preview.
 */

const LEAFLET_VERSION = "1.9.4";
const LEAFLET_JS = `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.js`;
const LEAFLET_CSS = `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.css`;
const ESRI_IMAGERY =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

type LeafletGlobal = typeof globalThis & { L?: any };

function loadLeaflet(): Promise<any> {
  if (typeof document === "undefined") return Promise.reject(new Error("No DOM"));

  if (!document.getElementById("leaflet-css")) {
    const link = document.createElement("link");
    link.id = "leaflet-css";
    link.rel = "stylesheet";
    link.href = LEAFLET_CSS;
    document.head.appendChild(link);
  }

  const w = window as LeafletGlobal;
  if (w.L) return Promise.resolve(w.L);

  return new Promise((resolve, reject) => {
    const existing = document.getElementById("leaflet-js") as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", () => resolve(w.L));
      existing.addEventListener("error", reject);
      return;
    }
    const script = document.createElement("script");
    script.id = "leaflet-js";
    script.src = LEAFLET_JS;
    script.async = true;
    script.onload = () => resolve(w.L);
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

/** Convert a span in degrees longitude to a Leaflet zoom level. */
function deltaToZoom(longitudeDelta: number): number {
  const safe = Math.max(longitudeDelta, 0.0005);
  const zoom = Math.log2(360 / safe);
  return Math.min(20, Math.max(2, Math.round(zoom)));
}

function markerHtml(marker: MapMarkerData): string {
  if (marker.label) {
    return `<div style="min-width:26px;height:26px;padding:0 6px;border-radius:13px;background:#4E8C6A;border:2px solid #FBF7EF;display:flex;align-items:center;justify-content:center;color:#FBF7EF;font-size:13px;font-weight:800;font-family:-apple-system,system-ui,sans-serif;box-shadow:0 1px 4px rgba(0,0,0,0.35);">${marker.label}</div>`;
  }
  return `<div style="width:16px;height:16px;border-radius:8px;background:#D9A441;border:2px solid #FBF7EF;box-shadow:0 1px 4px rgba(0,0,0,0.35);"></div>`;
}

function renderMarkers(L: any, layer: any, markers?: MapMarkerData[]): void {
  layer.clearLayers();
  (markers ?? []).forEach((m) => {
    const size = m.label ? 28 : 18;
    const icon = L.divIcon({
      html: markerHtml(m),
      className: "",
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    });
    L.marker([m.coordinate.latitude, m.coordinate.longitude], {
      icon,
      interactive: false,
      keyboard: false,
    }).addTo(layer);
  });
}

export function SatelliteMap({
  style,
  initialRegion,
  markers,
  onRegionChange,
  interactive = true,
}: SatelliteMapProps) {
  const containerRef = useRef<HTMLElement | null>(null);
  const mapRef = useRef<any>(null);
  const layerRef = useRef<any>(null);
  const onRegionChangeRef = useRef<SatelliteMapProps["onRegionChange"]>(onRegionChange);
  onRegionChangeRef.current = onRegionChange;

  useEffect(() => {
    let cancelled = false;
    let map: any;

    loadLeaflet()
      .then((L) => {
        const node = containerRef.current;
        if (cancelled || !node || !L) return;

        map = L.map(node, {
          zoomControl: false,
          attributionControl: false,
          dragging: interactive,
          touchZoom: interactive,
          scrollWheelZoom: interactive,
          doubleClickZoom: interactive,
          boxZoom: interactive,
          keyboard: interactive,
        }).setView(
          [initialRegion.latitude, initialRegion.longitude],
          deltaToZoom(initialRegion.longitudeDelta),
        );

        L.tileLayer(ESRI_IMAGERY, { maxZoom: 20, crossOrigin: true }).addTo(map);
        layerRef.current = L.layerGroup().addTo(map);
        mapRef.current = map;

        setTimeout(() => map.invalidateSize(), 0);

        const emit = (): void => {
          const c = map.getCenter();
          const b = map.getBounds();
          const region: MapRegion = {
            latitude: c.lat,
            longitude: c.lng,
            latitudeDelta: Math.abs(b.getNorth() - b.getSouth()),
            longitudeDelta: Math.abs(b.getEast() - b.getWest()),
          };
          onRegionChangeRef.current?.(region);
        };
        map.on("move", emit);

        renderMarkers(L, layerRef.current, markers);
      })
      .catch(() => {
        // Leaflet failed to load (offline preview); the crosshair overlay still
        // lets the parent read a sensible default center.
      });

    return () => {
      cancelled = true;
      if (map) map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
    // Initialize once; marker/region updates are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const w = window as LeafletGlobal;
    if (!w.L || !layerRef.current) return;
    renderMarkers(w.L, layerRef.current, markers);
  }, [markers]);

  return (
    <View
      // @ts-expect-error react-native-web forwards the ref to the host DOM node.
      ref={containerRef}
      style={style}
    />
  );
}
