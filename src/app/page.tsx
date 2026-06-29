"use client";

import { useChat } from "@ai-sdk/react";
import { useState, useEffect, useRef, useMemo, type FormEvent } from "react";
import dynamicImport from "next/dynamic";
import type { Spot, AshFallData } from "@/components/Map";
import type { UIMessage } from "ai";
import LocationInput from "@/components/LocationInput";
import Markdown from "react-markdown";

const Map = dynamicImport(() => import("@/components/Map"), { ssr: false });

type Mode = "chat" | "route";

const CATEGORIES = ["観光", "展望", "飲食", "買い物", "トイレ", "駐車場", "その他"] as const;
type Category = typeof CATEGORIES[number];
const DEFAULT_CATEGORIES: Category[] = ["観光", "展望", "飲食"];
const CATEGORY_EMOJI: Record<Category, string> = {
  観光: "🏛", 展望: "🔭", 飲食: "🍜", 買い物: "🛍", トイレ: "🚻", 駐車場: "🅿", その他: "📍",
};

type SortBy = "none" | "rating" | "reviewCount";
type Waypoint = { value: string; coord: { lat: number; lng: number } | null };

const MAX_WAYPOINTS = 3;

function getTextContent(msg: UIMessage): string {
  return msg.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
}

function parseSpots(text: string): Spot[] {
  const regex = /<!--SPOTS_JSON(\[.*?\])SPOTS_JSON-->/gs;
  const spots: Spot[] = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      spots.push(...parsed);
    } catch {
      // ignore
    }
  }
  return spots;
}

function cleanText(text: string): string {
  return text
    .replace(/<!--SPOTS_JSON\[.*?\]SPOTS_JSON-->/gs, "")
    .replace(/<!--ROUTE_CONTEXT.*?ROUTE_CONTEXT-->/gs, "")
    .trim();
}

function renderStars(rating: number) {
  const full = Math.round(rating);
  return "★".repeat(full) + "☆".repeat(5 - full);
}

