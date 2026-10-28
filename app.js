// くみあわせ（QumiAwase）：入口。画面（大会・チーム・形・日程・トーナメント表・順位表・試合と結果・送る）を作り、ボタン・入力を受け、部品（js/）をつなぐ。
// index.html から読む（type="module"）。組み合わせは js/pairing.js、順位と勝ち上がりは js/stats.js、端末に残すのは js/store.js、
// リンク（見る人用・さくせん盤・ろくが・結果を戻す）は js/link.js、カードは js/card.js、画像は js/image.js
import { FORMATS, LIMITS, PRESETS, TEAM_COLORS, TOOL } from "./js/settings.js?v=202610281357";
import { addMinutes, autoReferees, fitOptions, generate, refereeOptions, roundName, timeSchedule } from "./js/pairing.js?v=202610281357";
import { durationLabel, estimate, outcome, podium, resolve, table } from "./js/stats.js?v=202610281357";
import { blankTournament, cleanTournament, colorAt, loadAll, newId, saveAll, takeInbox } from "./js/store.js?v=202610281357";
import { LINK_MAX, qronosUrl, readResult, readView, roqgaUrl, saqsenUrl, viewUrl } from "./js/link.js?v=202610281357";
import { cardParams, dateLabel, formatLabel, matchLine, matchTitle, sideLabel, summaryText, teamName } from "./js/card.js?v=202610281357";
import { drawTournament } from "./js/image.js?v=202610281357";

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
  const changed = structureKey(t) !== key;
  const lost = Object.keys(t.results).length > 0 && changed;
  if (lost) t.results = {};
  if (changed) t.referees = {}; // 組み合わせが変わったら、審判も入れなおし
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

/**
 * いまの大会の組み合わせ・時間の割りふり・勝ち上がり・見こみをまとめて返す。
 * { t, gen, plan（試合の順・コート・はじまりからの分。時刻を入れるときは time も）, sched（時刻を入れるときだけ plan、ほかは null）, timeOf, numberOf（何試合目）, resolved, est（見こみ） }
 */
function compute() {
  const t = current();
  const gen = generate(t.teams, t.format, t.opts);
  const s = t.sched;
  const plan = timeSchedule(gen.matches, { courts: s.courts, minutes: s.minutes, rest: s.rest, avoid: s.avoid }).map((p) => (s.on ? { ...p, time: addMinutes(s.start, p.start) } : p));
  const sched = s.on && plan.length ? plan : null;
  const timeOf = Object.fromEntries((sched || []).map((p) => [p.id, p]));
  const numberOf = Object.fromEntries(plan.map((p, i) => [p.id, i + 1]));
  const resolved = resolve(gen, t.teams.map((x) => x.id), t.results, t.points);
  return { t, gen, plan, sched, timeOf, numberOf, resolved, est: estimate(gen, plan) };
}

// ---- 画面：ページのタブ（準備・試合） ----

// いま開いているページ（"prep"＝準備・"play"＝試合）と、試合のページで見せる中身（"matches"・"standings"・"bracket"）
const page = { now: "", play: "matches" };

