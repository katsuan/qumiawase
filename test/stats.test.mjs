// 順位・勝ち上がり（js/stats.js）のテスト。node --test test/
import test from "node:test";
import assert from "node:assert";
import { generate } from "../js/pairing.js";
import { outcome, podium, resolve, table } from "../js/stats.js";

const P = { win: 3, draw: 1, loss: 0 };
const teams = (n) => Array.from({ length: n }, (_, i) => ({ id: `t${i + 1}` }));
const m = (id, h, a) => ({ id, stage: "league", round: 1, home: { team: h }, away: { team: a } });

test("勝ち負け：点、同点なら PK、PK もないなら引き分け", () => {
  assert.equal(outcome({ s: [2, 1] }), "home");
  assert.equal(outcome({ s: [0, 3] }), "away");
  assert.equal(outcome({ s: [1, 1] }), "draw");
  assert.equal(outcome({ s: [1, 1], pk: [4, 3] }), "home");
  assert.equal(outcome({ s: [1, 1], pk: [2, 5] }), "away");
  assert.equal(outcome(null), null);
});

test("順位：勝ち点 → 得失点差 → 総得点", () => {
  const ids = ["a", "b", "c"];
  const ms = [m("1", "a", "b"), m("2", "b", "c"), m("3", "c", "a")];
  // a: 1勝1敗 得3失3、b: 1勝1敗 得4失2、c: 1勝1敗 得2失4
  const results = { 1: { s: [2, 0] }, 2: { s: [4, 0] }, 3: { s: [2, 1] } };
  const rows = table(ids, ms, results, P);
  assert.deepEqual(rows.map((r) => r.id), ["b", "a", "c"]);
  assert.deepEqual(rows.map((r) => r.pts), [3, 3, 3]);
  assert.equal(rows[0].gd, 2);
  assert.deepEqual(rows.map((r) => r.rank), [1, 2, 3]);
});

test("順位：勝ち点・得失点差・総得点が同じなら、直接対決で", () => {
  const ids = ["a", "b", "c", "d"];
  const ms = [m("1", "a", "b"), m("2", "c", "d"), m("3", "a", "c"), m("4", "b", "d"), m("5", "a", "d"), m("6", "b", "c")];
  // a と b は同じ成績（2勝1敗・得4失2）。直接対決は b の勝ち
  const results = { 1: { s: [0, 1] }, 2: { s: [0, 0] }, 3: { s: [2, 0] }, 4: { s: [2, 0] }, 5: { s: [2, 1] }, 6: { s: [1, 2] } };
  const rows = table(ids, ms, results, P);
  const a = rows.find((r) => r.id === "a");
  const b = rows.find((r) => r.id === "b");
  assert.deepEqual([a.pts, a.gd, a.gf], [b.pts, b.gd, b.gf]);
  assert.ok(rows.indexOf(b) < rows.indexOf(a), "直接対決で勝った b が上");
});

test("勝ち点は設定で変えられる（勝2・分1・負0）。PK は勝ち点に入れない", () => {
  const rows = table(["a", "b"], [m("1", "a", "b")], { 1: { s: [1, 1], pk: [5, 4] } }, { win: 2, draw: 1, loss: 0 });
  assert.deepEqual(rows.map((r) => r.pts), [1, 1]);
  const win = table(["a", "b"], [m("1", "a", "b")], { 1: { s: [3, 1] } }, { win: 2, draw: 1, loss: 0 });
  assert.equal(win[0].pts, 2);
});

