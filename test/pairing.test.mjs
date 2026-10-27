// 組み合わせ（js/pairing.js）のテスト。node --test test/
import test from "node:test";
import assert from "node:assert";
import { generate, knockout, league, matchKeys, nextPow2, roundName, roundRobinRounds, schedule, seedOrder, splitGroups, addMinutes, fitOptions } from "../js/pairing.js";

const teams = (n) => Array.from({ length: n }, (_, i) => ({ id: `t${i + 1}` }));
const ids = (n) => teams(n).map((t) => t.id);

test("シードの並び：1 番と 2 番は決勝まで当たらない", () => {
  assert.deepEqual(seedOrder(4), [1, 4, 2, 3]);
  assert.deepEqual(seedOrder(8), [1, 8, 4, 5, 2, 7, 3, 6]);
  for (const size of [2, 4, 8, 16, 32]) {
    const order = seedOrder(size);
    assert.deepEqual([...order].sort((a, b) => a - b), Array.from({ length: size }, (_, i) => i + 1));
    assert.ok(order.indexOf(1) < size / 2 && order.indexOf(2) >= size / 2, String(size));
  }
});

test("トーナメント：2〜32 チームで、不戦勝は上のシードに、試合の数はチーム数−1", () => {
  for (let n = 2; n <= 32; n++) {
    const ms = knockout(ids(n).map((id) => ({ team: id })));
    const size = nextPow2(n);
    const byes = ms.filter((m) => m.bye);
    assert.equal(byes.length, size - n, `n=${n} の不戦勝`);
    assert.equal(ms.filter((m) => !m.bye).length, n - 1, `n=${n} の試合の数`);
    // 不戦勝になるのはシードの上から（t1, t2, …）
    const byeTeams = byes.map((m) => (m.home.team || m.away.team)).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
    assert.deepEqual(byeTeams, ids(size - n), `n=${n} の不戦勝のチーム`);
    // 1回戦で、どのチームも1回だけ出る
    const first = ms.filter((m) => m.round === 1).flatMap((m) => [m.home.team, m.away.team]).filter(Boolean);
    assert.equal(new Set(first).size, n);
    assert.equal(first.length, n);
    // 両方とも相手なしの試合はない
    assert.ok(ms.every((m) => !(m.home.empty && m.away.empty)), `n=${n}`);
  }
});

test("トーナメント：決勝は最後、3位決定戦は準決勝の負けどうし", () => {
  const ms = knockout(ids(8).map((id) => ({ team: id })), { thirdPlace: true });
  const final = ms.find((m) => m.stage === "ko" && m.round === 3);
  const third = ms.find((m) => m.stage === "third");
  assert.ok(final && third);
  assert.deepEqual([third.home.loserOf, third.away.loserOf], ["K2-1", "K2-2"]);
  assert.equal(roundName(3, 3), "決勝");
  assert.equal(roundName(2, 3), "準決勝");
  assert.equal(roundName(1, 4), "1回戦");
  assert.equal(roundName(2, 4), "準々決勝");
  // 2チームのときは3位決定戦なし
  assert.ok(!knockout(ids(2).map((id) => ({ team: id })), { thirdPlace: true }).some((m) => m.stage === "third"));
});

test("総当たり：2〜32 チームで、全部の組が1回ずつ、1回の中で同じチームは1試合まで", () => {
  for (let n = 2; n <= 32; n++) {
    const rounds = roundRobinRounds(ids(n));
    const seen = new Set();
    for (const pairs of rounds) {
      const inRound = pairs.flat();
      assert.equal(new Set(inRound).size, inRound.length, `n=${n} 同じ回に2試合`);
      for (const [a, b] of pairs) {
        const key = [a, b].sort().join("-");
        assert.ok(!seen.has(key), `n=${n} ${key} が2回`);
        seen.add(key);
      }
    }
    assert.equal(seen.size, (n * (n - 1)) / 2, `n=${n} 組の数`);
  }
});

test("総当たり2回：ホームとアウェイを入れかえて、どの組も2回", () => {
  const ms = league(ids(5), { legs: 2 });
  assert.equal(ms.length, 5 * 4);
  const count = {};
  for (const m of ms) count[`${m.home.team}>${m.away.team}`] = (count[`${m.home.team}>${m.away.team}`] || 0) + 1;
  assert.ok(Object.values(count).every((c) => c === 1), "同じ向きは1回");
});

test("総当たり：ホームの数がかたよらない（差は 1 まで）", () => {
  for (let n = 3; n <= 16; n++) {
    const home = {};
    for (const m of league(ids(n))) home[m.home.team] = (home[m.home.team] || 0) + 1;
    const counts = ids(n).map((id) => home[id] || 0);
    assert.ok(Math.max(...counts) - Math.min(...counts) <= 1, `n=${n} ${counts}`);
  }
});

