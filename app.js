// くみあわせ（QumiAwase）：入口。画面（大会・チーム・形・日程・トーナメント表・順位表・試合と結果・送る）を作り、ボタン・入力を受け、部品（js/）をつなぐ。
// index.html から読む（type="module"）。組み合わせは js/pairing.js、順位と勝ち上がりは js/stats.js、端末に残すのは js/store.js、
// リンク（見る人用・さくせん盤・ろくが・結果を戻す）は js/link.js、カードは js/card.js、画像は js/image.js
import { FORMATS, LIMITS, TEAM_COLORS, TOOL } from "./js/settings.js?v=202610280757";
import { addMinutes, fitOptions, generate, roundName, schedule } from "./js/pairing.js?v=202610280757";
import { outcome, podium, resolve, table } from "./js/stats.js?v=202610280757";
import { blankTournament, cleanTournament, colorAt, loadAll, newId, saveAll, takeInbox } from "./js/store.js?v=202610280757";
import { readResult, readView, roqgaUrl, saqsenUrl, viewUrl } from "./js/link.js?v=202610280757";
import { cardParams, dateLabel, matchLine, matchTitle, sideLabel, teamName } from "./js/card.js?v=202610280757";
import { drawTournament } from "./js/image.js?v=202610280757";

// id から画面の部品を返す
const $ = (id) => document.getElementById(id);
// 文字を HTML に入れられる形にする（& < > " ' を置きかえる）
const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
// 中身の写しを返す
const clone = (v) => JSON.parse(JSON.stringify(v));
// Q キットのトーストで知らせる（undo を渡すと「元に戻す」つき）。Q キットがないときは何もしない
const toast = (message, undo) => window.LineShareUI?.toast(message, undo ? { actionLabel: "元に戻す", onAction: undo } : {});
// 季節の絵文字（Q キットの season.js）を、うれしい瞬間の短い文にときどき足す。なくても・止まっても文はそのまま
const seasonal = (text) => {
  try {
    return window.QSeason ? window.QSeason.decorate(text) : text;
  } catch {
    return text;
  }
};

let data = loadAll(); // { list: [大会…], current: いまの大会の id }（この端末）
let viewing = readView(location.search); // 見る人用のリンクで開いた大会（この端末に保存するまで、ここだけ）
let warnedSave = false; // 端末に残せなかったことを、もう知らせたか

// いま画面に出している大会を返す（見る人用のリンクで開いたときは、その大会）
function current() {
  return viewing || data.list.find((t) => t.id === data.current) || data.list[0];
}

// いまの大会を端末に残す（見るだけのときは残さない。残せなかったら1回だけ知らせる）
function persist() {
  if (viewing) return;
  current().updatedAt = Date.now();
  if (!saveAll(data) && !warnedSave) {
    warnedSave = true;
    toast("この端末に残せませんでした（空きがない・プライベートブラウズなど）。閉じると消えます");
  }
}

// 組み合わせが変わる元（チームの並び・形・設定）を1つの文字にして返す。変わったら、入れた結果は使えない
const structureKey = (t) => JSON.stringify([t.teams.map((x) => x.id), t.format, fitOptions(t.teams.length, t.opts)]);

/**
 * 大会を変える（fn の中で変える）。組み合わせが変わって結果が入っていたら、結果を消して「元に戻す」を出す。
 * message を渡すと、組み合わせが変わらなくても「元に戻す」つきで知らせる
 */
function change(fn, message = "") {
  const t = current();
  const before = clone(t);
  const key = structureKey(t);
  fn(t);
  const lost = Object.keys(t.results).length > 0 && structureKey(t) !== key;
  if (lost) t.results = {};
  persist();
  renderAll();
  // 元に戻す：変える前の大会にもどす
  const undo = () => {
    Object.assign(current(), before);
    persist();
    renderAll();
  };
  if (lost) toast(`${message ? `${message}。` : ""}組み合わせが変わったので、入れた結果を消しました`, undo);
  else if (message) toast(message, undo);
}

// ---- 計算（組み合わせ・日程・勝ち上がり） ----

// いまの大会の組み合わせ・日程・勝ち上がりをまとめて返す。{ t, gen, sched（なければ null）, timeOf, resolved }
function compute() {
  const t = current();
  const gen = generate(t.teams, t.format, t.opts);
  let sched = null;
  if (t.sched.on && gen.matches.length) {
    sched = schedule(gen.matches, { courts: t.sched.courts }).map((s) => ({ ...s, time: addMinutes(t.sched.start, s.slot * t.sched.minutes) }));
  }
  const timeOf = Object.fromEntries((sched || []).map((s) => [s.id, s]));
  const resolved = resolve(gen, t.teams.map((x) => x.id), t.results, t.points);
  return { t, gen, sched, timeOf, resolved };
}

