// みんなで入れる（js/live.js）のテスト：形の確かめ・待っているもの・ボットの中身との合わせかた・合言葉の key。node --test test/
import test from "node:test";
import assert from "node:assert";
import crypto from "node:crypto";
import { adminKey, botUrlIn, fromServer, inputKey, liveIn, liveUrl, newLiveId, overlay, queue, readLive, sessionKey, setSessionKey, toServer } from "../js/live.js";
import { cleanTournament } from "../js/store.js";

const BOT = "https://script.google.com/macros/s/AKfycbxxxxxxxxxxxxxxxxxxxxxxxx/exec";
const ID = "0123456789abcdef0123";

test("ボットの URL と大会の番号の形", () => {
  assert.equal(botUrlIn(BOT), BOT);
  for (const bad of ["https://example.com/exec", `${BOT}?key=x`, "javascript:alert(1)", "", null]) assert.equal(botUrlIn(bad), "", String(bad));
  assert.match(newLiveId(), /^[0-9a-f]{20}$/);
  assert.notEqual(newLiveId(), newLiveId());
});

test("共有リンク：番号とボットだけ（合言葉は入らない）。読みもどせる・よその URL は読まない", () => {
  const url = liveUrl({ id: ID, bot: BOT }, "https://katsuan.github.io/qumiawase/?view=x#y");
  const u = new URL(url);
  assert.deepEqual([...u.searchParams.keys()].sort(), ["bot", "live"]);
  assert.deepEqual(readLive(u.search), { id: ID, bot: BOT });
  assert.equal(readLive(`?live=${ID}&bot=https://evil.example/exec`), null);
  assert.equal(readLive("?live=../x&bot=" + encodeURIComponent(BOT)), null);
});

test("t.live の形を確かめる（待っているものも）", () => {
  assert.equal(liveIn({ id: ID }), null);
  const v = liveIn({ id: ID, bot: BOT, version: 3, pending: [{ mid: "L1-1", result: { s: [1, 0] } }, { mid: "<x>", result: { s: [1, 0] } }, { mid: "L1-2", result: { s: ["x", 0] } }, { mid: "L1-3", ref: "t2" }, { mid: "L1-4", result: null }] });
  assert.deepEqual(v.pending, [{ mid: "L1-1", result: { s: [1, 0] } }, { mid: "L1-3", ref: "t2" }, { mid: "L1-4", result: null }]);
  assert.equal(v.version, 3);
});

test("待っているもの：同じ試合の同じ種類はあとのものだけ。ボットの中身にのせる", () => {
  let p = [];
  p = queue(p, { mid: "a", result: { s: [1, 0] } });
  p = queue(p, { mid: "a", ref: "t3" });
  p = queue(p, { mid: "a", result: { s: [2, 0] } });
  p = queue(p, { mid: "b", result: null });
  assert.deepEqual(p, [{ mid: "a", ref: "t3" }, { mid: "a", result: { s: [2, 0] } }, { mid: "b", result: null }]);
  const t = overlay({ results: { b: { s: [0, 0] }, c: { s: [1, 1] } }, referees: { a: "t1" } }, p);
  assert.deepEqual(t.results, { a: { s: [2, 0] }, c: { s: [1, 1] } });
  assert.deepEqual(t.referees, { a: "t3" });
});

test("ボットから読んだ中身：この端末の id・live はそのまま。運営の書きかけ（keepPlan）は組み合わせを残す", () => {
  const local = cleanTournament({ id: "q1", name: "前", teams: [{ id: "t1", name: "a" }, { id: "t2", name: "b" }], format: "league", results: {} });
  local.live = { id: ID, bot: BOT, version: 1, pending: [{ mid: "L1-1", result: { s: [3, 0] } }], at: 0 };
  const server = { ...toServer(local), name: "あと", teams: [{ id: "t1", name: "A" }, { id: "t2", name: "B" }], results: { "L1-1": { s: [0, 1] } } };
  assert.equal("live" in server || "id" in server, false);
  const next = fromServer(local, server, 5);
  assert.equal(next.id, "q1");
  assert.equal(next.name, "あと");
  assert.equal(next.live.version, 5);
  assert.deepEqual(next.results["L1-1"], { s: [3, 0] }); // まだ送れていない自分の点を上にのせる
  const kept = fromServer(local, server, 5, { keepPlan: true });
  assert.equal(kept.name, "前");
});

test("合言葉の key：くらぶボット（55_tournament.gs）と同じ作り方", async () => {
  assert.equal(await adminKey("うんえい-2026"), crypto.createHash("sha256").update("qumiawase:admin:うんえい-2026").digest("hex"));
  assert.equal(await inputKey(ID, "こーと1"), crypto.pbkdf2Sync("こーと1", `qumiawase:${ID}`, 100000, 32, "sha256").toString("hex"));
});

test("そのタブだけの key：形がちがえば読まない", () => {
  const store = new Map();
  const s = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  setSessionKey(ID, { role: "input", key: "a".repeat(64) }, s);
  assert.deepEqual(sessionKey(ID, s), { role: "input", key: "a".repeat(64) });
  store.set(`qumiawase:key:${ID}`, JSON.stringify({ role: "owner", key: "x" }));
  assert.equal(sessionKey(ID, s), null);
  setSessionKey(ID, null, s);
  assert.equal(store.size, 0);
});
