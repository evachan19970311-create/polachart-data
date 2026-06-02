import fs from "node:fs/promises";
import path from "node:path";

const ROOT_DIR = process.cwd();
const DATA_DIR = path.join(ROOT_DIR, "data");
const CHARTS_DIR = path.join(DATA_DIR, "charts");
const INDEXES_DIR = path.join(DATA_DIR, "indexes");
const MUSIC_MASTER_PATH = path.join(DATA_DIR, "master", "music_master.json");
const checkOnly = process.argv.includes("--check");

async function main() {
  const musicMaster = await loadMusicMasterMap();
  const records = await loadPublishedChartRecords();
  const chartsIndex = buildChartsIndex(records, musicMaster);
  const tagsIndex = buildTagsIndex(records);
  const sectionsIndex = buildSectionsIndex(records);
  const searchIndex = buildSearchIndex(records, musicMaster);

  await writeJson("charts_index.json", chartsIndex);
  await writeJson("tags_index.json", tagsIndex);
  await writeJson("sections_index.json", sectionsIndex);
  await writeJson("search_index.json", searchIndex);

  console.log(`${checkOnly ? "Checked" : "Generated"}: ${records.length} published chart(s).`);
}

async function loadMusicMasterMap() {
  try {
    const rows = JSON.parse(await fs.readFile(MUSIC_MASTER_PATH, "utf8"));
    return new Map(rows.map((row) => [row.music_id, row]));
  } catch {
    return new Map();
  }
}

async function loadPublishedChartRecords() {
  const files = await findFiles(CHARTS_DIR, "published.json");
  const records = [];

  for (const filePath of files) {
    const record = JSON.parse(await fs.readFile(filePath, "utf8"));
    const relativePath = path.relative(ROOT_DIR, filePath).replaceAll(path.sep, "/");
    records.push({ record, relativePath });
  }

  records.sort((a, b) => {
    const aKey = `${a.record.music_id}_${a.record.diff}`;
    const bKey = `${b.record.music_id}_${b.record.diff}`;
    return aKey.localeCompare(bKey);
  });

  return records;
}

async function findFiles(dir, filename) {
  const results = [];

  async function walk(currentDir) {
    let entries = [];
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.name === filename) {
        results.push(fullPath);
      }
    }
  }

  await walk(dir);
  return results;
}

function buildChartsIndex(items, musicMaster) {
  return items.map(({ record, relativePath }) => {
    const chart = record.data_json;
    const timing = chart.timing;
    const master = musicMaster.get(record.music_id);
    const tags = chart.tags?.map((tag) => tag.type) ?? [];

    return {
      chart_id: record.id,
      music_id: record.music_id,
      diff: record.diff,
      title: master?.title ?? chart.meta.title,
      artist: master?.artist ?? chart.meta.artist ?? "",
      level_disp: chart.meta.level_disp ?? "",
      bpm_display: master?.bpm_display ?? chart.meta.bpm_display ?? "",
      status: record.status,
      format_version: record.format_version,
      notes_count: record.notes_count ?? chart.meta.notes_count ?? chart.notes.length,
      measure_count: record.measure_count ?? null,
      max_tick: record.max_tick ?? getMaxTick(chart),
      has_bpm_change: timing.bpms.length > 1,
      has_scroll_change: timing.scrolls.length > 1,
      has_stop: timing.stops.length > 0,
      has_time_signature_change: timing.time_signatures.length > 1,
      tags,
      updated_at: record.updated_at ?? "",
      path: relativePath,
    };
  });
}

function buildTagsIndex(items) {
  return items.flatMap(({ record }) => {
    const chart = record.data_json;
    return (chart.tags ?? []).map((tag) => ({
      chart_id: record.id,
      music_id: record.music_id,
      diff: record.diff,
      tag_type: tag.type,
      weight: tag.weight,
      source: tag.source ?? "manual",
    }));
  });
}

function buildSectionsIndex(items) {
  return items.flatMap(({ record }) => {
    const chart = record.data_json;
    return (chart.sections ?? []).map((section) => ({
      chart_id: record.id,
      music_id: record.music_id,
      diff: record.diff,
      section_key: section.id,
      start_tick: section.start_tick,
      end_tick: section.end_tick,
      label: section.label,
      difficulty: section.difficulty ?? null,
      tags: section.tags ?? [],
      comment: section.comment ?? "",
    }));
  });
}

function buildSearchIndex(items, musicMaster) {
  const map = new Map();

  for (const { record } of items) {
    const chart = record.data_json;
    const master = musicMaster.get(record.music_id);
    const current = map.get(record.music_id) ?? {
      music_id: record.music_id,
      title: master?.title ?? chart.meta.title,
      title_kana: master?.title_kana ?? "",
      artist: master?.artist ?? chart.meta.artist ?? "",
      diffs: [],
      levels: [],
      tags: [],
      has_published_chart: true,
    };

    current.diffs = unique([...current.diffs, record.diff]);
    if (chart.meta.level_disp) current.levels = unique([...current.levels, chart.meta.level_disp]);
    current.tags = unique([...current.tags, ...(chart.tags?.map((tag) => tag.type) ?? [])]);
    map.set(record.music_id, current);
  }

  return [...map.values()].sort((a, b) => a.music_id.localeCompare(b.music_id));
}

function getMaxTick(chart) {
  const noteTicks = chart.notes.flatMap((note) => {
    switch (note.type) {
      case "tap":
      case "flick":
      case "release":
      case "fader":
        return [note.tick];
      case "hold":
      case "fader_hold":
      case "fader_scratch":
        return note.shape_path.points.map((point) => point.tick);
      case "honeycomb":
        return note.nodes.map((node) => node.tick);
      default:
        return [];
    }
  });

  const sectionTicks = chart.sections?.flatMap((section) => [section.start_tick, section.end_tick]) ?? [];
  const timingTicks = [
    ...chart.timing.time_signatures.map((event) => event.tick),
    ...chart.timing.bpms.map((event) => event.tick),
    ...chart.timing.scrolls.map((event) => event.tick),
    ...chart.timing.stops.map((event) => event.tick),
  ];

  return Math.max(0, ...noteTicks, ...sectionTicks, ...timingTicks);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

async function writeJson(filename, data) {
  await fs.mkdir(INDEXES_DIR, { recursive: true });
  const filePath = path.join(INDEXES_DIR, filename);
  const nextContent = `${JSON.stringify(data, null, 2)}\n`;

  if (checkOnly) {
    let currentContent = "";
    try {
      currentContent = await fs.readFile(filePath, "utf8");
    } catch {
      throw new Error(`${filename} が存在しません。npm run generate:indexes を実行してください。`);
    }

    if (currentContent !== nextContent) {
      throw new Error(`${filename} が最新ではありません。npm run generate:indexes を実行してください。`);
    }
    return;
  }

  await fs.writeFile(filePath, nextContent, "utf8");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
