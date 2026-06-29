# かごしまAIガイド

鹿児島を訪れる観光客向けの、AIチャット+地図を組み合わせた移動シーン特化型観光ガイドアプリ。

## セットアップ（Docker）

研究室の筐体にはDockerが入っているので、以下の手順で起動できます。Node.jsのインストールは不要です。

### 1. リポジトリをクローン

```bash
git clone http://192.168.1.6:8080/seminar_all/2026_hackathon/m1_kagoshima_idea_contest.git
cd m1_kagoshima_idea_contest/development
```

### 2. 環境変数を設定

`.env.local` を作成し、APIキーを記載:

```bash
cat <<EOF > .env.local
ANTHROPIC_API_KEY=ここにAPIキーを貼る
GOOGLE_PLACES_API_KEY=ここにAPIキーを貼る
EOF
```

APIキーは横手にTeams DMで確認してください。
**※ `.env.local` は絶対にコミット・プッシュしないこと**

### 3. 起動

```bash
docker compose up --build
```

初回はビルドに数分かかります。2回目以降は `docker compose up` だけでOKです。

### 4. アクセス

http://localhost:3000 を開く。

### ローカル起動（Dockerを使わない場合）

Node.js 20以上が必要です。

```bash
cd development
npm install
npm run dev
```

## 機能

### チャットモード
- 鹿児島を中心に旅行全般の質問に回答（観光・施設・交通・グルメ・歴史など幅広く対応）
- AIが回答 + 地図にスポットをピン表示
- AIの返信にスポット画像カードを表示
- 鹿児島市オープンデータ（観光スポット78件）をAIに組み込み済み

### 経路検索モード
- 出発地・経由地（最大3件）・目的地を入力 → ルート表示 + 沿道スポットをカテゴリ別に表示
- カテゴリ: 観光🏛 / 展望🔭 / 飲食🍜 / 買い物🛍 / トイレ🚻 / 駐車場🅿
- スポットの口コミ・評価（★）をGoogle Places APIで取得・表示
- 左パネルでスポット一覧をカード表示（画像+名前+★評価）、評価順/口コミ数順のソート、★4.0以上フィルタ
- スポットカードから「＋経由」で経由地に追加可能
- 余裕時間セレクタ（10分/30分/1時間/1時間以上）でAIが時間に合ったスポットを厳選
- ルートを5区間に分割し、全体に均等にスポットを表示
- ズームレベルに応じてスポットの表示数を自動調整

### 降灰シミュレーション
- 桜島の降灰予測エリアを地図上に扇形で表示
- Open-Meteo APIから風向き・風速をリアルタイム取得
- チェックボックスでON/OFF切り替え

## 技術スタック

| 要素 | 技術 |
|------|------|
| フロントエンド | Next.js + TypeScript |
| AI | Claude API (Haiku 4.5) + Vercel AI SDK v6 |
| 地図 | Leaflet.js + OpenStreetMap |
| ルーティング | OSRM |
| ジオコーディング | Photon API (komoot) |
| スポット検索 | Overpass API (OSM) |
| 口コミ | Google Places API |
| 降灰シミュレーション | Open-Meteo API |
| データ | 鹿児島市オープンデータ (BODIK ODCS) |
