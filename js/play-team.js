// くみあわせ：試合の表の「チーム別」（そのチームの試合と勝ち進み・審判をする試合・最多の試合の数）と、くろのすのカウントダウンのリンク
// js/play-matches.js から読む（import。描きなおしは renderViewTools、チームを選ぶボタンは bindTeamView）
import { TOOL } from "./settings.js?v=202610290639";
import { LINK_MAX, qronosUrl, viewUrl } from "./link.js?v=202610290639";
import { matchTitle, sideLabel, teamName } from "./card.js?v=202610290639";
import { $, esc } from "./dom.js?v=202610290639";
import { teamById, ui, view } from "./state.js?v=202610290639";
import { doneOf, dotHtml, mine, whenText } from "./play-score.js?v=202610290639";

/**
 * そのチームの試合を返す：決まっている試合と、トーナメントの勝ち進み（勝てば決勝まで・負けたら3位決定戦）。グループのときは、1位で上がったときの決勝トーナメントから決勝まで。
 * [{ m, kind: "fixed"|"win"|"lose"|"advance", mine（勝ち進みのとき、このチームが入る側） }] を、試合の順に返す
 */
export function teamPath(c, id) {
  const { gen, resolved, numberOf } = c;
  const has = (m) => resolved[m.id]?.home === id || resolved[m.id]?.away === id;
  const out = gen.matches.filter((m) => !m.bye && has(m)).map((m) => ({ m, kind: "fixed" }));
  const seen = new Set(out.map((x) => x.m.id));
  const add = (x) => !seen.has(x.m.id) && (seen.add(x.m.id), out.push(x));
  // cur（このチームが出る・出るかもしれない試合）から、勝ったら出る試合（決勝まで）と、負けたら出る3位決定戦をたどる
  const follow = (cur) => {
    for (;;) {
      const third = gen.matches.find((x) => x.stage === "third" && (x.home.loserOf === cur.id || x.away.loserOf === cur.id));
      if (third && resolved[cur.id]?.winner !== id) add({ m: third, kind: "lose", mine: third.home.loserOf === cur.id ? third.home : third.away });
      if (resolved[cur.id]?.winner && resolved[cur.id].winner !== id) break;
      const next = gen.matches.find((x) => x.stage === "ko" && (x.home.winnerOf === cur.id || x.away.winnerOf === cur.id));
      if (!next) break;
      add({ m: next, kind: "win", mine: next.home.winnerOf === cur.id ? next.home : next.away });
      cur = next;
    }
  };
  // トーナメント：いま勝ち残っている最後の試合（不戦勝もふくむ）から
  const ko = gen.matches.filter((m) => m.stage === "ko" && (has(m) || (m.bye && resolved[m.id]?.winner === id))).sort((a, b) => a.round - b.round);
  const cur = ko.at(-1);
  if (cur && resolved[cur.id]?.loser !== id) follow(cur);
  // グループ：まだ上がるチームが決まっていなければ、1位で上がったときの決勝トーナメントの試合から、決勝まで
  const group = gen.groups?.find((g) => g.ids.includes(id));
  if (group && !ko.length) {
    const firstKo = gen.matches.find((m) => m.stage === "ko" && [m.home, m.away].some((sd) => sd.groupRank?.[0] === group.key && sd.groupRank[1] === 1));
    if (firstKo) {
      const mine = firstKo.home.groupRank?.[0] === group.key && firstKo.home.groupRank[1] === 1 ? firstKo.home : firstKo.away;
      if (!firstKo.bye) add({ m: firstKo, kind: "advance", mine });
      follow(firstKo);
    }
  }
  return out.sort((a, b) => (numberOf[a.m.id] ?? 0) - (numberOf[b.m.id] ?? 0));
}

// 勝ち進みの行にそえる言葉
export const KIND_LABEL = { fixed: "", win: "（勝てば）", lose: "（負けたら）", advance: "（1位で上がれば）" };

// teamPath の1つの試合の相手（決まっていればチームの id。未定なら null）
function opponentId(c, id, { m, kind, mine }) {
  const r = c.resolved[m.id] || {};
  if (kind === "fixed") return r.home === id ? r.away : r.home;
  if (!mine) return null;
  return (m.away === mine ? r.home : r.away) || null;
}

// teamPath の1つの試合の、相手の呼び名を返す（決まっていればチーム名、まだなら「準決勝 2の勝者」など）
export function opponentLabel(c, id, { m, kind, mine }) {
  const r = c.resolved[m.id] || {};
  if (kind === "fixed") return teamName(c.t, r.home === id ? r.away : r.home);
  if (!mine) return "相手は未定";
  const otherIsHome = m.away === mine;
  const other = otherIsHome ? m.home : m.away;
  const known = otherIsHome ? r.home : r.away;
  return known ? teamName(c.t, known) : sideLabel(other, c.gen);
}

// 試合の日時（"2026-11-03T09:30"）を返す。時刻を入れていない・日にちがないときは ""
const atOf = (c, id) => (c.t.sched.on && c.t.sched.date && c.timeOf[id]?.time ? `${c.t.sched.date}T${c.timeOf[id].time}` : "");

// くろのすのボードに付けるリンク：大会の見る人用リンク（長すぎるときは、くみあわせを開くだけ）
function qronosLink(c) {
  const link = viewUrl(c.t);
  return { url: link.length <= LINK_MAX ? link : TOOL.url, label: "🏆 大会を見る" };
}

