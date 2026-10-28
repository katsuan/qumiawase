// くみあわせ：大会をこの端末（localStorage）に残す・読む。読むときは1つずつ形を確かめる（壊れた中身・前の版でも止まらない）
// app.js・js/link.js から読む（import）
//
// 大会の形：{ id, name, createdAt, updatedAt, teams: [{ id, name, color }], format, opts: { thirdPlace, legs, groups, advance },
//            rules（大会要項。長い文）, points: { win, draw, loss, pk（総当たりも同点なら PK）, pkWin, pkLoss }, rank（順位の決め方：勝ち点のあとの並び。gd・gf・h2h）, sched: { on（時刻を入れる）, date, start, courts, minutes, place, avoid（連続試合を避ける）, rest（同じチームの空き時間・分） },
//            results: { 試合の id: { s, pk? } }, referees: { 試合の id: 審判のチームの id } }
import { DEFAULT_POINTS, LIMITS, PRESETS, TEAM_COLORS, TOOL } from "./settings.js?v=202610282234";
import { DEFAULT_RANK, rankIn } from "./stats.js?v=202610282234";
import { liveIn } from "./live.js?v=202610282234"; // つないだ大会の印（関数の中でだけ使う）

export const STORE_KEY = `${TOOL.key}:tournaments`; // { list: [大会…], current: いま開いている大会の id }
export const INBOX_KEY = `${TOOL.key}:inbox`; // さくせん盤から戻ってきた結果（同じ端末のとき）

