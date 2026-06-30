"use client";

import { useEffect, useState, useCallback } from "react";
import { MapContainer, TileLayer, Marker, Popup, Polyline, Polygon, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const spotIcon = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
});

const CATEGORY_STYLE: Record<string, { color: string; emoji: string }> = {
  観光: { color: "#ea580c", emoji: "🏛" },
  文化財: { color: "#92400e", emoji: "🏯" },
  展望: { color: "#7c3aed", emoji: "🔭" },
  飲食: { color: "#dc2626", emoji: "🍜" },
  買い物: { color: "#16a34a", emoji: "🛍" },
  トイレ: { color: "#2563eb", emoji: "🚻" },
  駐車場: { color: "#6b7280", emoji: "🅿" },
  その他: { color: "#6b7280", emoji: "📍" },
};

function makeCategoryIcon(category: string) {
  const style = CATEGORY_STYLE[category] ?? CATEGORY_STYLE["その他"];
  return L.divIcon({
    className: "",
    html: `
      <div style="
        background:${style.color};
        width:30px;height:30px;
        border-radius:50%;
        display:flex;align-items:center;justify-content:center;
        font-size:15px;
        box-shadow:0 2px 6px rgba(0,0,0,0.3);
        border:2px solid #fff;
      ">${style.emoji}</div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    popupAnchor: [0, -18],
  });
}

const KNOWN_CATEGORIES = new Set(Object.keys(CATEGORY_STYLE));

function makeLabelIcon(label: string, color: string) {
  return L.divIcon({
    className: "",
    html: `
      <div style="
        background:${color};
        color:#fff;
        font-weight:bold;
        font-size:13px;
        width:28px;height:28px;
        border-radius:50% 50% 50% 0;
        transform:rotate(-45deg);
        display:flex;align-items:center;justify-content:center;
        box-shadow:0 2px 6px rgba(0,0,0,0.3);
        border:2px solid #fff;
      ">
        <span style="transform:rotate(45deg)">${label}</span>
      </div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 28],
    popupAnchor: [0, -30],
  });
}

const startIcon = makeLabelIcon("A", "#16a34a");
const goalIcon  = makeLabelIcon("B", "#dc2626");