// ---- 画面：大会 ----

// 大会の呼び名（名前がなければ「無題の大会（10/28）」）を返す
function eventLabel(t) {
  if (t.name) return t.name;
  const d = new Date(t.createdAt);
  return `無題の大会（${d.getMonth() + 1}/${d.getDate()}）`;
}

// 大会の切りかえ・名前・見るだけの案内を描きなおす
function renderEvents() {
  const t = current();
  $("viewBanner").hidden = !viewing;
  document.body.classList.toggle("is-view", Boolean(viewing));
  $("eventPanel").hidden = Boolean(viewing);
  const select = $("eventSelect");
  select.replaceChildren(...[...data.list].sort((a, b) => b.updatedAt - a.updatedAt).map((x) => new Option(eventLabel(x), x.id, false, x.id === t.id)));
  if (document.activeElement !== $("eventName")) $("eventName").value = t.name;
}

// ---- 画面：チーム ----

// チームの行（番号・色と名前の入力枠・↑↓✕・色の選択肢）を描きなおす。名前を入れているあいだは描きなおさない
function renderTeams() {
  const t = current();
  $("teamsMeta").textContent = `${t.teams.length}チーム`;
  const list = $("teamList");
  list.replaceChildren(
    ...t.teams.map((team, i) => {
      const li = document.createElement("li");
      li.className = "team-row";
      li.dataset.tid = team.id;
      li.innerHTML = `
        <span class="team-no">${i + 1}</span>
        <div class="ls-pickfield">
          <button class="ls-pickfield-btn" type="button" aria-label="${esc(teamName(t, team.id))}の色を選ぶ"><span class="swatch" style="background:${esc(team.color)}"></span></button>
          <input class="team-name" maxlength="${LIMITS.name}" placeholder="チーム${i + 1}" autocomplete="off" enterkeyhint="next" aria-label="${i + 1}番目のチーム名">
        </div>
        <div class="team-move">
          <button class="ls-icon-button" type="button" data-move="-1" aria-label="上へ" ${i === 0 ? "disabled" : ""}>↑</button>
          <button class="ls-icon-button" type="button" data-move="1" aria-label="下へ" ${i === t.teams.length - 1 ? "disabled" : ""}>↓</button>
          <button class="ls-icon-button" type="button" data-remove aria-label="このチームを消す" ${t.teams.length <= 2 ? "disabled" : ""}>✕</button>
        </div>
        <div class="ls-picker" style="--cols: 9" hidden></div>`;
      li.querySelector(".team-name").value = team.name;
      bindTeamColor(li, team);
      return li;
    })
  );
  $("addTeam").disabled = t.teams.length >= LIMITS.teams;
}

// チームの行の色の丸を押す・名前を入れるあいだ、色の選択肢（8色とカスタム）を出す（Q キットの pickField）
function bindTeamColor(li, team) {
  const field = li.querySelector(".ls-pickfield");
  const button = li.querySelector(".ls-pickfield-btn");
  const input = li.querySelector(".team-name");
  const picker = li.querySelector(".ls-picker");
  // 色を選ぶ（決まった色ならたたむ。カスタムは開いたまま）
  const pick = (hex, close) => {
    team.color = hex;
    button.querySelector(".swatch").style.background = hex;
    persist();
    renderResults();
    fill();
    if (close && document.activeElement !== input) api?.close();
  };
  // 選択肢を作りなおす（いまの色に印）
  const fill = () => {
    const now = team.color.toLowerCase();
    const items = TEAM_COLORS.map((c) => {
      const b = Object.assign(document.createElement("button"), { type: "button", className: "ls-picker-item" });
      b.setAttribute("aria-pressed", String(now === c.hex));
      b.setAttribute("aria-label", c.label);
      const sw = Object.assign(document.createElement("span"), { className: "swatch" });
      sw.style.background = c.hex;
      b.append(sw);
      b.addEventListener("click", () => pick(c.hex, true));
      return b;
    });
    const custom = Object.assign(document.createElement("label"), { className: "ls-picker-item" });
    const isPreset = TEAM_COLORS.some((c) => c.hex === now);
    custom.setAttribute("aria-pressed", String(!isPreset));
    const sw = Object.assign(document.createElement("span"), { className: "swatch is-custom" });
    if (!isPreset) sw.style.setProperty("--c", now);
    const color = Object.assign(document.createElement("input"), { type: "color", value: now });
    color.setAttribute("aria-label", "カスタムの色");
    color.addEventListener("change", () => pick(color.value, false));
    sw.append(color);
    custom.append(sw);
    picker.replaceChildren(...items, custom);
  };
  const api = window.LineShareUI?.pickField?.({ field, button, input, picker, onOpen: fill });
  if (!api) button.addEventListener("click", () => ((picker.hidden = !picker.hidden), fill()));
}

