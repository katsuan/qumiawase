// くみあわせ：試合のページのトーナメント表・順位表・総当たり表と、そこから開く「点を入れる」窓
// app.js から読む（import。描きなおしは renderBracket・renderStandings、マスを押すのは bindTables）
import { roundName } from "./pairing.js?v=202610290639";
import { outcome, podium, table } from "./stats.js?v=202610290639";
import { matchTitle, sideLabel, teamName } from "./card.js?v=202610290639";
import { $, esc } from "./dom.js?v=202610290639";
import { compute, readOnly } from "./state.js?v=202610290639";
import { clearScore, dotHtml, gotoMatch, mine, pkAllowed, pkStepsHtml, scoreHtml, setScore, whenText } from "./play-score.js?v=202610290639";

// トーナメント表（回ごとの列）と、優勝・準優勝・3位を描きなおす
export function renderBracket(c) {
  const { t, gen, resolved } = c;
  const ko = gen.matches.filter((m) => m.stage === "ko");
  $("bracketPanel").hidden = !ko.length;
  if (!ko.length) return;
  const total = Math.max(...ko.map((m) => m.round));
  // 試合の箱：上に時刻とコート（時刻がなければ何試合目）、2チームと点。2チームが決まった試合は、押すと点を入れる窓（見るだけのときは試合の表へ）
  const box = (m) => {
    const r = resolved[m.id] || {};
    const res = t.results[m.id];
    const row = (side, id, k) => {
      const label = id ? teamName(t, id) : side.empty ? "シード" : sideLabel(side, gen);
      const score = res && !m.bye ? `${res.s[k]}${res.pk ? `(${res.pk[k]})` : ""}` : "";
      const cls = id ? `${r.winner === id && !m.bye ? "is-win" : ""} ${id === mine() ? "is-mine" : ""}` : "is-tbd";
      return `<div class="${cls}">${dotHtml(id)}<span class="name">${esc(label)}</span><b>${esc(score)}</b></div>`;
    };
    const when = m.bye ? "" : whenText(c, m);
    const tap = r.home && r.away && !m.bye ? ` role="button" tabindex="0" data-goto="${esc(m.id)}" aria-label="${esc(`${teamName(t, r.home)} 対 ${teamName(t, r.away)}`)}：${readOnly() ? "試合の表で見る" : "点を入れる"}"` : "";
    return `<div class="bracket-slot"><div class="bracket-match ${tap ? "is-tappable" : ""}"${tap}><p class="bracket-when">${esc(when || "\u00a0")}</p>${row(m.home, r.home, 0)}${row(m.away, r.away, 1)}</div></div>`;
  };
  // 3位決定戦：決勝の列の下に置く。どの列にも同じ高さの下の段をつけて、線の高さがずれないようにする
  const third = gen.matches.find((m) => m.stage === "third");
  const foot = (round) => (third ? `<div class="bracket-foot">${round === total ? `<p class="bracket-third-title">🥉 3位決定戦</p>${box(third)}` : ""}</div>` : "");
  const cols = [];
  for (let round = 1; round <= total; round++) {
    const boxes = ko.filter((m) => m.round === round).map(box);
    // 決勝の前の回は2試合ずつ組にする（組の右に縦の線を引いて、次の回の試合につなぐ。次の回の i 試合目は、この回の 2i・2i+1 試合目の勝者）
    const body = [];
    if (round < total) for (let i = 0; i < boxes.length; i += 2) body.push(boxes[i + 1] ? `<div class="bracket-pair">${boxes[i]}${boxes[i + 1]}</div>` : boxes[i]);
    else body.push(...boxes);
    cols.push(`<div class="bracket-col ${third ? "has-foot" : ""}"><h3>${esc(roundName(round, total))}</h3><div class="bracket-col-body">${body.join("")}</div>${foot(round)}</div>`);
  }
  $("bracket").innerHTML = cols.join("");
  // 優勝・準優勝・3位は1行ずつ
  const p = podium(gen, resolved);
  $("champion").hidden = !p.first;
  if (p.first)
    $("champion").innerHTML = [
      `<p>🏆 優勝　${esc(teamName(t, p.first))}</p>`,
      p.second ? `<p>🥈 準優勝　${esc(teamName(t, p.second))}</p>` : "",
      p.third ? `<p>🥉 3位　${esc(teamName(t, p.third))}</p>` : ""
    ].join("");
}

