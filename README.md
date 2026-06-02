# polachart-data

PolaChart の譜面データ管理リポジトリです。

このリポジトリは、Phase1 のテスト運用中に GitHub JSON を暫定ストレージとして使うためのものです。
将来的には Supabase へ移管できるよう、Supabase の予定テーブル構造に近い JSON 構成で管理します。

## Directory

```txt
data/
├─ master/
│  ├─ music_master.json
│  └─ music_charts.json
├─ charts/
│  └─ {music_id}/
│     └─ {diff}/
│        └─ published.json
├─ revisions/
│  └─ {music_id}/
│     └─ {diff}/
├─ indexes/
│  ├─ charts_index.json
│  ├─ tags_index.json
│  ├─ sections_index.json
│  └─ search_index.json
└─ issues/
   └─ chart_issues.json
```

## Policy

- `data_json` が譜面データの正本です。
- `indexes/*.json` は検索・一覧表示用の派生データです。
- GitHub Token や管理者パスワードはこのリポジトリに置きません。
- 音源ファイルは置きません。
- Supabase 移管時は、この構造を `music_master` / `music_charts` / `chart_transcriptions` / `chart_tags` / `chart_sections` へ投入します。