// チームを id で探して返す
const teamById = (id) => current().teams.find((x) => x.id === id);

// 新しいチームの id（いまの t の番号より大きい番号）を返す
function nextTeamId(t) {
  const max = Math.max(0, ...t.teams.map((x) => Number(/^t(\d+)$/.exec(x.id)?.[1]) || 0));
  return `t${max + 1}`;
}

// ---- 画面：形と日程 ----

// − 数 ＋ の部品を el に作る（get で今の数、set で変える。min〜max、step ずつ）
function stepper(el, { get, set, min, max, step = 1, label }) {
  const value = get();
  el.innerHTML = `<button type="button" data-d="-1" aria-label="${esc(label)}をへらす" ${esc(value <= min ? "disabled" : "")}>−</button><output aria-label="${esc(label)}">${esc(value)}</output><button type="button" data-d="1" aria-label="${esc(label)}をふやす" ${esc(value >= max ? "disabled" : "")}>＋</button>`;
  el.onclick = (e) => {
    const d = Number(e.target.closest("button")?.dataset.d);
    if (!d) return;
    set(Math.min(max, Math.max(min, get() + d * step)));
  };
}

// 形（トーナメント・総当たり・グループ）と、その設定・勝ち点を描きなおす
function renderFormat() {
  const t = current();
  const opts = fitOptions(t.teams.length, t.opts);
  $("formatMeta").textContent = FORMATS[t.format];
  $("formatChips").replaceChildren(
    ...Object.entries(FORMATS).map(([key, label]) => {
      const b = Object.assign(document.createElement("button"), { type: "button", className: "ls-chip", textContent: label });
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", String(t.format === key));
      b.addEventListener("click", () => t.format !== key && change((x) => (x.format = key)));
      return b;
    })
  );
  $("groupOptions").hidden = t.format !== "groups";
  $("legOptions").hidden = t.format === "knockout";
  $("thirdOption").hidden = t.format === "league";
  $("pointsFold").hidden = t.format === "knockout";
  $("thirdPlace").checked = opts.thirdPlace;
  document.querySelectorAll("[data-legs]").forEach((b) => b.setAttribute("aria-checked", String(Number(b.dataset.legs) === opts.legs)));
  const maxGroups = Math.max(1, Math.floor(t.teams.length / 2));
  stepper(document.querySelector('[data-opt="groups"]'), { get: () => opts.groups, set: (v) => change((x) => (x.opts.groups = v)), min: 1, max: maxGroups, label: "グループの数" });
  stepper(document.querySelector('[data-opt="advance"]'), { get: () => opts.advance, set: (v) => change((x) => (x.opts.advance = v)), min: 1, max: Math.max(1, Math.floor(t.teams.length / opts.groups)), label: "上がる数" });
  for (const key of ["win", "draw", "loss"]) {
    stepper(document.querySelector(`[data-point="${key}"]`), { get: () => t.points[key], set: (v) => ((t.points[key] = v), persist(), renderFormat(), renderResults()), min: 0, max: 9, label: "勝ち点" });
  }
  $("pointsMeta").textContent = `勝${t.points.win}・分${t.points.draw}・負${t.points.loss}`;
}

// 日程（なくてもOK）の欄を描きなおす
function renderSched() {
  const t = current();
  const s = t.sched;
  $("schedOn").checked = s.on;
  $("schedBox").hidden = !s.on;
  if (document.activeElement !== $("schedDate")) $("schedDate").value = s.date;
  if (document.activeElement !== $("schedStart")) $("schedStart").value = s.start;
  if (document.activeElement !== $("schedPlace")) $("schedPlace").value = s.place;
  $("schedMeta").textContent = s.on ? [dateLabel(s.date), `${s.start}〜`, `コート${s.courts}`, `${s.minutes}分`].filter(Boolean).join("・") : "なくてもOK";
  const setSched = (key) => (v) => ((t.sched[key] = v), persist(), renderSched(), renderResults());
  stepper(document.querySelector('[data-sched="courts"]'), { get: () => s.courts, set: setSched("courts"), min: 1, max: LIMITS.courts, label: "コートの数" });
  stepper(document.querySelector('[data-sched="minutes"]'), { get: () => s.minutes, set: setSched("minutes"), min: 5, max: LIMITS.minutes, step: 5, label: "1試合の時間" });
}

// ---- 画面：結果（トーナメント表・順位表・試合） ----

// チームの色の丸の HTML を返す（チームが決まっていなければ空の丸）
const dotHtml = (id) => `<i class="dot" style="background:${esc(teamById(id)?.color || "transparent")}"></i>`;

