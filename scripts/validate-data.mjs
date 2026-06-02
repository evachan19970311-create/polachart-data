import fs from "node:fs/promises";
import path from "node:path";

const ROOT_DIR = process.cwd();
const DATA_DIR = path.join(ROOT_DIR, "data");
const CHARTS_DIR = path.join(DATA_DIR, "charts");
const DIFFS = new Set(["EASY", "NORMAL", "HARD", "INF", "POLAR"]);
const SINGLE_NOTE_TYPES = new Set(["tap", "flick", "release", "fader"]);
const SHAPE_NOTE_TYPES = new Set(["hold", "fader_hold", "fader_scratch"]);

const errors = [];
const warnings = [];

async function main() {
  const chartFiles = await findChartFiles(CHARTS_DIR);

  if (chartFiles.length === 0) {
    warnings.push("data/charts 配下に published.json / draft.json / review.json がありません。");
  }

  for (const filePath of chartFiles) {
    await validateChartFile(filePath);
  }

  for (const warning of warnings) {
    console.warn(`[warn] ${warning}`);
  }

  if (errors.length > 0) {
    for (const error of errors) {
      console.error(`[error] ${error}`);
    }
    process.exit(1);
  }

  console.log(`OK: ${chartFiles.length} chart file(s) validated.`);
}

async function findChartFiles(dir) {
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
      } else if (["published.json", "draft.json", "review.json"].includes(entry.name)) {
        results.push(fullPath);
      }
    }
  }

  await walk(dir);
  return results;
}

async function validateChartFile(filePath) {
  const relativePath = path.relative(ROOT_DIR, filePath);
  let record;

  try {
    record = JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    errors.push(`${relativePath}: JSON parse failed: ${error.message}`);
    return;
  }

  const chart = record.data_json;
  if (!chart) {
    errors.push(`${relativePath}: data_json がありません。`);
    return;
  }

  assert(record.id, relativePath, "record.id がありません。");
  assert(record.music_id, relativePath, "record.music_id がありません。");
  assert(DIFFS.has(record.diff), relativePath, `record.diff が不正です: ${record.diff}`);
  assert(["draft", "review", "published", "archived"].includes(record.status), relativePath, `record.status が不正です: ${record.status}`);
  assert(record.format_version === "1.0.0", relativePath, `record.format_version は 1.0.0 が必要です: ${record.format_version}`);

  assert(chart.format_version === "1.0.0", relativePath, `data_json.format_version は 1.0.0 が必要です: ${chart.format_version}`);
  assert(chart.meta?.music_id === record.music_id, relativePath, "record.music_id と data_json.meta.music_id が一致していません。");
  assert(chart.meta?.diff === record.diff, relativePath, "record.diff と data_json.meta.diff が一致していません。");
  assert(Boolean(chart.meta?.title), relativePath, "data_json.meta.title がありません。");

  validateLayout(relativePath, chart.layout);
  validateTiming(relativePath, chart.timing);
  validateNotes(relativePath, chart.notes ?? [], chart.layout);
  validateSections(relativePath, chart.sections ?? []);
  validateTags(relativePath, chart.tags ?? []);
}

function validateLayout(filePath, layout) {
  if (!layout) {
    errors.push(`${filePath}: layout がありません。`);
    return;
  }

  assert(layout.lane_count === 12, filePath, `layout.lane_count は 12 を推奨固定にします: ${layout.lane_count}`);
  assert(layout.x_min === 0, filePath, `layout.x_min は 0 を推奨固定にします: ${layout.x_min}`);
  assert(layout.x_max === 12, filePath, `layout.x_max は 12 を推奨固定にします: ${layout.x_max}`);
  assert(layout.x_min < layout.x_max, filePath, "layout.x_min < layout.x_max を満たしていません。");
}

function validateTiming(filePath, timing) {
  if (!timing) {
    errors.push(`${filePath}: timing がありません。`);
    return;
  }

  assert(timing.resolution === 1920, filePath, `timing.resolution は 1920 を推奨固定にします: ${timing.resolution}`);
  assert(Number.isFinite(timing.offset_ms), filePath, "timing.offset_ms が数値ではありません。");
  validateTickEvents(filePath, "time_signatures", timing.time_signatures, true);
  validateTickEvents(filePath, "bpms", timing.bpms, true);
  validateTickEvents(filePath, "scrolls", timing.scrolls, true);
  validateTickEvents(filePath, "stops", timing.stops ?? [], false);

  for (const event of timing.time_signatures ?? []) {
    assert(Number.isInteger(event.numerator) && event.numerator >= 1, filePath, `time_signature numerator が不正です: ${event.numerator}`);
    assert([2, 4, 8, 16, 32].includes(event.denominator), filePath, `time_signature denominator が不正です: ${event.denominator}`);
  }

  for (const event of timing.bpms ?? []) {
    assert(Number.isFinite(event.bpm) && event.bpm > 0, filePath, `bpm が不正です: ${event.bpm}`);
  }

  for (const event of timing.scrolls ?? []) {
    assert(Number.isFinite(event.ratio) && event.ratio > 0, filePath, `scroll ratio が不正です: ${event.ratio}`);
  }

  for (const event of timing.stops ?? []) {
    assert(Number.isFinite(event.duration_ms) && event.duration_ms > 0, filePath, `stop duration_ms が不正です: ${event.duration_ms}`);
  }
}

