import { streamText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import type { ModelMessage } from "ai";
import spotsData from "@/data/kagoshima_spots.json";
import restaurantsData from "@/data/kagoshima_restaurants.json";

type SpotEntry = {
  name: string;
  category: string;
  address: string;
  description: string;
  area?: string;
  region?: string;
  tags?: string[];
  durationMinutes?: number;
  lat?: number | null;
  lng?: number | null;
};
type RestaurantEntry = {
  name: string;
  area: string;
  region?: string;
  genre: string;
  description: string;
  address: string;
  tags?: string[];
  durationMinutes?: number;
  lat: number;
  lng: number;
};

type QueryIntent = {
  text: string;
  requestedMinutes?: number;
  tags: string[];
  locationWords: string[];
  wantsFood: boolean;
  wantsTourism: boolean;
};

const LOCATION_WORDS = [
  "鹿児島市中心部",
  "鹿児島市郊外・桜島",
  "指宿・南薩",
  "霧島・姶良",
  "北薩",
  "大隅",
  "種子島・屋久島",
  "奄美群島",
  "天文館",
  "中央駅",
  "鹿児島中央",
  "城山",
  "桜島",
  "谷山",
  "与次郎",
  "鴨池",
  "騎射場",
  "吉野",
  "磯",
  "指宿",
  "南九州",
  "知覧",
  "枕崎",
  "日置",
  "霧島",
  "姶良",
  "薩摩川内",
  "出水",
  "阿久根",
  "長島",
  "伊佐",
  "さつま町",
  "鹿屋",
  "垂水",
  "南大隅",
  "志布志",
  "曽於",
  "肝付",
  "種子島",
  "屋久島",
  "奄美",
  "徳之島",
  "沖永良部",
  "与論",
];

const TAG_KEYWORDS: Record<string, string[]> = {
  "雨の日": ["雨", "雨の日", "屋内", "室内", "天気が悪い"],
  "家族向け": ["家族", "子連れ", "子ども", "ファミリー"],
  "短時間": ["短時間", "少し", "ついで", "立ち寄り", "サクッと", "1時間以内"],
  "絶景": ["絶景", "景色", "展望", "眺め", "写真", "映え"],
  "歴史": ["歴史", "史跡", "文化", "武家", "島津", "西郷", "維新"],
  "温泉": ["温泉", "足湯", "砂むし"],
  "自然": ["自然", "公園", "滝", "森", "海", "山", "湖"],
  "離島": ["離島", "島", "屋久島", "種子島", "奄美", "徳之島", "与論"],
  "海鮮": ["海鮮", "魚", "刺身", "寿司", "海鮮丼", "かつお", "かんぱち"],
  "黒豚": ["黒豚", "しゃぶしゃぶ", "とんかつ"],
  "カフェ": ["カフェ", "喫茶", "コーヒー", "休憩"],
  "スイーツ": ["スイーツ", "甘味", "白熊", "菓子"],
  "ラーメン": ["ラーメン"],
  "焼肉": ["焼肉", "黒牛"],
  "居酒屋": ["居酒屋", "焼酎", "飲み"],
  "ランチ": ["ランチ", "昼食", "昼ごはん", "昼"],
  "ディナー": ["ディナー", "夕食", "夜ごはん", "夜"],
};

function buildSpotLines(spots: SpotEntry[]): string {
  return spots.map((s) => {
    const desc = s.description.slice(0, 150);
    const coord = s.lat ? ` (${s.lat}, ${s.lng})` : "";
    const meta = [
      s.region,
      s.area,
      s.durationMinutes ? `目安${s.durationMinutes}分` : "",
      s.tags?.length ? `タグ:${s.tags.join("・")}` : "",
    ].filter(Boolean).join(" / ");
    return `- ${s.name}: ${desc} ${meta ? `【${meta}】` : ""} 住所:${s.address}${coord}`;
  }).join("\n");
}

function buildRestaurantLines(restaurants: RestaurantEntry[]): string {
  const grouped = restaurants.reduce<Record<string, RestaurantEntry[]>>((acc, restaurant) => {
    const key = `${restaurant.region ?? "その他"} / ${restaurant.area}`;
    acc[key] = acc[key] ?? [];
    acc[key].push(restaurant);
    return acc;
  }, {});

  return Object.entries(grouped)
    .map(([areaLabel, entries]) => {
      if (entries.length === 0) return "";
      const lines = entries
        .map((restaurant) =>
          `- ${restaurant.name}: ${restaurant.genre} / ${restaurant.description}。目安${restaurant.durationMinutes ?? 60}分 / タグ:${restaurant.tags?.join("・") ?? restaurant.genre} / 住所:${restaurant.address} (${restaurant.lat}, ${restaurant.lng})`
        )
        .join("\n");
      return `### ${areaLabel}\n${lines}`;
    })
    .filter(Boolean)
    .join("\n\n");
}

function getMessageText(message: IncomingMessage): string {
  return message.parts
    .filter((p) => p.type === "text" && p.text)
    .map((p) => p.text!)
    .join("");
}

function extractRequestedMinutes(text: string): number | undefined {
  if (/半日/.test(text)) return 240;
  if (/一日|1日|１日|日帰り/.test(text)) return 420;
  const hourMatch = text.match(/([0-9０-９]+)\s*時間/);
  if (hourMatch) return Number(hourMatch[1].replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))) * 60;
  const minuteMatch = text.match(/([0-9０-９]+)\s*分/);
  if (minuteMatch) return Number(minuteMatch[1].replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)));
  if (/短時間|サクッと|少し|立ち寄り/.test(text)) return 60;
  return undefined;
}

