// くみあわせ：準備の「大会」（いまの大会の名前・切りかえ・新しく作る・複製・消す・見る人用のリンクの大会を保存）
// app.js から読む（import。描きなおしは renderEvents、ボタンは bindEvent）
import { LIMITS } from "./settings.js?v=202610291801";
import { blankTournament, cleanTournament, newId } from "./store.js?v=202610291801";
import { $, clone, seasonal, toast } from "./dom.js?v=202610291801";
import { current, data, page, persist, setViewing, ui, viewing } from "./state.js?v=202610291801";

// 大会の呼び名（名前がなければ「無題の大会（10/28）」）を返す
function eventLabel(t) {
  if (t.name) return t.name;
  const d = new Date(t.createdAt);
  return `無題の大会（${d.getMonth() + 1}/${d.getDate()}）`;
}

// 大会の切りかえ・名前・見るだけの案内を描きなおす
export function renderEvents() {
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
  ui.renderAll();
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

// 押す・入力を受けるしかけ（大会の名前・「…」・見る人用のリンクの大会を保存）を付ける（app.js の init から1回）
export function bindEvent() {
  $("eventName").addEventListener("click", renameEvent);
  $("eventMenu").addEventListener("click", openEventMenu);
  $("saveView").addEventListener("click", () => {
    if (data.list.length >= LIMITS.tournaments) return toast(`保存できる大会は ${LIMITS.tournaments} 件まで。使わないものを消すと保存できます`);
    const t = { ...cleanTournament(viewing), id: newId("q"), createdAt: Date.now(), updatedAt: Date.now() };
    data.list.push(t);
    data.current = t.id;
    setViewing(null);
    history.replaceState(null, "", location.pathname);
    persist();
    ui.renderAll();
    toast(seasonal("この端末に保存しました"));
  });
}
