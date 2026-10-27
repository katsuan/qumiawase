// 端末に残す形（js/store.js）とリンクの受け渡し（js/link.js）のテスト。node --test test/
import test from "node:test";
import assert from "node:assert";
import { blankTournament, cleanTournament, loadAll, saveAll, takeInbox, INBOX_KEY, STORE_KEY } from "../js/store.js";
import { decode, encode, packTournament, readResult, readView, resultUrl, roqgaUrl, saqsenUrl, unpackTournament, viewUrl } from "../js/link.js";

const XSS = "<img src=x onerror=alert(1)>"; // qcheck-ok: W8 テストの見本の文字（画面では動かさない）
// まねの localStorage
function memory(init = {}) {
  const mem = { ...init };
  return { mem, getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => (mem[k] = String(v)), removeItem: (k) => delete mem[k] };
}
const sample = () => {
  const t = blankTournament("春の大会");
  t.teams = ["FC 青", "レッズ", "グリーン", XSS, "白組"].map((name, i) => ({ id: `x${i}`, name, color: ["#1e63d6", "#e53935", "#22a447", "#ffd23f", "#ffffff"][i] }));
  t.format = "league";
  t.opts.legs = 2;
  t.points = { win: 2, draw: 1, loss: 0 };
  t.sched = { on: true, date: "2026-11-03", start: "09:30", courts: 2, minutes: 15, place: "市民グラウンド", avoid: false, rest: 25 };
  t.results = { "L1-1": { s: [2, 1] }, "L2-1": { s: [0, 0], pk: [4, 3] } };
  return t;
};

test("見る人用のリンク：中身をのせて、読みもどせる（チームの id は並びの順）", () => {
  const t = sample();
  const back = readView(new URL(viewUrl(t)).search);
  assert.equal(back.name, "春の大会");
  assert.deepEqual(back.teams.map((x) => x.name), t.teams.map((x) => [...x.name].slice(0, 20).join("")));
  assert.deepEqual(back.teams.map((x) => x.id), ["t1", "t2", "t3", "t4", "t5"]);
  assert.equal(back.format, "league");
  assert.equal(back.opts.legs, 2);
  assert.deepEqual(back.points, { win: 2, draw: 1, loss: 0 });
  assert.deepEqual(back.sched, t.sched);
  assert.deepEqual(back.results, t.results);
  assert.equal(back.teams[3].name, XSS.slice(0, 20), "文字は文字のまま（上限あり）");
});

test("壊れた・形のちがうリンクは null（止まらない）", () => {
  for (const bad of ["%%%", "e30", encode([1]), encode({ t: [] }), encode({ t: "x" }), "", null]) {
    assert.equal(unpackTournament(decode(bad)), null, String(bad));
  }
  assert.equal(readView("?x=1"), null);
  // 変な結果・色は捨てる
  const t = unpackTournament({ t: [["a", "zzz"], ["b", "123456"]], r: [["L1-1", -5, 1e9], ["L1-2", "a", 1], 5, ["../x", 1, 1]] });
  assert.deepEqual(t.results, { "L1-1": { s: [0, 99] } });
  assert.equal(t.teams[0].color, "#22a447", "色でなければはじめの色");
  assert.equal(t.teams[1].color, "#123456");
});

test("端末に残す：壊れた中身でも空の大会を1つ。残して読みもどせる", () => {
  for (const bad of ["{", "[1]", "null", JSON.stringify({ list: [null, 5, { teams: "x" }] })]) {
    const data = loadAll(memory({ [STORE_KEY]: bad }));
    assert.ok(data.list.length >= 1);
    assert.ok(data.list.every((t) => Array.isArray(t.teams) && t.teams.length >= 1));
  }
  const store = memory();
  const t = sample();
  assert.ok(saveAll({ list: [t], current: t.id }, store));
  const back = loadAll(store);
  assert.deepEqual(back.list[0], cleanTournament(t));
  assert.equal(back.current, t.id);
  // 残せないとき（容量いっぱい）も止まらない
  assert.equal(saveAll({ list: [t], current: t.id }, { setItem() { throw new Error("quota"); } }), false);
});