function parseIntent(text: string): QueryIntent {
  const tags = Object.entries(TAG_KEYWORDS)
    .filter(([, keywords]) => keywords.some((keyword) => text.includes(keyword)))
    .map(([tag]) => tag);
  const locationWords = LOCATION_WORDS.filter((word) => text.includes(word));
  const wantsFood = /グルメ|食事|飲食|ごはん|ランチ|昼食|夕食|ディナー|店|レストラン|カフェ|海鮮|黒豚|ラーメン|焼肉|居酒屋/.test(text);
  const wantsTourism = /観光|スポット|行き|巡|遊|景色|絶景|歴史|温泉|公園|雨の日|家族|半日|日帰り/.test(text) || !wantsFood;

  return {
    text,
    requestedMinutes: extractRequestedMinutes(text),
    tags,
    locationWords,
    wantsFood,
    wantsTourism,
  };
}

function matchesLocation(item: SpotEntry | RestaurantEntry, intent: QueryIntent): boolean {
  if (intent.locationWords.length === 0) return true;
  const target = `${item.name} ${item.address} ${item.area ?? ""} ${item.region ?? ""}`;
  return intent.locationWords.some((word) => target.includes(word));
}

function scoreItem(item: SpotEntry | RestaurantEntry, intent: QueryIntent): number {
  const itemTags = item.tags ?? [];
  const text = `${item.name} ${item.address} ${item.area ?? ""} ${item.region ?? ""} ${item.description} ${itemTags.join(" ")}`;
  let score = 0;

  for (const word of intent.locationWords) {
    if (text.includes(word)) score += 35;
  }
  for (const tag of intent.tags) {
    if (itemTags.includes(tag) || text.includes(tag)) score += 20;
  }
  if (intent.requestedMinutes && item.durationMinutes) {
    score += item.durationMinutes <= intent.requestedMinutes ? 12 : -12;
  }
  if ("category" in item && item.category === "tourism") score += 5;
  if ("genre" in item && intent.tags.includes(item.genre)) score += 15;
  if (item.lat && item.lng) score += 3;
  return score;
}

function pickCandidates<T extends SpotEntry | RestaurantEntry>(items: T[], intent: QueryIntent, limit: number): T[] {
  const filtered = items.filter((item) => matchesLocation(item, intent));
  const base = filtered.length > 0 ? filtered : items;
  const scored = base
    .map((item, index) => ({ item, index, score: scoreItem(item, intent) }))
    .sort((a, b) => b.score - a.score || a.index - b.index);

  return scored.slice(0, limit).map(({ item }) => item);
}

function buildRecommendationContext(userText: string): string {
  const intent = parseIntent(userText);
  const allSpots = (spotsData as SpotEntry[]).filter(
    (spot) => (spot.category === "tourism" || spot.category === "history") && spot.lat && spot.lng
  );
  const allRestaurants = restaurantsData as RestaurantEntry[];
  const spotLimit = intent.wantsFood && !intent.wantsTourism ? 10 : 35;
  const restaurantLimit = intent.wantsFood ? 25 : 12;
  const spotCandidates = pickCandidates(allSpots, intent, spotLimit);
  const restaurantCandidates = pickCandidates(allRestaurants, intent, restaurantLimit);
  const intentSummary = [
    intent.locationWords.length ? `地域:${intent.locationWords.join("・")}` : "",
    intent.tags.length ? `条件:${intent.tags.join("・")}` : "",
    intent.requestedMinutes ? `時間:${intent.requestedMinutes}分以内を優先` : "",
  ].filter(Boolean).join(" / ") || "明示条件なし";

  return `## 質問に基づく推薦候補

抽出条件: ${intentSummary}

### 観光・文化候補
${spotCandidates.length ? buildSpotLines(spotCandidates) : "- 条件に合う観光候補が少ないため、近い地域の候補も検討してください。"}

### グルメ候補
${restaurantCandidates.length ? buildRestaurantLines(restaurantCandidates) : "- 条件に合う飲食店候補が少ないため、近い地域の候補も検討してください。"}`;
}

