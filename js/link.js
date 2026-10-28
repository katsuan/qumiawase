// くみあわせ：URL の受け渡し。見る人用のリンク（大会の中身を URL にのせる。サーバーなし）・さくせん盤やろくがで開くリンク・
// さくせん盤から結果を戻すリンク。中身は JSON → UTF-8 → base64url。受けとるときは形を確かめる
// app.js・js/card.js から読む（import）
import { LIMITS, QRONOS_URL, ROQGA_URL, SAQSEN_URL, TOOL } from "./settings.js?v=202610281310";
import { cleanTournament, hexIn, intIn, isObj, resultIn, textIn } from "./store.js?v=202610281310";

// LINE のリンクは 1000 文字まで
export const LINK_MAX = 1000;

// 中身を JSON → UTF-8 → base64url の文字にして返す
export function encode(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// base64url の文字から中身にもどして返す。読めないときは null
export function decode(text) {
  if (!text || typeof text !== "string" || text.length > 20000) return null;
  try {
    const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0))));
  } catch {
    return null;
  }
}

const FORMAT_CODES = { knockout: "k", league: "l", groups: "g" };
// 色を URL に入れる短い形（"#22a447" → "22a447"）にして返す
const shortHex = (hex) => String(hex || "").replace(/^#/, "");

/**
 * 見る人用のリンクにのせる中身（短い形）を返す。チームの id はのせない（並びの順で t1・t2…）。試合の id はチームの id によらないので、結果はそのまま
 * { v, n, f, o: [3位決定戦, 回数, グループ数, 上がる数], p: [勝, 分, 負], s: [時刻を入れる, 日にち, はじまり, コート数, 分, 会場, 連続試合を避ける, 空き時間], t: [[名前, 色], …], r: [[試合の id, 点, 点, PK, PK], …], j: [[試合の id, 審判のチームの並びの番号], …] }
 */
export function packTournament(t) {
  return {
    v: 1,
    n: t.name,
    f: FORMAT_CODES[t.format] || "k",
    o: [t.opts.thirdPlace ? 1 : 0, t.opts.legs, t.opts.groups, t.opts.advance],
    p: [t.points.win, t.points.draw, t.points.loss],
    s: [t.sched.on ? 1 : 0, t.sched.date, t.sched.start, t.sched.courts, t.sched.minutes, t.sched.place, t.sched.avoid ? 1 : 0, t.sched.rest],
    t: t.teams.map((team) => [team.name, shortHex(team.color)]),
    r: Object.entries(t.results).map(([id, r]) => [id, ...r.s, ...(r.pk || [])]),
    j: Object.entries(t.referees || {}).map(([id, team]) => [id, t.teams.findIndex((x) => x.id === team)]).filter(([, i]) => i >= 0)
  };
}

// 見る人用のリンクの中身（packTournament の形）から大会にもどして返す（形を確かめる）。読めなければ null
export function unpackTournament(data) {
  if (!isObj(data) || !Array.isArray(data.t) || !data.t.length) return null;
  const format = Object.keys(FORMAT_CODES).find((k) => FORMAT_CODES[k] === data.f) || "knockout";
  const o = Array.isArray(data.o) ? data.o : [];
  const p = Array.isArray(data.p) ? data.p : [];
  const s = Array.isArray(data.s) ? data.s : [];
  const results = {};
  for (const row of Array.isArray(data.r) ? data.r.slice(0, 2000) : []) {
    if (!Array.isArray(row)) continue;
    const r = resultIn({ s: row.slice(1, 3), ...(row.length >= 5 ? { pk: row.slice(3, 5) } : {}) });
    if (r) results[String(row[0])] = r;
  }
  const referees = {};
  for (const row of Array.isArray(data.j) ? data.j.slice(0, 2000) : []) if (Array.isArray(row) && Number.isInteger(row[1])) referees[String(row[0])] = `t${row[1] + 1}`;
  return cleanTournament({
    name: data.n,
    teams: data.t.filter(Array.isArray).slice(0, LIMITS.teams).map(([name, color], i) => ({ id: `t${i + 1}`, name, color: hexIn(`#${color}`) })),
    format,
    opts: { thirdPlace: o[0] === 1, legs: o[1], groups: o[2], advance: o[3] },
    points: { win: p[0], draw: p[1], loss: p[2] },
    sched: { on: s[0] === 1, date: s[1], start: s[2], courts: s[3], minutes: s[4], place: s[5], avoid: s[6] !== 0, rest: s[7] },
    results,
    referees
  });
}

// 見る人用のリンク（くみあわせの URL ＋ ?view=中身）を返す
export function viewUrl(t, base = TOOL.url) {
  return `${base}?view=${encode(packTournament(t))}`;
}

/**
 * さくせん盤で開くリンク：2チームの名前と色（と会場・日にち・時刻）と、結果を戻す先（大会の id・試合の id）。
 * home はさくせん盤の自チーム、away は相手。{ t, o, c, oc, w, d, tm, tid, mid } を ?match= にのせる
 */
export function saqsenUrl({ home, away, place = "", date = "", time = "", tid, mid }) {
  return `${SAQSEN_URL}?match=${encode({ t: home.name, o: away.name, c: home.color, oc: away.color, w: place, d: date, tm: time, tid, mid })}`;
}

// ろくがで開くリンク：2チームの名前と色（左＝home・右＝away）を ?match= にのせる
export function roqgaUrl({ home, away }) {
  return `${ROQGA_URL}?match=${encode({ t: home.name, o: away.name, c: home.color, oc: away.color })}`;
}

// さくせん盤から戻ってきた結果（?result= の中身）を読む。{ tid, mid, s, pk? } を返す。読めなければ null
export function readResult(text) {
  const data = decode(text);
  if (!isObj(data)) return null;
  const tid = textIn(data.tid, 40);
  const mid = textIn(data.mid, 16);
  const r = resultIn({ s: data.s, ...(data.pk ? { pk: data.pk } : {}) });
  return tid && mid && r ? { tid, mid, ...r } : null;
}

// 結果を戻すリンク（くみあわせの URL ＋ ?result=中身）を返す。さくせん盤の側でも同じ形で作る
export function resultUrl({ tid, mid, s, pk }, base = TOOL.url) {
  return `${base}?result=${encode({ tid, mid, s, ...(pk ? { pk } : {}) })}`;
}

// 見る人用のリンクの中身（?view=）を読み、大会にして返す。なければ null
export function readView(search) {
  const q = new URLSearchParams(search);
  return q.has("view") ? unpackTournament(decode(q.get("view"))) : null;
}

// 数（0〜max）に丸める（さくせん盤と同じ形で点を渡すときに使う）
export const scoreOf = (v) => intIn(v, 0, LIMITS.score, 0);

/**
 * くろのす（カウントダウン）のボードを開くリンクを返す：試合ごとの「あと◯分」を並べる（12件まで）。
 * entries は [{ at: "2026-11-03T09:30", title, emoji }]。くろのすの ?z= の形（項目は \x1f、行は \x1e でつなぎ、UTF-8 → base64url）。
 * 種類は u（その日まで）、日付は数字だけ（202611030930）。日時のある項目が1件もないときは null
 */
// くろのすで白い背景の上でも読める色にして返す（"#rrggbb" → "rrggbb"）。白・黄など明るい色は、読める濃さまで黒をまぜる。色でなければ ""
export function readableHex(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ""));
  if (!m) return "";
  let rgb = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  // 明るさ（相対輝度）。白との差が 3 倍（文字が読める目安）になるまで暗くする
  const lum = (c) => c.map((v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
  for (let k = 0; k < 20 && 1.05 / (lum(rgb) + 0.05) < 3; k++) rgb = rgb.map((v) => Math.round(v * 0.9));
  return rgb.map((v) => v.toString(16).padStart(2, "0")).join("");
}

export function qronosUrl(name, entries, link = null) {
  const clean = (v) => String(v ?? "").replace(/[\x1e\x1f]/g, " ").trim();
  const rows = entries
    .filter((e) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(e.at))
    .slice(0, 12)
    .map((e) => ["u", e.at.replace(/[-T:]/g, ""), clean(e.title).slice(0, 60), clean(e.emoji), readableHex(e.color)].join("\x1f").replace(/\x1f+$/, ""));
  if (!rows.length) return null;
  // 頭の行：[ボードの名前, 送る人, ひとこと, リンク, リンクの名前]（リンクはボード全体で1つ）
  const head = [clean(name).slice(0, 40), "", "", ...(link?.url ? [clean(link.url), clean(link.label).slice(0, 20)] : [])].join("\x1f").replace(/\x1f+$/, "");
  const bytes = new TextEncoder().encode([head, ...rows].join("\x1e"));
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return `${QRONOS_URL}?z=${btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
}
