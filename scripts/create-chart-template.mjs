import fs from "node:fs/promises";
import path from "node:path";

const ROOT_DIR = process.cwd();
const DATA_DIR = path.join(ROOT_DIR, "data");
const MUSIC_MASTER_PATH = path.join(DATA_DIR, "master", "music_master.json");
const MUSIC_CHARTS_PATH = path.join(DATA_DIR, "master", "music_charts.json");
const DIFFS = new Set(["EASY", "NORMAL", "HARD", "INF", "POLAR"]);

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const musicId = args.musicId ?? args["music-id"];
  const diff = args.diff?.toUpperCase();

  if (!musicId || !diff) {
    printUsage();
    process.exit(1);
  }

  if (!DIFFS.has(diff)) {
    throw new Error(`diff は EASY / NORMAL / HARD / INF / POLAR のいずれかです: ${diff}`);
  }

  const musicMaster = await readJsonArray(MUSIC_MASTER_PATH);
  const musicCharts = await readJsonArray(MUSIC_CHARTS_PATH);
  const master = musicMaster.find((item) => item.music_id === musicId);
  const chartMeta = musicCharts.find((item) => item.music_id === musicId && item.diff === diff);

  if (!master) {
    throw new Error(`music_master.json に music_id=${musicId} がありません。先に楽曲を登録してください。`);
  }

  if (!chartMeta) {
    throw new Error(`music_charts.json に music_id=${musicId}, diff=${diff} がありません。先に難易度情報を登録してください。`);
  }

  const status = args.status ?? "draft";
  if (!["draft", "review", "published"].includes(status)) {
    throw new Error(`status は draft / review / published のいずれかです: ${status}`);
  }

  const outputPath = path.join(DATA_DIR, "charts", musicId, diff, `${status}.json`);
  await assertFileDoesNotExist(outputPath);

  const now = toJstIsoString(new Date());
  const recordId = `chart_${musicId}_${diff.toLowerCase()}`;
  const record = buildTemplateRecord({ recordId, musicId, diff, status, master, chartMeta, now, author: args.author ?? "admin" });

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");

  console.log(`created: ${path.relative(ROOT_DIR, outputPath).replaceAll(path.sep, "/")}`);
  console.log("next: notes を入力したら npm run validate && npm run generate:indexes を実行してください。");
}

function buildTemplateRecord({ recordId, musicId, diff, status, master, chartMeta, now, author }) {
  return {
    id: recordId,
    music_id: musicId,
    diff,
    status,
    format_version: "1.0.0",
    revision_no: 1,
    checksum: "",
    notes_count: 0,
    measure_count: null,
    max_tick: 0,
    has_bpm_change: false,
    has_scroll_change: false,
    has_stop: false,
    has_time_signature_change: false,
    created_by: author,
    updated_by: author,
    created_at: now,
    updated_at: now,
    published_at: status === "published" ? now : null,
    data_json: {
      format_version: "1.0.0",
      meta: {
        music_id: musicId,
        diff,
        title: master.title,
        artist: master.artist ?? "",
        level_disp: chartMeta.level_disp ?? "",
        bpm_display: master.bpm_display ?? "",
        notes_count: 0,
        source: "manual",
      },
      layout: {
        lane_count: 12,
        x_min: 0,
        x_max: 12,
        main_layer: {
          visible: true,
          z_index: 10,
        },
        fader_layer: {
          visible: true,
          z_index: 20,
        },
      },
      timing: {
        resolution: 1920,
        offset_ms: 0,
        time_signatures: [
          {
            tick: 0,
            numerator: 4,
            denominator: 4,
          },
        ],
        bpms: [
          {
            tick: 0,
            bpm: parseBpm(master.bpm_display),
          },
        ],
        scrolls: [
          {
            tick: 0,
            ratio: 1,
          },
        ],
        stops: [],
      },
      notes: [],
      sections: [],
      tags: [],
      display: {
        default_pixels_per_beat: 120,
        default_zoom: 1,
        show_measure_lines: true,
        show_beat_lines: true,
        show_bpm_markers: true,
        show_scroll_markers: true,
        show_stop_markers: true,
        show_sections: true,
        note_skin: "default",
      },
      authoring: {
        created_by: author,
        updated_by: author,
        comment: "",
      },
    },
  };
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const value = argv[index + 1];
      args[key] = value;
      index += 1;
    }
  }
  return args;
}

async function readJsonArray(filePath) {
  const rows = JSON.parse(await fs.readFile(filePath, "utf8"));
  if (!Array.isArray(rows)) {
    throw new Error(`${path.relative(ROOT_DIR, filePath)} は配列である必要があります。`);
  }
  return rows;
}

async function assertFileDoesNotExist(filePath) {
  try {
    await fs.access(filePath);
    throw new Error(`${path.relative(ROOT_DIR, filePath)} は既に存在します。上書きする場合は手動で編集してください。`);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
}

function parseBpm(value) {
  const match = String(value ?? "").match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 120;
}

function toJstIsoString(date) {
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return `${jst.toISOString().replace("Z", "+09:00")}`;
}

function printUsage() {
  console.log(`Usage:
  npm run create:chart -- --musicId sample_0001 --diff POLAR
  npm run create:chart -- --musicId sample_0001 --diff POLAR --status draft --author admin
`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
