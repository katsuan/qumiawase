// くみあわせ：試合の表（試合のカード・入力中の試合・審判・時刻を手で直す・⏱ 遅れ・時刻ごとのまとまり・コート別・チーム別）
// app.js から読む（import。描きなおしは renderMatches、ボタンと入力は bindMatches）
import { addMinutes, autoReferees, refereeOptions, roundName } from "./pairing.js?v=202610291801";
import { outcome } from "./stats.js?v=202610291801";
import { roqgaUrl, saqsenUrl } from "./link.js?v=202610291801";
import { matchTitle, sideLabel, teamName } from "./card.js?v=202610291801";
import { $, esc, toast } from "./dom.js?v=202610291801";
import { change, compute, current, liveRole, persist, planLocked, readOnly, teamById, ui, view, viewing } from "./state.js?v=202610291801";
import { clearScore, doneOf, dotHtml, pkAllowed, pkStepsHtml, scoreHtml, setScore, whenText } from "./play-score.js?v=202610291801";
import { KIND_LABEL, opponentLabel, refereeDuty, refereeDutyHtml, renderViewTools, teamPath } from "./play-team.js?v=202610291801";

// 時刻ごとのまとまりの開け閉め（見出し → 開いているか）。描きなおしても戻らないように
const slotOpen = new Map();

// 入力中の試合（1つだけ）。カードを押すと、その試合だけ − ＋・PK・審判・結果を消す・さくせん盤やろくがを出す。ふだんは点だけ
let activeMatch = "";

// 試合のカードを入力中にする／やめる（もう一度押すか、ほかのカードを押すと閉じる）
function toggleActive(mid) {
  activeMatch = activeMatch === mid ? "" : mid;
  ui.renderResults();
  const card = document.querySelector(`#matches .match[data-mid="${CSS.escape(mid)}"] .match-head`);
  card?.focus({ preventScroll: true });
}

// ⏱ 遅れ：次の試合（まだの、いちばん早い試合）から、まとめて後ろへ。どこからずらしたかを覚える（あとで結果を入れても戻らない）
function renderDelay(c) {
  const { t, plan } = c;
  const show = t.sched.on && !viewing && !planLocked() && plan.length > 0;
  $("delayBar").hidden = !show;
  if (!show) return;
  const total = (t.delays || []).reduce((n, d) => n + d.min, 0);
  const from = (t.delays || []).length ? addMinutes(t.sched.start, Math.min(...t.delays.map((d) => d.at))) : "";
  $("delayText").textContent = total ? `⏱ 遅れ ${total > 0 ? "+" : ""}${total}分（${from} の試合から）` : "⏱ 遅れ なし";
  $("delayClear").hidden = !total;
}

// 遅れを足す（d 分。マイナスで減らす）：次の試合の、遅れをのせる前の時刻から
function addDelay(d) {
  const c = compute();
  const t = c.t;
  const byId = Object.fromEntries(c.gen.matches.map((m) => [m.id, m]));
  const next = c.plan.find((p) => !byId[p.id].bye && c.resolved[p.id]?.home && c.resolved[p.id]?.away && !doneOf(t, byId[p.id])) || c.plan.find((p) => !doneOf(t, byId[p.id]));
  if (!next) return toast("まだの試合がありません");
  const at = next.start - next.late;
  // 遅れは「なし」より前にはしない（予定より早めることはしない）
  if ((t.delays || []).reduce((n, x) => n + x.min, 0) + d < 0) return toast("遅れがないので、これより早くはできません");
  const delays = [...(t.delays || [])].map((x) => ({ ...x }));
  const last = delays.at(-1);
  if (last && last.at === at) last.min += d;
  else delays.push({ at, min: d });
  t.delays = delays.filter((x) => x.min !== 0);
  persist();
  ui.renderResults();
}

