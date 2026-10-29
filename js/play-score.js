// くみあわせ：試合の小さな部品（チームの色の丸・点の − 数 ＋・終わったか・PK を入れるか・いつ）と、点を入れる・消す・試合の表のその試合へ動く
// js/play-matches.js・js/play-tables.js・js/play-team.js から読む（import）
import { LIMITS } from "./settings.js?v=202610291801";
import { isDone } from "./stats.js?v=202610291801";
import { clone, esc, toast } from "./dom.js?v=202610291801";
import { current, page, persist, teamById, ui, view } from "./state.js?v=202610291801";

// チーム別で選んでいるチーム（順位表・トーナメント表でも目立たせる。チーム別でないときは ""）
export const mine = () => (view.mode === "team" ? view.team : "");

// チームの色の丸の HTML を返す（チームが決まっていなければ空の丸）
export const dotHtml = (id) => `<i class="dot" style="background:${esc(teamById(id)?.color || "transparent")}"></i>`;

// 点の − 数 ＋（まだ入れていないときは「–」。押すと 0 から入る）の HTML を返す
export function scoreHtml(mid, kind, k, value, label) {
  const shown = value === null ? "–" : value;
  return `<div class="score-stepper ${value === null ? "is-empty" : ""}"><button type="button" data-score="${kind}" data-k="${k}" data-d="-1" data-mid="${esc(mid)}" aria-label="${esc(label)}をへらす">−</button><output><button type="button" class="score-now" data-score="${kind}" data-k="${k}" data-d="0" data-mid="${esc(mid)}" aria-label="${esc(label)}（いま ${shown}）">${shown}</button></output><button type="button" data-score="${kind}" data-k="${k}" data-d="1" data-mid="${esc(mid)}" aria-label="${esc(label)}をふやす">＋</button></div>`;
}

// その試合は終わったか（PK で決める試合の同点は、PK が決まってから）
export const doneOf = (t, m) => isDone(m, t.results[m.id], t.points);
// その試合で PK を入れるか（トーナメントと、PK をする総当たり）
export const pkAllowed = (t, m) => m.stage === "ko" || m.stage === "third" || Boolean(t.points.pk);
// PK の − 数 ＋（左右のチームの下にそろえる）
export const pkStepsHtml = (m, res) =>
  `<div class="pk-steppers">${scoreHtml(m.id, "pk", 0, res.pk ? res.pk[0] : null, "ホームの PK")}<span class="match-vs" aria-hidden="true">-</span>${scoreHtml(m.id, "pk", 1, res.pk ? res.pk[1] : null, "アウェイの PK")}</div>`;
// 試合のいつ（「10:40・コート2」。時刻を入れていなければ「第5試合」）
export const whenText = (c, m) => {
  const s = c.timeOf[m.id];
  if (s) return `${s.time}${c.t.sched.courts > 1 ? `・コート${s.court}` : ""}`;
  return c.numberOf[m.id] ? `第${c.numberOf[m.id]}試合` : "";
};

/**
 * 点を変える。kind は "s"（点）か "pk"、k は 0（ホーム）か 1（アウェイ）、d は −1・＋1・0（「–」を押したとき：0 から入れる）
 */
export function setScore(mid, kind, k, d) {
  const t = current();
  const res = t.results[mid] ? clone(t.results[mid]) : { s: [0, 0] };
  if (kind === "pk") res.pk = res.pk || [0, 0];
  const list = res[kind];
  list[k] = Math.min(LIMITS.score, Math.max(0, list[k] + d));
  if (res.s[0] !== res.s[1]) delete res.pk; // 同点でなくなったら PK はいらない
  t.results[mid] = res;
  persist();
  ui.renderResults();
}

// 試合の結果を消す（「元に戻す」で戻せる）
export function clearScore(mid) {
  const t = current();
  const before = t.results[mid];
  delete t.results[mid];
  persist();
  ui.renderResults();
  toast("結果を消しました", () => {
    current().results[mid] = before;
    persist();
    ui.renderResults();
  });
}

// 総当たり表のマスから、試合の表のその試合へ動く（少しのあいだ光らせる）
export function gotoMatch(id) {
  page.now = "play";
  page.play = "matches";
  view.mode = "order";
  ui.renderPage();
  ui.renderResults();
  const el = document.querySelector(`#matches .match[data-mid="${CSS.escape(id)}"]`);
  if (!el) return;
  el.closest("details")?.setAttribute("open", "");
  // タブを切りかえたあとなので、なめらかにせず、すぐその位置へ
  window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 90 });
  el.classList.add("is-flash");
  setTimeout(() => el.classList.remove("is-flash"), 1600);
}