function validateTickEvents(filePath, name, events, requiresZero) {
  assert(Array.isArray(events), filePath, `${name} は配列である必要があります。`);
  if (!Array.isArray(events)) return;
  assert(!requiresZero || events.length > 0, filePath, `${name} は1件以上必要です。`);
  assert(!requiresZero || events.some((event) => event.tick === 0), filePath, `${name} は tick 0 のイベントが必要です。`);

  let prevTick = -1;
  for (const event of events) {
    assert(Number.isInteger(event.tick) && event.tick >= 0, filePath, `${name} の tick が不正です: ${event.tick}`);
    assert(event.tick >= prevTick, filePath, `${name} が tick 昇順ではありません。`);
    prevTick = event.tick;
  }
}

function validateNotes(filePath, notes, layout) {
  assert(Array.isArray(notes), filePath, "notes は配列である必要があります。");
  if (!Array.isArray(notes)) return;

  const ids = new Set();
  for (const note of notes) {
    assert(Boolean(note.id), filePath, "note.id がありません。");
    if (note.id) {
      assert(!ids.has(note.id), filePath, `note.id が重複しています: ${note.id}`);
      ids.add(note.id);
    }

    if (SINGLE_NOTE_TYPES.has(note.type)) {
      validateSingleNote(filePath, note, layout);
    } else if (SHAPE_NOTE_TYPES.has(note.type)) {
      validateShapeNote(filePath, note, layout);
    } else if (note.type === "honeycomb") {
      validateHoneycomb(filePath, note, layout);
    } else {
      errors.push(`${filePath}: note.type が不正です: ${note.type}`);
    }
  }
}

function validateSingleNote(filePath, note, layout) {
  const expectedLayer = note.type === "fader" ? "fader" : "main";
  assert(note.layer === expectedLayer, filePath, `${note.id}: layer は ${expectedLayer} である必要があります。`);
  assert(Number.isInteger(note.tick) && note.tick >= 0, filePath, `${note.id}: tick が不正です。`);
  validateBounds(filePath, `${note.id}`, note, layout);
}

function validateShapeNote(filePath, note, layout) {
  const expectedLayer = note.type.startsWith("fader") ? "fader" : "main";
  assert(note.layer === expectedLayer, filePath, `${note.id}: layer は ${expectedLayer} である必要があります。`);
  const points = note.shape_path?.points;
  assert(Array.isArray(points) && points.length >= 2, filePath, `${note.id}: shape_path.points は2点以上必要です。`);
  if (!Array.isArray(points)) return;

  let prevTick = -1;
  for (const [index, point] of points.entries()) {
    assert(Number.isInteger(point.tick) && point.tick >= 0, filePath, `${note.id}.points[${index}]: tick が不正です。`);
    assert(point.tick >= prevTick, filePath, `${note.id}: points が tick 昇順ではありません。`);
    prevTick = point.tick;
    validateBounds(filePath, `${note.id}.points[${index}]`, point, layout);

    if (note.type === "fader_hold") {
      assert(Math.abs(point.right - point.left - 1) < 0.0001, filePath, `${note.id}.points[${index}]: fader_hold は幅1固定です。`);
    }
  }
}

function validateHoneycomb(filePath, note, layout) {
  assert(note.layer === "main", filePath, `${note.id}: honeycomb の layer は main である必要があります。`);
  assert(Array.isArray(note.nodes) && note.nodes.length >= 1, filePath, `${note.id}: nodes は1点以上必要です。`);
  if (!Array.isArray(note.nodes)) return;

  let prevTick = -1;
  for (const [index, node] of note.nodes.entries()) {
    assert(Number.isInteger(node.tick) && node.tick >= 0, filePath, `${note.id}.nodes[${index}]: tick が不正です。`);
    assert(node.tick >= prevTick, filePath, `${note.id}: nodes が tick 昇順ではありません。`);
    prevTick = node.tick;
    validateBounds(filePath, `${note.id}.nodes[${index}]`, node, layout);
  }

  for (const [index, connection] of (note.connections ?? []).entries()) {
    assert(connection.from_index >= 0 && connection.from_index < note.nodes.length, filePath, `${note.id}.connections[${index}]: from_index が不正です。`);
    assert(connection.to_index >= 0 && connection.to_index < note.nodes.length, filePath, `${note.id}.connections[${index}]: to_index が不正です。`);
  }
}

function validateBounds(filePath, label, item, layout) {
  if (!layout) return;
  assert(Number.isFinite(item.left) && Number.isFinite(item.right), filePath, `${label}: left/right は数値である必要があります。`);
  assert(item.left >= layout.x_min, filePath, `${label}: left が範囲外です: ${item.left}`);
  assert(item.right <= layout.x_max, filePath, `${label}: right が範囲外です: ${item.right}`);
  assert(item.left < item.right, filePath, `${label}: left < right を満たしていません。`);
}

function validateSections(filePath, sections) {
  const ids = new Set();
  for (const section of sections) {
    assert(Boolean(section.id), filePath, "section.id がありません。");
    if (section.id) {
      assert(!ids.has(section.id), filePath, `section.id が重複しています: ${section.id}`);
      ids.add(section.id);
    }
    assert(Number.isInteger(section.start_tick) && section.start_tick >= 0, filePath, `${section.id}: start_tick が不正です。`);
    assert(Number.isInteger(section.end_tick) && section.end_tick > section.start_tick, filePath, `${section.id}: end_tick が不正です。`);
  }
}

function validateTags(filePath, tags) {
  for (const tag of tags) {
    assert(Boolean(tag.type), filePath, "tag.type がありません。" );
    assert(Number.isInteger(tag.weight) && tag.weight >= 1 && tag.weight <= 5, filePath, `${tag.type}: weight は1〜5です。`);
  }
}

function assert(condition, filePath, message) {
  if (!condition) {
    errors.push(`${filePath}: ${message}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