// 試合1つのカード（見出し・時刻・2チームと点・PK・さくせん盤やろくがで開く）の HTML を返す
function matchHtml(c, m) {
  const { t, gen, timeOf, numberOf, resolved } = c;
  const r = resolved[m.id] || {};
  const res = t.results[m.id];
  const ready = Boolean(r.home && r.away);
  const s = timeOf[m.id];
  // 時刻ごとの見出しの下（順番の見方）では、時刻をくり返さない（コートだけ）
  const underTime = view.mode === "order" && s;
  // 手で直した（✏️）・遅れでずらした（⏱+分）・同じコートで重なる（⚠️）の印
  const marks = s ? `${s.fixed ? " ✏️" : ""}${s.late ? ` ⏱${s.late > 0 ? "+" : ""}${s.late}分` : ""}${s.clash ? " ⚠️重なり" : ""}` : "";
  const when = (underTime ? (t.sched.courts > 1 ? `コート${s.court}` : "") : whenText(c, m)) + marks;
  const done = doneOf(t, m);
  const next = c.next?.has(m.id);
  // 入力中のカードだけ、点を変えるボタンなどを出す
  const active = ready && !readOnly() && activeMatch === m.id;
  const o = outcome(res);
  const side = (sideDef, id, k) => {
    const name = id ? teamName(t, id) : sideLabel(sideDef, gen);
    const win = (o === "home" && k === 0) || (o === "away" && k === 1);
    const value = res ? res.s[k] : null;
    return `<div class="match-side ${id ? "" : "is-tbd"} ${win ? "is-win" : ""}">${dotHtml(id)}<span class="name">${esc(name)}</span>${active ? scoreHtml(m.id, "s", k, value, `${name}の点`) : `<b class="${value === null ? "is-empty" : ""}">${ready && value === null ? "–" : value ?? ""}</b>`}</div>`;
  };
  const pkRow =
    pkAllowed(t, m) && res && res.s[0] === res.s[1] ? `<div class="pk-row"><span>PK（同点のとき）</span>${active ? pkStepsHtml(m, res) : `<b>${res.pk ? `${res.pk[0]} - ${res.pk[1]}` : "–"}</b>`}</div>` : "";
  let actions = "";
  // 終わった試合は「結果を消す」を見出しの右に小さく（さくせん盤・ろくがは出さない）
  const clearBtn = active && done ? `<button class="ls-chip clear-chip" type="button" data-clear="${esc(m.id)}">結果を消す</button>` : "";
  if (active && !done) {
    const home = teamById(r.home);
    const away = teamById(r.away);
    const named = (x) => ({ name: teamName(t, x.id), color: x.color });
    const saqsen = saqsenUrl({ home: named(home), away: named(away), place: t.sched.on ? t.sched.place : "", date: t.sched.on ? t.sched.date : "", time: s?.time || "", tid: t.id, mid: m.id });
    actions = `<div class="match-actions">
      <a class="ls-chip" href="${esc(saqsen)}" target="_blank" rel="noopener">⚽ さくせん盤で開く</a>
      <a class="ls-chip" href="${esc(roqgaUrl({ home: named(home), away: named(away) }))}" target="_blank" rel="noopener">📹 ろくがで撮る</a>
      ${res ? `<button class="ls-chip" type="button" data-clear="${esc(m.id)}">結果を消す</button>` : ""}
    </div>`;
  }
  const badge = next ? `<span class="next-badge">▶ 次の試合</span>` : done ? `<span class="done-badge">✓ 終わり</span>` : "";
  // 点の行の下の審判：入力中は選ぶ欄、ほかは入っていればラベルとチーム名（どちらもまん中そろえ）
  const refLabel = active ? "" : refereeLabel(c, m);
  const refRow = active ? refereeHtml(c, m) : refLabel ? `<div class="referee-row"><span>🟨 審判</span><b>${esc(refLabel)}</b></div>` : "";
  // 入力中のカード：時刻とコートを手で直す（時刻を入れている大会で、準備を変えられる人だけ）
  const timeRow =
    active && s && t.sched.on && !planLocked()
      ? `<div class="time-row"><span>🕘</span><input type="time" class="ls-input" value="${esc(s.time)}" data-fix-time="${esc(m.id)}" aria-label="${esc(matchTitle(m, gen))}の時刻">${
          t.sched.courts > 1 ? `<select data-fix-court="${esc(m.id)}" aria-label="コート">${Array.from({ length: t.sched.courts }, (_, i) => `<option value="${i + 1}" ${s.court === i + 1 ? "selected" : ""}>コート${i + 1}</option>`).join("")}</select>` : ""
        }${s.fixed ? `<button class="ls-chip" type="button" data-fix-clear="${esc(m.id)}">自動にもどす</button>` : ""}</div>`
      : "";
  // 押せるカード（出るチームが決まっていて、入れられるとき）：見出しをボタンにする（キーボードでも）
  const tappable = ready && !readOnly();
  const head = tappable ? ` data-tap="${esc(m.id)}" role="button" tabindex="0" aria-expanded="${active}" aria-label="${esc(matchTitle(m, gen))}：${active ? "入れるのをやめる" : "点を入れる"}"` : "";
  return `<article class="match ${done ? "is-done" : ""} ${next ? "is-next" : ""} ${tappable ? "is-tappable" : ""} ${active ? "is-active" : ""}" data-mid="${esc(m.id)}"><div class="match-head"${head}><span>${badge}${esc(matchTitle(m, gen))}</span><span>${esc(when)}${clearBtn}</span></div><div class="match-sides">${side(m.home, r.home, 0)}<span class="match-vs" aria-hidden="true">-</span>${side(m.away, r.away, 1)}</div>${pkRow}${refRow}${timeRow}${actions}</article>`;
}

