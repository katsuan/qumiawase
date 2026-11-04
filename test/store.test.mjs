// 端末に残す・読む（js/store.js）と、グループから上がるチームの並び・時刻の計算（js/pairing.js）のテスト。node --test test/
import test from "node:test";
import assert from "node:assert";
import { loadAll, saveAll, takeInbox, STORE_KEY, INBOX_KEY, blankTournament } from "../js/store.js";
import { groupEntrants, minutesFrom } from "../js/pairing.js";

// localStorage のまね（書いた値を覚える。throws なら書けない）
function memoryStorage(init = {}, { throws = false } = {}) {
  const mem = { ...init };
  return {
    getItem: (k) => (k in mem ? mem[k] : null),
    setItem: (k, v) => {
      if (throws) throw new Error("QuotaExceededError");
      mem[k] = String(v);
    },
    removeItem: (k) => delete mem[k],
    mem
  };
}

test("何も残っていない・壊れているときは、空の大会を1つ", () => {
  for (const raw of [undefined, "{", "null", "[]", JSON.stringify({ list: "x" })]) {
    const { list, current } = loadAll(memoryStorage(raw === undefined ? {} : { [STORE_KEY]: raw }));
    assert.equal(list.length, 1);
    assert.equal(current, list[0].id);
  }
});

test("残した大会の一覧を読み戻せる。同じ id は1つだけ、今の大会がなければ先頭", () => {
  const a = { ...blankTournament("春"), id: "ta" };
  const b = { ...blankTournament("秋"), id: "tb" };
  const storage = memoryStorage();
  assert.equal(saveAll({ list: [a, b, { ...a, name: "まねの春" }], current: "tb" }, storage), true);
  const back = loadAll(storage);
  assert.deepEqual(back.list.map((t) => t.name), ["春", "秋"]);
  assert.equal(back.current, "tb");
  storage.setItem(STORE_KEY, JSON.stringify({ list: [a, b], current: "nai" }));
  assert.equal(loadAll(storage).current, "ta");
});

test("端末がいっぱいで残せなくても止まらず、false を返す", () => {
  assert.equal(saveAll({ list: [blankTournament()], current: "x" }, memoryStorage({}, { throws: true })), false);
});

test("さくせん盤から戻った結果は、形を確かめて取り出し、取り出したら消す", () => {
  const storage = memoryStorage({
    [INBOX_KEY]: JSON.stringify([{ tid: "ta", mid: "K1-1", s: [2, 1] }, { tid: "ta", mid: "K1-2", s: [1, 1], pk: [4, 3] }, { tid: "", mid: "x", s: [1, 0] }, { tid: "ta", mid: "K1-3", s: "2-1" }, null, 5])
  });
  const got = takeInbox(storage);
  assert.deepEqual(got.map((x) => [x.mid, x.s, x.pk]), [
    ["K1-1", [2, 1], undefined],
    ["K1-2", [1, 1], [4, 3]]
  ]);
  assert.equal(storage.getItem(INBOX_KEY), null);
  assert.deepEqual(takeInbox(memoryStorage({ [INBOX_KEY]: "{" })), []);
});

test("グループから上がるチーム：1位がシードの上、同じグループどうしは決勝まで当たらない", () => {
  const groups = ["A", "B", "C", "D"].map((key) => ({ key, ids: [`${key}1`, `${key}2`, `${key}3`] }));
  const order = groupEntrants(groups, 2).map((x) => x.groupRank.join(""));
  assert.deepEqual(order.slice(0, 4), ["A1", "B1", "C1", "D1"]);
  // 1回戦の組（シード 1-8・4-5・2-7・3-6）で、同じグループのチームが当たらない
  const pair = (s, t) => [order[s - 1], order[t - 1]];
  for (const [x, y] of [pair(1, 8), pair(4, 5), pair(2, 7), pair(3, 6)]) assert.notEqual(x[0], y[0], `${x} - ${y}`);
  assert.deepEqual(groupEntrants([{ key: "A", ids: ["a"] }], 1).length, 1);
});

test("時刻の文字を、はじまりからの分にする（読めなければ null）", () => {
  assert.equal(minutesFrom("09:00", "10:30"), 90);
  assert.equal(minutesFrom("9:00", "08:45"), -15);
  assert.equal(minutesFrom("09:00", "1030"), null);
  assert.equal(minutesFrom("", "10:00"), null);
});