// ページのタブと、準備・試合のどちらを出すかを描きなおす（見る人用のリンクのときは試合だけ）
function renderPage() {
  if (viewing) page.now = "play";
  if (!page.now) page.now = Object.keys(current().results).length ? "play" : "prep";
  $("pageTabs").hidden = Boolean(viewing);
  document.querySelectorAll("[data-page]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.page === page.now)));
  $("pagePrep").hidden = page.now !== "prep";
  $("pagePlay").hidden = page.now !== "play";
}

// ---- 画面：試合の種類（初期設定のタブ） ----

// 試合の種類のタブと、選んでいる種類の説明を描きなおす
function renderPresets() {
  const t = current();
  const tabs = [...PRESETS, { key: "", label: "✏️ 自分で決める" }];
  $("presetTabs").innerHTML = tabs.map((p) => `<button class="ls-chip" type="button" role="tab" data-preset="${esc(p.key)}" aria-selected="${esc(t.preset === p.key)}">${esc(p.label)}</button>`).join("");
  // 選んでいるタブが見えるよう、横に送る（ページは動かさない）
  const box = $("presetTabs");
  const sel = box.querySelector('[aria-selected="true"]');
  if (sel && (sel.offsetLeft < box.scrollLeft || sel.offsetLeft + sel.offsetWidth > box.scrollLeft + box.clientWidth)) box.scrollLeft = sel.offsetLeft - 12;
  const p = PRESETS.find((x) => x.key === t.preset);
  $("presetNote").textContent = p
    ? `${p.note} → 1試合${p.minutes}分・空き${p.rest}分・勝ち点 勝${p.points.win}・分${p.points.draw}・負${p.points.loss}（目安。下で変えられます）`
    : "1試合の時間・空き時間・勝ち点は、下の「形」「時間と日程」で決めます。";
}

// 試合の種類を選ぶ：1試合の時間・空き時間・勝ち点・3位決定戦の初期設定を入れる（「元に戻す」で戻せる）
function applyPreset(key) {
  const p = PRESETS.find((x) => x.key === key);
  if (!p) return change((t) => (t.preset = ""));
  change((t) => {
    t.preset = p.key;
    Object.assign(t.sched, { minutes: p.minutes, rest: p.rest, avoid: true });
    t.points = { ...p.points };
    t.opts.thirdPlace = p.thirdPlace;
  }, `${p.label}の初期設定にしました`);
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
        <button class="ls-icon-button drag-handle" type="button" aria-label="${i + 1}番目。押したまま上下に動かすと並べかえ（↑↓ キーでも）">⠿</button>
        <button class="ls-icon-button" type="button" data-remove aria-label="このチームを消す" ${t.teams.length <= 2 ? "disabled" : ""}>✕</button>
        <div class="ls-picker" style="--cols: 9" hidden></div>`;
      li.querySelector(".team-name").value = team.name;
      bindTeamColor(li, team);
      const handle = li.querySelector(".drag-handle");
      handle.addEventListener("pointerdown", (e) => dragTeam(e, li));
      // つまみにフォーカスして ↑↓ キー：1つ上・下へ（動かしたあとも、そのチームのつまみにフォーカス）
      handle.addEventListener("keydown", (e) => {
        const d = { ArrowUp: -1, ArrowDown: 1 }[e.key];
        if (!d) return;
        e.preventDefault();
        const ids = current().teams.map((x) => x.id);
        const j = i + d;
        if (j < 0 || j >= ids.length) return;
        [ids[i], ids[j]] = [ids[j], ids[i]];
        reorderTeams(ids);
        $("teamList").querySelector(`[data-tid="${team.id}"] .drag-handle`)?.focus();
      });
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

// チームの並びを、ids の順にする（並べかえ。組み合わせが変わるので、結果があれば消して「元に戻す」）
function reorderTeams(ids) {
  const now = current().teams.map((x) => x.id);
  if (ids.join() === now.join()) return renderTeams();
  change((t) => (t.teams = ids.map((id) => t.teams.find((x) => x.id === id))));
}

// つまみ（⠿）を押したまま上下に動かして、チームの行を並べかえる（指でもマウスでも）。はなしたら、その順にする
function dragTeam(e, li) {
  const handle = e.currentTarget;
  const list = $("teamList");
  e.preventDefault();
  try {
    handle.setPointerCapture(e.pointerId);
  } catch {
    // つかめなくても動かせる
  }
  li.classList.add("is-dragging");
  // 指の高さが、となりの行のまん中をこえたら入れかえる（行が動いても行ったり来たりしない）
  const onMove = (ev) => {
    const y = ev.clientY;
    const prev = li.previousElementSibling;
    const next = li.nextElementSibling;
    if (prev && y < prev.getBoundingClientRect().top + prev.offsetHeight / 2) list.insertBefore(li, prev);
    else if (next && y > next.getBoundingClientRect().top + next.offsetHeight / 2) list.insertBefore(next, li);
    if (y < 60) window.scrollBy(0, -12);
    else if (y > window.innerHeight - 60) window.scrollBy(0, 12);
  };
  // はなしたとき：並んだ順でチームを並べかえる
  const onUp = () => {
    handle.removeEventListener("pointermove", onMove);
    handle.removeEventListener("pointerup", onUp);
    handle.removeEventListener("pointercancel", onUp);
    li.classList.remove("is-dragging");
    reorderTeams([...list.children].map((row) => row.dataset.tid));
  };
  handle.addEventListener("pointermove", onMove);
  handle.addEventListener("pointerup", onUp);
  handle.addEventListener("pointercancel", onUp);
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
function stepper(el, { get, set, min, max, step = 1, label, typed = false }) {
  const value = get();
  el.innerHTML = `<button type="button" data-d="-1" aria-label="${esc(label)}をへらす" ${esc(value <= min ? "disabled" : "")}>−</button><output aria-label="${esc(label)}">${esc(value)}</output><button type="button" data-d="1" aria-label="${esc(label)}をふやす" ${esc(value >= max ? "disabled" : "")}>＋</button>`;
  el.onclick = (e) => {
    const d = Number(e.target.closest("button")?.dataset.d);
    if (!d) return;
    set(Math.min(max, Math.max(min, get() + d * step)));
  };
  if (!typed) return;
  // typed のときは、数字を押して直接入れられる欄にする（入れおわったら範囲におさめる）
  const input = Object.assign(document.createElement("input"), { type: "number", inputMode: "numeric", min, max, step: 1, value });
  input.setAttribute("aria-label", label);
  el.querySelector("output").replaceWith(input);
  input.onfocus = () => input.select();
  input.onchange = () => {
    const n = Math.round(Number(input.value));
    if (!Number.isFinite(n) || input.value === "") return void (input.value = get());
    set(Math.min(max, Math.max(min, n)));
  };
  input.onkeydown = (e) => e.key === "Enter" && input.blur();
}

// 形（トーナメント・総当たり・グループ）と、その設定・勝ち点を描きなおす
function renderFormat() {
  const t = current();
  const opts = fitOptions(t.teams.length, t.opts);
  $("formatMeta").textContent = [PRESETS.find((p) => p.key === t.preset)?.label.replace(/^\S+\s/, ""), FORMATS[t.format]].filter(Boolean).join("・");
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
    stepper(document.querySelector(`[data-point="${key}"]`), { get: () => t.points[key], set: (v) => ((t.points[key] = v), (t.preset = ""), persist(), renderPresets(), renderFormat(), renderResults()), min: 0, max: 9, label: "勝ち点" });
  }
  $("pointsMeta").textContent = `勝${t.points.win}・分${t.points.draw}・負${t.points.loss}`;
}

// 時間と日程の欄（コート・1試合の時間・連続試合と空き時間・時刻を入れるか）を描きなおす
function renderSched() {
  const t = current();
  const s = t.sched;
  $("schedOn").checked = s.on;
  $("schedBox").hidden = !s.on;
  $("restRow").hidden = !s.avoid;
  $("restHint").hidden = !s.avoid;
  document.querySelectorAll("[data-avoid]").forEach((b) => b.setAttribute("aria-checked", String((b.dataset.avoid === "1") === s.avoid)));
  if (document.activeElement !== $("schedDate")) $("schedDate").value = s.date;
  if (document.activeElement !== $("schedStart")) $("schedStart").value = s.start;
  if (document.activeElement !== $("schedPlace")) $("schedPlace").value = s.place;
  $("schedMeta").textContent = [s.on ? `${dateLabel(s.date)} ${s.start}〜`.trim() : "", `コート${s.courts}`, `${s.minutes}分`, s.avoid ? `空き${s.rest}分` : "連続OK"].filter(Boolean).join("・");
  // 時間を変える（1試合の時間・空き時間を手で変えたら、試合の種類は「自分で決める」に）
  const setSched = (key) => (v) => {
    t.sched[key] = v;
    if (key === "minutes" || key === "rest") t.preset = "";
    persist();
    renderPresets();
    renderFormat(); // 枠の見出しに試合の種類を出しているので
    renderSched();
    renderResults();
  };
  stepper(document.querySelector('[data-sched="courts"]'), { get: () => s.courts, set: setSched("courts"), min: 1, max: LIMITS.courts, label: "コートの数" });
  stepper(document.querySelector('[data-sched="minutes"]'), { get: () => s.minutes, set: setSched("minutes"), min: 1, max: LIMITS.minutes, label: "1試合の時間", typed: true });
  stepper(document.querySelector('[data-sched="rest"]'), { get: () => s.rest, set: setSched("rest"), min: 0, max: LIMITS.minutes, label: "空き時間", typed: true });
}

// 見こみ（試合の数・1チームの最多の試合の数・かかる時間）を、形の下と試合のタブの見出しに出す
function renderEstimate({ t, est }) {
  const end = t.sched.on ? `・${t.sched.start}〜${addMinutes(t.sched.start, est.minutes)}` : "";
  const text = est.matches ? `📏 ${est.matches}試合・1チーム最多${est.most}試合・${durationLabel(est.minutes)}${end}（1試合${t.sched.minutes}分・コート${t.sched.courts}${t.sched.avoid ? `・空き${t.sched.rest}分` : ""}）` : "";
  $("estimate").textContent = text;
  $("playEstimate").textContent = text;
  const when = [dateLabel(t.sched.on ? t.sched.date : ""), t.sched.on ? t.sched.place : ""].filter(Boolean).join(" ");
  $("playTitle").textContent = `🏆 ${t.name || "組み合わせ"}　${[when, FORMATS[t.format], `${t.teams.length}チーム`].filter(Boolean).join("・")}`;
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
function matchHtml(c, m) {
  const { t, gen, timeOf, numberOf, resolved } = c;
  const r = resolved[m.id] || {};
  const res = t.results[m.id];
  const ready = Boolean(r.home && r.away);
  const s = timeOf[m.id];
  const when = s ? `${s.time}${t.sched.courts > 1 ? `・コート${s.court}` : ""}` : numberOf[m.id] ? `第${numberOf[m.id]}試合` : "";
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
  return `<article class="match ${res ? "is-done" : ""}" data-mid="${esc(m.id)}"><div class="match-head"><span>${esc(matchTitle(m, gen))}</span><span>${esc(when)}</span></div>${side(m.home, r.home, 0)}${side(m.away, r.away, 1)}${pkRow}${refereeHtml(c, m)}${actions}</article>`;
}

/**
 * 審判の行の HTML を返す：その試合に出ない・同じ時間に試合のないチームから選ぶ（いなければ「−」だけ）。
 * 入れたチームがあとで出ることになったとき（勝ち上がり・時間の重なり）は ⚠️ をつける。見るだけのときは文字だけ
 */
function refereeHtml(c, m) {
  const { t, gen, plan, resolved } = c;
  const now = t.referees?.[m.id] || "";
  const options = refereeOptions(m, t.teams.map((x) => x.id), resolved, plan, gen.matches);
  const clash = now && !options.includes(now);
  const r = resolved[m.id] || {};
  const why = r.home === now || r.away === now ? "（⚠️ この試合に出る）" : "（⚠️ 同じ時間に試合）";
  const label = now ? `${teamName(t, now)}${clash ? why : ""}` : "−";
  if (viewing) return `<div class="referee-row"><span>🟨 審判</span><b>${esc(label)}</b></div>`;
  if (!options.length && !now) return `<div class="referee-row"><span>🟨 審判</span><b>−</b></div>`;
  const list = clash ? [now, ...options] : options;
  const opts = list.map((id) => `<option value="${esc(id)}" ${esc(id === now ? "selected" : "")}>${esc(id === now && clash ? label : teamName(t, id))}</option>`).join("");
  return `<label class="referee-row ${clash ? "is-clash" : ""}"><span>🟨 審判</span><select data-referee="${esc(m.id)}" aria-label="${esc(matchTitle(m, gen))}の審判"><option value="">−</option>${opts}</select></label>`;
}

// 試合表の見方（"order"＝順番・"court"＝コート別・"team"＝チーム別）と、チーム別で選んでいるチーム
const view = { mode: "order", team: "" };

// 試合のまとまりの見出し（総当たり・グループ・トーナメントの回・3位決定戦）を返す
function sectionTitle(m, gen) {
  const total = Math.max(0, ...gen.matches.filter((x) => x.stage === "ko").map((x) => x.round));
  return m.stage === "third" ? "3位決定戦" : m.stage === "ko" ? roundName(m.round, total) : m.stage === "group" ? "グループの総当たり" : "総当たり";
}

/**
 * そのチームの試合を返す：決まっている試合と、トーナメントの勝ち進み（勝てば・負けたら3位決定戦）、グループから上がれたときの決勝トーナメントのはじめ。
 * [{ m, kind: "fixed"|"win"|"lose"|"advance", mine（勝ち進みのとき、このチームが入る側） }] を、試合の順に返す
 */
function teamPath(c, id) {
  const { gen, resolved, numberOf } = c;
  const has = (m) => resolved[m.id]?.home === id || resolved[m.id]?.away === id;
  const out = gen.matches.filter((m) => !m.bye && has(m)).map((m) => ({ m, kind: "fixed" }));
  const seen = new Set(out.map((x) => x.m.id));
  // トーナメント：いま勝ち残っている最後の試合（不戦勝もふくむ）から、勝ったら出る試合をたどる
  const ko = gen.matches.filter((m) => m.stage === "ko" && (has(m) || (m.bye && resolved[m.id]?.winner === id))).sort((a, b) => a.round - b.round);
  let cur = ko.at(-1);
  if (cur && resolved[cur.id]?.loser !== id) {
    for (;;) {
      const third = gen.matches.find((x) => x.stage === "third" && (x.home.loserOf === cur.id || x.away.loserOf === cur.id));
      if (third && !seen.has(third.id) && resolved[cur.id]?.winner !== id) {
        out.push({ m: third, kind: "lose", mine: third.home.loserOf === cur.id ? third.home : third.away });
        seen.add(third.id);
      }
      if (resolved[cur.id]?.winner && resolved[cur.id].winner !== id) break;
      const next = gen.matches.find((x) => x.stage === "ko" && (x.home.winnerOf === cur.id || x.away.winnerOf === cur.id));
      if (!next) break;
      if (!seen.has(next.id)) {
        out.push({ m: next, kind: "win", mine: next.home.winnerOf === cur.id ? next.home : next.away });
        seen.add(next.id);
      }
      cur = next;
    }
  }
  // グループ：まだ上がるチームが決まっていなければ、決勝トーナメントのいちばん早い試合（上がれば）
  const inGroup = gen.groups?.some((g) => g.ids.includes(id));
  if (inGroup && !ko.length) {
    const first = gen.matches.filter((m) => m.stage === "ko" && !m.bye).sort((a, b) => (numberOf[a.id] ?? 0) - (numberOf[b.id] ?? 0))[0];
    if (first) out.push({ m: first, kind: "advance" });
  }
  return out.sort((a, b) => (numberOf[a.m.id] ?? 0) - (numberOf[b.m.id] ?? 0));
}

const KIND_LABEL = { fixed: "", win: "（勝てば）", lose: "（負けたら）", advance: "（上がれば）" };

// teamPath の1つの試合の、相手の呼び名を返す（決まっていればチーム名、まだなら「準決勝 2の勝者」など）
// チーム別の行の相手（決まっていればチームの id。未定なら null）
function opponentId(c, id, { m, kind, mine }) {
  const r = c.resolved[m.id] || {};
  if (kind === "fixed") return r.home === id ? r.away : r.home;
  if (!mine) return null;
  return (m.away === mine ? r.home : r.away) || null;
}

function opponentLabel(c, id, { m, kind, mine }) {
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

// くろのすで、そのチームの試合（勝ち進みもふくむ）のカウントダウンを開くリンクを返す。日時がなければ null
// くろのすのボードに付けるリンク：大会の見る人用リンク（長すぎるときは、くみあわせを開くだけ）
function qronosLink(c) {
  const link = viewUrl(c.t);
  return { url: link.length <= LINK_MAX ? link : TOOL.url, label: "🏆 大会を見る" };
}

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

// 試合表の見方のボタン・チーム別のチームの選択・くろのすのボタンを描きなおす
function renderViewTools(c) {
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
    $("teamTools").innerHTML = url
      ? `<a class="ls-chip" href="${esc(url)}" target="_blank" rel="noopener">⏳ この試合をくろのすでカウントダウン</a>`
      : `<p class="ls-hint">⏳ 「時刻を入れる」で日にちとはじまりを入れると、このチームの試合をくろのすでカウントダウンできます。</p>`;
  }
  const all = allQronosUrl(c);
  $("qronosAll").hidden = !all;
  if (all) $("qronosAll").href = all;
}

// 試合の一覧を描きなおす（見方：順番・コート別・チーム別。順番は時刻か何試合目の順で、まとまりごとに見出し）
function renderMatches(c) {
  const { t, gen, plan, resolved } = c;
  const play = gen.matches.filter((m) => !m.bye);
  $("matchesEmpty").hidden = gen.matches.length > 0;
  $("matchViews").hidden = !play.length;
  $("refereeTools").hidden = !play.length || Boolean(viewing);
  $("clearReferees").hidden = !Object.keys(t.referees || {}).length;
  const done = play.filter((m) => outcome(t.results[m.id])).length;
  $("matchesMeta").textContent = play.length ? `${done} / ${play.length}試合` : "";
  renderViewTools(c);
  const byId = Object.fromEntries(gen.matches.map((m) => [m.id, m]));
  const parts = [];
  if (view.mode === "team" && view.team) {
    const path = teamPath(c, view.team);
    if (!path.length) parts.push(`<p class="ls-hint">このチームの試合はまだ決まっていません。</p>`);
    for (const x of path) {
      if (x.kind === "fixed") parts.push(matchHtml(c, x.m));
      else parts.push(`<p class="path-note">${esc(numberOf2(c, x.m))}　${esc(matchTitle(x.m, gen))}${esc(KIND_LABEL[x.kind])}　vs ${esc(opponentLabel(c, view.team, x))}</p>`);
    }
  } else if (view.mode === "court") {
    for (let court = 1; court <= t.sched.courts; court++) {
      parts.push(`<h3 class="round-head">🏟️ コート${court}</h3>`);
      for (const p of plan.filter((x) => x.court === court)) parts.push(matchHtml(c, byId[p.id]));
    }
  } else {
    let last = "";
    for (const p of plan) {
      const m = byId[p.id];
      const head = c.sched ? `🕘 ${p.time}` : sectionTitle(m, gen);
      if (head !== last) {
        parts.push(`<h3 class="round-head">${esc(head)}</h3>`);
        // トーナメントの1回戦の前に：不戦勝で次の回から出るチーム
        const byes = !c.sched && m.stage === "ko" && m.round === 1 ? gen.matches.filter((x) => x.bye) : [];
        if (byes.length) parts.push(`<p class="bye-note">シード（次の回から）：${byes.map((x) => esc(resolved[x.id]?.winner ? teamName(t, resolved[x.id].winner) : sideLabel(x.home.empty ? x.away : x.home, gen))).join("・")}</p>`);
      }
      last = head;
      parts.push(matchHtml(c, m));
    }
  }
  $("matches").innerHTML = parts.join("");
}

// 試合の時刻か「第N試合」を返す（チーム別の勝ち進みの行に使う）
const numberOf2 = (c, m) => (c.timeOf[m.id]?.time ? `${c.timeOf[m.id].time}${c.t.sched.courts > 1 ? ` コート${c.timeOf[m.id].court}` : ""}` : `第${c.numberOf[m.id]}試合`);

// 試合のページの、見せる中身のタブを描きなおす（その形にあるものだけ。選んでいる1つだけ出す）
function renderPlayTabs(c) {
  const has = {
    matches: true,
    standings: c.t.format !== "knockout" && c.gen.matches.length > 0,
    bracket: c.gen.matches.some((m) => m.stage === "ko")
  };
  if (!has[page.play]) page.play = "matches";
  document.querySelectorAll("[data-play]").forEach((b) => {
    b.hidden = !has[b.dataset.play];
    b.setAttribute("aria-selected", String(b.dataset.play === page.play));
  });
  $("playTabs").hidden = Object.values(has).filter(Boolean).length < 2;
  $("matchesPanel").hidden = page.play !== "matches";
  if (page.play !== "standings") $("standingsPanel").hidden = true;
  if (page.play !== "bracket") $("bracketPanel").hidden = true;
}

// トーナメント表・順位表・試合の一覧を描きなおす
function renderResults() {
  const c = compute();
  renderEstimate(c);
  renderBracket(c);
  renderStandings(c);
  renderMatches(c);
  renderPlayTabs(c);
}

// 画面をまるごと描きなおす
function renderAll() {
  renderPage();
  renderPresets();
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

// 印刷・PDF 用の「大会のまとめ」を作る：名前・日にちと会場・形・チーム・順位表・トーナメント表・試合の表（何試合目・時刻・コート・結果）
function printSummary(c) {
  const { t, gen, plan, resolved } = c;
  const byId = Object.fromEntries(gen.matches.map((m) => [m.id, m]));
  const when = [dateLabel(t.sched.on ? t.sched.date : ""), t.sched.on ? t.sched.place : ""].filter(Boolean).join("　");
  const rows = plan
    .map((p, i) => {
      const m = byId[p.id];
      const r = resolved[m.id] || {};
      const res = t.results[m.id];
      const side = (sideDef, id) => esc(id ? teamName(t, id) : sideLabel(sideDef, gen));
      const score = res ? `${res.s[0]} - ${res.s[1]}${res.pk ? `（PK ${res.pk[0]}-${res.pk[1]}）` : ""}` : "";
      return `<tr><td>${esc(i + 1)}</td><td>${esc(p.time || "")}</td><td>${esc(t.sched.courts > 1 ? p.court : "")}</td><td>${esc(matchTitle(m, gen))}</td><td>${side(m.home, r.home)}</td><td class="score">${esc(score)}</td><td>${side(m.away, r.away)}</td><td>${esc(t.referees?.[m.id] ? teamName(t, t.referees[m.id]) : "−")}</td></tr>`;
    })
    .join("");
  const teams = gen.groups?.length
    ? gen.groups.map((g) => `<p><b>${esc(g.key)}組</b>：${g.ids.map((id) => esc(teamName(t, id))).join("・")}</p>`).join("")
    : `<p>${t.teams.map((x, i) => `${esc(i + 1)}. ${esc(teamName(t, x.id))}`).join("　")}</p>`;
  $("printArea").innerHTML = `
    <h1>🏆 ${esc(t.name || "組み合わせ")}</h1>
    <p>${esc([when, `${formatLabel(t)}・${t.teams.length}チーム`].filter(Boolean).join("　"))}</p>
    <p>${esc(`1試合${t.sched.minutes}分・コート${t.sched.courts}${t.sched.avoid ? `・同じチームの空き時間${t.sched.rest}分` : ""}${t.sched.on ? `・${t.sched.start}〜` : ""}`)}</p>
    <h2>チーム</h2>${teams}
    ${$("standings").innerHTML.trim() ? `<h2>順位表</h2>${$("standings").innerHTML}` : ""}
    ${gen.matches.some((m) => m.stage === "ko") ? `<h2>トーナメント表</h2><div class="bracket">${$("bracket").innerHTML}</div>` : ""}
    <h2>試合</h2>
    <table class="print-table"><thead><tr><th>No</th><th>時刻</th><th>コート</th><th>試合</th><th>ホーム</th><th>結果</th><th>アウェイ</th><th>審判</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="print-foot">${esc(TOOL.name)}（${esc(TOOL.en)}）で作りました</p>`;
}

// 📄 大会のまとめ：印刷・PDF に保存するか、文でコピーするかを選ぶ窓を出す
function openSummary() {
  const c = compute();
  if (!c.gen.matches.length) return toast("チームを2つ以上入れると作れます");
  const sheet = document.createElement("div");
  sheet.className = "ls-sheet";
  sheet.innerHTML = `<div class="ls-sheet-card" role="dialog" aria-modal="true" aria-labelledby="summaryTitle">
    <p id="summaryTitle" class="ls-sheet-title">📄 大会のまとめ</p>
    <p class="ls-hint">名前・日程・チーム・順位表・トーナメント表・試合の表を1つに。印刷の画面で「PDF に保存」を選ぶと PDF になります（iPhone は印刷の画面で共有 → ファイルに保存）。</p>
    <button class="ls-button is-primary is-block" type="button" data-print>🖨️ 印刷・PDF に保存</button>
    <button class="ls-button is-block" type="button" data-copy>📋 文でコピー（LINE・メモに貼る）</button>
    <button class="ls-button is-block" type="button" data-close>閉じる</button>
  </div>`;
  // 窓を閉じる
  const close = () => sheet.remove();
  sheet.addEventListener("click", async (e) => {
    if (e.target === sheet || e.target.closest("[data-close]")) return close();
    if (e.target.closest("[data-print]")) {
      close();
      printSummary(c);
      if (typeof window.print === "function") window.print();
      else toast("このブラウザでは印刷できません。Safari・Chrome で開いてね");
    }
    if (e.target.closest("[data-copy]")) {
      try {
        await navigator.clipboard.writeText(summaryText(c.t, c.gen, c.resolved, c.plan));
        close();
        toast("大会のまとめをコピーしました");
      } catch {
        close();
        window.LineShareUI?.ask({ title: "大会のまとめ", text: "長押しでコピーしてね", input: summaryText(c.t, c.gen, c.resolved, c.plan), readonly: true, ok: "閉じる", cancel: null });
      }
    }
  });
  document.body.append(sheet);
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

  // 時間と日程：連続試合を避ける・続けてもよい
  document.querySelectorAll("[data-avoid]").forEach((b) =>
    b.addEventListener("click", () => {
      current().sched.avoid = b.dataset.avoid === "1";
      persist();
      renderSched();
      renderResults();
    })
  );
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

  // 審判を選ぶ（「−」はなし）
  $("matches").addEventListener("change", (e) => {
    const sel = e.target.closest("[data-referee]");
    if (!sel || viewing) return;
    const t = current();
    t.referees = { ...(t.referees || {}) };
    if (sel.value) t.referees[sel.dataset.referee] = sel.value;
    else delete t.referees[sel.dataset.referee];
    persist();
    renderResults();
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

  // ページのタブ（準備・試合）。切りかえたら上へ
  document.querySelectorAll("[data-page]").forEach((b) =>
    b.addEventListener("click", () => {
      page.now = b.dataset.page;
      renderPage();
      if (page.now === "prep") renderPresets(); // かくれているあいだは横に送れないので、出してから
      window.scrollTo({ top: 0 });
    })
  );
  // 試合のページの、見せる中身のタブ
  document.querySelectorAll("[data-play]").forEach((b) =>
    b.addEventListener("click", () => {
      page.play = b.dataset.play;
      renderResults();
    })
  );
  // 試合の種類
  // 試合の種類と形の枠を開いたら、選んでいる種類のタブが見えるように（閉じているあいだは送れない）
  $("formatFold").addEventListener("toggle", () => $("formatFold").open && renderPresets());
  $("presetTabs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-preset]");
    if (b) applyPreset(b.dataset.preset);
  });

  // 試合表の見方・チーム別のチーム
  document.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => ((view.mode = b.dataset.view), renderResults())));
  $("teamPick").addEventListener("click", (e) => {
    const b = e.target.closest("[data-team]");
    if (!b) return;
    view.team = b.dataset.team;
    renderResults();
  });

  // 送る・保存
  $("openSummary").addEventListener("click", openSummary);
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