// 審判の文字（チーム名。あとでその試合に出る・同じ時間に試合があることになったら ⚠️ つき）。入っていなければ ""
function refereeLabel(c, m) {
  const { t, gen, plan, resolved } = c;
  const now = t.referees?.[m.id] || "";
  if (!now) return "";
  const options = refereeOptions(m, t.teams.map((x) => x.id), resolved, plan, gen.matches);
  if (options.includes(now)) return teamName(t, now);
  const r = resolved[m.id] || {};
  return `${teamName(t, now)}${r.home === now || r.away === now ? "（⚠️ この試合に出る）" : "（⚠️ 同じ時間に試合）"}`;
}

/**
 * 入力中のカードの審判の欄：その試合に出ない・同じ時間に試合のないチームから選ぶ（いなければ「−」だけ）。
 * 入れたチームがあとで出ることになったら ⚠️ をつけて残す。終わった試合は文字だけ（入っていなければ出さない）
 */
function refereeHtml(c, m) {
  const { t, gen, plan, resolved } = c;
  const now = t.referees?.[m.id] || "";
  const label = refereeLabel(c, m);
  if (doneOf(t, m)) return now ? `<div class="referee-row"><span>🟨 審判</span><b>${esc(label)}</b></div>` : "";
  const options = refereeOptions(m, t.teams.map((x) => x.id), resolved, plan, gen.matches);
  const clash = now && !options.includes(now);
  if (!options.length && !now) return `<div class="referee-row"><span>🟨 審判</span><b>−</b></div>`;
  const list = clash ? [now, ...options] : options;
  const opts = list.map((id) => `<option value="${esc(id)}" ${esc(id === now ? "selected" : "")}>${esc(id === now ? label : teamName(t, id))}</option>`).join("");
  return `<label class="referee-row ${clash ? "is-clash" : ""}"><span>🟨 審判</span><select data-referee="${esc(m.id)}" aria-label="${esc(matchTitle(m, gen))}の審判"><option value="">−</option>${opts}</select></label>`;
}

// 試合のまとまりの見出し（総当たり・グループ・トーナメントの回・3位決定戦）を返す
function sectionTitle(m, gen) {
  const total = Math.max(0, ...gen.matches.filter((x) => x.stage === "ko").map((x) => x.round));
  return m.stage === "third" ? "3位決定戦" : m.stage === "ko" ? roundName(m.round, total) : m.stage === "group" ? "グループの総当たり" : "総当たり";
}