// 日程の順で、続けて出るチームの数（同じチームが前の試合にも出ている回数）
function backToBack(order, matches) {
  const byId = Object.fromEntries(matches.map((m) => [m.id, m]));
  let count = 0;
  for (let i = 1; i < order.length; i++) {
    const prev = matchKeys(byId[order[i - 1].id]);
    if (matchKeys(byId[order[i].id]).some((k) => prev.includes(k))) count += 1;
  }
  return count;
}

test("日程（コート1つ）：総当たりは 5 チーム以上なら、同じチームが続けて出ない", () => {
  for (let n = 5; n <= 32; n++) {
    const ms = league(ids(n));
    const order = schedule(ms, { courts: 1 });
    assert.equal(order.length, ms.length);
    assert.equal(backToBack(order, ms), 0, `n=${n}`);
  }
});

test("日程（コート2つ以上）：同じ時間に同じチームは出ない。全部の試合が入る", () => {
  for (const courts of [2, 3, 4]) {
    for (let n = 4; n <= 20; n++) {
      const { matches } = generate(teams(n), "league");
      const order = schedule(matches, { courts });
      assert.equal(order.length, matches.length);
      const bySlot = {};
      for (const o of order) (bySlot[o.slot] ||= []).push(o);
      for (const list of Object.values(bySlot)) {
        assert.ok(list.length <= courts);
        const keys = list.flatMap((o) => matchKeys(matches.find((m) => m.id === o.id)));
        assert.equal(new Set(keys).size, keys.length, `courts=${courts} n=${n} 同じ時間に2試合`);
      }
    }
  }
});

test("日程：トーナメントは回の順（前の回が全部終わってから次の回）。不戦勝は入れない", () => {
  const { matches } = generate(teams(6), "knockout", { thirdPlace: true });
  const order = schedule(matches, { courts: 2 });
  const slotOf = Object.fromEntries(order.map((o) => [o.id, o.slot]));
  const play = matches.filter((m) => !m.bye);
  assert.equal(order.length, play.length);
  for (const m of play) for (const n of play) if (m.round < n.round && m.stage !== "third") assert.ok(slotOf[m.id] < slotOf[n.id], `${m.id} < ${n.id}`);
  const final = play.find((m) => m.stage === "ko" && m.round === 3);
  assert.ok(slotOf.K3 <= slotOf[final.id], "3位決定戦は決勝より前か同じ時間");
});

test("グループ：分け方は行って帰ってくる順。決勝トーナメントのはじめは、ちがうグループどうし", () => {
  assert.deepEqual(splitGroups(ids(8), 2).map((g) => g.ids), [["t1", "t4", "t5", "t8"], ["t2", "t3", "t6", "t7"]]);
  const { matches, groups } = generate(teams(8), "groups", { groups: 2, advance: 2 });
  assert.equal(groups.length, 2);
  assert.equal(matches.filter((m) => m.stage === "group").length, 2 * 6);
  const firstKo = matches.filter((m) => m.stage === "ko" && m.round === 1);
  for (const m of firstKo) assert.notEqual(m.home.groupRank[0], m.away.groupRank[0]);
  // 3グループ・1位だけ：4チームのトーナメントに、上のシードが不戦勝
  const three = generate(teams(9), "groups", { groups: 3, advance: 1 });
  assert.equal(three.matches.filter((m) => m.stage === "ko" && m.bye).length, 1);
});

test("設定は、チームの数に合う範囲にそろえる", () => {
  assert.deepEqual(fitOptions(5, { groups: 9, advance: 9, legs: 3 }), { legs: 1, thirdPlace: false, groups: 2, advance: 2 });
  assert.equal(fitOptions(3, { groups: 2 }).groups, 1);
  assert.deepEqual(generate(teams(1), "knockout").matches, []);
});

test("同じチーム・同じ設定なら、いつも同じ試合の id", () => {
  const a = generate(teams(10), "groups", { groups: 3, advance: 2, thirdPlace: true });
  const b = generate(teams(10), "groups", { groups: 3, advance: 2, thirdPlace: true });
  assert.deepEqual(a.matches.map((m) => m.id), b.matches.map((m) => m.id));
  assert.equal(new Set(a.matches.map((m) => m.id)).size, a.matches.length, "id が重ならない");
});

test("時刻に分を足す", () => {
  assert.equal(addMinutes("09:00", 25), "09:25");
  assert.equal(addMinutes("23:50", 20), "00:10");
  assert.equal(addMinutes("x", 5), "");
});
