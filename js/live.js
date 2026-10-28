// くみあわせ：みんなで入れる（くらぶボットの「🏆 大会」。q-qlove-bot の lib/55_tournament.gs）。画面には触らない（テストで呼ぶ）
// app.js から読む（import）
//
// つながなければ、これまでどおり端末の中だけで動く（オフラインでも使える）。つないだ大会（t.live）だけ、点を1試合ずつボットに送り、
// ほかの端末が入れた点を読みなおす（🔄 更新・開いているあいだは自動）。電波がないときは端末にためておき（t.live.pending）、つながったら送る。
//
// 合言葉（docs/security.md の W7）：URL にも localStorage にも残さない。生の合言葉は送らない。
//   入力の合言葉 → PBKDF2（SHA-256・塩 "qumiawase:" + 大会の番号・10万回・32バイト）。ジェンダーリビールと同じ考え
//   運営の合言葉 → SHA-256("qumiawase:admin:" + 合言葉)（ボットのスクリプト プロパティにあるものとくらべる）
//   できた key は、そのタブの sessionStorage にだけ置く（タブを閉じれば消える。読みこみなおしでは聞きなおさない）
import { cleanTournament, isObj, resultIn } from "./store.js?v=202610282229";

// くらぶボットの URL（GAS のウェブアプリ …/exec だけ。Q キットの shared/qlove-bot.js と同じ形）
const BOT_URL = /^https:\/\/script\.google\.com\/(?:a\/[A-Za-z0-9.-]+\/)?macros\/s\/[A-Za-z0-9_-]{20,120}\/exec$/;
const LIVE_ID = /^[0-9a-f]{20}$/;
const TIMEOUT_MS = 15000;
export const PASS_MIN = 4;
export const PASS_MAX = 40;
export const PENDING_MAX = 300;

// くらぶボットの URL として使える形なら、その URL。ちがえば ""
export const botUrlIn = (v) => (BOT_URL.test(String(v || "").trim()) ? String(v).trim() : "");
// 大会の番号として使える形か
export const liveIdIn = (v) => (LIVE_ID.test(String(v || "")) ? String(v) : "");