test("さくせん盤で開くリンク：2チームの名前と色・会場・時刻・戻す先をのせる", () => {
  const t = sample();
  const url = new URL(saqsenUrl({ home: t.teams[0], away: t.teams[1], place: "市民グラウンド", date: "2026-11-03", time: "09:30", tid: t.id, mid: "L1-1" }));
  assert.equal(url.origin + url.pathname, "https://katsuan.github.io/soccer/");
  assert.deepEqual(decode(url.searchParams.get("match")), { t: "FC 青", o: "レッズ", c: "#1e63d6", oc: "#e53935", w: "市民グラウンド", d: "2026-11-03", tm: "09:30", tid: t.id, mid: "L1-1" });
  const r = new URL(roqgaUrl({ home: t.teams[0], away: t.teams[1] }));
  assert.equal(r.origin + r.pathname, "https://katsuan.github.io/score-recorder/");
  assert.deepEqual(decode(r.searchParams.get("match")), { t: "FC 青", o: "レッズ", c: "#1e63d6", oc: "#e53935" });
});

test("結果を戻すリンク：スコアと PK を読みもどせる。形がちがえば null", () => {
  const url = new URL(resultUrl({ tid: "q1", mid: "K1-2", s: [1, 1], pk: [5, 4] }));
  assert.deepEqual(readResult(url.searchParams.get("result")), { tid: "q1", mid: "K1-2", s: [1, 1], pk: [5, 4] });
  for (const bad of [encode({ tid: "q1", mid: "K1-2", s: ["a", 1] }), encode({ mid: "x", s: [1, 1] }), "%%%"]) assert.equal(readResult(bad), null);
});

test("同じ端末で戻ってきた結果（inbox）：形を確かめてとり出し、とり出したら消す", () => {
  const store = memory({ [INBOX_KEY]: JSON.stringify([{ tid: "q1", mid: "L1-1", s: [3, 2] }, { tid: "q1", s: [1, 1] }, null, { tid: "q1", mid: "L1-2", s: [1, "x"] }]) });
  assert.deepEqual(takeInbox(store), [{ tid: "q1", mid: "L1-1", s: [3, 2] }]);
  assert.equal(store.mem[INBOX_KEY], undefined);
  assert.deepEqual(takeInbox(memory({ [INBOX_KEY]: "{" })), []);
});

test("リンクの中身は 32 チームでも作れる（見る人用は長くてもよい）", () => {
  const t = sample();
  t.teams = Array.from({ length: 32 }, (_, i) => ({ id: `t${i + 1}`, name: `チーム${i + 1}`, color: "#22a447" }));
  const back = readView(new URL(viewUrl(t)).search);
  assert.equal(back.teams.length, 32);
  assert.ok(packTournament(t).t.length === 32);
});

test("試合の種類の初期設定：時間は5分きざみで上限まで、勝ち点は 0〜9。覚えた種類は形を確かめて読む", async () => {
  const { PRESETS, LIMITS } = await import("../js/settings.js");
  assert.equal(new Set(PRESETS.map((p) => p.key)).size, PRESETS.length);
  for (const p of PRESETS) {
    assert.ok(p.minutes % 5 === 0 && p.minutes >= 5 && p.minutes <= LIMITS.minutes, p.key);
    assert.ok(p.rest % 5 === 0 && p.rest >= 0 && p.rest <= LIMITS.minutes, p.key);
    for (const v of Object.values(p.points)) assert.ok(v >= 0 && v <= 9, p.key);
    assert.ok(p.note && p.label);
  }
  assert.equal(cleanTournament({ preset: "futsal", teams: [{ name: "a" }, { name: "b" }] }).preset, "futsal");
  assert.equal(cleanTournament({ preset: "<x>", teams: [{ name: "a" }] }).preset, "");
});
