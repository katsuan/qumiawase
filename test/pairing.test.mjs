// 組み合わせ（js/pairing.js）のテスト。node --test test/
import test from "node:test";
import assert from "node:assert";
import { generate, knockout, league, nextPow2, roundName, roundRobinRounds, timeSchedule, seedOrder, splitGroups, addMinutes, fitOptions } from "../js/pairing.js";

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

// 1試合 20 分・空き時間 10 分で、コート1つに入れたときの、すきま（コートが空いて待つ時間）の合計を返す。0 なら、続けて出ないまま詰めて並べられた
function idleOf(matches, opts = {}) {
  const plan = timeSchedule(matches, { courts: 1, minutes: 20, rest: 10, avoid: true, ...opts });
  return Math.max(...plan.map((p) => p.end)) - plan.length * 20;
}

test("連続試合を避ける（コート1つ）：総当たりは 5 チーム以上なら、待ち時間なしで、同じチームが続けて出ない順に並ぶ", () => {
  for (let n = 5; n <= 32; n++) assert.equal(idleOf(league(ids(n))), 0, `n=${n}`);
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

test("連続試合を避ける（コート1つ）：グループの総当たりも、グループをまぜて、待ち時間なしで並ぶ", () => {
  for (const [n, groups] of [[8, 2], [9, 3], [10, 2], [12, 3], [12, 4], [16, 4], [20, 4], [24, 6]]) {
    const { matches } = generate(teams(n), "groups", { groups, advance: 2 });
    assert.equal(idleOf(matches.filter((m) => m.stage === "group")), 0, `n=${n} groups=${groups}`);
  }
});

// 日程の時刻の確かめ：同じチームが重ならない・コートが重ならない・全部入る。チームの試合の間（前の終わり → 次の始まり）の最小を返す
function checkTimes(matches, plan, courts) {
  const byId = Object.fromEntries(matches.map((m) => [m.id, m]));
  assert.equal(plan.length, matches.filter((m) => !m.bye).length, "全部の試合が入る");
  for (let c = 1; c <= courts; c++) {
    const list = plan.filter((p) => p.court === c).sort((a, b) => a.start - b.start);
    for (let i = 1; i < list.length; i++) assert.ok(list[i].start >= list[i - 1].end, `コート${c}が重なる`);
  }
  let minGap = Infinity;
  const byTeam = {};
  for (const p of plan) for (const side of [byId[p.id].home, byId[p.id].away]) if (side.team) (byTeam[side.team] ||= []).push(p);
  for (const list of Object.values(byTeam)) {
    list.sort((a, b) => a.start - b.start);
    for (let i = 1; i < list.length; i++) {
      assert.ok(list[i].start >= list[i - 1].end, "同じチームが重なる");
      minGap = Math.min(minGap, list[i].start - list[i - 1].end);
    }
  }
  return minGap;
}

test("日程の時刻（連続試合を避ける）：同じチームは、前の試合のあと空き時間をあける。コート・チームは重ならない", async () => {
  for (const courts of [1, 2, 3, 4]) {
    for (const rest of [5, 10, 20, 45]) {
      for (const n of [2, 3, 4, 5, 6, 9, 12, 17, 32]) {
        const { matches } = generate(teams(n), "league");
        const plan = timeSchedule(matches, { courts, minutes: 20, rest, avoid: true });
        assert.ok(checkTimes(matches, plan, courts) >= rest, `courts=${courts} rest=${rest} n=${n}`);
      }
    }
  }
});

test("日程の時刻（続けてもよい）：重ならないだけで詰める（空き時間なし）", async () => {
  const { matches } = generate(teams(4), "league");
  const plan = timeSchedule(matches, { courts: 1, minutes: 20, rest: 30, avoid: false });
  checkTimes(matches, plan, 1);
  assert.equal(Math.max(...plan.map((p) => p.end)), 6 * 20, "コート1つで6試合ぶん、すきまなし");
});

test("日程の時刻：トーナメントの次の回は、前の回が終わってから。勝ち上がったチームにも空き時間", async () => {
  const { matches } = generate(teams(8), "knockout", { thirdPlace: true });
  const plan = timeSchedule(matches, { courts: 2, minutes: 15, rest: 20, avoid: true });
  const at = Object.fromEntries(plan.map((p) => [p.id, p]));
  const r1End = Math.max(...matches.filter((m) => m.round === 1).map((m) => at[m.id].end));
  for (const m of matches.filter((x) => x.round === 2)) {
    assert.ok(at[m.id].start >= r1End, `${m.id} は1回戦が全部終わってから`);
    for (const side of [m.home, m.away]) assert.ok(at[m.id].start >= at[side.winnerOf].end + 20, `${m.id} は勝ち上がったチームの空き時間のあと`);
  }
  // グループの順位で上がるチームは、そのグループが終わってから
  const g = generate(teams(8), "groups", { groups: 2, advance: 2 });
  const gp = timeSchedule(g.matches, { courts: 2, minutes: 15, rest: 10, avoid: true });
  const gat = Object.fromEntries(gp.map((p) => [p.id, p]));
  const groupEnd = Math.max(...g.matches.filter((m) => m.stage === "group").map((m) => gat[m.id].end));
  for (const m of g.matches.filter((x) => x.stage === "ko" && x.round === 1)) assert.ok(gat[m.id].start >= groupEnd, m.id);
});

test("続けてもよい：回の順のまま、すきまなく詰める", () => {
  const ms = league(ids(6));
  const plan = timeSchedule(ms, { courts: 1, minutes: 20, rest: 30, avoid: false });
  assert.deepEqual(plan.map((o) => o.id), ms.map((m) => m.id));
});

// グループ → 決勝トーナメント：同じグループのチームは、なるべく遅い回まで当たらない（1位と2位は決勝まで）
test("決勝トーナメントで同じグループが早く当たらない", () => {
  const teams = (n) => Array.from({ length: n }, (_, i) => ({ id: `t${i + 1}` }));
  for (const [n, groups, advance] of [[16, 4, 2], [8, 2, 2], [12, 3, 2], [16, 8, 2], [24, 4, 2]]) {
    const gen = generate(teams(n), "groups", { groups, advance });
    const first = gen.matches.filter((m) => m.stage === "ko" && m.round === 1);
    const total = Math.max(...gen.matches.filter((m) => m.stage === "ko").map((m) => m.round));
    // 1回戦の場所の並び（不戦勝もふくむ）
    const slots = first.flatMap((m) => [m.home, m.away]);
    const where = (key, rank) => slots.findIndex((sd) => sd.groupRank && sd.groupRank[0] === key && sd.groupRank[1] === rank);
    for (const g of gen.groups) {
      const p1 = where(g.key, 1);
      const p2 = where(g.key, 2);
      let k = 1;
      while (p1 >> k !== p2 >> k) k++;
      assert.equal(k, total, `${n}チーム ${groups}組：${g.key}組の1位と2位は決勝まで当たらない（${k}回戦で当たる）`);
    }
    // 1回戦で1位どうしは当たらない
    for (const m of first) if (!m.bye) assert.ok(!(m.home.groupRank?.[1] === 1 && m.away.groupRank?.[1] === 1), `${n}チーム：1位どうし`);
  }
});
