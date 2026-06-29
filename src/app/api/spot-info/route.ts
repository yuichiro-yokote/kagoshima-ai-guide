export async function POST(req: Request) {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return Response.json({ spots: [] });

  const { spots } = await req.json();
  if (!spots?.length) return Response.json({ spots: [] });

  type SpotInput = { name: string; lat: number; lng: number; description: string };

  const enriched = await Promise.all(
    (spots as SpotInput[]).map(async (spot) => {
      try {
        const url = new URL("https://maps.googleapis.com/maps/api/place/nearbysearch/json");
        url.searchParams.set("location", `${spot.lat},${spot.lng}`);
        url.searchParams.set("radius", "200");
        url.searchParams.set("keyword", spot.name);
        url.searchParams.set("key", apiKey);

        const res = await fetch(url.toString(), { signal: AbortSignal.timeout(10000) });
        if (!res.ok) return spot;
        const data = await res.json();
        const top = data.results?.[0];
        if (!top) return spot;

        let photoUrl: string | undefined;
        if (top.photos?.[0]?.photo_reference) {
          photoUrl = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=300&photo_reference=${top.photos[0].photo_reference}&key=${apiKey}`;
        }

        return {
          ...spot,
          rating: top.rating,
          reviewCount: top.user_ratings_total ?? 0,
          photoUrl,
        };
      } catch {
        return spot;
      }
    })
  );

  return Response.json({ spots: enriched });
}
