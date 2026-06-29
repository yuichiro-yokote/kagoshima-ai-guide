// 鹿児島市周辺のバウンディングボックス（西,南,東,北）
const KAGOSHIMA_BBOX = "129.8,31.0,131.5,32.5";
// 鹿児島市中心座標（location bias用）
const KAGOSHIMA_LAT = 31.5889;
const KAGOSHIMA_LNG = 130.5478;

type PhotonFeature = {
  geometry: { coordinates: [number, number] };
  properties: {
    name?: string;
    city?: string;
    state?: string;
    country?: string;
    postcode?: string;
    street?: string;
    housenumber?: string;
  };
};

function buildDisplayName(props: PhotonFeature["properties"]): string {
  const parts = [props.name, props.city, props.state].filter(Boolean);
  return parts.join(", ");
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q");

  if (!q) {
    return Response.json({ error: "q is required" }, { status: 400 });
  }

  const limit = Math.min(parseInt(searchParams.get("limit") ?? "1"), 5);

  // Photon API: prefix検索対応、鹿児島エリアにlocation biasをかける
  const url = new URL("https://photon.komoot.io/api/");
  url.searchParams.set("q", q);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("bbox", KAGOSHIMA_BBOX);
  url.searchParams.set("lat", String(KAGOSHIMA_LAT));
  url.searchParams.set("lon", String(KAGOSHIMA_LNG));

  const res = await fetch(url.toString(), {
    headers: { "User-Agent": "kagoshima-ai-guide/1.0" },
  });

  if (!res.ok) {
    return Response.json({ error: "Geocoding request failed" }, { status: 502 });
  }

  const data = await res.json();
  const features: PhotonFeature[] = data.features ?? [];

  if (!features.length) {
    return Response.json({ error: "場所が見つかりませんでした" }, { status: 404 });
  }

  const results = features.map((f) => ({
    lat: f.geometry.coordinates[1],
    lng: f.geometry.coordinates[0],
    display_name: buildDisplayName(f.properties),
  }));

  if (limit === 1) return Response.json(results[0]);
  return Response.json(results);
}
