import { streamText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import type { CoreMessage } from "ai";
import spotsData from "@/data/kagoshima_spots.json";

type SpotEntry = { name: string; category: string; address: string; description: string; lat?: number | null; lng?: number | null };

function buildSpotLines(): string {
  const tourism = (spotsData as SpotEntry[]).filter((s) => s.category === "tourism");
  return tourism.map((s) => {
    const desc = s.description.slice(0, 150);
    const coord = s.lat ? ` (${s.lat}, ${s.lng})` : "";
    return `- ${s.name}: ${desc} 住所:${s.address}${coord}`;
  }).join("\n");
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

### 天文館エリアの飲食店（天文館電停〜いづろ周辺）
- いちにいさん天文館店: 黒豚しゃぶしゃぶの名店。千日町13-21 (31.5875, 130.5520)
- 天文館むじゃき: かき氷「白熊」発祥の店。千日町5-8 (31.5878, 130.5518)
- 黒かつ亭 天文館店: 黒豚とんかつ専門店。ランチが人気。山之口町9-1 (31.5870, 130.5530)
- 吾愛人(わかな) 天文館本店: 黒豚しゃぶしゃぶ・郷土料理の老舗。東千石町9-14 (31.5890, 130.5525)
- 熊襲亭: 鹿児島郷土料理の名店。きびなご・さつま揚げ等。東千石町6-10 (31.5892, 130.5520)
- こむらさき 天文館店: 鹿児島ラーメンの老舗。東千石町11-19 (31.5888, 130.5522)
- のり一: 鹿児島ラーメンの人気店。天文館電停そば。堀江町2-15 (31.5882, 130.5512)
- 豚とろ 天文館本店: 鹿児島ラーメン。とろとろチャーシューが名物。山之口町9-41 (31.5868, 130.5528)
- 鯖乃家: 〆鯖・刺身が名物の海鮮居酒屋。山之口町3-12 (31.5872, 130.5525)
- あぢもり: 黒豚しゃぶしゃぶの名店。千日町13-21 (31.5876, 130.5519)

### 鹿児島中央駅エリアの飲食店（※天文館とは別エリア）
- かごっまふるさと屋台村: 中央駅ビル地下1階。25店舗の屋台。中央町1-1 (31.5838, 130.5415)
- ざぼんラーメン: 鹿児島ラーメンの元祖。中央駅一番街。中央町22-6 (31.5840, 130.5420)
- アミュプラザ鹿児島: 駅ビル内レストラン街。中央町1-1 (31.5838, 130.5415)

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

function toCoreMessages(messages: IncomingMessage[]): CoreMessage[] {
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
