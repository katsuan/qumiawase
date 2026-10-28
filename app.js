// くみあわせ（QumiAwase）：入口。画面（大会・チーム・形・日程・トーナメント表・順位表・試合と結果・送る）を作り、ボタン・入力を受け、部品（js/）をつなぐ。
// index.html から読む（type="module"）。組み合わせは js/pairing.js、順位と勝ち上がりは js/stats.js、端末に残すのは js/store.js、
// リンク（見る人用・さくせん盤・ろくが・結果を戻す）は js/link.js、カードは js/card.js、画像は js/image.js、みんなで入れる（くらぶボット）は js/live.js
import { FORMATS, LIMITS, PRESETS, TEAM_COLORS, TOOL } from "./js/settings.js?v=202610282320";
import { addMinutes, autoReferees, fitOptions, generate, refereeOptions, roundName, timeSchedule } from "./js/pairing.js?v=202610282320";
import { durationLabel, estimate, outcome, podium, RANK_LABELS, rankIn, resolve, table } from "./js/stats.js?v=202610282320";
import { blankTournament, cleanTournament, colorAt, loadAll, newId, saveAll, takeInbox } from "./js/store.js?v=202610282320";
import { LINK_MAX, qronosUrl, readResult, readView, roqgaUrl, saqsenUrl, viewUrl } from "./js/link.js?v=202610282320";
import { cardParams, dateLabel, formatLabel, matchLine, matchTitle, pointsLabel, sideLabel, summaryText, teamName } from "./js/card.js?v=202610282320";
import { drawTournament } from "./js/image.js?v=202610282320";
import { adminKey, botUrlIn, fromServer, inputKey, liveCall, liveError, liveUrl, newLiveId, overlay, PASS_MAX, PASS_MIN, queue, readLive, sessionKey, setSessionKey, toServer } from "./js/live.js?v=202610282320";

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

// みんなで入れる（くらぶボット）：合言葉から作った key。sessionStorage に置けない端末のために、開いているあいだもここに覚える
const liveKeys = {};
// つないだ大会での、この端末の役割（"admin"＝運営・"input"＝入力の人・""＝見るだけ）。つないでいなければ null
function liveRole(t = current()) {
  if (!t || !t.live || viewing) return null;
  return (sessionKey(t.live.id) || liveKeys[t.live.id] || {}).role || "";
}
// 点・審判を入れられないか（見る人用のリンク・つないだ大会で合言葉をまだ入れていない）
const readOnly = () => Boolean(viewing) || liveRole() === "";
// 準備（チーム・形・時間）を変えられないか（つないだ大会で運営でない）
const planLocked = () => liveRole() !== null && liveRole() !== "admin";

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
  liveAfterSave();
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
  const resolved = resolve(gen, t.teams.map((x) => x.id), t.results, t.points, t.rank);
  return { t, gen, plan, sched, timeOf, numberOf, resolved, est: estimate(gen, plan) };
}

// ---- 画面：ページのタブ（準備・試合） ----

// いま開いているページ（"prep"＝準備・"play"＝試合）と、試合のページで見せる中身（"matches"・"standings"・"bracket"）
const page = { now: "", play: "matches" };

// ページのタブと、準備・試合のどちらを出すかを描きなおす（見る人用のリンクのときは試合だけ）
function renderPage() {
  if (viewing || planLocked()) page.now = "play";
  if (!page.now) page.now = Object.keys(current().results).length ? "play" : "prep";
  $("pageTabs").hidden = Boolean(viewing) || planLocked(); // 見るだけ・つないだ大会で運営でないときは、試合だけ
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
    ? `${p.note} → 1試合${p.minutes}分・空き${p.rest}分・勝ち点 勝${p.points.win}・分${p.points.draw}・負${p.points.loss}（目安。勝ち点は上・時間は下で変えられます）`
    : "勝ち点は上の「勝ち点」、1試合の時間・空き時間は下の「時間と日程」で決めます。";
}

