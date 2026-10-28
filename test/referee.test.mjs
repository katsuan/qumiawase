// 審判（js/pairing.js の refereeOptions・autoReferees と、リンク・保存）のテスト。node --test test/
import test from "node:test";
import assert from "node:assert";
import { autoReferees, generate, refereeOptions, timeSchedule } from "../js/pairing.js";
import { resolve } from "../js/stats.js";
import { blankTournament, cleanTournament } from "../js/store.js";
import { packTournament, unpackTournament } from "../js/link.js";

const teams = (n) => Array.from({ length: n }, (_, i) => ({ id: `t${i + 1}` }));
const P = { win: 3, draw: 1, loss: 0 };

test("審判の候補：その試合に出ない・同じ時間にほかのコートで試合のないチーム", () => {
  const gen = generate(teams(4), "league");
  const ids = teams(4).map((t) => t.id);
  const resolved = resolve(gen, ids, {}, P);
  const one = timeSchedule(gen.matches, { courts: 1, minutes: 20 });
  const m = gen.matches.find((x) => x.id === one[0].id);
  assert.deepEqual(refereeOptions(m, ids, resolved, one, gen.matches), ids.filter((id) => id !== m.home.team && id !== m.away.team));
  const two = timeSchedule(gen.matches, { courts: 2, minutes: 20, avoid: false });
  assert.deepEqual(refereeOptions(m, ids, resolved, two, gen.matches), [], "4チーム・2コートは全員が同時に試合 → いない（−）");
});

test("審判を自動で：全部の試合に、出ないチームから、かたよらないように。入っているものはそのまま", () => {
  const gen = generate(teams(5), "league");
  const ids = teams(5).map((t) => t.id);
  const resolved = resolve(gen, ids, {}, P);
  const plan = timeSchedule(gen.matches, { courts: 1, minutes: 20, rest: 10 });
  const first = gen.matches.find((x) => x.id === plan[0].id);
  const keep = ids.find((id) => ![first.home.team, first.away.team].includes(id));
  const out = autoReferees(gen.matches, ids, resolved, plan, { [first.id]: keep }, 10);
  assert.equal(out[first.id], keep, "入っているものはそのまま");
  for (const m of gen.matches) {
    assert.ok(out[m.id], "全部の試合に入る");
    assert.ok(![m.home.team, m.away.team].includes(out[m.id]), "出るチームは審判にしない");
  }
  const count = ids.map((id) => Object.values(out).filter((x) => x === id).length);
  assert.ok(Math.max(...count) - Math.min(...count) <= 1, `かたよらない ${count}`);
});

test("審判：保存とリンクで残る。ないチーム・おかしい id は落とす", () => {
  const t = blankTournament();
  t.referees = { "L1-1": "t3", "L1-2": "t9", "bad id!": "t1" };
  const clean = cleanTournament(t);
  assert.deepEqual(clean.referees, { "L1-1": "t3" });
  assert.deepEqual(unpackTournament(packTournament(clean)).referees, { "L1-1": "t3" });
});

test("審判を自動で：トーナメントの出るチームが決まっていない試合には入れない", () => {
  const gen = generate(teams(4), "knockout");
  const ids = teams(4).map((t) => t.id);
  const resolved = resolve(gen, ids, {}, P);
  const plan = timeSchedule(gen.matches, { courts: 1, minutes: 20 });
  const out = autoReferees(gen.matches, ids, resolved, plan, {}, 0);
  const final = gen.matches.find((m) => m.round === 2);
  assert.equal(out[final.id], undefined);
  assert.equal(Object.keys(out).length, 2);
});