// トーナメント表（回ごとの列）と、優勝・準優勝・3位を描きなおす
function renderBracket({ t, gen, resolved }) {
  const ko = gen.matches.filter((m) => m.stage === "ko");
  $("bracketPanel").hidden = !ko.length;
  if (!ko.length) return;
  const total = Math.max(...ko.map((m) => m.round));
  const cols = [];
  for (let round = 1; round <= total; round++) {
    const list = ko.filter((m) => m.round === round);
    const boxes = list.map((m) => {
      const r = resolved[m.id] || {};
      const res = t.results[m.id];
      const row = (side, id, k) => {
        const label = id ? teamName(t, id) : side.empty ? "シード" : sideLabel(side, gen);
        const score = res && !m.bye ? `${res.s[k]}${res.pk ? `(${res.pk[k]})` : ""}` : "";
        const cls = id ? (r.winner === id && !m.bye ? "is-win" : "") : "is-tbd";
        return `<div class="${cls}">${dotHtml(id)}<span class="name">${esc(label)}</span><b>${esc(score)}</b></div>`;
      };
      return `<div class="bracket-match">${row(m.home, r.home, 0)}${row(m.away, r.away, 1)}</div>`;
    });
    cols.push(`<div class="bracket-col"><h3>${esc(roundName(round, total))}</h3><div class="bracket-col-body">${boxes.join("")}</div></div>`);
  }
  $("bracket").innerHTML = cols.join("");
  const p = podium(gen, resolved);
  $("champion").hidden = !p.first;
  if (p.first) $("champion").textContent = `🏆 優勝 ${teamName(t, p.first)}${p.second ? `　🥈 ${teamName(t, p.second)}` : ""}${p.third ? `　🥉 ${teamName(t, p.third)}` : ""}`;
}