function makeWaypointIcon(num: number) {
  return L.divIcon({
    className: "",
    html: `
      <div style="
        background:#7c3aed;
        color:#fff;
        font-weight:bold;
        font-size:13px;
        width:28px;height:28px;
        border-radius:50% 50% 50% 0;
        transform:rotate(-45deg);
        display:flex;align-items:center;justify-content:center;
        box-shadow:0 2px 6px rgba(0,0,0,0.3);
        border:2px solid #fff;
      ">
        <span style="transform:rotate(45deg)">${num}</span>
      </div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 28],
    popupAnchor: [0, -30],
  });
}

const SAKURAJIMA: [number, number] = [31.5806, 130.6572];
const SPREAD_DEG = 35;

function calcAshFallCone(ashFallDirection: number, windSpeed: number): [number, number][] {
  let distKm: number;
  if (windSpeed < 3) distKm = 5;
  else if (windSpeed < 7) distKm = 12;
  else if (windSpeed < 14) distKm = 22;
  else distKm = 35;

  const [lat, lng] = SAKURAJIMA;
  const latRad = (lat * Math.PI) / 180;
  const points: [number, number][] = [SAKURAJIMA];

  for (let offset = -SPREAD_DEG; offset <= SPREAD_DEG; offset += 5) {
    const bearing = ((ashFallDirection + offset) % 360 + 360) % 360;
    const bRad = (bearing * Math.PI) / 180;
    const dy = (Math.cos(bRad) * distKm) / 111.0;
    const dx = (Math.sin(bRad) * distKm) / (111.0 * Math.cos(latRad));
    points.push([lat + dy, lng + dx]);
  }

  return points;
}

export type AshFallData = {
  windSpeed: number;
  windDirection: number;
  ashFallDirection: number;
  updatedAt: string;
};

export type Spot = {
  name: string;
  lat: number;
  lng: number;
  description: string;
  category?: string;
  durationMinutes?: number;
  tags?: string[];
  rating?: number;
  reviewCount?: number;
  photoUrl?: string;
};

export type LatLng = { lat: number; lng: number };

// OSRM は [lng, lat] 順で返すので [lat, lng] に変換
function toLatLng(coords: [number, number][]): [number, number][] {
  return coords.map(([lng, lat]) => [lat, lng]);
}

function InvalidateSize() {
  const map = useMap();
  useEffect(() => {
    const timer = setTimeout(() => map.invalidateSize(), 100);
    return () => clearTimeout(timer);
  });
  return null;
}

function FitBounds({
  spots,
  route,
  start,
  goal,
}: {
  spots: Spot[];
  route: [number, number][] | null;
  start: LatLng | null;
  goal: LatLng | null;
}) {
  const map = useMap();
  useEffect(() => {
    if (route && route.length > 0) {
      const bounds = L.latLngBounds(toLatLng(route));
      map.fitBounds(bounds, { padding: [50, 50] });
    } else if (start && goal) {
      const bounds = L.latLngBounds([[start.lat, start.lng], [goal.lat, goal.lng]]);
      map.fitBounds(bounds, { padding: [80, 80] });
    } else if (spots.length > 0) {
      const bounds = L.latLngBounds(spots.map((s) => [s.lat, s.lng]));
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 });
    }
  }, [spots, route, start, goal, map]);
  return null;
}

function getMaxSpots(zoom: number): number {
  if (zoom >= 16) return Infinity;
  if (zoom >= 14) return 30;
  if (zoom >= 12) return 15;
  return 5;
}

function ZoomAwareSpots({ spots, focusedSpotName, focusKey }: { spots: Spot[]; focusedSpotName?: string | null; focusKey?: number }) {
  const map = useMap();
  const [zoom, setZoom] = useState(map.getZoom());

  const onZoom = useCallback(() => setZoom(map.getZoom()), [map]);
  useEffect(() => {
    map.on("zoomend", onZoom);
    return () => { map.off("zoomend", onZoom); };
  }, [map, onZoom]);

  useEffect(() => {
    if (!focusedSpotName) return;
    const spot = spots.find((s) => s.name === focusedSpotName);
    if (!spot) return;

    const onMoveEnd = () => {
      map.off("moveend", onMoveEnd);
      setTimeout(() => {
        map.eachLayer((layer) => {
          if (layer instanceof L.Marker) {
            const ll = layer.getLatLng();
            if (Math.abs(ll.lat - spot.lat) < 0.0001 && Math.abs(ll.lng - spot.lng) < 0.0001) {
              layer.openPopup();
            }
          }
        });
      }, 100);
    };

    // タブ切替で地図が hidden→visible になる場合があるため遅延してサイズ再計算
    const timer = setTimeout(() => {
      map.invalidateSize();
      map.flyTo([spot.lat, spot.lng], Math.max(map.getZoom(), 15), { duration: 0.5 });
      map.on("moveend", onMoveEnd);
    }, 200);

    return () => {
      clearTimeout(timer);
      map.off("moveend", onMoveEnd);
    };
  }, [focusedSpotName, focusKey, spots, map]);

  const maxSpots = getMaxSpots(zoom);
  const prioritized = [...spots].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
  const visible = prioritized.slice(0, maxSpots);

  return (
    <>
      {visible.map((spot, i) => {
        const category = spot.category ?? (KNOWN_CATEGORIES.has(spot.description) ? spot.description : undefined);
        const isCategory = Boolean(category);
        return (
          <Marker
            key={`${spot.name}-${i}`}
            position={[spot.lat, spot.lng]}
            icon={category ? makeCategoryIcon(category) : spotIcon}
          >
            <Popup>
              <strong>{spot.name}</strong>
              {category && (
                <span style={{ marginLeft: "6px", fontSize: "11px", color: "#6b7280" }}>
                  {CATEGORY_STYLE[category]?.emoji} {category}
                </span>
              )}
              {spot.description && !KNOWN_CATEGORIES.has(spot.description) && <><br />{spot.description}</>}
              {(spot.durationMinutes || spot.tags?.length) && (
                <div style={{ marginTop: "6px", display: "flex", gap: "4px", flexWrap: "wrap" }}>
                  {spot.durationMinutes && (
                    <span style={{ fontSize: "11px", color: "#374151", background: "#f3f4f6", borderRadius: "999px", padding: "2px 7px" }}>
                      目安{spot.durationMinutes}分
                    </span>
                  )}
                  {spot.tags?.slice(0, 4).map((tag) => (
                    <span key={tag} style={{ fontSize: "11px", color: "#1d4ed8", background: "#dbeafe", borderRadius: "999px", padding: "2px 7px" }}>
                      {tag}
                    </span>
                  ))}
                </div>
              )}
              {spot.photoUrl && (
                <div style={{ marginTop: "6px" }}>
                  <img src={spot.photoUrl} alt={spot.name} style={{ width: "100%", borderRadius: "4px", maxHeight: "120px", objectFit: "cover" }} />
                </div>
              )}
              {spot.rating != null && (
                <div style={{ marginTop: "4px", fontSize: "12px", color: "#b45309" }}>
                  {"★".repeat(Math.round(spot.rating))}{"☆".repeat(5 - Math.round(spot.rating))}
                  {" "}{spot.rating.toFixed(1)}
                  <span style={{ color: "#6b7280" }}>（{spot.reviewCount?.toLocaleString()}件）</span>
                </div>
              )}
            </Popup>
          </Marker>
        );
      })}
    </>
  );
}

type RouteLabel = { coordinates: [number, number][]; label: string };

function makeRouteLabelIcon(label: string, selected: boolean) {
  return L.divIcon({
    className: "",
    html: `
      <div style="
        background:${selected ? "#2563eb" : "#fff"};
        color:${selected ? "#fff" : "#374151"};
        font-size:14px;
        font-weight:700;
        padding:6px 14px;
        border-radius:20px;
        box-shadow:0 3px 10px rgba(0,0,0,0.3);
        border:2px solid ${selected ? "#1d4ed8" : "#9ca3af"};
        white-space:nowrap;
        cursor:pointer;
        pointer-events:auto;
      ">${label}</div>`,
    iconSize: [80, 32],
    iconAnchor: [40, 16],
  });
}