function buildSystemPrompt(userText: string): string {
  return `あなたは「かごしまAIガイド」です。鹿児島を中心に、九州全般や旅行全般の質問にも対応するAIコンシェルジュです。観光情報を中心に、施設・交通・グルメ・歴史・大学・生活情報など幅広くサポートしてください。

## ルール
- 鹿児島市とその周辺に関する質問には特に詳しく回答してください。鹿児島以外の質問にも対応可能です
- **必ず具体的な店名を挙げて紹介してください。「○○料理の店が多くあります」のようなジャンル紹介ではなく、実際の店名（例:「いちにいさん天文館店」「黒かつ亭」）を出してください。**
- **「観光案内所に聞いてください」「Google検索してください」のような回答は絶対にしないでください。あなた自身がガイドです。**
- グルメの質問には、推薦候補リストから該当エリア・地域・タグに合う店を選んで3〜5件紹介してください
- ユーザーが特定のエリア（天文館、中央駅周辺など）を指定した場合は、そのエリアに実際にあるスポットだけを紹介してください。別のエリアのスポットを混ぜないでください（例: 天文館と聞かれたら中央駅の店を出さない）
- ユーザーが「雨の日」「家族向け」「短時間」「絶景」「海鮮」などの条件を出した場合は、tags と durationMinutes を優先して候補を絞ってください
- 観光とグルメを同時に聞かれた場合は、同じ region / area のスポットと飲食店を組み合わせ、移動負担が小さい順に提案してください
- スポットを紹介する際は、**必ず**以下のJSON形式で場所情報を回答の末尾に付けてください：
  <!--SPOTS_JSON[{"name":"スポット名","category":"観光または飲食","lat":緯度,"lng":経度,"description":"一言説明","durationMinutes":60,"tags":["タグ"]}]SPOTS_JSON-->
- 複数スポットがある場合は配列に複数入れてください。**最低3件は含めてください**
- フレンドリーで親しみやすい口調で案内してください
- 営業時間や料金は「最新情報は公式サイトでご確認ください」と添えてください
- 以下の推薦候補リストを優先して回答してください。ここにないスポットや飲食店についても知識があれば補足して構いませんが、場所JSONには緯度経度が分かる候補を優先してください。

${buildRecommendationContext(userText)}

### 交通
- 鹿児島市電（路面電車）: 市内観光に便利。1回190円
- 桜島フェリー: 鹿児島港→桜島港。約15分、大人200円。24時間運航
- カゴシマシティビュー（観光バス）: 主要観光地を巡回。1日乗車券600円
`;
}

interface UIMessagePart {
  type: string;
  text?: string;
}

interface IncomingMessage {
  role: "user" | "assistant";
  parts: UIMessagePart[];
}

function expandRouteContext(text: string): string {
  const match = text.match(/<!--ROUTE_CONTEXT(.*?)ROUTE_CONTEXT-->/s);
  if (!match) return text;
  try {
    const ctx = JSON.parse(match[1]);
    const visible = text.replace(/<!--ROUTE_CONTEXT.*?ROUTE_CONTEXT-->/s, "").trim();
    return `${visible}

【経路情報】約${ctx.distKm}km・車で約${ctx.drivingMin}分

経路沿いには以下のスポットがあります:
${ctx.spotLines}

以下の条件でおすすめを提案してください:
- 余裕時間${ctx.spareLabel}で立ち寄れるスポットに絞って提案してください
- ${ctx.spareAdvice}提案してください
- 口コミ評価が高いスポットを優先しつつ、カテゴリのバランスも考慮してください
- 「口コミで○○と評判」のように口コミ情報も交えて紹介してください
- 各スポットへの寄り道にかかるおおよその時間も教えてください`;
  } catch {
    return text;
  }
}

function toCoreMessages(messages: IncomingMessage[]): ModelMessage[] {
  return messages.map((msg) => {
    let text = getMessageText(msg);
    if (msg.role === "user") text = expandRouteContext(text);
    return { role: msg.role, content: text };
  });
}

export async function POST(req: Request) {
  const body = await req.json();
  const messages: IncomingMessage[] = body.messages;
  const lastUserText = [...messages].reverse().find((message) => message.role === "user");
  const userText = lastUserText ? getMessageText(lastUserText) : "";

  const result = streamText({
    model: anthropic("claude-haiku-4-5-20251001"),
    system: buildSystemPrompt(userText),
    messages: toCoreMessages(messages),
  });

  return result.toUIMessageStreamResponse();
}