// 試合の種類を選ぶ：1試合の時間・空き時間・勝ち点・3位決定戦の初期設定を入れる（「元に戻す」で戻せる）
function applyPreset(key) {
  const p = PRESETS.find((x) => x.key === key);
  if (!p) return change((t) => (t.preset = ""));
  change((t) => {
    t.preset = p.key;
    Object.assign(t.sched, { minutes: p.minutes, rest: p.rest, avoid: true });
    t.points = { ...t.points, ...p.points }; // PK をするかは、そのまま
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
  $("eventNameText").textContent = eventLabel(t);
  $("eventNameText").classList.toggle("is-untitled", !t.name);
}

// 大会を切りかえる
function switchEvent(id) {
  data.current = id;
  persist();
  renderAll();
}

// 大会の名前を変える（下から出るシートの入力欄。なくてもOK）
async function renameEvent() {
  const t = current();
  const name = await window.LineShareUI?.ask({ title: "大会の名前", text: "なくてもOK（例：秋のリーグ戦）", input: t.name, ok: "決める", maxLength: LIMITS.title });
  if (name === null || name === undefined) return;
  t.name = name.trim().slice(0, LIMITS.title);
  persist();
  renderEvents();
}

// 新しい大会を作る（作ったら名前を聞く。あとでもよい）
function newEvent() {
  if (data.list.length >= LIMITS.tournaments) return toast(`保存できる大会は ${LIMITS.tournaments} 件まで。使わないものを消すと作れます`);
  const t = blankTournament();
  data.list.push(t);
  page.now = "prep";
  switchEvent(t.id);
  renameEvent();
}

// いまの大会を複製する
function copyEvent() {
  if (data.list.length >= LIMITS.tournaments) return toast(`保存できる大会は ${LIMITS.tournaments} 件まで。使わないものを消すと作れます`);
  const t = { ...clone(current()), id: newId("q"), createdAt: Date.now(), updatedAt: Date.now() };
  t.name = `${current().name || "無題の大会"}（コピー）`.slice(0, LIMITS.title);
  data.list.push(t);
  switchEvent(t.id);
  toast("複製しました");
}

// いまの大会を消す（確かめずに消し、「元に戻す」で戻せる）
function deleteEvent() {
  const t = current();
  const at = data.list.indexOf(t);
  data.list.splice(at, 1);
  if (!data.list.length) data.list.push(blankTournament());
  switchEvent(data.list[0].id);
  toast(`「${eventLabel(t)}」を消しました`, () => {
    data.list.splice(at, 0, t);
    switchEvent(t.id);
  });
}

// 「…」のシート：大会の一覧（押すと切りかえ）と、新しく作る・名前を変える・複製・消す
function openEventMenu() {
  document.querySelector(".ls-sheet.event-sheet")?.remove();
  const before = document.activeElement;
  const t = current();
  const button = (text, onClick, extra = "") => {
    const b = Object.assign(document.createElement("button"), { type: "button", className: `ls-button ${extra}`, textContent: text });
    b.addEventListener("click", () => {
      close();
      onClick();
    });
    return b;
  };
  const sheet = Object.assign(document.createElement("div"), { className: "ls-sheet event-sheet" });
  const card = Object.assign(document.createElement("div"), { className: "ls-sheet-card" });
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");
  card.setAttribute("aria-label", "大会");
  card.append(Object.assign(document.createElement("p"), { className: "ls-sheet-title", textContent: "🏆 大会" }));
  const others = [...data.list].sort((a, b) => b.updatedAt - a.updatedAt);
  if (others.length > 1) {
    card.append(Object.assign(document.createElement("p"), { className: "event-sheet-sub", textContent: `切りかえる（${others.length}件）` }));
    const list = Object.assign(document.createElement("div"), { className: "event-sheet-list" });
    for (const x of others) {
      const b = button(`${x.id === t.id ? "✓ " : ""}${eventLabel(x)}・${x.teams.length}チーム`, () => x.id !== t.id && switchEvent(x.id));
      b.setAttribute("aria-current", String(x.id === t.id));
      list.append(b);
    }
    card.append(list);
  }
  const actions = Object.assign(document.createElement("div"), { className: "event-sheet-actions" });
  actions.append(button("＋ 新しく作る", newEvent, "is-primary"), button("✏️ 名前を変える", renameEvent), button("⧉ 複製する", copyEvent), button("🗑 消す", deleteEvent));
  card.append(actions);
  const cancel = Object.assign(document.createElement("button"), { type: "button", className: "ls-sheet-cancel", textContent: "閉じる" });
  cancel.addEventListener("click", () => close());
  card.append(cancel);
  sheet.append(card);
  const onKey = (e) => e.key === "Escape" && close();
  function close() {
    sheet.remove();
    document.removeEventListener("keydown", onKey);
    before?.focus?.({ preventScroll: true });
  }
  sheet.addEventListener("click", (e) => e.target === sheet && close());
  document.addEventListener("keydown", onKey);
  document.body.append(sheet);
  card.querySelector("button")?.focus();
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
  $("formatMeta").textContent = [FORMATS[t.format], PRESETS.find((p) => p.key === t.preset)?.label.replace(/^\S+\s/, "")].filter(Boolean).join("・");
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
  // 総当たりの決まり・トーナメントの決まり：その形にあるほうだけ。グループのときは両方（名前で見分ける）
  $("leagueRules").hidden = t.format === "knockout";
  $("koRules").hidden = t.format === "league";
  $("leagueRulesTitle").textContent = t.format === "groups" ? "📊 グループの総当たりの決まり" : "📊 総当たりの決まり";
  $("koRulesTitle").textContent = t.format === "groups" ? "🗺️ 決勝トーナメントの決まり" : "🗺️ トーナメントの決まり";
  $("thirdPlace").checked = opts.thirdPlace;
  document.querySelectorAll("[data-legs]").forEach((b) => b.setAttribute("aria-checked", String(Number(b.dataset.legs) === opts.legs)));
  const maxGroups = Math.max(1, Math.floor(t.teams.length / 2));
  stepper(document.querySelector('[data-opt="groups"]'), { get: () => opts.groups, set: (v) => change((x) => (x.opts.groups = v)), min: 1, max: maxGroups, label: "グループの数" });
  stepper(document.querySelector('[data-opt="advance"]'), { get: () => opts.advance, set: (v) => change((x) => (x.opts.advance = v)), min: 1, max: Math.max(1, Math.floor(t.teams.length / opts.groups)), label: "上がる数" });
  for (const key of ["win", "draw", "loss", "pkWin", "pkLoss"]) {
    stepper(document.querySelector(`[data-point="${key}"]`), { get: () => t.points[key], set: (v) => ((t.points[key] = v), (t.preset = ""), persist(), renderPresets(), renderFormat(), renderResults()), min: 0, max: 9, label: "勝ち点" });
  }
  $("pointsPk").checked = t.points.pk;
  $("pkPoints").hidden = !t.points.pk;
  $("drawPoints").hidden = t.points.pk; // PK をするなら引き分けはない
  $("pointsMeta").textContent = pointsLabel(t.points);
  // 順位の決め方：勝ち点はいつも最初。あとの3つは ↑↓ で並べかえる
  const rank = rankIn(t.rank);
  $("rankMeta").textContent = rank.map((k) => RANK_LABELS[k]).join(" → ");
  $("rankOrder").innerHTML =
    `<li><span class="rank-no">1</span><span class="rank-name">勝ち点</span><small>いつも最初</small></li>` +
    rank
      .map((k, i) => `<li><span class="rank-no">${i + 2}</span><span class="rank-name">${esc(RANK_LABELS[k])}</span><button class="ls-chip" type="button" data-rank="${i}" data-d="-1" aria-label="${esc(RANK_LABELS[k])}を上へ" ${i === 0 ? "disabled" : ""}>↑</button><button class="ls-chip" type="button" data-rank="${i}" data-d="1" aria-label="${esc(RANK_LABELS[k])}を下へ" ${i === rank.length - 1 ? "disabled" : ""}>↓</button></li>`)
      .join("");
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
  const when = [dateLabel(t.sched.on ? t.sched.date : ""), t.sched.on ? t.sched.place : ""].filter(Boolean).join(" ");
  // 試合のページの見出し：名前（大きく）と、日にち・形・チーム・時間（1行に小さく）
  $("playTitle").textContent = `🏆 ${t.name || "組み合わせ"}`;
  $("playSub").textContent = [when, FORMATS[t.format], `${t.teams.length}チーム`, est.matches ? `${est.matches}試合` : "", est.matches ? (t.sched.on ? `${t.sched.start}〜${addMinutes(t.sched.start, est.minutes)}` : durationLabel(est.minutes)) : ""].filter(Boolean).join("・");
  // 準備のおわりのボタン：試合の数も
  $("goPlay").hidden = !est.matches;
  $("goPlay").textContent = `📋 試合へ（${est.matches}試合）`;
}

// ---- 画面：結果（トーナメント表・順位表・試合） ----

// チーム別で選んでいるチーム（順位表・トーナメント表でも目立たせる。チーム別でないときは ""）
const mine = () => (view.mode === "team" ? view.team : "");

// チームの色の丸の HTML を返す（チームが決まっていなければ空の丸）
const dotHtml = (id) => `<i class="dot" style="background:${esc(teamById(id)?.color || "transparent")}"></i>`;

// トーナメント表（回ごとの列）と、優勝・準優勝・3位を描きなおす
function renderBracket(c) {
  const { t, gen, resolved, timeOf, numberOf } = c;
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
    const s = timeOf[m.id];
    const when = m.bye ? "" : s ? `${s.time}${t.sched.courts > 1 ? `・コート${s.court}` : ""}` : numberOf[m.id] ? `第${numberOf[m.id]}試合` : "";
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
    const when = c.timeOf[m.id] ? `${c.timeOf[m.id].time}${t.sched.courts > 1 ? `・コート${c.timeOf[m.id].court}` : ""}` : c.numberOf[m.id] ? `第${c.numberOf[m.id]}試合` : "";
    const ref = t.referees?.[m.id];
    const side = (id, k) => {
      const name = teamName(t, id);
      const win = (o === "home" && k === 0) || (o === "away" && k === 1);
      return `<div class="match-side ${win ? "is-win" : ""}">${dotHtml(id)}<span class="name">${esc(name)}</span>${scoreHtml(m.id, "s", k, res ? res.s[k] : null, `${name}の点`)}</div>`;
    };
    // トーナメントで同点のときは PK も（試合の表と同じ）
    const withPk = m.stage === "ko" || m.stage === "third" || Boolean(t.points.pk); // トーナメントと、PK をする総当たり
    const pkHtml = withPk && res && res.s[0] === res.s[1] ? `<div class="pk-row"><span>PK（同点のとき）</span><div class="pk-steppers">${scoreHtml(m.id, "pk", 0, res.pk ? res.pk[0] : null, "ホームの PK")}<span class="match-vs" aria-hidden="true">-</span>${scoreHtml(m.id, "pk", 1, res.pk ? res.pk[1] : null, "アウェイの PK")}</div></div>` : "";
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

// 総当たり表のマスから、試合の表のその試合へ動く（少しのあいだ光らせる）
function gotoMatch(id) {
  page.now = "play";
  page.play = "matches";
  view.mode = "order";
  renderPage();
  renderResults();
  const el = document.querySelector(`#matches .match[data-mid="${CSS.escape(id)}"]`);
  if (!el) return;
  el.closest("details")?.setAttribute("open", "");
  // タブを切りかえたあとなので、なめらかにせず、すぐその位置へ
  window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 90 });
  el.classList.add("is-flash");
  setTimeout(() => el.classList.remove("is-flash"), 1600);
}

// 順位表（総当たり・グループごと）を描きなおす
function renderStandings(c) {
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

// 点の − 数 ＋（まだ入れていないときは「–」。押すと 0 から入る）の HTML を返す
function scoreHtml(mid, kind, k, value, label) {
  const shown = value === null ? "–" : value;
  return `<div class="score-stepper ${value === null ? "is-empty" : ""}"><button type="button" data-score="${kind}" data-k="${k}" data-d="-1" data-mid="${esc(mid)}" aria-label="${esc(label)}をへらす">−</button><output><button type="button" class="score-now" data-score="${kind}" data-k="${k}" data-d="0" data-mid="${esc(mid)}" aria-label="${esc(label)}（いま ${shown}）">${shown}</button></output><button type="button" data-score="${kind}" data-k="${k}" data-d="1" data-mid="${esc(mid)}" aria-label="${esc(label)}をふやす">＋</button></div>`;
}

// 時刻ごとのまとまりの開け閉め（見出し → 開いているか）。描きなおしても戻らないように
const slotOpen = new Map();

// 入力中の試合（1つだけ）。カードを押すと、その試合だけ − ＋・PK・審判・結果を消す・さくせん盤やろくがを出す。ふだんは点だけ
let activeMatch = "";

// 試合のカードを入力中にする／やめる（もう一度押すか、ほかのカードを押すと閉じる）
function toggleActive(mid) {
  activeMatch = activeMatch === mid ? "" : mid;
  renderResults();
  const card = document.querySelector(`#matches .match[data-mid="${CSS.escape(mid)}"] .match-head`);
  card?.focus({ preventScroll: true });
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
  const when = underTime ? (t.sched.courts > 1 ? `コート${s.court}` : "") : s ? `${s.time}${t.sched.courts > 1 ? `・コート${s.court}` : ""}` : numberOf[m.id] ? `第${numberOf[m.id]}試合` : "";
  const done = Boolean(outcome(res));
  const next = c.next?.has(m.id);
  // 入力中のカードだけ、点を変えるボタンなどを出す
  const active = ready && !readOnly() && activeMatch === m.id;
  const withPk = m.stage === "ko" || m.stage === "third" || Boolean(t.points.pk); // トーナメントと、PK をする総当たり
  const o = outcome(res);
  const side = (sideDef, id, k) => {
    const name = id ? teamName(t, id) : sideLabel(sideDef, gen);
    const win = (o === "home" && k === 0) || (o === "away" && k === 1);
    const value = res ? res.s[k] : null;
    return `<div class="match-side ${id ? "" : "is-tbd"} ${win ? "is-win" : ""}">${dotHtml(id)}<span class="name">${esc(name)}</span>${active ? scoreHtml(m.id, "s", k, value, `${name}の点`) : `<b class="${value === null ? "is-empty" : ""}">${ready && value === null ? "–" : value ?? ""}</b>`}</div>`;
  };
  const pkRow =
    withPk && res && res.s[0] === res.s[1]
      ? `<div class="pk-row"><span>PK（同点のとき）</span>${!active ? `<b>${res.pk ? `${res.pk[0]} - ${res.pk[1]}` : "–"}</b>` : `<div class="pk-steppers">${scoreHtml(m.id, "pk", 0, res.pk ? res.pk[0] : null, "ホームの PK")}<span class="match-vs" aria-hidden="true">-</span>${scoreHtml(m.id, "pk", 1, res.pk ? res.pk[1] : null, "アウェイの PK")}</div>`}</div>`
      : "";
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
      ${res && !readOnly() ? `<button class="ls-chip" type="button" data-clear="${esc(m.id)}">結果を消す</button>` : ""}
    </div>`;
  }
  const badge = next ? `<span class="next-badge">▶ 次の試合</span>` : done ? `<span class="done-badge">✓ 終わり</span>` : "";
  // 点の行の下の審判：入力中は選ぶ欄、ほかは入っていればラベルとチーム名（どちらもまん中そろえ）
  const refLabel = active ? "" : refereeLabel(c, m);
  const refRow = active ? refereeHtml(c, m, true) : refLabel ? `<div class="referee-row"><span>🟨 審判</span><b>${esc(refLabel)}</b></div>` : "";
  // 押せるカード（出るチームが決まっていて、入れられるとき）：見出しをボタンにする（キーボードでも）
  const tappable = ready && !readOnly();
  const head = tappable ? ` data-tap="${esc(m.id)}" role="button" tabindex="0" aria-expanded="${active}" aria-label="${esc(matchTitle(m, gen))}：${active ? "入れるのをやめる" : "点を入れる"}"` : "";
  return `<article class="match ${done ? "is-done" : ""} ${next ? "is-next" : ""} ${tappable ? "is-tappable" : ""} ${active ? "is-active" : ""}" data-mid="${esc(m.id)}"><div class="match-head"${head}><span>${badge}${esc(matchTitle(m, gen))}</span><span>${esc(when)}${clearBtn}</span></div><div class="match-sides">${side(m.home, r.home, 0)}<span class="match-vs" aria-hidden="true">-</span>${side(m.away, r.away, 1)}</div>${refRow}${pkRow}${actions}</article>`;
}

/**
 * 審判の行の HTML を返す：その試合に出ない・同じ時間に試合のないチームから選ぶ（いなければ「−」だけ）。
 * 入れたチームがあとで出ることになったとき（勝ち上がり・時間の重なり）は ⚠️ をつける。見るだけのときは文字だけ
 */
// 審判の文字（チーム名。あとで出ることになったら ⚠️ つき）。入っていなければ ""
function refereeLabel(c, m) {
  const { t, gen, plan, resolved } = c;
  const now = t.referees?.[m.id] || "";
  if (!now) return "";
  const options = refereeOptions(m, t.teams.map((x) => x.id), resolved, plan, gen.matches);
  const r = resolved[m.id] || {};
  if (options.includes(now)) return teamName(t, now);
  return `${teamName(t, now)}${r.home === now || r.away === now ? "（⚠️ この試合に出る）" : "（⚠️ 同じ時間に試合）"}`;
}

function refereeHtml(c, m, active = false) {
  const { t, gen, plan, resolved } = c;
  const now = t.referees?.[m.id] || "";
  const options = refereeOptions(m, t.teams.map((x) => x.id), resolved, plan, gen.matches);
  const clash = now && !options.includes(now);
  const r = resolved[m.id] || {};
  const why = r.home === now || r.away === now ? "（⚠️ この試合に出る）" : "（⚠️ 同じ時間に試合）";
  const label = now ? `${teamName(t, now)}${clash ? why : ""}` : "−";
  const done = Boolean(outcome(t.results[m.id]));
  if (done && !now) return "";
  if (!active && !now) return ""; // 入力中でなければ、入れた審判だけ文字で
  if (!active || done) return `<div class="referee-row"><span>🟨 審判</span><b>${esc(label)}</b></div>`;
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
 * そのチームの試合を返す：決まっている試合と、トーナメントの勝ち進み（勝てば決勝まで・負けたら3位決定戦）。グループのときは、1位で上がったときの決勝トーナメントから決勝まで。
 * [{ m, kind: "fixed"|"win"|"lose"|"advance", mine（勝ち進みのとき、このチームが入る側） }] を、試合の順に返す
 */
function teamPath(c, id) {
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

const KIND_LABEL = { fixed: "", win: "（勝てば）", lose: "（負けたら）", advance: "（1位で上がれば）" };

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
// そのチームが審判をする試合のならび
const refereeDuty = (c, id) => c.gen.matches.filter((m) => !m.bye && id && c.t.referees?.[m.id] === id);

// チーム別の、審判をする試合の1行（いつ・どの試合・出るチーム・結果）の HTML を返す
function refereeDutyHtml(c, m) {
  const { t, gen, resolved } = c;
  const r = resolved[m.id] || {};
  const name = (side, id) => (id ? teamName(t, id) : sideLabel(side, gen));
  const res = t.results[m.id];
  const mid = res ? `${res.s[0]} - ${res.s[1]}` : "vs";
  return `<p class="ref-duty ${outcome(res) ? "is-done" : ""}"><b>🟨 審判</b>　${esc(numberOf2(c, m))}　${esc(matchTitle(m, gen))}<br>${esc(name(m.home, r.home))} ${esc(mid)} ${esc(name(m.away, r.away))}</p>`;
}

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

// 試合の一覧を描きなおす（見方：順番・コート別・チーム別。順番は時刻か何試合目の順で、まとまりごとに見出し）
function renderMatches(c) {
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
  const done = play.filter((m) => outcome(t.results[m.id])).length;
  $("matchesMeta").textContent = play.length ? `${done} / ${play.length}試合` : "";
  // 次の試合：順番でいちばん早い、出るチームが決まっていて結果のまだの試合（同じ時刻のほかのコートも）
  const byIdAll = Object.fromEntries(gen.matches.map((m) => [m.id, m]));
  const waiting = plan.filter((p) => !byIdAll[p.id].bye && resolved[p.id]?.home && resolved[p.id]?.away && !outcome(t.results[p.id]));
  c.next = new Set(waiting.length ? waiting.filter((p) => p.start === waiting[0].start).map((p) => p.id) : []);
  $("jumpNext").hidden = !c.next.size || view.mode === "team";
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
      else parts.push(`<p class="path-note">${esc(numberOf2(c, x.m))}　${esc(matchTitle(x.m, gen))}${esc(KIND_LABEL[x.kind])}　vs ${esc(opponentLabel(c, view.team, x))}</p>`);
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
      const doneCount = play2.filter((m) => outcome(t.results[m.id])).length;
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
  // トーナメント表が横にはみ出すときだけ「横にずらす」の案内（出してから測る）
  $("bracketHint").hidden = $("bracket").scrollWidth <= $("bracket").clientWidth + 2;
}

// 画面をまるごと描きなおす
function renderAll() {
  renderLive();
  renderRules();
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
    const undo = () => {
      if (before) t.results[x.mid] = before;
      else delete t.results[x.mid];
      persist();
      renderAll();
    };
    const role = liveRole(t);
    if (role === "") {
      // みんなで入れる大会で、このタブはまだ見るだけ：合言葉を入れたら送る（それまでは端末で待つ）
      window.LineShareUI?.toast(`さくせん盤から結果を入れました${line ? `：${line}` : ""}。みんなに送るには合言葉を入れてね`, { actionLabel: "✏️ 合言葉を入れて送る", onAction: openUnlock });
    } else toast(seasonal(`さくせん盤から結果を入れ${role ? "て、みんなに送り" : ""}ました${line ? `：${line}` : ""}`), undo);
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
    <section class="print-keep"><h2>チーム</h2>${teams}</section>
    ${t.rules ? `<section><h2>大会要項</h2><div class="print-rules">${esc(t.rules)}</div></section>` : ""}
    ${$("standings").innerHTML.trim() ? `<section><h2>順位表</h2>${$("standings").innerHTML}</section>` : ""}
    ${gen.matches.some((m) => m.stage === "ko") ? `<section class="print-keep"><h2>トーナメント表</h2><div class="bracket">${$("bracket").innerHTML}</div></section>` : ""}
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
  // 大会要項：入れるたびに残す（共有中の運営なら、少し待ってからボットへ）
  $("rulesText").addEventListener("input", (e) => {
    current().rules = e.target.value.slice(0, LIMITS.rules);
    persist();
    $("rulesMeta").textContent = current().rules ? `${[...current().rules].length}字` : "なし";
    $("rulesView").hidden = !current().rules.trim();
    $("rulesBody").innerHTML = rulesHtml(current().rules);
  });
  // みんなで入れる
  $("liveBody").addEventListener("click", (e) => {
    const b = e.target.closest("[data-live]");
    if (b) onLiveAction(b.dataset.live);
  });
  $("liveRefresh").addEventListener("click", async () => {
    const t = current();
    if (t.live.pending.length && liveRole(t)) await liveFlush();
    else if (await livePull({ quiet: false })) toast("読みなおしました");
  });
  $("liveRoleBtn").addEventListener("click", () => {
    if (liveRole()) return $("liveFold").scrollIntoView({ behavior: "smooth", block: "center" });
    // 見るだけのとき：帯の中に合言葉の欄を出す（もう一度押すとしまう）
    if ($("liveUnlock").hidden) openUnlock();
    else $("liveUnlock").hidden = true;
  });
  // 合言葉の欄：送る（Enter でも）・見せる
  document.addEventListener("submit", (e) => {
    const form = e.target.closest("form[data-live-form]");
    if (!form) return;
    e.preventDefault();
    const kind = form.dataset.liveForm;
    if (kind === "start") liveStart(form);
    if (kind === "input") liveChangeInput(form);
    if (kind === "unlock") liveUnlock(form);
  });
  document.addEventListener("change", (e) => {
    const box = e.target.closest("[data-pass-show]");
    if (box) box.closest("form").querySelectorAll(".pass-input").forEach((x) => (x.type = box.checked ? "text" : "password"));
  });
  // 大会
  $("eventName").addEventListener("click", renameEvent);
  $("eventMenu").addEventListener("click", openEventMenu);
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
  // 順位の決め方の ↑↓：となりと入れかえる
  $("rankOrder").addEventListener("click", (e) => {
    const b = e.target.closest("[data-rank]");
    if (!b || b.disabled) return;
    const t = current();
    const rank = rankIn(t.rank);
    const i = Number(b.dataset.rank);
    const j = i + Number(b.dataset.d);
    if (j < 0 || j >= rank.length) return;
    [rank[i], rank[j]] = [rank[j], rank[i]];
    t.rank = rank;
    persist();
    renderFormat();
    renderResults();
    document.querySelector(`#rankOrder [data-rank="${j}"][data-d="${b.dataset.d}"]:not([disabled])`)?.focus() || document.querySelector(`#rankOrder [data-rank="${j}"]:not([disabled])`)?.focus();
  });
  // 総当たりも同点なら PK（PK勝ち・PK負けの勝ち点）。組み合わせは変わらないので、描きなおすだけ
  $("pointsPk").addEventListener("change", (e) => {
    current().points.pk = e.target.checked;
    persist();
    renderFormat();
    renderResults();
  });
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
    // 時刻ごとのまとまりの見出し：押した人の開け閉めだけを覚える（描いたときの開け閉めは覚えない）
    const sum = e.target.closest(".slot-fold > summary");
    if (sum) return slotOpen.set(sum.parentElement.dataset.slot, !sum.parentElement.open);
    const b = e.target.closest("[data-score]");
    if (b && !readOnly()) return setScore(b.dataset.mid, b.dataset.score, Number(b.dataset.k), Number(b.dataset.d));
    const clear = e.target.closest("[data-clear]");
    if (clear) return clearScore(clear.dataset.clear);
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
  $("matches").addEventListener("change", (e) => {
    const sel = e.target.closest("[data-referee]");
    if (!sel || readOnly()) return;
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
  // 形と試合の種類の枠を開いたら、選んでいる種類のタブが見えるように（閉じているあいだは送れない）
  $("formatFold").addEventListener("toggle", () => $("formatFold").open && renderPresets());
  $("presetTabs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-preset]");
    if (b) applyPreset(b.dataset.preset);
  });

  // 試合表の見方・チーム別のチーム
  document.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => ((view.mode = b.dataset.view), renderResults())));
  // 次の試合へ：そのカードまで動かす（上に貼りついたタブの下に来るように）
  $("jumpNext").addEventListener("click", () => {
    const el = document.querySelector("#matches .match.is-next");
    el?.closest("details")?.setAttribute("open", "");
    if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 90, behavior: "smooth" });
  });
  // 準備のおわり：試合のページへ（いちばん上から）
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
  $("goPlay").addEventListener("click", () => {
    page.now = "play";
    page.play = "matches";
    renderPage();
    renderResults();
    window.scrollTo({ top: 0 });
  });
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
// ---- 大会要項 ----