test("トーナメント：勝ったほうが次へ。不戦勝はそのまま次へ。決まるまでは null", () => {
  const gen = generate(teams(3), "knockout");
  const ids = teams(3).map((t) => t.id);
  let r = resolve(gen, ids, {}, P);
  const bye = gen.matches.find((x) => x.bye);
  assert.equal(r[bye.id].winner, "t1");
  const play = gen.matches.find((x) => x.round === 1 && !x.bye);
  const final = gen.matches.find((x) => x.round === 2);
  assert.deepEqual([r[final.id].home, r[final.id].away].filter(Boolean).length, 1, "決勝の片方はまだ");
  r = resolve(gen, ids, { [play.id]: { s: [1, 1], pk: [3, 4] } }, P);
  const winner = r[play.id].winner;
  assert.ok(winner && winner !== "t1");
  assert.ok([r[final.id].home, r[final.id].away].includes(winner));
  r = resolve(gen, ids, { [play.id]: { s: [1, 1], pk: [3, 4] }, [final.id]: { s: [2, 0] } }, P);
  assert.equal(podium(gen, r).first, r[final.id].home);
});

test("グループ → 決勝トーナメント：グループが全部終わるまで、上がるチームは決まらない", () => {
  const gen = generate(teams(8), "groups", { groups: 2, advance: 2 });
  const ids = teams(8).map((t) => t.id);
  const groupA = gen.matches.filter((x) => x.group === "A");
  const results = {};
  for (const x of groupA.slice(0, -1)) results[x.id] = { s: [1, 0] };
  const ko = gen.matches.find((x) => x.stage === "ko" && x.round === 1);
  assert.equal(resolve(gen, ids, results, P)[ko.id].home, null);
  results[groupA.at(-1).id] = { s: [0, 0] };
  const r = resolve(gen, ids, results, P);
  const firstA = table(gen.groups[0].ids, groupA, results, P)[0].id;
  assert.equal(r[ko.id].home, firstA, "A組1位が入る");
  assert.equal(r[ko.id].away, null, "B組はまだ");
});

test("見こみ：試合の数・1チームの最多の試合の数・かかる時間", async () => {
  const { estimate, durationLabel } = await import("../js/stats.js");
  const { timeSchedule } = await import("../js/pairing.js");
  const lg = generate(teams(5), "league");
  const e = estimate(lg, timeSchedule(lg.matches, { courts: 1, minutes: 20, avoid: false }));
  assert.deepEqual(e, { matches: 10, most: 4, minutes: 200 });
  const ko = generate(teams(8), "knockout", { thirdPlace: true });
  assert.equal(estimate(ko, []).matches, 8);
  assert.equal(estimate(ko, []).most, 3, "8チームのトーナメントは3試合（決勝・3位決定戦まで）");
  const ko5 = generate(teams(5), "knockout");
  assert.equal(estimate(ko5, []).matches, 4);
  const gr = generate(teams(8), "groups", { groups: 2, advance: 2 });
  assert.equal(estimate(gr, []).most, 3 + 2, "グループ3試合＋決勝トーナメント2回");
  assert.equal(durationLabel(110), "約1時間50分");
  assert.equal(durationLabel(40), "約40分");
  assert.equal(durationLabel(120), "約2時間");
});

// 総当たりの PK：points.pk なら、同点で PK が決まった試合は PK勝ち・PK負けの勝ち点（しないなら引き分け）
test("総当たりの PK の勝ち点", () => {
  const ms = [{ id: "a", home: { team: "x" }, away: { team: "y" } }];
  const results = { a: { s: [1, 1], pk: [4, 3] } };
  const off = table(["x", "y"], ms, results, { win: 3, draw: 1, loss: 0 });
  assert.deepEqual(off.map((r) => [r.id, r.pts, r.draw]), [["x", 1, 1], ["y", 1, 1]]);
  const on = table(["y", "x"], ms, results, { win: 3, draw: 1, loss: 0, pk: true, pkWin: 2, pkLoss: 1 });
  assert.deepEqual(on.map((r) => [r.id, r.pts, r.pkWin, r.pkLoss, r.draw, r.gd]), [["x", 2, 1, 0, 0, 0], ["y", 1, 0, 1, 0, 0]]);
  // PK がまだ入っていなければ引き分け
  const wait = table(["x", "y"], ms, { a: { s: [1, 1] } }, { win: 3, draw: 1, loss: 0, pk: true, pkWin: 2, pkLoss: 1 });
  assert.deepEqual(wait.map((r) => r.pts), [1, 1]);
});