// 新しい大会の番号（20けたの16進数。推測できないように crypto で）
export function newLiveId(cryptoObj = globalThis.crypto) {
  const bytes = cryptoObj.getRandomValues(new Uint8Array(10));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

// 入力の合言葉 → key（PBKDF2）
export async function inputKey(id, pass, subtle = globalThis.crypto.subtle) {
  const base = await subtle.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveBits"]);
  return hex(await subtle.deriveBits({ name: "PBKDF2", salt: new TextEncoder().encode(`qumiawase:${id}`), iterations: 100000, hash: "SHA-256" }, base, 256));
}

// 運営の合言葉 → key（SHA-256）
export async function adminKey(pass, subtle = globalThis.crypto.subtle) {
  return hex(await subtle.digest("SHA-256", new TextEncoder().encode(`qumiawase:admin:${pass}`)));
}

// 見る・入れる人に送るリンク（?live=番号&bot=ボットの URL）。合言葉は入れない
export function liveUrl(live, base) {
  const u = new URL(base);
  u.search = "";
  u.hash = "";
  u.searchParams.set("live", live.id);
  u.searchParams.set("bot", live.bot);
  return u.toString();
}

// URL の ?live=…&bot=… を読む。形がちがえば null
export function readLive(search) {
  const q = new URLSearchParams(search || "");
  const id = liveIdIn(q.get("live"));
  const bot = botUrlIn(q.get("bot"));
  return id && bot ? { id, bot } : null;
}

// t.live の形を確かめる（{ id, bot, version, pending: [{ mid, result?, ref? }], at（最後に読んだ時刻） }）。だめなら null
export function liveIn(v) {
  if (!isObj(v)) return null;
  const id = liveIdIn(v.id);
  const bot = botUrlIn(v.bot);
  if (!id || !bot) return null;
  const pending = (Array.isArray(v.pending) ? v.pending : []).map(opIn).filter(Boolean).slice(-PENDING_MAX);
  return { id, bot, version: Number.isInteger(v.version) && v.version >= 0 ? v.version : 0, pending, at: Number(v.at) || 0 };
}

// 送るのを待っている1つ（その試合の結果か審判）の形を確かめる
function opIn(op) {
  if (!isObj(op) || !/^[A-Za-z0-9-]{1,16}$/.test(String(op.mid))) return null;
  const out = { mid: String(op.mid) };
  if ("result" in op) out.result = op.result === null ? null : resultIn(op.result);
  if ("ref" in op) out.ref = typeof op.ref === "string" && /^[A-Za-z0-9_-]{0,24}$/.test(op.ref) ? op.ref : "";
  if (out.result === undefined && out.ref === undefined) return null;
  if ("result" in op && op.result !== null && !out.result) return null;
  return out;
}

// 待っているものに足す（同じ試合の同じ種類は、あとのほうだけ残す）
export function queue(pending, op) {
  const clean = opIn(op);
  if (!clean) return pending;
  const kind = "result" in clean ? "result" : "ref";
  const rest = pending.filter((p) => !(p.mid === clean.mid && kind in p));
  return [...rest, clean].slice(-PENDING_MAX);
}

// 待っているものを、大会（結果・審判）にかさねる（ボットから読んだ中身に、まだ送れていない自分の入力をのせる）
export function overlay(t, pending) {
  const results = { ...t.results };
  const referees = { ...t.referees };
  for (const op of pending) {
    if ("result" in op) {
      if (op.result) results[op.mid] = op.result;
      else delete results[op.mid];
    }
    if ("ref" in op) {
      if (op.ref) referees[op.mid] = op.ref;
      else delete referees[op.mid];
    }
  }
  return { ...t, results, referees };
}

/**
 * ボットから読んだ中身（data）を、この端末の大会にする。id・作った時刻・つないだ印（live）はこの端末のまま。
 * keepPlan なら（運営がまだ送っていない組み合わせの書きかえがあるとき）、チーム・形・時間はこの端末のまま、結果と審判だけ読む
 */
export function fromServer(local, data, version, { keepPlan = false } = {}) {
  const got = cleanTournament(data);
  if (!got) return null;
  const base = keepPlan ? { ...local, results: got.results, referees: got.referees } : { ...got, id: local.id, createdAt: local.createdAt };
  const live = { ...local.live, version, at: Date.now() };
  return { ...overlay(base, live.pending), live, updatedAt: Date.now() };
}

// ボットへ送る中身（大会から、この端末だけのもの（id・live・時刻）を外す）
export function toServer(t) {
  const { id, live, createdAt, updatedAt, ...rest } = t;
  return rest;
}

// くらぶボットを呼ぶ（text/plain で送る：GAS は CORS の下見に答えられない）。{ ok, … }。つながらなければ { ok: false, error: "net" }
export async function liveCall(bot, action, payload = {}, fetchFn = globalThis.fetch) {
  const url = botUrlIn(bot);
  if (!url) return { ok: false, error: "nourl" };
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), TIMEOUT_MS) : null;
  try {
    const res = await fetchFn(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ app: "qlove", v: 1, tool: "qumiawase", action, ...payload }),
      signal: ctrl ? ctrl.signal : undefined,
      credentials: "omit",
      referrerPolicy: "no-referrer"
    });
    const json = await res.json();
    return isObj(json) && typeof json.ok === "boolean" ? json : { ok: false, error: "bad" };
  } catch {
    return { ok: false, error: "net" };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ボットの返事の error を、やさしい言葉に
export const LIVE_ERRORS = {
  net: "つながりませんでした。電波のよいところで、もう一度ためしてね（入れた点は、この端末にためてあります）",
  pass: "合言葉がちがいます",
  many: "合言葉を何回もまちがえたので、10分ほど待ってからためしてね",
  off: "くらぶボットに運営の合言葉がまだありません（ボットを作った人が、スクリプト プロパティ TOURNAMENT_ADMIN_KEY に書きます）",
  auth: "くらぶボットに「🏆 大会」の機能がないか、切ってあります（ボットのライブラリの版を上げてね）",
  none: "この大会は、くらぶボットにありません（消されたかもしれません）",
  full: "くらぶボットに置ける大会の数（50件）をこえました。ボットのシート「大会」から古いものを消してね",
  stale: "ほかの人が先に書きかえました。読みなおしてから、もう一度送ります",
  bad: "送った中身の形がちがいました",
  fail: "うまくいきませんでした。時間をおいて、もう一度ためしてね",
  nourl: "くらぶボットの URL がありません"
};
export const liveError = (res) => LIVE_ERRORS[res && res.error] || LIVE_ERRORS.fail;

// そのタブだけに置く key（{ role: "admin" | "input", key }）。読めなければ null
export function sessionKey(id, storage = globalThis.sessionStorage) {
  try {
    const v = JSON.parse(storage.getItem(`qumiawase:key:${id}`) || "null");
    return isObj(v) && ["admin", "input"].includes(v.role) && /^[0-9a-f]{64}$/.test(v.key) ? v : null;
  } catch {
    return null;
  }
}
export function setSessionKey(id, value, storage = globalThis.sessionStorage) {
  try {
    if (value) storage.setItem(`qumiawase:key:${id}`, JSON.stringify(value));
    else storage.removeItem(`qumiawase:key:${id}`);
  } catch {
    // 置けない端末では、ページを開いているあいだだけ（app.js が覚える）
  }
}