/**
 * 総当たり表（星取表）の HTML を返す（ids は順位の順。番号は順位とそろう）：行のチームから見た結果（○ 2-1・● 0-1・△ 1-1）か、まだなら時刻（なければ何試合目）。
 * 2回総当たりは1マスに2つ。マスを押すと、その場で点を入れる窓（見るだけのときは試合の表のその試合へ）
 */
function crossHtml(c, ids, ms, key) {
  const { t } = c;
  const when = (m) => c.timeOf[m.id]?.time || (c.numberOf[m.id] ? `第${c.numberOf[m.id]}` : "");
  const cell = (a, b) => {
    if (a === b) return `<td class="cross-self"></td>`;
    const list = ms.filter((m) => (m.home.team === a && m.away.team === b) || (m.home.team === b && m.away.team === a));
    const items = list.map((m) => {
      const res = t.results[m.id];
      const o = outcome(res);
      if (!o) return `<button type="button" class="cross-item is-wait" data-goto="${esc(m.id)}">${esc(when(m))}</button>`;
      const mineHome = m.home.team === a;
      const [x, y] = mineHome ? res.s : [res.s[1], res.s[0]];
      // 同点で PK が決まったとき（PK をする総当たり）は、PK の勝ち負けで ○●、「PK」をそえる
      const pk = t.points.pk && x === y && res.pk && res.pk[0] !== res.pk[1] ? (mineHome ? res.pk : [res.pk[1], res.pk[0]]) : null;
      const mark = x > y || (pk && pk[0] > pk[1]) ? "win" : x < y || pk ? "loss" : "draw";
      return `<button type="button" class="cross-item is-${mark}" data-goto="${esc(m.id)}"><i>${{ win: "○", loss: "●", draw: "△" }[mark]}</i>${esc(x)}-${esc(y)}${pk ? `<small>PK${esc(pk[0])}-${esc(pk[1])}</small>` : ""}</button>`;
    });
    return `<td>${items.join("")}</td>`;
  };
  const no = (id) => ids.indexOf(id) + 1;
  const head = ids.map((id) => `<th scope="col" title="${esc(teamName(t, id))}">${dotHtml(id)}${no(id)}</th>`).join("");
  const body = ids.map((a) => `<tr class="${a === mine() ? "is-mine" : ""}"><th scope="row" class="team">${no(a)} ${dotHtml(a)}${esc(teamName(t, a))}</th>${ids.map((b) => cell(a, b)).join("")}</tr>`).join("");
  return `<div class="table-wrap cross-wrap"><table class="cross-table"><caption>総当たり表</caption><thead><tr><th></th>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

/**
 * 総当たり表のマス・トーナメント表の試合から開く「点を入れる」窓（トーナメントで同点なら PK も）。− 数 ＋ は試合の表と同じで、入れるとすぐ順位表・総当たり表・試合の表に出る。
 * 「結果を消す」（元に戻すつき）・「試合の表で見る」・閉じる
 */
function openScoreSheet(mid) {
  document.querySelector(".ls-sheet.score-sheet")?.remove();
  const before = document.activeElement;
  const sheet = Object.assign(document.createElement("div"), { className: "ls-sheet score-sheet" });
  const card = Object.assign(document.createElement("div"), { className: "ls-sheet-card" });
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");
  card.setAttribute("aria-labelledby", "scoreSheetTitle");
  sheet.append(card);
  // 中身を、いまの結果から描きなおす
  const draw = () => {
    const c = compute();
    const { t, gen, resolved } = c;
    const m = gen.matches.find((x) => x.id === mid);
    if (!m) return close();
    const r = resolved[m.id] || {};
    const res = t.results[m.id];
    const o = outcome(res);
    const when = whenText(c, m);
    const ref = t.referees?.[m.id];
    const side = (id, k) => {
      const name = teamName(t, id);
      const win = (o === "home" && k === 0) || (o === "away" && k === 1);
      return `<div class="match-side ${win ? "is-win" : ""}">${dotHtml(id)}<span class="name">${esc(name)}</span>${scoreHtml(m.id, "s", k, res ? res.s[k] : null, `${name}の点`)}</div>`;
    };
    // PK で決める試合で同点のときは PK も（試合の表と同じ）
    const pkHtml = pkAllowed(t, m) && res && res.s[0] === res.s[1] ? `<div class="pk-row"><span>PK（同点のとき）</span>${pkStepsHtml(m, res)}</div>` : "";
    card.innerHTML = `<p id="scoreSheetTitle" class="ls-sheet-title">${esc(matchTitle(m, gen))}</p>
      <p class="score-sheet-sub">${esc([when, ref ? `🟨 審判 ${teamName(t, ref)}` : ""].filter(Boolean).join("　"))}</p>
      <div class="match-sides score-sheet-sides">${side(r.home, 0)}<span class="match-vs" aria-hidden="true">-</span>${side(r.away, 1)}</div>
      ${pkHtml}
      <div class="score-sheet-actions">
        ${res ? `<button class="ls-chip" type="button" data-sheet-clear>結果を消す</button>` : ""}
        <button class="ls-chip" type="button" data-sheet-goto>📋 試合の表で見る</button>
      </div>
      <button class="ls-sheet-cancel" type="button" data-sheet-close>${res ? "決める" : "閉じる"}</button>`;
  };
  const onKey = (e) => e.key === "Escape" && close();
  function close() {
    sheet.remove();
    document.removeEventListener("keydown", onKey);
    before?.focus?.({ preventScroll: true });
  }
  sheet.addEventListener("click", (e) => {
    if (e.target === sheet || e.target.closest("[data-sheet-close]")) return close();
    const b = e.target.closest("[data-score]");
    if (b) {
      const focusKey = `[data-score="${b.dataset.score}"][data-k="${b.dataset.k}"][data-d="${b.dataset.d}"]`;
      setScore(b.dataset.mid, b.dataset.score, Number(b.dataset.k), Number(b.dataset.d));
      draw();
      card.querySelector(focusKey)?.focus();
      return;
    }
    if (e.target.closest("[data-sheet-clear]")) {
      clearScore(mid);
      return draw();
    }
    if (e.target.closest("[data-sheet-goto]")) {
      close();
      gotoMatch(mid);
    }
  });
  draw();
  document.addEventListener("keydown", onKey);
  document.body.append(sheet);
  card.querySelector(".score-stepper button")?.focus({ preventScroll: true });
}

// 順位表（総当たり・グループごと）を描きなおす
export function renderStandings(c) {
  const { t, gen } = c;
  const groups = gen.groups?.length ? gen.groups : t.format === "league" && gen.matches.length ? [{ key: "", ids: t.teams.map((x) => x.id) }] : [];
  $("standingsPanel").hidden = !groups.length;
  $("standings").innerHTML = groups
    .map((g) => {
      const ms = gen.matches.filter((m) => (g.key ? m.group === g.key : m.stage === "league"));
      const rows = table(g.ids, ms, t.results, t.points, t.rank)
        .map((r) => `<tr class="${r.id === mine() ? "is-mine" : ""}"><td>${r.rank}</td><td class="team">${dotHtml(r.id)}${esc(teamName(t, r.id))}</td><td>${r.played}</td><td>${r.win}</td>${t.points.pk ? `<td>${r.pkWin}</td><td>${r.pkLoss}</td>` : `<td>${r.draw}</td>`}<td>${r.loss}</td><td>${r.gf}</td><td>${r.ga}</td><td>${r.gd > 0 ? "+" : ""}${r.gd}</td><td class="pts">${r.pts}</td></tr>`)
        .join("");
      const ranked = table(g.ids, ms, t.results, t.points, t.rank).map((r) => r.id);
      return `${g.key ? `<section class="group-box" aria-label="${esc(g.key)}組"><h3 class="group-title">${esc(g.key)}組</h3>` : ""}<div class="table-wrap"><table class="standing-table"><thead><tr><th></th><th class="team">チーム</th><th>試</th><th>勝</th>${t.points.pk ? `<th title="PK勝ち">PK勝</th><th title="PK負け">PK負</th>` : "<th>分</th>"}<th>負</th><th>得</th><th>失</th><th>差</th><th>点</th></tr></thead><tbody>${rows}</tbody></table></div>${crossHtml(c, ranked, ms, g.key)}${g.key ? "</section>" : ""}`;
    })
    .join("");
}

// 押す・入力を受けるしかけ（総当たり表のマス・トーナメント表の試合）を付ける（app.js の init から1回）
export function bindTables() {
  // 総当たり表のマス・トーナメント表の試合：その場で点を入れる窓を開く（見るだけのときは試合の表へ）
  for (const id of ["standings", "bracket"]) {
    $(id).addEventListener("click", (e) => {
      const b = e.target.closest("[data-goto]");
      if (b) (readOnly() ? gotoMatch : openScoreSheet)(b.dataset.goto);
    });
  }
  $("bracket").addEventListener("keydown", (e) => {
    const b = e.target.closest("[data-goto]");
    if (!b || (e.key !== "Enter" && e.key !== " ")) return;
    e.preventDefault();
    (readOnly() ? gotoMatch : openScoreSheet)(b.dataset.goto);
  });
}
