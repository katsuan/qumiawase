// くみあわせ：準備の「形と決まり」「時間と日程」「大会要項」（試合の種類・形・勝ち点・順位の決め方・コートと時刻）と、見こみ（試合の数・かかる時間）
// app.js から読む（import。描きなおしは renderPresets・renderFormat・renderSched・renderEstimate・renderRules、ボタンと入力は bindFormat）
import { FORMATS, LIMITS, PRESETS } from "./settings.js?v=202610290639";
import { addMinutes, fitOptions } from "./pairing.js?v=202610290639";
import { durationLabel, estimate, RANK_LABELS, rankIn } from "./stats.js?v=202610290639";
import { dateLabel, pointsLabel } from "./card.js?v=202610290639";
import { $, esc, stepper } from "./dom.js?v=202610290639";
import { change, current, persist, ui } from "./state.js?v=202610290639";

// 試合の種類のタブと、選んでいる種類の説明を描きなおす
export function renderPresets() {
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

// 形（トーナメント・総当たり・グループ）と、その設定・勝ち点を描きなおす
export function renderFormat() {
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
    stepper(document.querySelector(`[data-point="${key}"]`), { get: () => t.points[key], set: (v) => ((t.points[key] = v), (t.preset = ""), persist(), renderPresets(), renderFormat(), ui.renderResults()), min: 0, max: 9, label: "勝ち点" });
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
export function renderSched() {
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
    ui.renderResults();
  };
  stepper(document.querySelector('[data-sched="courts"]'), { get: () => s.courts, set: setSched("courts"), min: 1, max: LIMITS.courts, label: "コートの数" });
  stepper(document.querySelector('[data-sched="minutes"]'), { get: () => s.minutes, set: setSched("minutes"), min: 1, max: LIMITS.minutes, label: "1試合の時間", typed: true });
  stepper(document.querySelector('[data-sched="rest"]'), { get: () => s.rest, set: setSched("rest"), min: 0, max: LIMITS.minutes, label: "空き時間", typed: true });
}

// 見こみ（試合の数・1チームの最多の試合の数・かかる時間）を、形の下と試合のタブの見出しに出す
export function renderEstimate({ t, est }) {
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

// 大会要項の文を HTML にする（文字はぜんぶ esc。https:// ではじまるところだけリンクに）
function rulesHtml(text) {
  return esc(text).replace(/https:\/\/[^\s<>"']+/g, (url) => `<a href="${url}" target="_blank" rel="noopener">${url}</a>`);
}

// 準備の「📜 大会要項」と、試合のページの上の大会要項を描きなおす
export function renderRules() {
  const t = current();
  const text = t.rules || "";
  if (document.activeElement !== $("rulesText")) $("rulesText").value = text;
  $("rulesMeta").textContent = text ? `${[...text].length}字` : "なし";
  $("rulesView").hidden = !text;
  $("rulesBody").innerHTML = rulesHtml(text);
}

// 押す・入力を受けるしかけ（大会要項・形・順位の決め方・PK・時間と日程・試合の種類）を付ける（app.js の init から1回）
export function bindFormat() {
  // 大会要項：入れるたびに残す（共有中の運営なら、少し待ってからボットへ）
  $("rulesText").addEventListener("input", (e) => {
    current().rules = e.target.value.slice(0, LIMITS.rules);
    persist();
    $("rulesMeta").textContent = current().rules ? `${[...current().rules].length}字` : "なし";
    $("rulesView").hidden = !current().rules.trim();
    $("rulesBody").innerHTML = rulesHtml(current().rules);
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
    ui.renderResults();
    document.querySelector(`#rankOrder [data-rank="${j}"][data-d="${b.dataset.d}"]:not([disabled])`)?.focus() || document.querySelector(`#rankOrder [data-rank="${j}"]:not([disabled])`)?.focus();
  });
  // 総当たりも同点なら PK（PK勝ち・PK負けの勝ち点）。組み合わせは変わらないので、描きなおすだけ
  $("pointsPk").addEventListener("change", (e) => {
    current().points.pk = e.target.checked;
    persist();
    renderFormat();
    ui.renderResults();
  });
  document.querySelectorAll("[data-legs]").forEach((b) => b.addEventListener("click", () => change((t) => (t.opts.legs = Number(b.dataset.legs)))));

  // 時間と日程：連続試合を避ける・続けてもよい
  document.querySelectorAll("[data-avoid]").forEach((b) =>
    b.addEventListener("click", () => {
      current().sched.avoid = b.dataset.avoid === "1";
      persist();
      renderSched();
      ui.renderResults();
    })
  );
  $("schedOn").addEventListener("change", (e) => {
    current().sched.on = e.target.checked;
    persist();
    renderSched();
    ui.renderResults();
  });
  for (const [id, key] of [["schedDate", "date"], ["schedStart", "start"], ["schedPlace", "place"]]) {
    $(id).addEventListener("input", (e) => {
      current().sched[key] = key === "place" ? e.target.value.slice(0, LIMITS.place) : e.target.value;
      persist();
      renderSched();
      ui.renderResults();
    });
  }

  // 試合の種類
  // 形と試合の種類の枠を開いたら、選んでいる種類のタブが見えるように（閉じているあいだは送れない）
  $("formatFold").addEventListener("toggle", () => $("formatFold").open && renderPresets());
  $("presetTabs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-preset]");
    if (b) applyPreset(b.dataset.preset);
  });
}
