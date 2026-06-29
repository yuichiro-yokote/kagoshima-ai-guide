export type RouteSpot = {
  name: string;
  lat: number;
  lng: number;
  category: string;
  rating?: number;
  reviewCount?: number;
  photoUrl?: string;
};

// 点と線分の距離（メートル）
function pointToSegmentDistance(
  pLat: number, pLng: number,
  aLat: number, aLng: number,
  bLat: number, bLng: number,
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;

  const dy = (bLat - aLat) * R * toRad(1);
  const dx = (bLng - aLng) * R * toRad(1) * Math.cos(toRad((aLat + bLat) / 2));
  const len2 = dx * dx + dy * dy;

  const py = (pLat - aLat) * R * toRad(1);
  const px = (pLng - aLng) * R * toRad(1) * Math.cos(toRad((aLat + pLat) / 2));

  const t = len2 > 0 ? Math.max(0, Math.min(1, (px * dx + py * dy) / len2)) : 0;
  const nearX = px - t * dx;
  const nearY = py - t * dy;
  return Math.sqrt(nearX * nearX + nearY * nearY);
}

// ルートポリラインからの最短距離（メートル）
function distanceToRoute(lat: number, lng: number, coords: [number, number][]): number {
  let minDist = Infinity;
  for (let i = 0; i < coords.length - 1; i++) {
    const [lngA, latA] = coords[i];
    const [lngB, latB] = coords[i + 1];
    const d = pointToSegmentDistance(lat, lng, latA, lngA, latB, lngB);
    if (d < minDist) minDist = d;
  }
  return minDist;
}

// スポット名と座標でGoogle Places Nearby Searchを呼び、評価を返す
async function fetchSpotInfo(
  name: string,
  lat: number,
  lng: number,
): Promise<{ rating?: number; reviewCount?: number; photoUrl?: string }> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return {};

  const url = new URL("https://maps.googleapis.com/maps/api/place/nearbysearch/json");
  url.searchParams.set("location", `${lat},${lng}`);
  url.searchParams.set("radius", "100");
  url.searchParams.set("keyword", name);
  url.searchParams.set("key", apiKey);

  try {
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return {};
    const data = await res.json();
    const top = data.results?.[0];
    if (!top) return {};

    let photoUrl: string | undefined;
    if (top.photos?.[0]?.photo_reference) {
      photoUrl = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=200&photo_reference=${top.photos[0].photo_reference}&key=${apiKey}`;
    }

    return {
      rating: top.rating,
      reviewCount: top.user_ratings_total ?? 0,
      photoUrl,
    };
  } catch {
    return {};
  }
}

function getCategory(tags: Record<string, string>): string {
  if (tags.tourism === "attraction" || tags.tourism === "museum" || tags.historic) return "観光";
  if (tags.tourism === "viewpoint") return "展望";
  if (tags.amenity === "restaurant" || tags.amenity === "cafe" || tags.amenity === "fast_food" || tags.amenity === "bar") return "飲食";
  if (tags.amenity === "convenience" || tags.amenity === "supermarket" || tags.shop) return "買い物";
  if (tags.amenity === "toilets") return "トイレ";
  if (tags.amenity === "parking") return "駐車場";
  return "その他";
}

export async function POST(req: Request) {
  const body = await req.json();
  const coords: [number, number][] = body.coordinates; // [[lng, lat], ...]

  if (!coords?.length) {
    return Response.json({ error: "coordinates are required" }, { status: 400 });
  }

  // バウンディングボックスを計算（500mバッファ付き）
  const lats = coords.map(([, lat]) => lat);
  const lngs = coords.map(([lng]) => lng);
  const BUFFER = 0.005; // 約500m
  const minLat = Math.min(...lats) - BUFFER;
  const maxLat = Math.max(...lats) + BUFFER;
  const minLng = Math.min(...lngs) - BUFFER;
  const maxLng = Math.max(...lngs) + BUFFER;
  const bbox = `${minLat},${minLng},${maxLat},${maxLng}`;

  const query = `
[out:json][timeout:20];
(
  node["tourism"~"attraction|museum|viewpoint|gallery|zoo|theme_park|artwork"](${bbox});
  node["historic"](${bbox});
  node["amenity"~"restaurant|cafe|fast_food|bar|ice_cream"](${bbox});
  node["amenity"~"convenience|supermarket"](${bbox});
  node["amenity"="toilets"](${bbox});
);
out body;
`.trim();

  const OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://lz4.overpass-api.de/api/interpreter",
    "https://z.overpass-api.de/api/interpreter",
  ];

  const fetchOptions = {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "kagoshima-ai-guide/1.0",
    },
    body: `data=${encodeURIComponent(query)}`,
    signal: AbortSignal.timeout(25000),
  };

  let res: Response | null = null;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const r = await fetch(endpoint, fetchOptions);
      if (r.ok) { res = r; break; }
    } catch {
      // 次のエンドポイントを試す
    }
  }

  if (!res) {
    return Response.json({ error: "Overpass request failed" }, { status: 502 });
  }

  const data = await res.json();

  type OverpassElement = {
    lat: number;
    lon: number;
    tags?: Record<string, string>;
  };

  const allPOIs = (data.elements as OverpassElement[])
    .filter((el) => el.tags?.name)
    .map((el) => ({
      name: el.tags!.name,
      lat: el.lat,
      lng: el.lon,
      category: getCategory(el.tags!),
    }));

  // ルートを区間に分割し、各区間からスポットを拾う
  const NUM_SEGMENTS = 5;
  const segmentSize = Math.ceil(coords.length / NUM_SEGMENTS);
  const picked = new Set<string>();
  const spots: RouteSpot[] = [];

  for (let seg = 0; seg < NUM_SEGMENTS; seg++) {
    const segStart = seg * segmentSize;
    const segEnd = Math.min((seg + 1) * segmentSize, coords.length);
    const segCoords = coords.slice(segStart, segEnd);

    // まず300m以内で探す
    let segSpots = allPOIs
      .filter((s) => !picked.has(`${s.lat},${s.lng}`))
      .filter((s) => distanceToRoute(s.lat, s.lng, segCoords) <= 300)
      .slice(0, 5);

    // 見つからなければ1000mまで広げて最も近い1件を拾う
    if (segSpots.length === 0) {
      const nearest = allPOIs
        .filter((s) => !picked.has(`${s.lat},${s.lng}`))
        .map((s) => ({ ...s, dist: distanceToRoute(s.lat, s.lng, segCoords) }))
        .filter((s) => s.dist <= 1000)
        .sort((a, b) => a.dist - b.dist)[0];
      if (nearest) {
        segSpots = [{ name: nearest.name, lat: nearest.lat, lng: nearest.lng, category: nearest.category }];
      }
    }

    for (const s of segSpots) {
      picked.add(`${s.lat},${s.lng}`);
      spots.push(s);
    }
  }

  // 各スポットの評価をPlaces APIで並列取得
  const spotsWithRatings: RouteSpot[] = await Promise.all(
    spots.map(async (spot) => {
      const { rating, reviewCount, photoUrl } = await fetchSpotInfo(spot.name, spot.lat, spot.lng);
      return { ...spot, rating, reviewCount, photoUrl };
    })
  );

  const spotsWithGoogleInfo = spotsWithRatings.filter((s) => s.rating != null || s.photoUrl);

  return Response.json({ spots: spotsWithGoogleInfo });
}
