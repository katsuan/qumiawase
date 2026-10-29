// くみあわせ：「📡 みんなで入れる」の画面（くらぶボットにのせる・合言葉・点を送る・🔄 更新で読む・共有リンク・つなぐのをやめる）
// app.js から読む（import）。合言葉から key を作る・ボットを呼ぶ・形を確かめるのは js/live.js（画面には触らない）
//
// つないでいない大会は、これまでどおり端末の中だけ。つないだ大会だけ、点を1試合ずつ送り、ほかの端末の点は「🔄 更新」で読みなおす
import { TOOL } from "./settings.js?v=202610291808";
import { blankTournament, newId, saveAll } from "./store.js?v=202610291808";
import { adminKey, botUrlIn, fromServer, inputKey, liveCall, liveError, liveUrl, newLiveId, overlay, PASS_MAX, PASS_MIN, queue, sessionKey, setSessionKey, toServer } from "./live.js?v=202610291808";
import { $, copy, esc, seasonal, toast } from "./dom.js?v=202610291808";
import { change, current, data, liveKeys, liveRole, page, ui, viewing } from "./state.js?v=202610291808";

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
export function liveAfterSave() {
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
    ui.renderAll();
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
          ui.renderAll();
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
      ui.renderAll();
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
export function openUnlock() {
  page.now = "play";
  ui.renderPage();
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
      ui.renderAll();
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
  ui.renderAll();
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
  ui.renderAll();
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
export function renderLive() {
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
    copy(url, "共有リンクをコピーしました", "共有リンク");
    return;
  }
  if (kind === "lock") {
    rememberKey(t.live.id, null);
    toast("この端末では、見るだけにしました");
    return ui.renderAll();
  }
  if (kind === "leave") return liveLeave();
}

// ?live=…&bot=… で開いたとき：この端末にその大会があれば開き、なければボットから読んで足す
export async function openLiveLink(link) {
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
  ui.renderAll();
  if (!liveRole(t)) toast("見るだけで開きました。最新の点は「🔄 更新」で読みます。点を入れる人は「✏️ 点を入れる」から合言葉を入れてね");
}

// つないだ大会の準備（はじめの印）と、電波がもどったときに送れていない点を送る
export function startLivePolling() {
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

// 押す・入力を受けるしかけ（みんなで入れる（帯・欄・合言葉の form））を付ける（app.js の init から1回）
export function bindLive() {
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
}
