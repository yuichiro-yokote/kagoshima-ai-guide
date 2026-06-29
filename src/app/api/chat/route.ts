import { streamText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import type { ModelMessage } from "ai";
import spotsData from "@/data/kagoshima_spots.json";
import restaurantsData from "@/data/kagoshima_restaurants.json";

type SpotEntry = { name: string; category: string; address: string; description: string; lat?: number | null; lng?: number | null };
type RestaurantEntry = {
  name: string;
  area: string;
  genre: string;
  description: string;
  address: string;
  lat: number;
  lng: number;
};

function buildSpotLines(): string {
  const tourism = (spotsData as SpotEntry[]).filter((s) => s.category === "tourism");
  return tourism.map((s) => {
    const desc = s.description.slice(0, 150);
    const coord = s.lat ? ` (${s.lat}, ${s.lng})` : "";
    return `- ${s.name}: ${desc} 住所:${s.address}${coord}`;
  }).join("\n");
}

function buildRestaurantLines(): string {
  const restaurants = restaurantsData as RestaurantEntry[];
  const areas = ["天文館", "中央駅", "城山", "桜島", "谷山", "与次郎", "その他"];
  return areas
    .map((area) => {
      const entries = restaurants.filter((restaurant) => restaurant.area === area);
      if (entries.length === 0) return "";
      const lines = entries
        .map((restaurant) =>
          `- ${restaurant.name}: ${restaurant.genre} / ${restaurant.description}。住所:${restaurant.address} (${restaurant.lat}, ${restaurant.lng})`
        )
        .join("\n");
      return `### ${area}エリア\n${lines}`;
    })
    .filter(Boolean)
    .join("\n\n");
}

const SYSTEM_PROMPT = `あなたは「かごしまAIガイド」です。鹿児島を中心に、九州全般や旅行全般の質問にも対応するAIコンシェルジュです。観光情報を中心に、施設・交通・グルメ・歴史・大学・生活情報など幅広くサポートしてください。

## ルール
- 鹿児島市とその周辺に関する質問には特に詳しく回答してください。鹿児島以外の質問にも対応可能です
- **必ず具体的な店名を挙げて紹介してください。「○○料理の店が多くあります」のようなジャンル紹介ではなく、実際の店名（例:「いちにいさん天文館店」「黒かつ亭」）を出してください。**
- **「観光案内所に聞いてください」「Google検索してください」のような回答は絶対にしないでください。あなた自身がガイドです。**
- グルメの質問には、上記の飲食店リストから該当エリアの店を選んで3〜5件紹介してください
- ユーザーが特定のエリア（天文館、中央駅周辺など）を指定した場合は、そのエリアに実際にあるスポットだけを紹介してください。別のエリアのスポットを混ぜないでください（例: 天文館と聞かれたら中央駅の店を出さない）
- スポットを紹介する際は、**必ず**以下のJSON形式で場所情報を回答の末尾に付けてください：
  <!--SPOTS_JSON[{"name":"スポット名","lat":緯度,"lng":経度,"description":"一言説明"}]SPOTS_JSON-->
- 複数スポットがある場合は配列に複数入れてください。**最低3件は含めてください**
- フレンドリーで親しみやすい口調で案内してください
- 営業時間や料金は「最新情報は公式サイトでご確認ください」と添えてください
- 以下の鹿児島市オープンデータの観光スポット情報を参考にして回答してください。ここにないスポットや飲食店についても知識があれば積極的に紹介してください。

## 鹿児島市の観光スポット情報（鹿児島市オープンデータより）

${buildSpotLines()}

## 鹿児島市の主要飲食店・グルメスポット

${buildRestaurantLines()}

### 交通
- 鹿児島市電（路面電車）: 市内観光に便利。1回190円
- 桜島フェリー: 鹿児島港→桜島港。約15分、大人200円。24時間運航
- カゴシマシティビュー（観光バス）: 主要観光地を巡回。1日乗車券600円
`;

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
    let text = msg.parts
      .filter((p) => p.type === "text" && p.text)
      .map((p) => p.text!)
      .join("");
    if (msg.role === "user") text = expandRouteContext(text);
    return { role: msg.role, content: text };
  });
}

export async function POST(req: Request) {
  const body = await req.json();
  const messages: IncomingMessage[] = body.messages;

  const result = streamText({
    model: anthropic("claude-haiku-4-5-20251001"),
    system: SYSTEM_PROMPT,
    messages: toCoreMessages(messages),
  });

  return result.toUIMessageStreamResponse();
}