function getRouteMidpoint(coords: [number, number][]): [number, number] {
  const mid = coords[Math.floor(coords.length / 2)];
  return [mid[1], mid[0]];
}

export default function Map({
  spots,
  route,
  altRoutes,
  altRouteLabels,
  selectedRouteLabel,
  onSelectRoute,
  start,
  goal,
  waypointMarkers,
  ashFall,
  focusedSpot,
  focusKey,
}: {
  spots: Spot[];
  route?: [number, number][] | null;
  altRoutes?: RouteLabel[] | null;
  altRouteLabels?: string[];
  selectedRouteLabel?: string;
  onSelectRoute?: (index: number) => void;
  start?: LatLng | null;
  goal?: LatLng | null;
  waypointMarkers?: (LatLng & { name: string })[];
  ashFall?: AshFallData | null;
  focusedSpot?: Spot | null;
  focusKey?: number;
}) {
  return (
    <MapContainer
      center={[31.5889, 130.5478]}
      zoom={13}
      className="h-full w-full"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {altRoutes && altRoutes.map((alt, i) => (
        <Polyline
          key={`alt-${i}`}
          positions={toLatLng(alt.coordinates)}
          pathOptions={{ color: "#9ca3af", weight: 6, opacity: 0.6 }}
          eventHandlers={{ click: () => onSelectRoute?.(i) }}
        />
      ))}
      {route && route.length > 0 && (
        <Polyline
          positions={toLatLng(route)}
          pathOptions={{ color: "#2563eb", weight: 6, opacity: 0.9 }}
        />
      )}
      {route && selectedRouteLabel && (
        <Marker
          position={getRouteMidpoint(route)}
          icon={makeRouteLabelIcon(selectedRouteLabel, true)}
          interactive={false}
        />
      )}
      {altRoutes && altRoutes.map((alt, i) => (
        <Marker
          key={`alt-label-${i}`}
          position={getRouteMidpoint(alt.coordinates)}
          icon={makeRouteLabelIcon(alt.label, false)}
          eventHandlers={{ click: () => onSelectRoute?.(i) }}
        />
      ))}
      {start && (
        <Marker position={[start.lat, start.lng]} icon={startIcon}>
          <Popup>出発地点</Popup>
        </Marker>
      )}
      {waypointMarkers && waypointMarkers.map((wp, i) => (
        <Marker key={`wp-${i}`} position={[wp.lat, wp.lng]} icon={makeWaypointIcon(i + 1)}>
          <Popup>経由地{i + 1}: {wp.name}</Popup>
        </Marker>
      ))}
      {goal && (
        <Marker position={[goal.lat, goal.lng]} icon={goalIcon}>
          <Popup>目的地</Popup>
        </Marker>
      )}
      {ashFall && (
        <>
          <Polygon
            positions={calcAshFallCone(ashFall.ashFallDirection, ashFall.windSpeed)}
            pathOptions={{
              color: "#6b7280",
              fillColor: "#9ca3af",
              fillOpacity: 0.35,
              weight: 1,
              opacity: 0.5,
              dashArray: "4 4",
            }}
          >
            <Popup>
              <div style={{ fontSize: "12px", lineHeight: "1.6" }}>
                <strong>🌋 桜島 降灰シミュレーション</strong>
                <br />
                風向き: {ashFall.windDirection}° → 降灰方向: {ashFall.ashFallDirection}°
                <br />
                風速: {ashFall.windSpeed.toFixed(1)} m/s
                <br />
                <span style={{ color: "#6b7280", fontSize: "11px" }}>
                  更新: {new Date(ashFall.updatedAt).toLocaleString("ja-JP")}
                </span>
                <br />
                <span style={{ color: "#9ca3af", fontSize: "10px" }}>
                  ※気象データを基にした近似表示です
                </span>
              </div>
            </Popup>
          </Polygon>
          <Marker position={SAKURAJIMA} icon={makeLabelIcon("🌋", "#dc2626")}>
            <Popup>桜島</Popup>
          </Marker>
        </>
      )}
      <ZoomAwareSpots spots={spots} focusedSpotName={focusedSpot?.name} focusKey={focusKey} />
      <InvalidateSize />
      <FitBounds spots={spots} route={route ?? null} start={start ?? null} goal={goal ?? null} />
    </MapContainer>
  );
}
