// くみあわせ：いまの大会と、画面のあいだで分けあうもの（端末の大会・見る人用のリンクの大会・役割・ページと見方）、残す・変える（元に戻す）・計算（組み合わせ・日程・勝ち上がり）
// app.js と js/ の画面の部品から読む（import）。描きなおし・送るのは ui（app.js が起動のときに入れる）を通して呼ぶ（部品どうしが読み合わないように）
import { addMinutes, adjustTimes, fitOptions, generate, timeSchedule } from "./pairing.js?v=202610291808";
import { estimate, resolve } from "./stats.js?v=202610291808";
import { loadAll, saveAll } from "./store.js?v=202610291808";
import { readView } from "./link.js?v=202610291808";
import { sessionKey } from "./live.js?v=202610291808";
import { clone, toast } from "./dom.js?v=202610291808";

// 上の段の描きなおしと、残したあとのこと（app.js が init の前に入れる）
export const ui = { renderAll() {}, renderResults() {}, renderPage() {}, afterSave() {} };

export const data = loadAll(); // { list: [大会…], current: いまの大会の id }（この端末）
export let viewing = readView(location.search); // 見る人用のリンクで開いた大会（この端末に保存するまで、ここだけ）
// 見る人用のリンクの大会を変える（この端末に保存したら null）
export function setViewing(v) {
  viewing = v;
}
let warnedSave = false; // 端末に残せなかったことを、もう知らせたか

// みんなで入れる（くらぶボット）：合言葉から作った key。sessionStorage に置けない端末のために、開いているあいだもここに覚える
export const liveKeys = {};
// つないだ大会での、この端末の役割（"admin"＝運営・"input"＝入力の人・""＝見るだけ）。つないでいなければ null
export function liveRole(t = current()) {
  if (!t || !t.live || viewing) return null;
  return (sessionKey(t.live.id) || liveKeys[t.live.id] || {}).role || "";
}
// 点・審判を入れられないか（見る人用のリンク・つないだ大会で合言葉をまだ入れていない）
export const readOnly = () => Boolean(viewing) || liveRole() === "";
// 準備（チーム・形・時間）を変えられないか（つないだ大会で運営でない）
export const planLocked = () => liveRole() !== null && liveRole() !== "admin";

// いま画面に出している大会を返す（見る人用のリンクで開いたときは、その大会）
export function current() {
  return viewing || data.list.find((t) => t.id === data.current) || data.list[0];
}

// いまの大会を端末に残す（見るだけのときは残さない。残せなかったら1回だけ知らせる）
export function persist() {
  if (viewing) return;
  current().updatedAt = Date.now();
  if (!saveAll(data) && !warnedSave) {
    warnedSave = true;
    toast("この端末に残せませんでした（空きがない・プライベートブラウズなど）。閉じると消えます");
  }
  ui.afterSave();
}

// 組み合わせが変わる元（チームの並び・形・設定）を1つの文字にして返す。変わったら、入れた結果は使えない
const structureKey = (t) => JSON.stringify([t.teams.map((x) => x.id), t.format, fitOptions(t.teams.length, t.opts)]);

/**
 * 大会を変える（fn の中で変える）。組み合わせが変わって結果が入っていたら、結果を消して「元に戻す」を出す。
 * message を渡すと、組み合わせが変わらなくても「元に戻す」つきで知らせる
 */
export function change(fn, message = "") {
  const t = current();
  const before = clone(t);
  const key = structureKey(t);
  fn(t);
  const changed = structureKey(t) !== key;
  const lost = Object.keys(t.results).length > 0 && changed;
  if (lost) t.results = {};
  if (changed) {
    t.referees = {}; // 組み合わせが変わったら、審判も入れなおし
    t.timeFix = {}; // 手で直した時刻も（試合が変わるため）
  }
  persist();
  ui.renderAll();
  // 元に戻す：変える前の大会にもどす
  const undo = () => {
    Object.assign(current(), before);
    persist();
    ui.renderAll();
  };
  if (lost) toast(`${message ? `${message}。` : ""}組み合わせが変わったので、入れた結果を消しました`, undo);
  else if (message) toast(message, undo);
}

// ---- 計算（組み合わせ・日程・勝ち上がり） ----

/**
 * いまの大会の組み合わせ・時間の割りふり・勝ち上がり・見こみをまとめて返す。
 * { t, gen, plan（試合の順・コート・はじまりからの分。時刻を入れるときは time も）, sched（時刻を入れるときだけ plan、ほかは null）, timeOf, numberOf（何試合目）, resolved, est（見こみ） }
 */
export function compute() {
  const t = current();
  const gen = generate(t.teams, t.format, t.opts);
  const s = t.sched;
  // 自動で決めた時刻に、手で直した時刻と遅れをのせる（時刻を入れているときだけ）
  let auto = timeSchedule(gen.matches, { courts: s.courts, minutes: s.minutes, rest: s.rest, avoid: s.avoid });
  if (s.on) auto = adjustTimes(auto, { start: s.start, minutes: s.minutes, courts: s.courts, fix: t.timeFix || {}, delays: t.delays || [] });
  const plan = auto.map((p) => (s.on ? { ...p, time: addMinutes(s.start, p.start) } : p));
  const sched = s.on && plan.length ? plan : null;
  const timeOf = Object.fromEntries((sched || []).map((p) => [p.id, p]));
  const numberOf = Object.fromEntries(plan.map((p, i) => [p.id, i + 1]));
  const resolved = resolve(gen, t.teams.map((x) => x.id), t.results, t.points, t.rank);
  return { t, gen, plan, sched, timeOf, numberOf, resolved, est: estimate(gen, plan) };
}

// いま開いているページ（"prep"＝準備・"play"＝試合）と、試合のページで見せる中身（"matches"・"standings"・"bracket"）
export const page = { now: "", play: "matches" };

// 試合表の見方（"order"＝順番・"court"＝コート別・"team"＝チーム別）と、チーム別で選んでいるチーム
export const view = { mode: "order", team: "" };

// チームを id で探して返す
export const teamById = (id) => current().teams.find((x) => x.id === id);
