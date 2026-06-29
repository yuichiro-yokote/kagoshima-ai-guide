// router.project-osrm.org の公開サーバーは driving のみ対応
// cycling・foot は距離から平均速度で推算する
const AVG_SPEED_KMH = { cycling: 15, foot: 4 };

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const latA = searchParams.get("latA");
  const lngA = searchParams.get("lngA");
  const latB = searchParams.get("latB");
  const lngB = searchParams.get("lngB");

  if (!latA || !lngA || !latB || !lngB) {
    return Response.json({ error: "latA, lngA, latB, lngB are required" }, { status: 400 });
  }

  // 経由地（最大3件）: JSON配列 [{ lat, lng }, ...]
  type WaypointParam = { lat: number; lng: number };
  const waypointsRaw = searchParams.get("waypoints");
  const waypoints: WaypointParam[] = waypointsRaw ? JSON.parse(waypointsRaw) : [];

  // OSRM 座標文字列: A; wp1; wp2; ...; B
  const coords = [
    `${lngA},${latA}`,
    ...waypoints.map((w) => `${w.lng},${w.lat}`),
    `${lngB},${latB}`,
  ].join(";");

  const alternatives = waypoints.length === 0 ? "&alternatives=3" : "";
  const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson${alternatives}`;
  const res = await fetch(url, { headers: { "User-Agent": "kagoshima-ai-guide/1.0" } });

  if (!res.ok) {
    return Response.json({ error: "OSRM request failed" }, { status: 502 });
  }

  const data = await res.json();
  if (data.code !== "Ok" || !data.routes?.length) {
    return Response.json({ error: "経路が見つかりませんでした" }, { status: 404 });
  }

  type Leg = { distance: number; duration: number };
  type OSRMRoute = { geometry: { coordinates: [number, number][] }; legs: Leg[] };

  const routes = (data.routes as OSRMRoute[]).map((route) => {
    const totalDistance: number = route.legs.reduce((sum: number, leg: Leg) => sum + leg.distance, 0);
    const totalDuration: number = route.legs.reduce((sum: number, leg: Leg) => sum + leg.duration, 0);
    return {
      coordinates: route.geometry.coordinates as [number, number][],
      distance: totalDistance,
      durations: {
        driving: totalDuration,
        cycling: (totalDistance / 1000) / AVG_SPEED_KMH.cycling * 3600,
        foot:    (totalDistance / 1000) / AVG_SPEED_KMH.foot    * 3600,
      },
    };
  });

  return Response.json({ routes });
}
