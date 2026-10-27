// くみあわせ：結果から数える・まとめる（勝ち負け・順位表・トーナメントの勝ち上がり）。画面には触らない（テストで呼ぶ）
// app.js・js/card.js・js/image.js から読む（import）
//
// 結果の形：results = { 試合の id: { s: [ホームの点, アウェイの点], pk?: [ホームの PK, アウェイの PK] } }

// 1試合の勝ち負けを返す："home"・"away"・"draw"（引き分け。PK で決まればその勝ち）・null（まだ）
export function outcome(result) {
  if (!result || !Array.isArray(result.s)) return null;
  const [a, b] = result.s;
  if (a > b) return "home";
  if (a < b) return "away";
  const pk = result.pk;
  if (Array.isArray(pk) && pk[0] !== pk[1]) return pk[0] > pk[1] ? "home" : "away";
  return "draw";
}

// 空の行（順位表の1チームぶん）を返す
const emptyRow = (id) => ({ id, played: 0, win: 0, draw: 0, loss: 0, gf: 0, ga: 0, gd: 0, pts: 0 });

// 試合のならびから、チームごとの成績（勝ち点・得失点）を数えて { id: 行 } で返す。PK は勝ち点に入れない（引き分け）
function tally(ids, matches, results, points) {
  const rows = Object.fromEntries(ids.map((id) => [id, emptyRow(id)]));
  for (const m of matches) {
    const r = results[m.id];
    const h = m.home.team;
    const a = m.away.team;
    if (!r || !Array.isArray(r.s) || !rows[h] || !rows[a]) continue;
    const [gh, ga] = r.s;
    for (const [id, gf, gaa] of [[h, gh, ga], [a, ga, gh]]) {
      const row = rows[id];
      row.played += 1;
      row.gf += gf;
      row.ga += gaa;
      row.gd = row.gf - row.ga;
      if (gf > gaa) (row.win += 1), (row.pts += points.win);
      else if (gf < gaa) (row.loss += 1), (row.pts += points.loss);
      else (row.draw += 1), (row.pts += points.draw);
    }
  }
  return rows;
}

/**
 * 順位表を返す。並びは 勝ち点 → 得失点差 → 総得点 → 直接対決（同じ順位のチームどうしの試合の 勝ち点 → 得失点差 → 総得点）→ チームの並びの順。
 * ids はチームの id のならび（同じなら前のほうが上）、matches は総当たりの試合（{ home: { team }, away: { team } }）、points は勝ち点
 */
export function table(ids, matches, results, points) {
  const rows = tally(ids, matches, results, points);
  const main = (x, y) => y.pts - x.pts || y.gd - x.gd || y.gf - x.gf;
  const list = ids.map((id) => rows[id]).sort((x, y) => main(x, y) || ids.indexOf(x.id) - ids.indexOf(y.id));
  // 同じ並びのチームどうしは、そのチームどうしの試合だけで並べなおす
  const out = [];
  for (let i = 0; i < list.length; ) {
    let j = i + 1;
    while (j < list.length && main(list[i], list[j]) === 0) j++;
    const tied = list.slice(i, j);
    if (tied.length > 1) {
      const tiedIds = tied.map((r) => r.id);
      const inside = matches.filter((m) => tiedIds.includes(m.home.team) && tiedIds.includes(m.away.team));
      const h2h = tally(tiedIds, inside, results, points);
      tied.sort((x, y) => main(h2h[x.id], h2h[y.id]) || ids.indexOf(x.id) - ids.indexOf(y.id));
    }
    out.push(...tied);
    i = j;
  }
  return out.map((row, i) => ({ ...row, rank: i + 1 }));
}

// その試合のならびに、結果がまだ入っていない試合がないか（全部終わったか）を返す
export const finished = (matches, results) => matches.every((m) => m.bye || outcome(results[m.id]));

/**
 * トーナメントの勝ち上がりを決める：試合ごとの、ホーム・アウェイのチーム（まだ決まらなければ null）と、勝ったチーム・負けたチームを返す。
 * gen は js/pairing.js の generate の返り値、ids はチームの並び。{ 試合の id: { home, away, winner, loser } } を返す
 */
export function resolve(gen, ids, results, points) {
  const byId = Object.fromEntries(gen.matches.map((m) => [m.id, m]));
  const memo = {};
  // グループの順位（全部の試合が終わったグループだけ）
  const groupRanks = {};
  for (const g of gen.groups || []) {
    const ms = gen.matches.filter((m) => m.stage === "group" && m.group === g.key);
    if (ms.length && finished(ms, results)) groupRanks[g.key] = table(g.ids, ms, results, points).map((r) => r.id);
  }
  // 側（チーム・勝者・敗者・グループの順位）から、決まっていればチームの id を返す
  const teamOf = (side) => {
    if (!side || side.empty) return null;
    if (side.team) return side.team;
    if (side.winnerOf) return settle(side.winnerOf).winner;
    if (side.loserOf) return settle(side.loserOf).loser;
    if (side.groupRank) return groupRanks[side.groupRank[0]]?.[side.groupRank[1] - 1] || null;
    return null;
  };
  // 1試合の、出るチームと勝ち負けを決める（前の試合から順に。覚えておいて使い回す）
  const settle = (id) => {
    if (memo[id]) return memo[id];
    const m = byId[id];
    const home = teamOf(m.home);
    const away = teamOf(m.away);
    let winner = null;
    let loser = null;
    if (m.bye) winner = home || away;
    else if (home && away) {
      const o = outcome(results[id]);
      if (o === "home") (winner = home), (loser = away);
      if (o === "away") (winner = away), (loser = home);
    }
    memo[id] = { home, away, winner, loser };
    return memo[id];
  };
  gen.matches.forEach((m) => settle(m.id));
  return memo;
}

// 優勝・準優勝・3位（決まっていれば）を返す。{ first, second, third }（決まらないものは null）
export function podium(gen, resolved) {
  const ko = gen.matches.filter((m) => m.stage === "ko");
  if (!ko.length) return { first: null, second: null, third: null };
  const last = Math.max(...ko.map((m) => m.round));
  const final = ko.find((m) => m.round === last);
  const third = gen.matches.find((m) => m.stage === "third");
  return { first: resolved[final.id]?.winner || null, second: resolved[final.id]?.loser || null, third: third ? resolved[third.id]?.winner || null : null };
}