// ふつうのオブジェクトか（null・並びでない）を返す
export const isObj = (v) => Boolean(v) && typeof v === "object" && !Array.isArray(v);
// 文字（か数）なら max 字までの文字にして返す。ちがえば ""
export const textIn = (v, max) => (typeof v === "string" || typeof v === "number" ? [...String(v)].slice(0, max).join("").trim() : "");
// 長い文（改行あり）：max 字まで。改行とタブのほかの見えない文字は消す。行の終わりの空白も消す
export const longTextIn = (v, max) => (typeof v === "string" ? [...v.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").replace(/[ \t]+$/gm, "")].slice(0, max).join("").trim() : "");
// min〜max の整数にして返す。数でなければ fallback
export const intIn = (v, min, max, fallback) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && v !== "" && v !== null ? Math.min(max, Math.max(min, n)) : fallback;
};
// #rrggbb の色なら小文字にして返す。ちがえば ""
export const hexIn = (v) => (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : "");
// "YYYY-MM-DD" ならそのまま、ちがえば ""
const dateIn = (v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "");
// "HH:MM" ならそのまま、ちがえば ""
const timeIn = (v) => (typeof v === "string" && /^\d{2}:\d{2}$/.test(v) ? v : "");

// 見分けの ID（prefix つき）を返す
export const newId = (prefix) => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// i 番目のチームのはじめの色（さくせん盤と同じ8色を順に）を返す
export const colorAt = (i) => TEAM_COLORS[i % TEAM_COLORS.length].hex;

// 空の大会（チーム4つ・トーナメント）を作って返す
export function blankTournament(name = "") {
  const now = Date.now();
  return {
    id: newId("q"),
    name: name || "",
    createdAt: now,
    updatedAt: now,
    teams: Array.from({ length: 4 }, (_, i) => ({ id: `t${i + 1}`, name: "", color: colorAt(i) })),
    preset: "", // 試合の種類（PRESETS の key。"" は自分で決めた）
    format: "knockout",
    opts: { thirdPlace: false, legs: 1, groups: 2, advance: 2 },
    points: { ...DEFAULT_POINTS },
    rank: [...DEFAULT_RANK], // 順位の決め方（勝ち点のあと）
    sched: { on: false, date: "", start: "09:00", courts: 1, minutes: 20, place: "", avoid: true, rest: 10 },
    results: {},
    referees: {} // 審判（試合の id → チームの id）
  };
}

// 結果1つ（{ s: [a, b], pk?: [a, b] }）の形を確かめて返す。ちがえば null
export function resultIn(v) {
  if (!isObj(v) || !Array.isArray(v.s) || v.s.length !== 2) return null;
  const s = v.s.map((n) => intIn(n, 0, LIMITS.score, null));
  if (s.includes(null)) return null;
  const pk = Array.isArray(v.pk) && v.pk.length === 2 ? v.pk.map((n) => intIn(n, 0, LIMITS.score, null)) : null;
  return pk && !pk.includes(null) ? { s, pk } : { s };
}

// 大会1つの形を確かめ、使える形にして返す（形がちがうところは初めの値に）。大会でなければ null
export function cleanTournament(v) {
  if (!isObj(v)) return null;
  const base = blankTournament();
  const seen = new Set();
  const teams = (Array.isArray(v.teams) ? v.teams : [])
    .filter(isObj)
    .slice(0, LIMITS.teams)
    .map((t, i) => {
      let id = textIn(t.id, 24) || `t${i + 1}`;
      while (seen.has(id)) id = `${id}x`;
      seen.add(id);
      return { id, name: textIn(t.name, LIMITS.name), color: hexIn(t.color) || colorAt(i) };
    });
  const opts = isObj(v.opts) ? v.opts : {};
  const points = isObj(v.points) ? v.points : {};
  const sched = isObj(v.sched) ? v.sched : {};
  const results = {};
  if (isObj(v.results)) {
    for (const [id, r] of Object.entries(v.results).slice(0, 2000)) {
      const ok = resultIn(r);
      if (ok && /^[A-Za-z0-9-]{1,16}$/.test(id)) results[id] = ok;
    }
  }
  const teamIds = new Set((teams.length ? teams : base.teams).map((x) => x.id));
  const referees = {};
  if (isObj(v.referees)) {
    for (const [id, team] of Object.entries(v.referees).slice(0, 2000)) if (/^[A-Za-z0-9-]{1,16}$/.test(id) && teamIds.has(team)) referees[id] = team;
  }
  return {
    id: textIn(v.id, 40) || base.id,
    name: textIn(v.name, LIMITS.title),
    rules: longTextIn(v.rules, LIMITS.rules), // 大会要項
    createdAt: Number(v.createdAt) || base.createdAt,
    updatedAt: Number(v.updatedAt) || base.updatedAt,
    teams: teams.length ? teams : base.teams,
    preset: PRESETS.some((p) => p.key === v.preset) ? v.preset : "",
    format: ["knockout", "league", "groups"].includes(v.format) ? v.format : "knockout",
    opts: {
      thirdPlace: opts.thirdPlace === true,
      legs: opts.legs === 2 ? 2 : 1,
      groups: intIn(opts.groups, 1, 16, 2),
      advance: intIn(opts.advance, 1, 16, 2)
    },
    points: { win: intIn(points.win, 0, 9, 3), draw: intIn(points.draw, 0, 9, 1), loss: intIn(points.loss, 0, 9, 0), pk: points.pk === true, pkWin: intIn(points.pkWin, 0, 9, 2), pkLoss: intIn(points.pkLoss, 0, 9, 1) },
    rank: rankIn(v.rank),
    sched: {
      on: sched.on === true,
      date: dateIn(sched.date),
      start: timeIn(sched.start) || "09:00",
      courts: intIn(sched.courts, 1, LIMITS.courts, 1),
      minutes: intIn(sched.minutes, 1, LIMITS.minutes, 20),
      place: textIn(sched.place, LIMITS.place),
      avoid: sched.avoid !== false,
      rest: intIn(sched.rest, 0, LIMITS.minutes, 10)
    },
    results,
    referees,
    // みんなで入れる（くらぶボット）につないだ大会だけ。つないでいなければ付けない
    ...(liveIn(v.live) ? { live: liveIn(v.live) } : {})
  };
}

// 端末に残った大会の一覧を読む。{ list, current } を返す（なければ空の大会を1つ）
export function loadAll(storage = globalThis.localStorage) {
  let raw = null;
  try {
    raw = JSON.parse(storage.getItem(STORE_KEY));
  } catch {
    raw = null;
  }
  const list = (isObj(raw) && Array.isArray(raw.list) ? raw.list : []).map(cleanTournament).filter(Boolean).slice(0, LIMITS.tournaments);
  const ids = new Set();
  const unique = list.filter((t) => !ids.has(t.id) && ids.add(t.id));
  if (!unique.length) unique.push(blankTournament());
  const current = unique.some((t) => t.id === raw?.current) ? raw.current : unique[0].id;
  return { list: unique, current };
}

// 大会の一覧を端末に残す。残せたら true（容量いっぱい・プライベートのときは false。止めない）
export function saveAll(data, storage = globalThis.localStorage) {
  try {
    storage.setItem(STORE_KEY, JSON.stringify({ list: data.list, current: data.current }));
    return true;
  } catch {
    return false;
  }
}

// さくせん盤から戻ってきた結果（同じ端末）を全部とり出して返す（とり出したら消す）。[{ tid, mid, s, pk? }]
export function takeInbox(storage = globalThis.localStorage) {
  let list = [];
  try {
    const raw = JSON.parse(storage.getItem(INBOX_KEY));
    list = Array.isArray(raw) ? raw : [];
    storage.removeItem(INBOX_KEY);
  } catch {
    list = [];
  }
  return list
    .filter(isObj)
    .map((x) => ({ tid: textIn(x.tid, 40), mid: textIn(x.mid, 16), ...(resultIn(x) || {}) }))
    .filter((x) => x.tid && x.mid && Array.isArray(x.s));
}
