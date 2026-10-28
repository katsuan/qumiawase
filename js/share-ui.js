// くみあわせ：送る・保存（おくるんのカード・📷 画像・🔗 見る人用のリンク・📄 大会のまとめ（印刷・PDF・文でコピー））
// app.js から読む（import。ボタンは bindShare）。カードの中身は js/card.js、画像は js/image.js
import { TOOL } from "./settings.js?v=202610290639";
import { table } from "./stats.js?v=202610290639";
import { viewUrl } from "./link.js?v=202610290639";
import { cardParams, dateLabel, formatLabel, matchTitle, sideLabel, summaryText, teamName } from "./card.js?v=202610290639";
import { drawTournament } from "./image.js?v=202610290639";
import { $, esc, toast } from "./dom.js?v=202610290639";
import { compute, current } from "./state.js?v=202610290639";

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

// 押す・入力を受けるしかけ（送る・保存のボタン）を付ける（app.js の init から1回）
export function bindShare() {
  // 送る・保存
  $("openSummary").addEventListener("click", openSummary);
  $("sendCard").addEventListener("click", sendCard);
  $("saveImage").addEventListener("click", saveImage);
  $("shareView").addEventListener("click", shareView);
}