export default function Home() {
  const { messages, sendMessage, status } = useChat();
  const [input, setInput] = useState("");
  const [spots, setSpots] = useState<Spot[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [mode, setMode] = useState<Mode>("chat");
  const [layoutMode, setLayoutMode] = useState<"pc" | "sp">("pc");
  const [spView, setSpView] = useState<"chat" | "route" | "map">("chat");
  const [pointA, setPointA] = useState("");
  const [pointB, setPointB] = useState("");
  const [coordA, setCoordA] = useState<{ lat: number; lng: number } | null>(null);
  const [coordB, setCoordB] = useState<{ lat: number; lng: number } | null>(null);
  const [waypoints, setWaypoints] = useState<Waypoint[]>([]);
  type RouteData = {
    coordinates: [number, number][];
    distance: number;
    durations: { driving: number; cycling: number; foot: number };
  };
  const [allRoutes, setAllRoutes] = useState<RouteData[]>([]);
  const [selectedRouteIndex, setSelectedRouteIndex] = useState(0);
  const routeCoords = allRoutes[selectedRouteIndex]?.coordinates ?? null;
  const routeInfo = allRoutes[selectedRouteIndex] ?? null;
  const [routeSpots, setRouteSpots] = useState<Spot[]>([]);
  const [isSpotsLoading, setIsSpotsLoading] = useState(false);
  const [enabledCategories, setEnabledCategories] = useState<Set<Category>>(new Set(DEFAULT_CATEGORIES));
  const [routeError, setRouteError] = useState<string | null>(null);
  const [isRouteLoading, setIsRouteLoading] = useState(false);

  const [sortBy, setSortBy] = useState<SortBy>("none");
  const [filterHighRating, setFilterHighRating] = useState(false);
  const [spareTime, setSpareTime] = useState("30");

  const [showAshFall, setShowAshFall] = useState(false);
  const [ashFallData, setAshFallData] = useState<AshFallData | null>(null);
  const [ashFallLoading, setAshFallLoading] = useState(false);
  const [ashFallError, setAshFallError] = useState<string | null>(null);

  const isLoading = status === "streaming" || status === "submitted";

  useEffect(() => {
    const allSpots: Spot[] = [];
    for (const msg of messages) {
      if (msg.role === "assistant") {
        allSpots.push(...parseSpots(getTextContent(msg)));
      }
    }
    setSpots(allSpots);
  }, [messages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (!showAshFall) return;
    if (ashFallData) return;
    setAshFallLoading(true);
    setAshFallError(null);
    fetch("/api/ashfall")
      .then((r) => {
        if (!r.ok) throw new Error("データ取得失敗");
        return r.json();
      })
      .then((d) => setAshFallData(d))
      .catch((e) => setAshFallError(e.message))
      .finally(() => setAshFallLoading(false));
  }, [showAshFall, ashFallData]);

  const displayedSpots = useMemo(() => {
    let list = routeSpots.filter((s) => enabledCategories.has(s.description as Category));
    if (filterHighRating) list = list.filter((s) => s.rating != null && s.rating >= 4.0);
    if (sortBy === "rating") {
      list = [...list].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
    } else if (sortBy === "reviewCount") {
      list = [...list].sort((a, b) => (b.reviewCount ?? 0) - (a.reviewCount ?? 0));
    }
    return list;
  }, [routeSpots, enabledCategories, filterHighRating, sortBy]);

  // 経由地スロット追加
  const addWaypointSlot = () => {
    if (waypoints.length >= MAX_WAYPOINTS) return;
    setWaypoints((prev) => [...prev, { value: "", coord: null }]);
  };

  // スポットカードから経由地に追加（次の空きスロットへ、なければスロット作成）
  const addWaypointFromSpot = (spot: Spot) => {
    setWaypoints((prev) => {
      const emptyIdx = prev.findIndex((w) => !w.coord);
      if (emptyIdx !== -1) {
        return prev.map((w, i) =>
          i === emptyIdx ? { value: spot.name, coord: { lat: spot.lat, lng: spot.lng } } : w
        );
      }
      if (prev.length >= MAX_WAYPOINTS) return prev;
      return [...prev, { value: spot.name, coord: { lat: spot.lat, lng: spot.lng } }];
    });
  };

  const removeWaypoint = (index: number) => {
    setWaypoints((prev) => prev.filter((_, i) => i !== index));
  };

  const updateWaypointValue = (index: number, value: string) => {
    setWaypoints((prev) =>
      prev.map((w, i) => (i === index ? { value, coord: null } : w))
    );
  };

  const updateWaypointCoord = (index: number, value: string, coord: { lat: number; lng: number }) => {
    setWaypoints((prev) =>
      prev.map((w, i) => (i === index ? { value, coord } : w))
    );
  };

  const fetchSpotsForRoute = async (coordinates: [number, number][]) => {
    setIsSpotsLoading(true);
    try {
      const spotsRes = await fetch("/api/spots-along-route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coordinates }),
      });
      if (spotsRes.ok) {
        const spotsData = await spotsRes.json();
        setRouteSpots(
          spotsData.spots.map((s: { name: string; lat: number; lng: number; category: string; rating?: number; reviewCount?: number; photoUrl?: string }) => ({
            name: s.name,
            lat: s.lat,
            lng: s.lng,
            description: s.category,
            rating: s.rating,
            reviewCount: s.reviewCount,
            photoUrl: s.photoUrl,
          }))
        );
      }
    } finally {
      setIsSpotsLoading(false);
    }
  };

  const handleSelectRoute = async (index: number) => {
    if (index === selectedRouteIndex) return;
    setSelectedRouteIndex(index);
    await fetchSpotsForRoute(allRoutes[index].coordinates);
  };

  const handleChatSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    sendMessage({ text: input });
    setInput("");
  };

  const handleAskAI = () => {
    if (!routeInfo || !pointA || !pointB) return;
    const distKm = (routeInfo.distance / 1000).toFixed(1);
    const drivingMin = Math.ceil(routeInfo.durations.driving / 60);
    const resolvedWaypoints = waypoints.filter((w) => w.coord);
    const waypointStr = resolvedWaypoints.length > 0
      ? `（経由: ${resolvedWaypoints.map((w) => w.value).join(" → ")}）`
      : "";
    const spotLines = routeSpots
      .map((s) => {
        const ratingStr = s.rating != null
          ? ` ★${s.rating.toFixed(1)}（口コミ${s.reviewCount?.toLocaleString()}件）`
          : "";
        return `・${s.name}（${s.description}${ratingStr}）`;
      })
      .join("\n");
    const spareLabel = spareTime === "10" ? "約10分" : spareTime === "30" ? "約30分" : spareTime === "60" ? "約1時間" : "1時間以上";
    const spareAdvice = spareTime === "10" ? "テイクアウトやちょっとした景観スポットなど、さっと寄れる場所を中心に" : spareTime === "30" ? "カフェやお土産屋、小さな名所など、短時間で楽しめる場所を中心に" : spareTime === "60" ? "飲食店でのランチや庭園、博物館など、じっくり楽しめる場所を中心に" : "本格的な観光地や体験型施設、複数スポットの周遊も含めて幅広く";
    const prompt = `${pointA}から${pointB}まで${waypointStr}、余裕時間${spareLabel}でおすすめの寄り道を教えて！<!--ROUTE_CONTEXT${JSON.stringify({ distKm, drivingMin, spareLabel, spareAdvice, spotLines })}ROUTE_CONTEXT-->`;
    setMode("chat");
    sendMessage({ text: prompt });
  };

  const handleRouteSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!pointA.trim() || !pointB.trim()) return;

    setRouteError(null);
    setIsRouteLoading(true);

    try {
      const resolvedA = coordA ?? await (async () => {
        const res = await fetch(`/api/geocode?q=${encodeURIComponent(pointA)}`);
        if (!res.ok) { const e = await res.json(); throw new Error(`地点A: ${e.error}`); }
        return res.json();
      })();
      const resolvedB = coordB ?? await (async () => {
        const res = await fetch(`/api/geocode?q=${encodeURIComponent(pointB)}`);
        if (!res.ok) { const e = await res.json(); throw new Error(`地点B: ${e.error}`); }
        return res.json();
      })();

      // 値が入力されている経由地を Geocoding（候補選択済みなら coord を流用）
      const resolvedWaypoints = await Promise.all(
        waypoints
          .filter((w) => w.value.trim())
          .map(async (w) => {
            if (w.coord) return { ...w.coord, name: w.value };
            const res = await fetch(`/api/geocode?q=${encodeURIComponent(w.value)}`);
            if (!res.ok) { const e = await res.json(); throw new Error(`経由地「${w.value}」: ${e.error}`); }
            const data = await res.json();
            return { ...data, name: w.value };
          })
      );

      const waypointsParam = resolvedWaypoints.length > 0
        ? `&waypoints=${encodeURIComponent(JSON.stringify(resolvedWaypoints.map((w) => ({ lat: w.lat, lng: w.lng }))))}`
        : "";

      const routeRes = await fetch(
        `/api/route?latA=${resolvedA.lat}&lngA=${resolvedA.lng}&latB=${resolvedB.lat}&lngB=${resolvedB.lng}${waypointsParam}`
      );
      if (!routeRes.ok) {
        const e = await routeRes.json();
        throw new Error(e.error);
      }
      const routeData = await routeRes.json();
      const routes: RouteData[] = routeData.routes;
      setAllRoutes(routes);
      setSelectedRouteIndex(0);

      // 最初のルートでスポット検索
      await fetchSpotsForRoute(routes[0].coordinates);
    } catch (err) {
      setRouteError(err instanceof Error ? err.message : "エラーが発生しました");
    } finally {
      setIsRouteLoading(false);
    }
  };

  // マップに渡す経由地マーカー（coord が確定しているもののみ）
  const waypointMarkers = waypoints
    .filter((w) => w.coord)
    .map((w) => ({ lat: w.coord!.lat, lng: w.coord!.lng, name: w.value }));

  return (
    <div className="flex flex-col h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 overflow-hidden">
      <header className="relative text-white flex-shrink-0 overflow-hidden">
        <img src="/header-bg.png" alt="" className="absolute inset-0 w-full h-full object-cover scale-105" />
        <div className="absolute inset-0 bg-gradient-to-r from-slate-900/80 via-blue-900/70 to-indigo-900/60 backdrop-blur-[2px]" />
        <div className="relative z-10 flex items-center justify-between px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-white/20 backdrop-blur-md rounded-xl flex items-center justify-center text-xl">🌋</div>
            <div>
              <h1 className="text-xl font-extrabold tracking-tight">かごしまAIガイド</h1>
              <p className="text-[11px] text-white/60 tracking-widest uppercase">AI-Powered Travel Concierge</p>
            </div>
          </div>
          <button
            onClick={() => setLayoutMode((l) => (l === "pc" ? "sp" : "pc"))}
            className="flex-shrink-0 text-xs bg-white/10 hover:bg-white/20 border border-white/20 text-white/90 px-4 py-1.5 rounded-full backdrop-blur-md transition-all hover:scale-105"
          >
            {layoutMode === "pc" ? "📱 スマホ表示" : "🖥 PC表示"}
          </button>
        </div>
      </header>

      <div className={`flex flex-1 overflow-hidden ${layoutMode === "sp" ? "flex-col" : ""}`}>

        {/* SP mode tab bar */}
        {layoutMode === "sp" && (
          <div className="flex-shrink-0 flex bg-white border-b border-gray-200">
            {(["chat", "route", "map"] as const).map((tab) => {
              const label = tab === "chat" ? "💬 チャット" : tab === "route" ? "🔍 経路検索" : "🗺 地図";
              return (
                <button
                  key={tab}
                  onClick={() => { setSpView(tab); if (tab !== "map") setMode(tab); }}
                  className={`flex-1 py-2 text-sm font-medium transition-colors ${
                    spView === tab ? "text-blue-600 border-b-2 border-blue-600" : "text-gray-500 hover:text-gray-700"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        )}

        {/* Left/Top panel */}
        <div className={`flex flex-col min-h-0 ${
          layoutMode === "pc" ? "w-1/2 border-r border-gray-200/50" : spView !== "map" ? "flex-1" : "hidden"
        } bg-white/70 backdrop-blur-xl`}>

          {/* Mode toggle - PC only */}
          {layoutMode === "pc" &&
          <div className="flex-shrink-0 flex border-b border-gray-100 bg-white">
            <button
              onClick={() => setMode("chat")}
              className={`flex-1 py-3 text-sm font-semibold transition-all flex items-center justify-center gap-2 ${
                mode === "chat"
                  ? "text-blue-600 border-b-2 border-blue-600 bg-blue-50/50"
                  : "text-gray-400 hover:text-gray-600 hover:bg-gray-50"
              }`}
            >
              💬 チャット
            </button>
            <button
              onClick={() => setMode("route")}
              className={`flex-1 py-3 text-sm font-semibold transition-all flex items-center justify-center gap-2 ${
                mode === "route"
                  ? "text-blue-600 border-b-2 border-blue-600 bg-blue-50/50"
                  : "text-gray-400 hover:text-gray-600 hover:bg-gray-50"
              }`}
            >
              🔍 経路検索
            </button>
          </div>}

          {/* Ashfall toggle */}
          <div className="flex-shrink-0 flex items-center gap-2 px-4 py-2.5 bg-white/80 backdrop-blur-sm border-b border-gray-100">
            <label className="flex items-center gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showAshFall}
                onChange={(e) => setShowAshFall(e.target.checked)}
                className="accent-red-500 w-4 h-4 rounded"
              />
              <span className="text-sm font-medium text-gray-600">🌋 降灰シミュレーション</span>
            </label>
            {ashFallLoading && (
              <span className="text-xs text-gray-400">取得中...</span>
            )}
            {ashFallData && !ashFallLoading && (
              <span className="text-xs text-gray-400 ml-auto">
                風速 {ashFallData.windSpeed.toFixed(1)}m/s・{ashFallData.windDirection}°
              </span>
            )}
            {ashFallError && (
              <span className="text-xs text-red-400 ml-auto">{ashFallError}</span>
            )}
          </div>

          {/* Chat mode */}
          {mode === "chat" && (
            <>
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {messages.length === 0 && (
                  <div className="text-center mt-16 px-6">
                    <p className="text-5xl mb-5">🌋</p>
                    <p className="text-xl font-bold text-gray-700 mb-2">鹿児島の観光について質問してみましょう！</p>
                    <p className="text-sm text-gray-400 mb-6">AIがあなたにぴったりのスポットをご案内します</p>
                    <div className="space-y-2">
                      {["天文館周辺でおすすめのランチは？", "桜島に行きたいんだけど、どうやって行くの？", "半日で回れる歴史スポットを教えて"].map((ex) => (
                        <button
                          key={ex}
                          type="button"
                          onClick={() => { sendMessage({ text: ex }); }}
                          className="block w-full text-left text-sm text-gray-500 bg-white border border-gray-200 rounded-xl px-4 py-3 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-600 transition-all"
                        >
                          💡 {ex}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {messages.map((msg) => {
                  const text = getTextContent(msg);
                  return (
                    <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[85%] rounded-2xl px-5 py-3.5 whitespace-pre-wrap text-sm leading-relaxed ${
                        msg.role === "user"
                          ? "bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-500/20"
                          : "bg-white/90 backdrop-blur-sm text-gray-700 shadow-lg shadow-gray-200/50 border border-white/80"
                      }`}>
                        {msg.role === "assistant" ? <div className="prose-chat"><Markdown>{cleanText(text)}</Markdown></div> : cleanText(text)}
                        {msg.role === "assistant" && routeSpots.length > 0 && (() => {
                          const mentioned = routeSpots.filter((s) => s.photoUrl && cleanText(text).includes(s.name));
                          if (mentioned.length === 0) return null;
                          return (
                            <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                              {mentioned.map((s, j) => (
                                <div key={j} className="shrink-0 w-32 rounded-lg border border-gray-100 overflow-hidden bg-gray-50">
                                  <img src={s.photoUrl} alt={s.name} className="w-full h-20 object-cover" />
                                  <div className="px-2 py-1">
                                    <p className="text-xs font-medium text-gray-700 truncate">{s.name}</p>
                                    {s.rating != null && (
                                      <p className="text-xs text-amber-600">★{s.rating.toFixed(1)}</p>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                  );
                })}
                {isLoading && messages[messages.length - 1]?.role !== "assistant" && (
                  <div className="flex justify-start">
                    <div className="bg-white rounded-2xl px-4 py-3 shadow-md border border-gray-100 text-sm text-gray-400 flex items-center gap-2">
                      <span className="flex gap-1">
                        <span className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                        <span className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                        <span className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                      </span>
                      考え中...
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              <form onSubmit={handleChatSubmit} className="flex-shrink-0 border-t border-gray-100/50 p-4 bg-white/50 backdrop-blur-xl">
                <div className="flex gap-2">
                  <input
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="鹿児島の観光について質問してください..."
                    className="flex-1 rounded-full border border-gray-200 px-5 py-2.5 text-sm bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent transition-all"
                    disabled={isLoading}
                  />
                  <button
                    type="submit"
                    disabled={isLoading || !input.trim()}
                    className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-full px-6 py-2.5 text-sm font-semibold hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-md hover:shadow-lg transition-all"
                  >
                    送信
                  </button>
                </div>
              </form>
            </>
          )}

          {/* Route mode */}
          {mode === "route" && (
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <form onSubmit={handleRouteSubmit} className="space-y-0">

                {/* 地点A */}
                <div className="flex items-start gap-2">
                  <div className="flex flex-col items-center pt-7 shrink-0">
                    <div className="w-7 h-7 rounded-full bg-green-600 text-white text-xs font-bold flex items-center justify-center shadow">A</div>
                    <div className="w-0.5 h-4 bg-gray-300 mt-1" />
                  </div>
                  <div className="flex-1">
                    <LocationInput
                      label="現在地"
                      placeholder="例: 鹿児島中央駅"
                      value={pointA}
                      onChange={(v) => { setPointA(v); setCoordA(null); }}
                      onSelect={(s) => { setPointA(s.display_name.split(",")[0].trim()); setCoordA(s); }}
                    />
                  </div>
                </div>

                {/* 経由地 */}
                {waypoints.map((wp, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <div className="flex flex-col items-center pt-7 shrink-0">
                      <div className="w-7 h-7 rounded-full bg-violet-600 text-white text-xs font-bold flex items-center justify-center shadow">{i + 1}</div>
                      <div className="w-0.5 h-4 bg-gray-300 mt-1" />
                    </div>
                    <div className="flex-1">
                      <LocationInput
                        label={`経由地 ${i + 1}`}
                        placeholder="スポット名や住所を入力"
                        value={wp.value}
                        onChange={(v) => updateWaypointValue(i, v)}
                        onSelect={(s) => updateWaypointCoord(i, s.display_name.split(",")[0].trim(), s)}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => removeWaypoint(i)}
                      className="mt-7 text-gray-300 hover:text-red-400 transition-colors text-xl leading-none px-1 shrink-0"
                      aria-label={`経由地${i + 1}を削除`}
                    >
                      ×
                    </button>
                  </div>
                ))}

                {/* 経由地追加ボタン */}
                {waypoints.length < MAX_WAYPOINTS && (
                  <div className="flex items-start gap-2">
                    <div className="flex flex-col items-center shrink-0" style={{ paddingTop: "2px" }}>
                      <div className="w-0.5 h-3 bg-gray-300" />
                    </div>
                    <button
                      type="button"
                      onClick={addWaypointSlot}
                      className="ml-9 text-xs text-blue-500 hover:text-blue-700 flex items-center gap-1 py-1 transition-colors"
                    >
                      <span className="text-base leading-none">＋</span> 経由地を追加
                      <span className="text-gray-300 ml-1">（あと{MAX_WAYPOINTS - waypoints.length}件）</span>
                    </button>
                  </div>
                )}

                {/* 地点B */}
                <div className="flex items-start gap-2 mt-1">
                  <div className="flex flex-col items-center pt-7 shrink-0">
                    <div className="w-7 h-7 rounded-full bg-red-600 text-white text-xs font-bold flex items-center justify-center shadow">B</div>
                  </div>
                  <div className="flex-1">
                    <LocationInput
                      label="目的地"
                      placeholder="例: 仙巌園"
                      value={pointB}
                      onChange={(v) => { setPointB(v); setCoordB(null); }}
                      onSelect={(s) => { setPointB(s.display_name.split(",")[0].trim()); setCoordB(s); }}
                    />
                  </div>
                </div>

                <div className="pt-3 space-y-2">
                  <button
                    type="submit"
                    disabled={!pointA.trim() || !pointB.trim() || isRouteLoading}
                    className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-xl px-4 py-3 text-sm font-semibold hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-md hover:shadow-lg transition-all"
                  >
                    {isRouteLoading ? "🔄 検索中..." : "🔍 経路を検索"}
                  </button>
                  {routeError && <p className="text-red-500 text-sm">{routeError}</p>}
                </div>
              </form>

              {routeInfo && (
                <>
                  {allRoutes.length > 1 && (
                    <div className="flex gap-2 mb-2">
                      {allRoutes.map((r, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => handleSelectRoute(i)}
                          className={`flex-1 text-xs px-2 py-2 rounded-lg border transition-colors ${
                            i === selectedRouteIndex
                              ? "bg-blue-600 text-white border-blue-600"
                              : "bg-white text-gray-600 border-gray-200 hover:border-blue-300"
                          }`}
                        >
                          ルート{i + 1}: {(r.distance / 1000).toFixed(1)}km・{Math.ceil(r.durations.driving / 60)}分
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl p-4 text-sm text-blue-800 space-y-1.5 border border-blue-100/50 shadow-sm">
                    <p className="font-medium">距離: {(routeInfo.distance / 1000).toFixed(1)} km</p>
                    <p>🚗 車: 約 {Math.ceil(routeInfo.durations.driving / 60)} 分</p>
                    <p>🚲 自転車: 約 {Math.ceil(routeInfo.durations.cycling / 60)} 分</p>
                    <p>🚶 徒歩: 約 {Math.ceil(routeInfo.durations.foot / 60)} 分</p>
                  </div>
                  {isSpotsLoading && (
                    <div className="text-center text-sm text-gray-400 py-2">スポットを検索中...</div>
                  )}

                  {routeSpots.length > 0 && (
                    <div>
                      <p className="text-sm font-medium text-gray-700 mb-2">
                        表示するスポット
                        <span className="ml-2 text-gray-400 font-normal">
                          ({displayedSpots.length}/{routeSpots.length}件)
                        </span>
                      </p>

                      <div className="flex flex-wrap gap-2">
                        {CATEGORIES.filter((cat) => routeSpots.some((s) => s.description === cat)).map((cat) => (
                          <label key={cat} className="flex items-center gap-1.5 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={enabledCategories.has(cat)}
                              onChange={(e) => {
                                setEnabledCategories((prev) => {
                                  const next = new Set(prev);
                                  e.target.checked ? next.add(cat) : next.delete(cat);
                                  return next;
                                });
                              }}
                              className="accent-blue-600"
                            />
                            <span className="text-sm text-gray-700">{CATEGORY_EMOJI[cat]} {cat}</span>
                          </label>
                        ))}
                      </div>

                      <div className="mt-3 space-y-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs text-gray-500 shrink-0">並び替え:</span>
                          {(["none", "rating", "reviewCount"] as SortBy[]).map((s) => (
                            <button
                              key={s}
                              onClick={() => setSortBy(s)}
                              className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
                                sortBy === s
                                  ? "bg-blue-600 text-white border-blue-600"
                                  : "text-gray-600 border-gray-300 hover:border-blue-400"
                              }`}
                            >
                              {s === "none" ? "デフォルト" : s === "rating" ? "評価順" : "口コミ数順"}
                            </button>
                          ))}
                        </div>
                        <label className="flex items-center gap-1.5 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={filterHighRating}
                            onChange={(e) => setFilterHighRating(e.target.checked)}
                            className="accent-blue-600"
                          />
                          <span className="text-xs text-gray-700">★4.0以上のみ表示</span>
                        </label>
                      </div>

                      <div className="mt-3 space-y-2">
                        <label className="block text-sm font-medium text-gray-700">
                          ⏱ 寄り道に使える余裕時間
                        </label>
                        <select
                          value={spareTime}
                          onChange={(e) => setSpareTime(e.target.value)}
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="10">約10分（さっと寄れる場所）</option>
                          <option value="30">約30分（カフェ・お土産屋など）</option>
                          <option value="60">約1時間（ランチ・観光地など）</option>
                          <option value="over60">1時間以上（じっくり観光）</option>
                        </select>
                      </div>
                      <button
                        type="button"
                        onClick={handleAskAI}
                        className="mt-3 w-full bg-gradient-to-r from-orange-500 to-amber-500 text-white rounded-xl px-4 py-3 text-sm font-semibold hover:from-orange-600 hover:to-amber-600 shadow-md hover:shadow-lg transition-all hover:scale-[1.01]"
                      >
                        ✨ AIにこの経路のおすすめを聞く
                      </button>

                      {/* スポット一覧 */}
                      <div className="mt-3 space-y-2">
                        {displayedSpots.map((spot, i) => {
                          const alreadyAdded = waypoints.some((w) => w.coord?.lat === spot.lat && w.coord?.lng === spot.lng);
                          const atLimit = waypoints.length >= MAX_WAYPOINTS && !waypoints.some((w) => !w.coord);
                          return (
                            <div key={`${spot.name}-${i}`} className="bg-white rounded-xl border border-gray-100 shadow-sm hover:shadow-md flex overflow-hidden transition-all hover:border-gray-200">
                              {spot.photoUrl && (
                                <img src={spot.photoUrl} alt={spot.name} className="w-20 h-20 object-cover shrink-0" />
                              )}
                              <div className="flex-1 px-3 py-2 min-w-0">
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex items-center gap-1.5 min-w-0">
                                    <span className="text-base shrink-0">
                                      {CATEGORY_EMOJI[spot.description as Category] ?? "📍"}
                                    </span>
                                    <span className="text-sm font-medium text-gray-800 truncate">{spot.name}</span>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => addWaypointFromSpot(spot)}
                                    disabled={alreadyAdded || atLimit}
                                    className={`shrink-0 text-xs px-2 py-0.5 rounded-full border transition-colors ${
                                      alreadyAdded
                                        ? "bg-violet-50 text-violet-600 border-violet-300 cursor-default"
                                        : atLimit
                                        ? "text-gray-300 border-gray-200 cursor-not-allowed"
                                        : "text-violet-600 border-violet-300 hover:bg-violet-50"
                                    }`}
                                  >
                                    {alreadyAdded ? "✓ 経由済み" : "＋ 経由"}
                                  </button>
                                </div>
                                <div className="mt-0.5 flex items-center gap-2">
                                  <span className="text-xs text-gray-400">{spot.description}</span>
                                  {spot.rating != null ? (
                                    <span className="text-xs text-amber-600">
                                      {renderStars(spot.rating)} {spot.rating.toFixed(1)}
                                      <span className="text-gray-400 ml-1">({spot.reviewCount?.toLocaleString()}件)</span>
                                    </span>
                                  ) : (
                                    <span className="text-xs text-gray-300">評価なし</span>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </>
              )}

              {!routeInfo && !isRouteLoading && (
                <div className="text-center text-gray-400 text-sm">
                  <p>現在地と目的地を入力すると、</p>
                  <p>経路上のおすすめスポットを表示します。</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Map */}
        <div className={`min-h-0 ${layoutMode === "pc" ? "w-1/2" : spView === "map" ? "flex-1 w-full" : "hidden"}`}>
          <Map
            spots={mode === "route" ? displayedSpots : spots}
            route={routeCoords}
            altRoutes={mode === "route" && allRoutes.length > 1 ? allRoutes
              .filter((_, i) => i !== selectedRouteIndex)
              .map((r) => ({ coordinates: r.coordinates, label: `${Math.ceil(r.durations.driving / 60)}分` }))
              : null}
            selectedRouteLabel={routeInfo ? `${Math.ceil(routeInfo.durations.driving / 60)}分` : undefined}
            onSelectRoute={(i) => {
              const others = allRoutes.map((_, j) => j).filter((j) => j !== selectedRouteIndex);
              handleSelectRoute(others[i]);
            }}
            start={coordA}
            goal={coordB}
            waypointMarkers={mode === "route" ? waypointMarkers : undefined}
            ashFall={showAshFall ? ashFallData : null}
          />
        </div>
      </div>
    </div>
  );
}