// くろのすで、そのチームの試合（勝ち進みもふくむ）のカウントダウンを開くリンクを返す。日時がなければ null
function teamQronosUrl(c, id) {
  // 行の色は相手のチームの色（未定ならくろのすの色のまま）
  const entries = teamPath(c, id).map((x) => ({ at: atOf(c, x.m.id), title: `${matchTitle(x.m, c.gen)}${KIND_LABEL[x.kind]} vs ${opponentLabel(c, id, x)}`, emoji: x.kind === "fixed" ? "⚽" : "🏆", color: teamById(opponentId(c, id, x))?.color || "" }));
  return qronosUrl(`${teamName(c.t, id)}の試合`, entries, qronosLink(c));
}

// くろのすで、大会のカウントダウン（はじまり・3位決定戦・決勝。総当たりは最後の試合）を開くリンクを返す。日時がなければ null
function allQronosUrl(c) {
  const list = c.plan.map((p) => c.gen.matches.find((m) => m.id === p.id));
  if (!list.length) return null;
  const entries = [{ at: atOf(c, list[0].id), title: "はじまり（第1試合）", emoji: "🏁" }];
  for (const m of list) if (m.stage === "third" || (m.stage === "ko" && m === list.filter((x) => x.stage === "ko").at(-1))) entries.push({ at: atOf(c, m.id), title: matchTitle(m, c.gen), emoji: m.stage === "third" ? "🥉" : "🏆" });
  if (!list.some((m) => m.stage === "ko") && list.length > 1) entries.push({ at: atOf(c, list.at(-1).id), title: "最後の試合", emoji: "🏁" });
  return qronosUrl(c.t.name || "組み合わせ", entries, qronosLink(c));
}

// そのチームが審判をする試合のならび
export const refereeDuty = (c, id) => c.gen.matches.filter((m) => !m.bye && id && c.t.referees?.[m.id] === id);

// チーム別の、審判をする試合の1行（いつ・どの試合・出るチーム・結果）の HTML を返す
export function refereeDutyHtml(c, m) {
  const { t, gen, resolved } = c;
  const r = resolved[m.id] || {};
  const name = (side, id) => (id ? teamName(t, id) : sideLabel(side, gen));
  const res = t.results[m.id];
  const mid = res ? `${res.s[0]} - ${res.s[1]}` : "vs";
  return `<p class="ref-duty ${doneOf(t, m) ? "is-done" : ""}"><b>🟨 審判</b>　${esc(whenText(c, m))}　${esc(matchTitle(m, gen))}<br>${esc(name(m.home, r.home))} ${esc(mid)} ${esc(name(m.away, r.away))}</p>`;
}

// 試合表の見方のボタン・チーム別のチームの選択・くろのすのボタンを描きなおす
export function renderViewTools(c) {
  const { t } = c;
  if (view.mode === "court" && t.sched.courts < 2) view.mode = "order";
  if (!t.teams.some((x) => x.id === view.team)) view.team = t.teams[0]?.id || "";
  document.querySelectorAll("[data-view]").forEach((b) => {
    b.setAttribute("aria-selected", String(b.dataset.view === view.mode));
    b.hidden = b.dataset.view === "court" && t.sched.courts < 2;
  });
  $("teamPick").hidden = view.mode !== "team";
  $("teamTools").hidden = view.mode !== "team";
  if (view.mode === "team") {
    $("teamPick").innerHTML = t.teams.map((x) => `<button class="ls-chip" type="button" role="radio" data-team="${esc(x.id)}" aria-checked="${esc(x.id === view.team)}">${dotHtml(x.id)}${esc(teamName(t, x.id))}</button>`).join("");
    const url = teamQronosUrl(c, view.team);
    // 最多の試合の数：決まっている試合 ＋ 勝ち進んだとき（3位決定戦は決勝のかわりなので数えない）
    const path = teamPath(c, view.team);
    const fixed = path.filter((x) => x.kind === "fixed").length;
    const more = path.filter((x) => x.kind === "win" || x.kind === "advance").length;
    const most = more ? `<p class="path-note">📏 最多 ${esc(fixed + more)}試合（決まっている ${esc(fixed)}試合 ＋ 勝ち進めば ${esc(more)}試合）</p>` : "";
    const duty = refereeDuty(c, view.team).length;
    const refNote = duty ? `<p class="path-note">🟨 審判 ${esc(duty)}試合（試合のあいだに入れています）</p>` : "";
    $("teamTools").innerHTML = most + refNote + (url
      ? `<a class="ls-chip" href="${esc(url)}" target="_blank" rel="noopener">⏳ この試合をくろのすでカウントダウン</a>`
      : `<p class="ls-hint">⏳ 「時刻を入れる」で日にちとはじまりを入れると、このチームの試合をくろのすでカウントダウンできます。</p>`);
  }
  const all = allQronosUrl(c);
  $("qronosAll").hidden = !all;
  if (all) $("qronosAll").href = all;
}

// 押す・入力を受けるしかけ（チーム別のチームを選ぶ）を付ける（app.js の init から1回）
export function bindTeamView() {
  $("teamPick").addEventListener("click", (e) => {
    const b = e.target.closest("[data-team]");
    if (!b) return;
    view.team = b.dataset.team;
    ui.renderResults();
  });
}
