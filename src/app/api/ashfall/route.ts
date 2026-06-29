import { NextResponse } from "next/server";

const SAKURAJIMA_LAT = 31.5806;
const SAKURAJIMA_LNG = 130.6572;

export async function GET() {
  try {
    const url =
      `https://api.open-meteo.com/v1/jma` +
      `?latitude=${SAKURAJIMA_LAT}&longitude=${SAKURAJIMA_LNG}` +
      `&current=wind_speed_10m,wind_direction_10m` +
      `&wind_speed_unit=ms&timezone=Asia%2FTokyo`;

    const res = await fetch(url, { next: { revalidate: 600 } });
    if (!res.ok) throw new Error("open-meteo fetch failed");

    const data = await res.json();
    const windSpeed: number = data.current.wind_speed_10m;
    const windDirection: number = data.current.wind_direction_10m;

    return NextResponse.json({
      windSpeed,
      windDirection,
      ashFallDirection: (windDirection + 180) % 360,
      updatedAt: data.current.time,
    });
  } catch {
    return NextResponse.json({ error: "気象データの取得に失敗しました" }, { status: 502 });
  }
}