// 試合の一覧を描きなおす（見方：順番・コート別・チーム別。順番は時刻か何試合目の順で、まとまりごとに見出し）
export function renderMatches(c) {
  const { t, gen, plan, resolved } = c;
  const play = gen.matches.filter((m) => !m.bye);
  $("matchesEmpty").hidden = gen.matches.length > 0;
  $("matchViews").hidden = !play.length;
  // 審判：準備の枠（自動で入れる・全部消す）と、まだ1つもないときの試合の画面の案内
  const refs = play.filter((m) => t.referees?.[m.id]).length;
  $("refereeFold").hidden = !play.length || readOnly() || liveRole() === "input";
  $("clearReferees").hidden = !refs;
  $("refereeMeta").textContent = refs ? `${refs} / ${play.length}試合に入れた` : "まだ";
  $("refereeHint").hidden = Boolean(refs) || !play.length || readOnly();
  $("tapHint").hidden = !play.length || readOnly() || Boolean(activeMatch);
  const done = play.filter((m) => doneOf(t, m)).length;
  $("matchesMeta").textContent = play.length ? `${done} / ${play.length}試合` : "";
  // 次の試合：順番でいちばん早い、出るチームが決まっていて結果のまだの試合（同じ時刻のほかのコートも）
  const byIdAll = Object.fromEntries(gen.matches.map((m) => [m.id, m]));
  const waiting = plan.filter((p) => !byIdAll[p.id].bye && resolved[p.id]?.home && resolved[p.id]?.away && !doneOf(t, byIdAll[p.id]));
  c.next = new Set(waiting.length ? waiting.filter((p) => p.start === waiting[0].start).map((p) => p.id) : []);
  $("jumpNext").hidden = !c.next.size || view.mode === "team";
  renderDelay(c);
  renderViewTools(c);
  const byId = Object.fromEntries(gen.matches.map((m) => [m.id, m]));
  const parts = [];
  if (view.mode === "team" && view.team) {
    // このチームの試合に、審判をする試合もはさむ（試合の順に）
    const duty = refereeDuty(c, view.team).map((m) => ({ m, kind: "ref" }));
    const path = [...teamPath(c, view.team), ...duty].sort((a, b) => (c.numberOf[a.m.id] ?? 0) - (c.numberOf[b.m.id] ?? 0));
    if (!path.length) parts.push(`<p class="ls-hint">このチームの試合はまだ決まっていません。</p>`);
    for (const x of path) {
      if (x.kind === "fixed") parts.push(matchHtml(c, x.m));
      else if (x.kind === "ref") parts.push(refereeDutyHtml(c, x.m));
      else parts.push(`<p class="path-note">${esc(whenText(c, x.m))}　${esc(matchTitle(x.m, gen))}${esc(KIND_LABEL[x.kind])}　vs ${esc(opponentLabel(c, view.team, x))}</p>`);
    }
  } else if (view.mode === "court") {
    for (let court = 1; court <= t.sched.courts; court++) {
      parts.push(`<h3 class="round-head">🏟️ コート${court}</h3>`);
      for (const p of plan.filter((x) => x.court === court)) parts.push(matchHtml(c, byId[p.id]));
    }
  } else {
    // 時刻（なければ節・回）ごとにたためるまとまりにする。はじめは、ぜんぶ終わったまとまりだけたたむ（開け閉めは覚えておく）
    const groups = [];
    for (const p of plan) {
      const m = byId[p.id];
      const head = c.sched ? `🕘 ${p.time}` : sectionTitle(m, gen);
      if (!groups.length || groups.at(-1).head !== head) groups.push({ head, list: [] });
      groups.at(-1).list.push(m);
    }
    for (const g of groups) {
      const play2 = g.list.filter((m) => !m.bye);
      const doneCount = play2.filter((m) => doneOf(t, m)).length;
      const allDone = play2.length > 0 && doneCount === play2.length;
      const hasActive = g.list.some((m) => m.id === activeMatch || c.next.has(m.id));
      const open = slotOpen.has(g.head) ? slotOpen.get(g.head) : !allDone || hasActive;
      const meta = allDone ? "✓ ぜんぶ終わり" : doneCount ? `${doneCount} / ${play2.length}試合` : `${play2.length}試合`;
      let inner = "";
      // トーナメントの1回戦の前に：不戦勝で次の回から出るチーム
      const m0 = g.list[0];
      const byes = !c.sched && m0.stage === "ko" && m0.round === 1 ? gen.matches.filter((x) => x.bye) : [];
      if (byes.length) inner += `<p class="bye-note">シード（次の回から）：${byes.map((x) => esc(resolved[x.id]?.winner ? teamName(t, resolved[x.id].winner) : sideLabel(x.home.empty ? x.away : x.home, gen))).join("・")}</p>`;
      inner += g.list.map((m) => matchHtml(c, m)).join("");
      parts.push(`<details class="slot-fold" data-slot="${esc(g.head)}" ${open ? "open" : ""}><summary class="round-head"><span>${esc(g.head)}</span><span class="slot-meta">${esc(meta)}</span></summary><div class="ls-stack">${inner}</div></details>`);
    }
  }
  $("matches").innerHTML = parts.join("");
}

