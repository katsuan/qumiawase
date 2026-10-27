// さくせん盤（となりの q-saqsen）との受けわたしのテスト。くみあわせ → さくせん盤（?match=）→ くみあわせ（?result=）。node --test test/
// さくせん盤のファイルは普通の <script> なので、vm で読む。q-saqsen が同じフォルダになければ飛ばす
import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import vm from "node:vm";
import { readResult, roqgaUrl, saqsenUrl } from "../js/link.js";

const SAQSEN = new URL("../../q-saqsen/", import.meta.url);
const ROQGA = new URL("../../q-roqga/", import.meta.url);
const has = (dir) => fs.existsSync(new URL("index.html", dir));

// さくせん盤の state とリンクを読むところ（js/page.js〜link.js）を、URL を決めて読む
function bootSaqsen(search) {
  const files = ["page", "formation", "marks", "store", "link"].map((f) => fs.readFileSync(new URL(`js/${f}.js`, SAQSEN), "utf8")).join("\n");
  const mem = {};
  const ctx = vm.createContext({
    localStorage: { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => (mem[k] = String(v)) },
    location: { search, pathname: "/soccer/" },
    history: { replaceState() {} },
    window: { matchMedia: () => ({ matches: false }) },
    document: {},
    URLSearchParams, TextEncoder, TextDecoder, atob, btoa
  });
  vm.runInContext(files, ctx);
  return { get: (code) => vm.runInContext(code, ctx), mem };
}

test("さくせん盤で開く → 2チーム・色・会場・時刻・戻す先が、さくせん盤に届く", { skip: !has(SAQSEN) }, () => {
  const url = new URL(saqsenUrl({ home: { name: "FC 青", color: "#1e63d6" }, away: { name: "レッズ", color: "#e53935" }, place: "市民グラウンド", date: "2026-11-03", time: "09:30", tid: "q1abc", mid: "K1-2" }));
  const { get } = bootSaqsen(url.search);
  assert.deepEqual(JSON.parse(JSON.stringify(get("pendingMatch"))), { team: "FC 青", opponent: "レッズ", ourColor: "#1e63d6", oppColor: "#e53935", where: "市民グラウンド", whenDate: "2026-11-03", whenTime: "09:30", tid: "q1abc", mid: "K1-2" });
});

test("さくせん盤で結果を入れる → くみあわせに、点と PK が戻る（リンクでも、同じ端末の inbox でも）", { skip: !has(SAQSEN) }, () => {
  const { get, mem } = bootSaqsen("");
  get(`state.qumiawase = { tid: "q1abc", mid: "K1-2" }; state.scoreUs = 2; state.scoreThem = 2; state.pkUs = 4; state.pkThem = 5;`);
  const url = new URL(get("qumiawaseResultUrl()"));
  assert.equal(url.origin + url.pathname, "https://katsuan.github.io/qumiawase/");
  assert.deepEqual(readResult(url.searchParams.get("result")), { tid: "q1abc", mid: "K1-2", s: [2, 2], pk: [4, 5] });
  get("keepQumiawaseResult()");
  assert.deepEqual(JSON.parse(mem["qumiawase:inbox"]), [{ tid: "q1abc", mid: "K1-2", s: [2, 2], pk: [4, 5] }]);
});

test("ろくがで撮る → 2チームの名前と色が、ろくがに届く", { skip: !has(ROQGA) }, () => {
  const code = ["page", "store"].map((f) => fs.readFileSync(new URL(`js/${f}.js`, ROQGA), "utf8")).join("\n");
  const ctx = vm.createContext({ localStorage: { getItem: () => null, setItem() {} }, document: {}, atob, TextDecoder });
  vm.runInContext(code, ctx);
  const url = new URL(roqgaUrl({ home: { name: "FC 青", color: "#1e63d6" }, away: { name: "レッズ", color: "#e53935" } }));
  const m = vm.runInContext("readMatchLink", ctx)(url.searchParams.get("match"));
  assert.deepEqual(JSON.parse(JSON.stringify(m)), { teamUs: "FC 青", teamThem: "レッズ", colorUs: "#1e63d6", colorThem: "#e53935" });
});

const QRONOS = new URL("../../q-qronos/", import.meta.url);
test("くろのすで開く → くろのすの読み方で、試合ごとの日時と名前のボードになる", { skip: !has(QRONOS) }, async () => {
  const { qronosUrl } = await import("../js/link.js");
  const window = {};
  const ctx = vm.createContext({ window, URLSearchParams, TextEncoder, TextDecoder, atob, btoa, Date, Intl });
  for (const f of ["js/count.js", "js/link.js"]) vm.runInContext(fs.readFileSync(new URL(f, QRONOS), "utf8"), ctx);
  const url = new URL(qronosUrl("FC 青の試合", [
    { at: "2026-11-03T09:30", title: "第1試合 vs レッズ", emoji: "⚽" },
    { at: "2026-11-03T11:10", title: "準決勝 vs グリーン", emoji: "🏆" },
    { at: "bad", title: "x" }
  ]));
  assert.equal(url.origin + url.pathname, "https://katsuan.github.io/countdown/");
  const expanded = new URLSearchParams(window.Countdown.expandSearch(url.search));
  assert.equal(expanded.get("name"), "FC 青の試合");
  const es = expanded.getAll("e");
  assert.equal(es.length, 2, "日時のないものは入れない");
  assert.match(decodeURIComponent(es[0]), /2026-11-03T09:30/);
  assert.match(decodeURIComponent(es[0]), /第1試合 vs レッズ/);
  assert.equal(qronosUrl("x", []), null);
});
