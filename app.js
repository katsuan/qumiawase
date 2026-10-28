// くみあわせ（QumiAwase）：入口。部品（js/）をつなぎ、描きなおしの順番を決め、ページのタブ・さくせん盤から戻ってきた結果・起動だけをここで受ける
// index.html から読む（type="module"）。画面の部品：準備は js/prep-event.js（大会）・js/prep-teams.js（チーム）・js/prep-format.js（形・日程・要項）、
// 試合は js/play-matches.js（試合の表）・js/play-tables.js（トーナメント表・順位表）・js/play-team.js（チーム別）・js/play-score.js（点を入れる）、
// 送る・保存は js/share-ui.js、みんなで入れるは js/live-ui.js。いまの大会と計算は js/state.js、画面の小さな道具は js/dom.js
// 計算だけの部品（画面に触らない・テストで呼ぶ）：組み合わせは js/pairing.js、順位と勝ち上がりは js/stats.js、端末に残すのは js/store.js、
// リンクは js/link.js、カードは js/card.js、画像は js/image.js、くらぶボットとのやりとりは js/live.js
import { TOOL } from "./js/settings.js?v=202610290639";
import { takeInbox } from "./js/store.js?v=202610290639";
import { readResult } from "./js/link.js?v=202610290639";
import { matchLine } from "./js/card.js?v=202610290639";
import { readLive } from "./js/live.js?v=202610290639";
import { $, seasonal, toast } from "./js/dom.js?v=202610290639";
import { compute, current, data, liveRole, page, persist, planLocked, setViewing, ui, viewing } from "./js/state.js?v=202610290639";
import { bindTeamView } from "./js/play-team.js?v=202610290639";
import { bindMatches, renderMatches } from "./js/play-matches.js?v=202610290639";
import { bindTables, renderBracket, renderStandings } from "./js/play-tables.js?v=202610290639";
import { bindEvent, renderEvents } from "./js/prep-event.js?v=202610290639";
import { bindTeams, renderTeams } from "./js/prep-teams.js?v=202610290639";
import { bindFormat, renderEstimate, renderFormat, renderPresets, renderRules, renderSched } from "./js/prep-format.js?v=202610290639";
import { bindShare } from "./js/share-ui.js?v=202610290639";
import { bindLive, liveAfterSave, openLiveLink, openUnlock, renderLive, startLivePolling } from "./js/live-ui.js?v=202610290639";

// ---- 画面：ページのタブ（準備・試合）と、描きなおしの順番 ----

// ページのタブと、準備・試合のどちらを出すかを描きなおす（見る人用のリンクのときは試合だけ）
function renderPage() {
  if (viewing || planLocked()) page.now = "play";
  if (!page.now) page.now = Object.keys(current().results).length ? "play" : "prep";
  $("pageTabs").hidden = Boolean(viewing) || planLocked(); // 見るだけ・つないだ大会で運営でないときは、試合だけ
  document.querySelectorAll("[data-page]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.page === page.now)));
  $("pagePrep").hidden = page.now !== "prep";
  $("pagePlay").hidden = page.now !== "play";
}

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

// ---- さくせん盤から戻ってきた結果 ----

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
    setViewing(null);
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

// ---- 操作 ----

// 押す・入力を受けるしかけを付ける（はじめに1回）。部品ごとの bind を順に呼び、ページのタブ・試合へ・さくせん盤の結果だけここで
function bindEvents() {
  bindEvent();
  bindTeams();
  bindFormat();
  bindMatches();
  bindTeamView();
  bindTables();
  bindShare();
  bindLive();
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
  $("goPlay").addEventListener("click", () => {
    page.now = "play";
    page.play = "matches";
    renderPage();
    renderResults();
    window.scrollTo({ top: 0 });
  });

  // 同じ端末のさくせん盤から結果が戻ってきたら入れる（別のタブで入れたとき・もどってきたとき）
  window.addEventListener("storage", (e) => e.key?.endsWith(":inbox") && takeLocalResults());
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && takeLocalResults());
}

// はじめに動かす：部品をつなぎ、名前を出し、受けとった結果を入れ、画面を作る
function init() {
  document.title = `${TOOL.name}｜${TOOL.copy}`;
  $("toolName").textContent = TOOL.name;
  $("toolCopy").textContent = TOOL.copy;
  // 部品から呼ぶ描きなおしと、端末に残したあと（つないだ大会なら送る）
  Object.assign(ui, { renderAll, renderResults, renderPage, afterSave: liveAfterSave });
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