// 押す・入力を受けるしかけ（⏱ 遅れ・点・PK・結果を消す・時刻を直す・審判・見方・次の試合へ）を付ける（app.js の init から1回）
export function bindMatches() {
  // ⏱ 遅れ
  $("delayMinus").addEventListener("click", () => addDelay(-5));
  $("delayPlus").addEventListener("click", () => addDelay(5));
  $("delayClear").addEventListener("click", () => {
    const t = current();
    const before = t.delays;
    t.delays = [];
    persist();
    ui.renderResults();
    toast("遅れをなくしました", () => {
      current().delays = before;
      persist();
      ui.renderResults();
    });
  });

  // 試合：点・PK・結果を消す
  $("matches").addEventListener("click", (e) => {
    // 時刻ごとのまとまりの見出し：押した人の開け閉めだけを覚える（描いたときの開け閉めは覚えない）
    const sum = e.target.closest(".slot-fold > summary");
    if (sum) return slotOpen.set(sum.parentElement.dataset.slot, !sum.parentElement.open);
    const b = e.target.closest("[data-score]");
    if (b && !readOnly()) return setScore(b.dataset.mid, b.dataset.score, Number(b.dataset.k), Number(b.dataset.d));
    const clear = e.target.closest("[data-clear]");
    if (clear) return clearScore(clear.dataset.clear);
    const fixClear = e.target.closest("[data-fix-clear]");
    if (fixClear && !planLocked()) {
      const t = current();
      t.timeFix = { ...(t.timeFix || {}) };
      delete t.timeFix[fixClear.dataset.fixClear];
      persist();
      ui.renderResults();
      return toast("自動の時刻にもどしました");
    }
    // 点・審判・リンクのほかを押したら、その試合を入力中にする／やめる
    if (e.target.closest("button, a, select, input, label, .match-actions")) return;
    const card = e.target.closest(".match.is-tappable");
    if (card) toggleActive(card.dataset.mid);
  });
  $("matches").addEventListener("keydown", (e) => {
    const head = e.target.closest("[data-tap]");
    if (!head || (e.key !== "Enter" && e.key !== " ")) return;
    e.preventDefault();
    toggleActive(head.dataset.tap);
  });

  // 審判を選ぶ（「−」はなし）
  // 時刻・コートを手で直す
  $("matches").addEventListener("change", (e) => {
    const el = e.target.closest("[data-fix-time], [data-fix-court]");
    if (!el || planLocked() || viewing) return;
    const mid = el.dataset.fixTime || el.dataset.fixCourt;
    const card = el.closest(".match");
    const time = card.querySelector("[data-fix-time]")?.value || "";
    const court = Number(card.querySelector("[data-fix-court]")?.value || compute().timeOf[mid]?.court || 1);
    if (!/^\d{2}:\d{2}$/.test(time)) return;
    const t = current();
    t.timeFix = { ...(t.timeFix || {}), [mid]: { time, court } };
    persist();
    ui.renderResults();
    toast(`時刻を ${time} にしました（✏️。「自動にもどす」で戻せます）`);
  });
  $("matches").addEventListener("change", (e) => {
    const sel = e.target.closest("[data-referee]");
    if (!sel || readOnly()) return;
    const t = current();
    t.referees = { ...(t.referees || {}) };
    if (sel.value) t.referees[sel.dataset.referee] = sel.value;
    else delete t.referees[sel.dataset.referee];
    persist();
    ui.renderResults();
  });

  // 審判を自動で入れる（まだ入れていない試合だけ。審判の少ないチームから）・審判を全部消す。どちらも元に戻せる
  $("autoReferees").addEventListener("click", () => {
    const c = compute();
    const next = autoReferees(c.gen.matches, c.t.teams.map((x) => x.id), c.resolved, c.plan, c.t.referees, c.t.sched.avoid ? c.t.sched.rest : 0);
    const added = Object.keys(next).length - Object.keys(c.t.referees || {}).length;
    const waiting = c.gen.matches.some((m) => !m.bye && !next[m.id] && !(c.resolved[m.id]?.home && c.resolved[m.id]?.away));
    const later = waiting ? "。出るチームが決まっていない試合は、結果が入ってからもう一度押してね" : "";
    if (!added) return toast(`入れられる審判がありませんでした${later || "（入れられるチームがいない試合は −）"}`);
    change((x) => (x.referees = next), `審判を${added}試合に入れました${later}`);
  });
  $("clearReferees").addEventListener("click", () => change((x) => (x.referees = {}), "審判を全部消しました"));

  // 試合表の見方・チーム別のチーム
  document.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => ((view.mode = b.dataset.view), ui.renderResults())));
  // 次の試合へ：そのカードまで動かす（上に貼りついたタブの下に来るように）
  $("jumpNext").addEventListener("click", () => {
    const el = document.querySelector("#matches .match.is-next");
    el?.closest("details")?.setAttribute("open", "");
    if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 90, behavior: "smooth" });
  });
}
