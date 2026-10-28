// くみあわせ：画面の小さな道具（id で部品を探す・HTML に入れる文字・写し・トースト・季節の絵文字・− 数 ＋ の欄）
// app.js と js/ の画面の部品（state・prep-*・play-*・share-ui・live-ui）から読む（import）

// id から画面の部品を返す
export const $ = (id) => document.getElementById(id);
// 文字を HTML に入れられる形にする（& < > " ' を置きかえる）
export const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
// 中身の写しを返す
export const clone = (v) => JSON.parse(JSON.stringify(v));
// Q キットのトーストで知らせる（undo を渡すと「元に戻す」つき）。Q キットがないときは何もしない
export const toast = (message, undo) => window.LineShareUI?.toast(message, undo ? { actionLabel: "元に戻す", onAction: undo } : {});
// 季節の絵文字（Q キットの season.js）を、うれしい瞬間の短い文にときどき足す。なくても・止まっても文はそのまま
export const seasonal = (text) => {
  try {
    return window.QSeason ? window.QSeason.decorate(text) : text;
  } catch {
    return text;
  }
};

// − 数 ＋ の部品を el に作る（get で今の数、set で変える。min〜max、step ずつ）
export function stepper(el, { get, set, min, max, step = 1, label, typed = false }) {
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