// 順位表（総当たり・グループごと）を描きなおす
function renderStandings({ t, gen }) {
  const groups = gen.groups?.length ? gen.groups : t.format === "league" && gen.matches.length ? [{ key: "", ids: t.teams.map((x) => x.id) }] : [];
  $("standingsPanel").hidden = !groups.length;
  $("standings").innerHTML = groups
    .map((g) => {
      const ms = gen.matches.filter((m) => (g.key ? m.group === g.key : m.stage === "league"));
      const rows = table(g.ids, ms, t.results, t.points)
        .map((r) => `<tr><td>${r.rank}</td><td class="team">${dotHtml(r.id)}${esc(teamName(t, r.id))}</td><td>${r.played}</td><td>${r.win}</td><td>${r.draw}</td><td>${r.loss}</td><td>${r.gf}</td><td>${r.ga}</td><td>${r.gd > 0 ? "+" : ""}${r.gd}</td><td class="pts">${r.pts}</td></tr>`)
        .join("");
      return `<div class="table-wrap"><table class="standing-table">${g.key ? `<caption>${esc(g.key)}組</caption>` : ""}<thead><tr><th></th><th class="team">チーム</th><th>試</th><th>勝</th><th>分</th><th>負</th><th>得</th><th>失</th><th>差</th><th>点</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    })
    .join("");
}

// 点の − 数 ＋（まだ入れていないときは「–」。押すと 0 から入る）の HTML を返す
function scoreHtml(mid, kind, k, value, label) {
  const shown = value === null ? "–" : value;
  return `<div class="score-stepper"><button type="button" data-score="${kind}" data-k="${k}" data-d="-1" data-mid="${esc(mid)}" aria-label="${esc(label)}をへらす">−</button><output><button type="button" class="score-now" data-score="${kind}" data-k="${k}" data-d="0" data-mid="${esc(mid)}" aria-label="${esc(label)}（いま ${shown}）">${shown}</button></output><button type="button" data-score="${kind}" data-k="${k}" data-d="1" data-mid="${esc(mid)}" aria-label="${esc(label)}をふやす">＋</button></div>`;
}

// 試合1つのカード（見出し・時刻・2チームと点・PK・さくせん盤やろくがで開く）の HTML を返す
function matchHtml({ t, gen, timeOf, resolved }, m) {
  const r = resolved[m.id] || {};
  const res = t.results[m.id];
  const ready = Boolean(r.home && r.away);
  const s = timeOf[m.id];
  const when = s ? `${s.time}${t.sched.courts > 1 ? `・コート${s.court}` : ""}` : "";
  const isKo = m.stage === "ko" || m.stage === "third";
  const o = outcome(res);
  const side = (sideDef, id, k) => {
    const name = id ? teamName(t, id) : sideLabel(sideDef, gen);
    const win = (o === "home" && k === 0) || (o === "away" && k === 1);
    const value = res ? res.s[k] : null;
    return `<div class="match-side ${id ? "" : "is-tbd"} ${win ? "is-win" : ""}">${dotHtml(id)}<span class="name">${esc(name)}</span>${ready && !viewing ? scoreHtml(m.id, "s", k, value, `${name}の点`) : `<b>${value ?? ""}</b>`}</div>`;
  };
  const pkRow =
    isKo && res && res.s[0] === res.s[1]
      ? `<div class="pk-row"><span>PK（同点のとき）</span>${viewing ? `<b>${res.pk ? `${res.pk[0]} - ${res.pk[1]}` : "–"}</b>` : `<div class="pk-steppers">${scoreHtml(m.id, "pk", 0, res.pk ? res.pk[0] : null, "ホームの PK")}${scoreHtml(m.id, "pk", 1, res.pk ? res.pk[1] : null, "アウェイの PK")}</div>`}</div>`
      : "";
  let actions = "";
  if (ready) {
    const home = teamById(r.home);
    const away = teamById(r.away);
    const named = (x) => ({ name: teamName(t, x.id), color: x.color });
    const saqsen = saqsenUrl({ home: named(home), away: named(away), place: t.sched.on ? t.sched.place : "", date: t.sched.on ? t.sched.date : "", time: s?.time || "", tid: t.id, mid: m.id });
    actions = `<div class="match-actions">
      <a class="ls-chip" href="${esc(saqsen)}" target="_blank" rel="noopener">⚽ さくせん盤で開く</a>
      <a class="ls-chip" href="${esc(roqgaUrl({ home: named(home), away: named(away) }))}" target="_blank" rel="noopener">📹 ろくがで撮る</a>
      ${res && !viewing ? `<button class="ls-chip" type="button" data-clear="${esc(m.id)}">結果を消す</button>` : ""}
    </div>`;
  }
  return `<article class="match ${res ? "is-done" : ""}" data-mid="${esc(m.id)}"><div class="match-head"><span>${esc(matchTitle(m, gen))}</span><span>${esc(when)}</span></div>${side(m.home, r.home, 0)}${side(m.away, r.away, 1)}${pkRow}${actions}</article>`;
}

// 試合の一覧を描きなおす（日程があれば時刻の順、なければ回の順。トーナメントの不戦勝は回の見出しの下に1行）
function renderMatches(c) {
  const { t, gen, sched, resolved } = c;
  const play = gen.matches.filter((m) => !m.bye);
  $("matchesEmpty").hidden = gen.matches.length > 0;
  const done = play.filter((m) => outcome(t.results[m.id])).length;
  $("matchesMeta").textContent = play.length ? `${done} / ${play.length}試合` : "";
  const parts = [];
  if (sched) {
    const order = [...sched].sort((a, b) => a.slot - b.slot || a.court - b.court);
    let last = null;
    for (const s of order) {
      if (s.slot !== last) parts.push(`<h3 class="round-head">🕘 ${esc(s.time)}</h3>`);
      last = s.slot;
      parts.push(matchHtml(c, gen.matches.find((m) => m.id === s.id)));
    }
  } else {
    const heads = new Map();
    for (const m of gen.matches) {
      const key = m.stage === "ko" || m.stage === "third" ? `ko${m.round}${m.stage}` : `lg${m.round}`;
      if (!heads.has(key)) heads.set(key, []);
      heads.get(key).push(m);
    }
    const total = Math.max(0, ...gen.matches.filter((m) => m.stage === "ko").map((m) => m.round));
    // 総当たり（節の順）→ トーナメント（回の順。3位決定戦は決勝の前）
    const order = (list) => [list[0].stage === "ko" || list[0].stage === "third" ? 1 : 0, list[0].round, list[0].stage === "third" ? 0 : 1];
    const sections = [...heads.values()].sort((a, b) => {
      const [x, y] = [order(a), order(b)];
      return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
    });
    for (const list of sections) {
      const first = list[0];
      const title = first.stage === "third" ? "3位決定戦" : first.stage === "ko" ? roundName(first.round, total) : `第${first.round}節`;
      parts.push(`<h3 class="round-head">${esc(title)}</h3>`);
      const byes = list.filter((m) => m.bye).map((m) => resolved[m.id]?.winner || null);
      if (byes.length) parts.push(`<p class="bye-note">シード（次の回から）：${byes.map((id) => (id ? esc(teamName(t, id)) : esc(sideLabel(list.find((m) => m.bye)?.home, gen)))).join("・")}</p>`);
      for (const m of list) if (!m.bye) parts.push(matchHtml(c, m));
    }
  }
  $("matches").innerHTML = parts.join("");
}

// トーナメント表・順位表・試合の一覧を描きなおす
function renderResults() {
  const c = compute();
  renderBracket(c);
  renderStandings(c);
  renderMatches(c);
}

// 画面をまるごと描きなおす
function renderAll() {
  renderEvents();
  renderTeams();
  renderFormat();
  renderSched();
  renderResults();
}

// ---- 結果を入れる ----

/**
 * 点を変える。kind は "s"（点）か "pk"、k は 0（ホーム）か 1（アウェイ）、d は −1・＋1・0（「–」を押したとき：0 から入れる）
 */
function setScore(mid, kind, k, d) {
  const t = current();
  const res = t.results[mid] ? clone(t.results[mid]) : { s: [0, 0] };
  if (kind === "pk") res.pk = res.pk || [0, 0];
  const list = res[kind];
  list[k] = Math.min(LIMITS.score, Math.max(0, list[k] + d));
  if (res.s[0] !== res.s[1]) delete res.pk; // 同点でなくなったら PK はいらない
  t.results[mid] = res;
  persist();
  renderResults();
}

// 試合の結果を消す（「元に戻す」で戻せる）
function clearScore(mid) {
  const t = current();
  const before = t.results[mid];
  delete t.results[mid];
  persist();
  renderResults();
  toast("結果を消しました", () => {
    current().results[mid] = before;
    persist();
    renderResults();
  });
}

/**
 * さくせん盤から戻ってきた結果（{ tid, mid, s, pk? }）を、その大会に入れる。この端末にない大会なら知らせるだけ。
 * 入れたら、その大会を開いて「元に戻す」つきで知らせる
 */
function applyIncoming(list) {
  // 同じ試合の結果がリンクと inbox の両方から来たときは、あとのもの1つだけ
  const unique = [...new Map(list.map((x) => [`${x.tid}|${x.mid}`, x])).values()];
  for (const x of unique) {
    const t = data.list.find((e) => e.id === x.tid);
    if (!t) {
      toast("この端末にない大会の結果でした（大会を作った端末で開いてね）");
      continue;
    }
    viewing = null;
    data.current = t.id;
    const before = t.results[x.mid];
    t.results[x.mid] = { s: x.s, ...(x.pk ? { pk: x.pk } : {}) };
    persist();
    renderAll();
    const c = compute();
    const m = c.gen.matches.find((e) => e.id === x.mid);
    const line = m ? matchLine(t, c.gen, c.resolved, m) : "";
    toast(seasonal(`さくせん盤から結果を入れました${line ? `：${line}` : ""}`), () => {
      if (before) t.results[x.mid] = before;
      else delete t.results[x.mid];
      persist();
      renderAll();
    });
  }
}

// 同じ端末でさくせん盤から戻ってきた結果（inbox）を入れる
const takeLocalResults = () => {
  const list = takeInbox();
  if (list.length) applyIncoming(list);
};

// ---- 送る・保存する ----

// 画像の保存の画面（長押しで保存・共有・ダウンロード）を出す
function showImageSheet(blob) {
  const url = URL.createObjectURL(blob);
  const file = new File([blob], `${current().name || TOOL.name}.png`, { type: "image/png" });
  const sheet = document.createElement("div");
  sheet.className = "ls-sheet image-sheet";
  sheet.innerHTML = `<div class="ls-sheet-card" role="dialog" aria-modal="true" aria-label="画像"><img alt="組み合わせの画像"><p class="ls-hint">画像を長押しすると保存できます。</p><div class="ls-stack actions"></div><button class="ls-button" type="button" data-close>閉じる</button></div>`;
  sheet.querySelector("img").src = url;
  const actions = sheet.querySelector(".actions");
  if (navigator.canShare?.({ files: [file] })) {
    const share = Object.assign(document.createElement("button"), { type: "button", className: "ls-button is-primary is-block", textContent: "📤 共有・保存" });
    share.addEventListener("click", () => navigator.share({ files: [file] }).catch(() => {}));
    actions.append(share);
  }
  actions.append(Object.assign(document.createElement("a"), { className: "ls-button is-block", href: url, download: file.name, textContent: "⬇️ ダウンロード" }));
  // 画面を閉じる（画像の中身も手放す）
  const close = () => {
    sheet.remove();
    URL.revokeObjectURL(url);
  };
  sheet.addEventListener("click", (e) => (e.target === sheet || e.target.closest("[data-close]")) && close());
  document.body.append(sheet);
}

let savingImage = false; // 画像を作っているあいだ（二重押しで画面がふえないように）
// 📷 画像で保存：組み合わせ表・順位表・試合の一覧の画像を作り、保存の画面を出す
async function saveImage() {
  if (savingImage) return;
  savingImage = true;
  try {
    await document.fonts?.ready;
    const c = compute();
    const canvas = drawTournament(c.t, c.gen, c.resolved, c.sched);
    const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
    if (!blob) return toast("画像を作れませんでした。少し待って、もう一度押してね");
    showImageSheet(blob);
  } finally {
    savingImage = false;
  }
}

// 🔗 見る人用のリンクを、共有メニューで渡す（使えなければコピー）
async function shareView() {
  const url = viewUrl(current());
  const title = current().name || TOOL.name;
  try {
    if (navigator.share) return await navigator.share({ title, url });
  } catch (e) {
    if (e?.name === "AbortError") return;
  }
  try {
    await navigator.clipboard.writeText(url);
    toast("見る人用のリンクをコピーしました");
  } catch {
    window.LineShareUI?.ask({ title: "見る人用のリンク", text: "長押しでコピーしてね", input: url, readonly: true, ok: "閉じる", cancel: null });
  }
}

// カードで送る：組み合わせ・順位をおくるんのカードにして開く
function sendCard() {
  const c = compute();
  if (!c.gen.matches.length) return toast("チームを2つ以上入れると送れます");
  if (!window.OQRN) return toast("おくるんを読みこめませんでした。電波のあるところで、もう一度押してね");
  location.href = window.OQRN.cardUrl(cardParams(c.t, c.gen, c.resolved));
}

// ---- 操作 ----

// 押す・入力を受けるしかけを付ける（はじめに1回）
function bindEvents() {
  // 大会
  $("eventSelect").addEventListener("change", (e) => {
    data.current = e.target.value;
    persist();
    renderAll();
  });
  $("eventName").addEventListener("input", (e) => {
    current().name = e.target.value.slice(0, LIMITS.title);
    persist();
    const opt = [...$("eventSelect").options].find((o) => o.value === current().id);
    if (opt) opt.textContent = eventLabel(current());
  });
  $("newEvent").addEventListener("click", () => {
    if (data.list.length >= LIMITS.tournaments) return toast(`保存できる大会は ${LIMITS.tournaments} 件まで。使わないものを消すと作れます`);
    const t = blankTournament();
    data.list.push(t);
    data.current = t.id;
    persist();
    renderAll();
    $("eventName").focus();
  });
  $("copyEvent").addEventListener("click", () => {
    if (data.list.length >= LIMITS.tournaments) return toast(`保存できる大会は ${LIMITS.tournaments} 件まで。使わないものを消すと作れます`);
    const t = { ...clone(current()), id: newId("q"), createdAt: Date.now(), updatedAt: Date.now() };
    t.name = `${current().name || "無題の大会"}（コピー）`.slice(0, LIMITS.title);
    data.list.push(t);
    data.current = t.id;
    persist();
    renderAll();
    toast("複製しました");
  });
  $("deleteEvent").addEventListener("click", () => {
    const t = current();
    const at = data.list.indexOf(t);
    data.list.splice(at, 1);
    if (!data.list.length) data.list.push(blankTournament());
    data.current = data.list[0].id;
    persist();
    renderAll();
    toast(`「${eventLabel(t)}」を消しました`, () => {
      data.list.splice(at, 0, t);
      data.current = t.id;
      persist();
      renderAll();
    });
  });
  $("saveView").addEventListener("click", () => {
    if (data.list.length >= LIMITS.tournaments) return toast(`保存できる大会は ${LIMITS.tournaments} 件まで。使わないものを消すと保存できます`);
    const t = { ...cleanTournament(viewing), id: newId("q"), createdAt: Date.now(), updatedAt: Date.now() };
    data.list.push(t);
    data.current = t.id;
    viewing = null;
    history.replaceState(null, "", location.pathname);
    persist();
    renderAll();
    toast(seasonal("この端末に保存しました"));
  });

  // チーム：名前・並べかえ・消す
  $("teamList").addEventListener("input", (e) => {
    const li = e.target.closest(".team-row");
    if (!li || !e.target.classList.contains("team-name")) return;
    const team = teamById(li.dataset.tid);
    team.name = e.target.value.slice(0, LIMITS.name);
    persist();
    renderResults();
  });
  $("teamList").addEventListener("click", (e) => {
    const li = e.target.closest(".team-row");
    const move = e.target.closest("[data-move]");
    if (li && move) {
      const d = Number(move.dataset.move);
      change((t) => {
        const i = t.teams.findIndex((x) => x.id === li.dataset.tid);
        const j = i + d;
        if (j < 0 || j >= t.teams.length) return;
        [t.teams[i], t.teams[j]] = [t.teams[j], t.teams[i]];
      });
    }
    if (li && e.target.closest("[data-remove]")) {
      const name = teamName(current(), li.dataset.tid);
      change((t) => (t.teams = t.teams.filter((x) => x.id !== li.dataset.tid)), `「${name}」を消しました`);
    }
  });
  $("addTeam").addEventListener("click", () => {
    change((t) => t.teams.length < LIMITS.teams && t.teams.push({ id: nextTeamId(t), name: "", color: colorAt(t.teams.length) }));
    const inputs = document.querySelectorAll(".team-name");
    inputs[inputs.length - 1]?.focus();
  });
  $("shuffleTeams").addEventListener("click", () =>
    change((t) => {
      for (let i = t.teams.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [t.teams[i], t.teams[j]] = [t.teams[j], t.teams[i]];
      }
    }, "シャッフルしました")
  );
  $("bulkToggle").addEventListener("click", () => {
    const open = $("bulkBox").hidden;
    $("bulkBox").hidden = !open;
    $("bulkToggle").setAttribute("aria-expanded", String(open));
    if (open) $("bulkText").value = current().teams.map((x) => x.name).join("\n");
  });
  $("bulkApply").addEventListener("click", () => {
    const names = $("bulkText").value.split("\n").map((s) => s.trim().slice(0, LIMITS.name)).filter(Boolean).slice(0, LIMITS.teams);
    if (names.length < 2) return toast("2チーム以上入れてね");
    change((t) => {
      // 同じ名前のチームは、id と色をそのまま使う（結果と色を残す）
      const pool = [...t.teams];
      t.teams = names.map((name, i) => {
        const k = pool.findIndex((x) => x.name === name);
        if (k >= 0) return pool.splice(k, 1)[0];
        return { id: "", name, color: colorAt(i) };
      });
      t.teams.forEach((x) => !x.id && (x.id = nextTeamId(t)));
    }, `${names.length}チームを入れました`);
    $("bulkBox").hidden = true;
    $("bulkToggle").setAttribute("aria-expanded", "false");
  });

  // 形
  $("thirdPlace").addEventListener("change", (e) => change((t) => (t.opts.thirdPlace = e.target.checked)));
  document.querySelectorAll("[data-legs]").forEach((b) => b.addEventListener("click", () => change((t) => (t.opts.legs = Number(b.dataset.legs)))));

  // 日程
  $("schedOn").addEventListener("change", (e) => {
    current().sched.on = e.target.checked;
    persist();
    renderSched();
    renderResults();
  });
  for (const [id, key] of [["schedDate", "date"], ["schedStart", "start"], ["schedPlace", "place"]]) {
    $(id).addEventListener("input", (e) => {
      current().sched[key] = key === "place" ? e.target.value.slice(0, LIMITS.place) : e.target.value;
      persist();
      renderSched();
      renderResults();
    });
  }

  // 試合：点・PK・結果を消す
  $("matches").addEventListener("click", (e) => {
    const b = e.target.closest("[data-score]");
    if (b && !viewing) return setScore(b.dataset.mid, b.dataset.score, Number(b.dataset.k), Number(b.dataset.d));
    const clear = e.target.closest("[data-clear]");
    if (clear) clearScore(clear.dataset.clear);
  });

  // 送る・保存
  $("sendCard").addEventListener("click", sendCard);
  $("saveImage").addEventListener("click", saveImage);
  $("shareView").addEventListener("click", shareView);

  // 同じ端末のさくせん盤から結果が戻ってきたら入れる（別のタブで入れたとき・もどってきたとき）
  window.addEventListener("storage", (e) => e.key?.endsWith(":inbox") && takeLocalResults());
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && takeLocalResults());
}

// はじめに動かす：名前を出し、受けとった結果を入れ、画面を作る
function init() {
  document.title = `${TOOL.name}｜${TOOL.copy}`;
  $("toolName").textContent = TOOL.name;
  $("toolCopy").textContent = TOOL.copy;
  bindEvents();
  renderAll();
  // ?result=（さくせん盤からの結果のリンク）と、同じ端末の inbox
  const q = new URLSearchParams(location.search);
  const incoming = q.has("result") ? readResult(q.get("result")) : null;
  if (q.has("result")) {
    history.replaceState(null, "", location.pathname);
    if (!incoming) toast("結果のリンクが読めませんでした（途中で切れていないか確かめてね）");
  }
  if (q.has("view") && !viewing) {
    history.replaceState(null, "", location.pathname);
    toast("見る人用のリンクが読めませんでした（途中で切れていないか確かめてね）");
  }
  applyIncoming([...(incoming ? [incoming] : []), ...takeInbox()]);
  if (viewing) return; // 見るだけのときは、使い方を出さない
  window.LineShareUI?.firstTip(
    TOOL.key,
    ["チームの名前と色を入れる（上から順にシード）", "🏆 形を選ぶと、組み合わせがすぐできる", "点を入れると、勝ち上がりと順位表が出る"],
    $("eventPanel")
  );
}

init();