// 大会要項の文を HTML にする（文字はぜんぶ esc。https:// ではじまるところだけリンクに）
function rulesHtml(text) {
  return esc(text).replace(/https:\/\/[^\s<>"']+/g, (url) => `<a href="${url}" target="_blank" rel="noopener">${url}</a>`);
}

// 準備の「📜 大会要項」と、試合のページの上の大会要項を描きなおす
function renderRules() {
  const t = current();
  const text = t.rules || "";
  if (document.activeElement !== $("rulesText")) $("rulesText").value = text;
  $("rulesMeta").textContent = text ? `${[...text].length}字` : "なし";
  $("rulesView").hidden = !text;
  $("rulesBody").innerHTML = rulesHtml(text);
}

// ---- みんなで入れる（くらぶボットの「🏆 大会」。js/live.js） ----
// つないでいない大会は、これまでどおり端末の中だけ。つないだ大会だけ、点を1試合ずつ送り、ほかの端末の点を読みなおす

const livePlanSent = {}; // 大会の id → ボットにある組み合わせ（チーム・形・時間）の文字。運営が変えたら送る
const liveShadow = {}; // 大会の id → ボットの結果・審判に、送るのを待っているものをのせたもの（どこが変わったかを見る）
let liveBusy = false;
let livePutTimer = 0;
let liveMessage = ""; // 最後にうまくいかなかったこと（画面に出す）

// 組み合わせ（結果・審判のほか）の文字
const planText = (t) => {
  const { results, referees, ...rest } = toServer(t);
  return JSON.stringify(rest);
};
const resultText = (t) => JSON.stringify([t.results, t.referees]);

// その大会の key（{ role, key }）を覚える・忘れる
function rememberKey(id, value) {
  if (value) liveKeys[id] = value;
  else delete liveKeys[id];
  setSessionKey(id, value);
}

// 端末に残したあと（persist）：つないだ大会なら、変わったところを送る。運営が組み合わせを変えたら、まるごと送る
function liveAfterSave() {
  const t = current();
  const role = liveRole(t);
  // つないでいない・見る人用のリンク：何もしない。見るだけ（""）でも、さくせん盤から届いた点は待っているものに入れておく（合言葉を入れたら送る）
  if (role === null) return;
  const id = t.live.id;
  if (livePlanSent[id] === undefined) livePlanSent[id] = planText(t);
  if (liveShadow[id] === undefined) liveShadow[id] = resultText(t);
  if (role === "admin" && planText(t) !== livePlanSent[id]) {
    clearTimeout(livePutTimer);
    livePutTimer = setTimeout(() => livePut(), 1200);
    return;
  }
  // 結果・審判の、変わった試合だけを待っているものに足す
  const [r0, f0] = JSON.parse(liveShadow[id]);
  const ids = new Set([...Object.keys(r0), ...Object.keys(t.results), ...Object.keys(f0), ...Object.keys(t.referees)]);
  let pending = t.live.pending;
  for (const mid of ids) {
    if (JSON.stringify(r0[mid] ?? null) !== JSON.stringify(t.results[mid] ?? null)) pending = queue(pending, { mid, result: t.results[mid] || null });
    if ((f0[mid] || "") !== (t.referees[mid] || "")) pending = queue(pending, { mid, ref: t.referees[mid] || "" });
  }
  if (pending === t.live.pending) return;
  t.live.pending = pending;
  liveShadow[id] = resultText(t);
  saveAll(data);
  if (role) liveFlush();
  else renderLive();
}

// その大会を、ボットから読んだものに置きかえる（data.list の中で）
function liveReplace(next) {
  const i = data.list.findIndex((x) => x.id === next.id);
  if (i < 0) return;
  data.list[i] = next;
  liveShadow[next.id] = resultText(next);
  if (!livePutTimer) livePlanSent[next.id] = planText(next);
  saveAll(data);
}

// ボットから読みなおす（変わっていなければ何もしない）。読めたら true
async function livePull({ quiet = true } = {}) {
  const t = current();
  if (!t.live || viewing || liveBusy) return false;
  const res = await liveCall(t.live.bot, "get", { id: t.live.id, since: t.live.version });
  if (!res.ok) {
    liveMessage = liveError(res);
    if (!quiet) toast(liveMessage);
    renderLive();
    return false;
  }
  liveMessage = "";
  const now = data.list.find((x) => x.id === t.id);
  if (!now || !now.live) return false;
  if (res.same) {
    now.live.at = Date.now();
    saveAll(data);
  } else {
    const next = fromServer(now, res.data, res.version, { keepPlan: Boolean(livePutTimer) });
    if (next) liveReplace(next);
    renderAll();
  }
  renderLive();
  return true;
}

// 待っている点・審判を、1つずつ送る。送り終わったら読みなおす
async function liveFlush() {
  const t = current();
  const role = liveRole(t);
  if (!role || liveBusy) return;
  liveBusy = true;
  try {
    const { key } = sessionKey(t.live.id) || liveKeys[t.live.id];
    while (t.live.pending.length) {
      const op = t.live.pending[0];
      const res = await liveCall(t.live.bot, "score", { id: t.live.id, key, ...op });
      if (!res.ok) {
        liveMessage = liveError(res);
        if (res.error === "pass") {
          rememberKey(t.live.id, null);
          toast("合言葉が変わったようです。もう一度入れてね");
          renderAll();
        }
        if (["bad", "none"].includes(res.error)) t.live.pending.shift(); // 送っても受けとられないものは、待たない
        else break;
        continue;
      }
      t.live.pending.shift();
      saveAll(data);
    }
  } finally {
    liveBusy = false;
  }
  renderLive(); // ほかの人の点は読まない（GAS を呼ぶのは 🔄 だけ）
}

// 運営：組み合わせを変えたので、大会をまるごと送る（ほかの人が先に点を入れていたら、読みなおしてから送りなおす）
async function livePut(retry = true) {
  livePutTimer = 0;
  const t = current();
  if (liveRole(t) !== "admin") return;
  const { key } = sessionKey(t.live.id) || liveKeys[t.live.id];
  const sent = planText(t);
  const res = await liveCall(t.live.bot, "put", { id: t.live.id, key, base: t.live.version, data: toServer(overlay(t, t.live.pending)) });
  if (res.ok) {
    t.live.version = res.version;
    t.live.pending = [];
    livePlanSent[t.live.id] = sent;
    liveShadow[t.live.id] = resultText(t);
    liveMessage = "";
    saveAll(data);
    renderLive();
    return;
  }
  if (res.error === "stale" && retry) {
    // ほかの人の点を読み、この端末の組み合わせはそのまま（keepPlan）で送りなおす
    livePutTimer = -1;
    const got = await liveCall(t.live.bot, "get", { id: t.live.id });
    livePutTimer = 0;
    if (got.ok && got.data) {
      const next = fromServer(t, got.data, got.version, { keepPlan: true });
      next.referees = t.referees; // 審判は、運営がまとめて入れたもの（この端末）を残す
      const i = data.list.findIndex((x) => x.id === t.id);
      data.list[i] = next;
      saveAll(data);
      renderAll();
      return livePut(false);
    }
  }
  liveMessage = liveError(res);
  toast(liveMessage);
  renderLive();
}

// 合言葉の入力欄（ページの中に置く。iPhone で下から出す窓の入力欄はキーボードと重なって入れにくいため）。
// 伏せて入れ、「見せる」で見える。name は form の中の見分け
const passField = (name, label, hint = "") =>
  `<label class="ls-label" for="pass-${name}">${esc(label)}</label><input id="pass-${name}" name="${name}" class="ls-input pass-input" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="${PASS_MAX}" enterkeyhint="done">${hint ? `<p class="ls-hint">${esc(hint)}</p>` : ""}`;
const passShow = `<label class="check-row"><input type="checkbox" data-pass-show> 合言葉を見せる</label>`;

// form の中の合言葉（name）を読む。短ければ知らせて null
function passOf(form, name) {
  const v = String(form.elements[name]?.value || "").trim();
  if (v.length >= PASS_MIN) return v;
  toast(`合言葉は${PASS_MIN}文字以上で入れてね`);
  form.elements[name]?.focus();
  return null;
}

// 上の帯に合言葉の欄を出して、そこへ動く（見るだけのとき）
function openUnlock() {
  page.now = "play";
  renderPage();
  const form = $("liveUnlock");
  form.hidden = false;
  $("liveBar").scrollIntoView({ behavior: "smooth", block: "start" });
  form.elements.unlock.focus({ preventScroll: true });
}

// 合言葉を入れて、この大会で点を入れられるようにする（運営の合言葉でも、入力の合言葉でもよい）
async function liveUnlock(form) {
  const t = current();
  if (!t.live) return;
  const pass = passOf(form, "unlock");
  if (!pass) return;
  toast("確かめています…");
  // 入力の合言葉として確かめ、ちがえば運営の合言葉として確かめる
  for (const make of [() => inputKey(t.live.id, pass), () => adminKey(pass)]) {
    const key = await make();
    const res = await liveCall(t.live.bot, "check", { id: t.live.id, key });
    if (res.ok) {
      rememberKey(t.live.id, { role: res.role, key });
      form.reset();
      form.hidden = true;
      toast(res.role === "admin" ? "運営として入れられます" : "点を入れられます");
      renderAll();
      liveFlush();
      return;
    }
    if (res.error !== "pass") return toast(liveError(res));
  }
  toast(liveError({ error: "pass" }));
}

// 運営：いまの大会を、くらぶボットにのせる（みんなで入れられるようにする）
async function liveStart(form) {
  const t = current();
  const bot = window.QloveBotLink?.get() || "";
  if (!bot) return toast("先に、くらぶボットの URL を入れてね");
  const admin = passOf(form, "admin");
  if (!admin) return;
  const input = passOf(form, "input");
  if (!input) return;
  const id = newLiveId();
  toast("のせています…");
  const [aKey, iKey] = [await adminKey(admin), await inputKey(id, input)];
  const res = await liveCall(bot, "create", { id, adminKey: aKey, inputKey: iKey, data: toServer(t) });
  if (!res.ok) return toast(liveError(res));
  t.live = { id, bot, version: res.version, pending: [], at: Date.now() };
  rememberKey(id, { role: "admin", key: aKey });
  livePlanSent[id] = planText(t);
  liveShadow[id] = resultText(t);
  saveAll(data);
  renderAll();
  toast(seasonal("みんなで入れられるようにしました。「🔗 共有リンク」を送ってね"));
}

// 運営：入力の合言葉を変える（前の合言葉の人は、入れられなくなる）
async function liveChangeInput(form) {
  const t = current();
  if (liveRole(t) !== "admin") return;
  const input = passOf(form, "newinput");
  if (!input) return;
  const { key } = sessionKey(t.live.id) || liveKeys[t.live.id];
  const res = await liveCall(t.live.bot, "put", { id: t.live.id, key, base: t.live.version, data: toServer(overlay(t, t.live.pending)), inputKey: await inputKey(t.live.id, input) });
  if (!res.ok) return toast(liveError(res));
  t.live.version = res.version;
  saveAll(data);
  form.reset();
  toast("入力の合言葉を変えました。点を入れる人に伝えなおしてね");
  renderLive();
}

// この端末で、つなぐのをやめる（ボットの大会はそのまま。この端末の大会は、ふつうの大会にもどる）
async function liveLeave() {
  const t = current();
  if (!t.live) return;
  const yes = await window.LineShareUI?.ask({ title: "📴 つなぐのをやめる", text: "この端末の大会は、ふつうの大会（端末の中だけ）にもどります。くらぶボットの大会と、ほかの人の端末はそのままです。", ok: "やめる", cancel: "もどる" });
  if (!yes) return;
  if (t.live.pending.length) toast(`送れていない点が ${t.live.pending.length} 件ありました（この端末には入っています）`);
  rememberKey(t.live.id, null);
  delete t.live;
  saveAll(data);
  renderAll();
}

// くらぶボットの URL を入れる（Q キットの QloveBotLink。🏆 大会の機能があるか確かめてから）
async function liveSetBot() {
  const text = $("liveBotUrl").value.trim();
  if (!botUrlIn(text)) return toast("くらぶボットの URL（https://script.google.com/macros/s/…/exec）を入れてね");
  const res = await liveCall(text, "get", { id: "00000000000000000000" });
  if (res.error === "net") return toast(liveError(res));
  if (res.error === "auth") return toast(liveError(res));
  const saved = window.QloveBotLink?.set(text);
  if (!saved?.ok) return toast("この端末に残せませんでした");
  toast("くらぶボットとつなぎました");
  renderLive();
}

// 「📡 みんなで入れる」の欄と、試合のページの上の知らせを描きなおす
function renderLive() {
  const t = current();
  const role = liveRole(t);
  const fold = $("liveFold");
  fold.hidden = Boolean(viewing);
  $("liveBar").hidden = !t.live || Boolean(viewing);
  if (t.live && !viewing) {
    const at = t.live.at ? new Date(t.live.at) : null;
    const time = at ? `${at.getHours()}:${String(at.getMinutes()).padStart(2, "0")}` : "";
    const wait = t.live.pending.length;
    $("liveStatus").textContent = [liveMessage ? "⚠️ つながっていません" : time ? `${time} に読んだ点` : "まだ読んでいません", wait ? `送るのを待っている ${wait} 件` : ""].filter(Boolean).join("・");
    $("liveRoleBtn").textContent = role === "admin" ? "🔓 運営" : role === "input" ? "🔓 入力できる" : "✏️ 点を入れる";
    $("liveRoleBtn").classList.toggle("is-primary", !role);
    if (role) $("liveUnlock").hidden = true;
  }
  $("liveMeta").textContent = t.live ? (role === "admin" ? "運営" : role === "input" ? "入力" : "見るだけ") : "";
  const bot = window.QloveBotLink?.get() || "";
  let html = "";
  if (t.live) {
    html = `<p class="ls-hint">この大会は、くらぶボットで共有しています。点は1試合ずつ送り、ほかの人の点は「🔄 更新」を押したときに読みます（GAS をあまり呼ばないため）。電波がないときは、この端末にためて、つながったら送ります。</p>
      <div class="live-actions">
        <button class="ls-button is-primary" type="button" data-live="copy">🔗 共有リンクをコピー</button>

        ${role ? `<button class="ls-chip" type="button" data-live="lock">🔒 この端末で入れるのをやめる</button>` : ""}
        <button class="ls-chip" type="button" data-live="leave">📴 つなぐのをやめる</button>
      </div>
      <p class="ls-hint">共有リンクには合言葉は入りません。点を入れる人には、入力の合言葉を口で伝えてね。見る人は、リンクを開くだけ。</p>
      ${role === "admin" ? `<form class="ls-stack live-form" data-live-form="input">${passField("newinput", "🔑 入力の合言葉を変える", "前の合言葉では入れられなくなります")}${passShow}<button class="ls-button" type="submit">変える</button></form>` : ""}`;
  } else if (!window.QloveBotLink) {
    html = `<p class="ls-hint">くらぶボットの部品を読めませんでした（電波を確かめてね）。</p>`;
  } else if (!bot) {
    html = `<p class="ls-hint">くらぶボットとつなぐと、運営・コートの入力の人・見る人で、同じ結果を見られます（つながなくても、これまでどおり使えます）。</p>
      <label class="ls-label" for="liveBotUrl">くらぶボットの URL</label>
      <input id="liveBotUrl" class="ls-input" type="url" inputmode="url" autocomplete="off" placeholder="https://script.google.com/macros/s/…/exec">
      <button class="ls-button" type="button" data-live="bot">つなぐ</button>`;
  } else {
    html = `<p class="ls-hint">くらぶボットにつないであります。この大会をのせると、運営・コートの入力の人・見る人で同じ結果を見られます（入れた点はすぐ送り、ほかの人の点を読みなおします）。</p>
      <form class="ls-stack live-form" data-live-form="start">
        ${passField("admin", "📡 運営の合言葉", "くらぶボットを作った人（システム管理者）が決めたもの")}
        ${passField("input", "🔑 入力の合言葉（新しく決める）", "コートで点を入れる人に、口で伝える合言葉（4文字以上）。リンクには入りません")}
        ${passShow}
        <button class="ls-button is-primary is-block" type="submit">📡 この大会をみんなで入れる</button>
      </form>
      <button class="ls-chip" type="button" data-live="forget">くらぶボットの URL を変える</button>`;
  }
  // 中身が同じなら描きなおさない（読みなおしのたびに、入れかけの合言葉が消えないように）
  if ($("liveBody").dataset.html !== html) {
    $("liveBody").innerHTML = html;
    $("liveBody").dataset.html = html;
  }
}

// 「📡 みんなで入れる」のボタン
async function onLiveAction(kind) {
  const t = current();
  if (kind === "bot") return liveSetBot();
  if (kind === "forget") {
    window.QloveBotLink?.clear();
    return renderLive();
  }
  if (kind === "copy") {
    const url = liveUrl(t.live, TOOL.url);
    try {
      await navigator.clipboard.writeText(url);
      toast("共有リンクをコピーしました");
    } catch {
      window.LineShareUI?.ask({ title: "共有リンク", text: "長押しでコピーしてね", input: url, readonly: true, ok: "閉じる", cancel: null });
    }
    return;
  }
  if (kind === "lock") {
    rememberKey(t.live.id, null);
    toast("この端末では、見るだけにしました");
    return renderAll();
  }
  if (kind === "leave") return liveLeave();
}

// ?live=…&bot=… で開いたとき：この端末にその大会があれば開き、なければボットから読んで足す
async function openLiveLink(link) {
  history.replaceState(null, "", location.pathname);
  let t = data.list.find((x) => x.live && x.live.id === link.id);
  if (!t) {
    const res = await liveCall(link.bot, "get", { id: link.id });
    if (!res.ok || !res.data) return toast(liveError(res));
    const base = { ...blankTournament(), id: newId("q"), createdAt: Date.now(), live: { id: link.id, bot: link.bot, version: 0, pending: [], at: 0 } };
    t = fromServer(base, res.data, res.version);
    if (!t) return toast(liveError({ error: "bad" }));
    data.list.unshift(t);
    liveShadow[link.id] = resultText(t);
    livePlanSent[link.id] = planText(t);
  }
  data.current = t.id;
  page.now = "play";
  saveAll(data);
  renderAll();
  if (!liveRole(t)) toast("見るだけで開きました。最新の点は「🔄 更新」で読みます。点を入れる人は「✏️ 点を入れる」から合言葉を入れてね");
}

// つないだ大会の準備（はじめの印）と、電波がもどったときに送れていない点を送る
function startLivePolling() {
  // はじめの印：開いたときの結果・組み合わせを「ボットと同じ」とみなす（このあと入れたものだけを送る）
  for (const t of data.list) {
    if (!t.live) continue;
    liveShadow[t.live.id] = resultText(overlay(t, []));
    livePlanSent[t.live.id] = planText(t);
  }
  // GAS をあまり呼ばないよう、ほかの人の点を読むのは「🔄 更新」だけ。電波がもどったら、送れていない点だけ送る
  window.addEventListener("online", () => {
    const t = current();
    if (t.live && !viewing && t.live.pending.length && liveRole(t)) liveFlush();
  });
}

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
  startLivePolling();
  applyIncoming([...(incoming ? [incoming] : []), ...takeInbox()]);
  // みんなで入れる：?live=…&bot=… で開いた大会・ときどき読みなおす
  const link = readLive(location.search);
  if (link && !viewing) openLiveLink(link);
  if (viewing) return; // 見るだけのときは、使い方を出さない
  window.LineShareUI?.firstTip(
    TOOL.key,
    ["チームの名前と色を入れる（上から順にシード）", "🏆 形を選ぶと、組み合わせがすぐできる", "点を入れると、勝ち上がりと順位表が出る"],
    $("eventPanel")
  );
}

init();
