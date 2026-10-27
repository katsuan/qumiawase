// おくるんのカードの中身（js/card.js）のテスト。node --test test/
import test from "node:test";
import assert from "node:assert";
import { generate } from "../js/pairing.js";
import { resolve } from "../js/stats.js";
import { blankTournament } from "../js/store.js";
import { cardDetail, cardParams, dateLabel, matchTitle, sideLabel } from "../js/card.js";

const make = (n, format, opts = {}) => {
  const t = blankTournament("秋の大会");
  t.teams = Array.from({ length: n }, (_, i) => ({ id: `t${i + 1}`, name: `チーム${"あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみ"[i]}`, color: "#22a447" }));
  t.format = format;
  Object.assign(t.opts, opts);
  const gen = generate(t.teams, t.format, t.opts);
  return { t, gen };
};

test("試合の見出し：決勝・準決勝 1・3位決定戦・A組 第1節", () => {
  const { gen } = make(8, "knockout", { thirdPlace: true });
  const title = (id) => matchTitle(gen.matches.find((m) => m.id === id), gen);
  assert.equal(title("K3-1"), "決勝");
  assert.equal(title("K2-2"), "準決勝 2");
  assert.equal(title("K1-1"), "準々決勝 1");
  assert.equal(title("K3"), "3位決定戦");
  const g = make(8, "groups", { groups: 2, advance: 2 });
  assert.equal(matchTitle(g.gen.matches[0], g.gen), "A組 第1節");
  assert.equal(sideLabel({ groupRank: ["B", 2] }, g.gen), "B組2位");
  assert.equal(sideLabel({ winnerOf: "K2-1" }, gen), "準決勝 1の勝者");
});

test("カードの本文は 600 字まで（多いときは「ほか N 試合」）。優勝が決まれば先頭に", () => {
  const { t, gen } = make(32, "league");
  const detail = cardDetail(t, gen, resolve(gen, t.teams.map((x) => x.id), t.results, t.points));
  assert.ok(detail.length <= 600, String(detail.length));
  assert.match(detail, /ほか \d+ 試合$/);
  const ko = make(2, "knockout");
  ko.t.results = { "K1-1": { s: [1, 1], pk: [3, 2] } };
  const d2 = cardDetail(ko.t, ko.gen, resolve(ko.gen, ["t1", "t2"], ko.t.results, ko.t.points));
  assert.match(d2, /^🏆 優勝 チームあ　準優勝 チームい/);
  assert.match(d2, /決勝　チームあ 1-1（PK 3-2） チームい/);
});

test("カードのボタンは、見る人用のリンク（長すぎるときは、くみあわせを開くだけ）", () => {
  const small = make(4, "knockout");
  const p = cardParams(small.t, small.gen, resolve(small.gen, small.t.teams.map((x) => x.id), {}, small.t.points));
  assert.match(p.get("actionUrl"), /\?view=/);
  assert.equal(p.get("from"), "qumiawase");
  assert.ok(p.get("actionUrl").length <= 1000);
  const big = make(32, "league", { legs: 2 });
  for (const m of big.gen.matches) big.t.results[m.id] = { s: [1, 0] };
  const q = cardParams(big.t, big.gen, resolve(big.gen, big.t.teams.map((x) => x.id), big.t.results, big.t.points));
  assert.equal(q.get("actionUrl"), "https://katsuan.github.io/qumiawase/");
});

test("日にちの文字", () => {
  assert.equal(dateLabel("2026-11-03"), "11/3（火）");
  assert.equal(dateLabel(""), "");
});

test("大会のまとめ：名前・形・チーム・試合（何試合目）・順位・優勝を文に", async () => {
  const { summaryText, formatLabel } = await import("../js/card.js");
  const { timeSchedule } = await import("../js/pairing.js");
  const g = make(6, "groups", { groups: 2, advance: 1, thirdPlace: false });
  const order = timeSchedule(g.gen.matches, { courts: 1, minutes: 20, rest: 10 });
  for (const m of g.gen.matches.filter((x) => x.stage === "group")) g.t.results[m.id] = { s: [1, 0] };
  const text = summaryText(g.t, g.gen, resolve(g.gen, g.t.teams.map((x) => x.id), g.t.results, g.t.points), order);
  assert.match(text, /^🏆 秋の大会\n/);
  assert.match(text, new RegExp(formatLabel(g.t)));
  assert.match(text, /【チーム】\nA組：チームあ・チームえ・チームお\nB組：チームい・チームう・チームか/);
  assert.match(text, /第1試合　A組 第1節/);
  assert.match(text, /【順位】\n【A組】\n1位/);
  assert.equal((text.match(/第\d+試合/g) || []).length, g.gen.matches.filter((m) => !m.bye).length);
});
