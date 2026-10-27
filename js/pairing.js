// くみあわせ：組み合わせを作る（トーナメント・総当たり・グループ → 決勝トーナメント）と、日程（時刻とコート）の割りふり。
// 画面には触らない（テストで呼ぶ）。同じチームのならびと設定からは、いつも同じ組み合わせ（試合の id も同じ）になる
// app.js・js/stats.js・js/link.js から読む（import）
//
// 試合の形：{ id, stage: "league"|"group"|"ko"|"third", group?: "A", round, home: 側, away: 側, bye?: true }
// 側の形：{ team: チームの id } ／ { winnerOf: 試合の id } ／ { loserOf: 試合の id } ／ { groupRank: ["A", 1] } ／ { empty: true }（不戦勝の相手なし）

// n 以上で、いちばん小さい2のべき乗を返す（5 → 8）
export function nextPow2(n) {
  let size = 1;
  while (size < n) size *= 2;
  return size;
}

// トーナメントのシードの並び（1 番と 2 番は決勝まで当たらない）を返す。size は2のべき乗（8 → [1, 8, 4, 5, 2, 7, 3, 6]）
export function seedOrder(size) {
  let seeds = [1];
  while (seeds.length < size) {
    const n = seeds.length * 2;
    seeds = seeds.flatMap((s) => [s, n + 1 - s]);
  }
  return seeds;
}

// トーナメントの回の呼び名（決勝・準決勝・準々決勝・1回戦…）を返す。round は 1 から、total は回の数
export function roundName(round, total) {
  const fromLast = total - round;
  if (fromLast === 0) return "決勝";
  if (fromLast === 1) return "準決勝";
  if (fromLast === 2) return "準々決勝";
  return `${round}回戦`;
}

// グループの呼び名（0 → "A"）を返す
export const groupKey = (index) => String.fromCharCode(65 + index);

// 側の見分け（同じ時間に同じチームが2試合しないように使う）を返す。相手なしは null
function sideKey(side) {
  if (!side || side.empty) return null;
  if (side.team) return `t:${side.team}`;
  if (side.winnerOf) return `w:${side.winnerOf}`;
  if (side.loserOf) return `l:${side.loserOf}`;
  if (side.groupRank) return `g:${side.groupRank.join("")}`;
  return null;
}

// 試合に出る側の見分けのならびを返す
export const matchKeys = (match) => [sideKey(match.home), sideKey(match.away)].filter(Boolean);

/**
 * トーナメントを作る。entrants はシードの順（1 番が先）の側。2のべき乗に足りないぶんは、上のシードが不戦勝（1回戦なし）。
 * thirdPlace で3位決定戦。prefix は試合の id の頭（グループのあとの決勝トーナメントは "K"）。試合のならびを返す
 */
export function knockout(entrants, { thirdPlace = false, prefix = "K" } = {}) {
  const size = nextPow2(Math.max(2, entrants.length));
  const total = Math.log2(size);
  const order = seedOrder(size);
  const matches = [];
  let prev = [];
  for (let round = 1; round <= total; round++) {
    const count = size / 2 ** round;
    const current = [];
    for (let i = 0; i < count; i++) {
      let home;
      let away;
      if (round === 1) {
        home = entrants[order[i * 2] - 1] || { empty: true };
        away = entrants[order[i * 2 + 1] - 1] || { empty: true };
      } else {
        home = { winnerOf: prev[i * 2].id };
        away = { winnerOf: prev[i * 2 + 1].id };
      }
      const match = { id: `${prefix}${round}-${i + 1}`, stage: "ko", round, home, away };
      if (home.empty || away.empty) match.bye = true;
      current.push(match);
    }
    matches.push(...current);
    prev = current;
  }
  // 3位決定戦：準決勝で負けたチームどうし（4チーム以上のとき）
  if (thirdPlace && total >= 2) {
    const semis = matches.filter((m) => m.round === total - 1);
    matches.push({ id: `${prefix}3`, stage: "third", round: total, home: { loserOf: semis[0].id }, away: { loserOf: semis[1].id } });
  }
  return matches;
}

/**
 * 総当たりの回ごとの組（円形の回し方。1つ目のチームを止めて、ほかを1つずつ回す）を返す。[[ [a, b], … ], …]（1回の中では、どのチームも1試合まで）。
 * 奇数のときは、毎回1チームが休み。ホーム（前に書く側）は、それまでにホームになった数が少ないほう
 */
export function roundRobinRounds(ids) {
  const list = [...ids];
  if (list.length % 2) list.push(null);
  const n = list.length;
  const rounds = [];
  const homes = new Map(); // これまでホームになった数（少ないほうをホームに）
  for (let r = 0; r < n - 1; r++) {
    const pairs = [];
    for (let i = 0; i < n / 2; i++) {
      let a = list[i];
      let b = list[n - 1 - i];
      if (a === null || b === null) continue;
      const ha = homes.get(a) || 0;
      const hb = homes.get(b) || 0;
      if (ha > hb || (ha === hb && (r + i) % 2)) [a, b] = [b, a];
      homes.set(a, (homes.get(a) || 0) + 1);
      pairs.push([a, b]);
    }
    rounds.push(pairs);
    list.splice(1, 0, list.pop()); // 1つ目を止めて、ほかを右へ1つ回す
  }
  return rounds;
}

/**
 * 総当たりの試合を作る。legs が 2 なら、2回目はホームとアウェイを入れかえてもう1回。
 * group を渡すと、グループの中の総当たり（id は "GA-…"）。試合のならびを返す
 */
export function league(ids, { legs = 1, group = "" } = {}) {
  const rounds = roundRobinRounds(ids);
  const matches = [];
  for (let leg = 1; leg <= legs; leg++) {
    rounds.forEach((pairs, r) => {
      pairs.forEach(([a, b], i) => {
        const [home, away] = leg === 2 ? [b, a] : [a, b];
        const round = (leg - 1) * rounds.length + r + 1;
        matches.push({
          id: group ? `G${group}-${round}-${i + 1}` : `L${round}-${i + 1}`,
          stage: group ? "group" : "league",
          ...(group ? { group } : {}),
          round,
          home: { team: home },
          away: { team: away }
        });
      });
    });
  }
  return matches;
}

// チームをグループに分ける（並びの順に A・B・C… と、行って帰ってくる順で。強いチームが片よらない）。[{ key: "A", ids: [...] }, …] を返す
export function splitGroups(ids, count) {
  const groups = Array.from({ length: count }, (_, i) => ({ key: groupKey(i), ids: [] }));
  ids.forEach((id, i) => {
    const lap = Math.floor(i / count);
    const at = i % count;
    groups[lap % 2 ? count - 1 - at : at].ids.push(id);
  });
  return groups;
}

// 設定を、作れる範囲にそろえて返す（チームの数でグループの数・上がる数をおさえる）
export function fitOptions(teamCount, opts = {}) {
  const legs = opts.legs === 2 ? 2 : 1;
  const thirdPlace = Boolean(opts.thirdPlace);
  const maxGroups = Math.max(1, Math.floor(teamCount / 2));
  const groups = Math.min(maxGroups, Math.max(1, Math.floor(Number(opts.groups) || 2)));
  const smallest = Math.floor(teamCount / groups);
  const advance = Math.min(Math.max(1, smallest), Math.max(1, Math.floor(Number(opts.advance) || 2)));
  return { legs, thirdPlace, groups, advance };
}

/**
 * 大会の組み合わせを作る。teams は [{ id, … }]（並びの順がシード・グループ分けの順）、format は knockout・league・groups。
 * { matches, groups } を返す（groups はグループのときだけ。[{ key, ids }]）。チームが2つより少ないときは試合なし
 */
export function generate(teams, format, options = {}) {
  const ids = teams.map((t) => t.id);
  if (ids.length < 2) return { matches: [], groups: [] };
  const opts = fitOptions(ids.length, options);
  if (format === "league") return { matches: league(ids, { legs: opts.legs }), groups: [] };
  if (format === "groups") {
    const groups = splitGroups(ids, opts.groups);
    const groupMatches = groups.flatMap((g) => league(g.ids, { legs: opts.legs, group: g.key }));
    // 上がるチーム：1位どうし・2位どうし…の順にシードを付ける（はじめの試合で、同じグループのチームが当たらない）
    const entrants = [];
    for (let rank = 1; rank <= opts.advance; rank++) groups.forEach((g) => g.ids.length >= rank && entrants.push({ groupRank: [g.key, rank] }));
    const finals = entrants.length >= 2 ? knockout(entrants, { thirdPlace: opts.thirdPlace, prefix: "K" }) : [];
    return { matches: [...groupMatches, ...finals], groups };
  }
  return { matches: knockout(ids.map((id) => ({ team: id })), { thirdPlace: opts.thirdPlace }), groups: [] };
}

// 日程を決める順のまとまり：総当たり（グループもまとめて）→ トーナメントの1回戦 → 2回戦 …（3位決定戦は決勝の前）
function phasesOf(matches) {
  const play = matches.filter((m) => !m.bye);
  const leagueLike = play.filter((m) => m.stage === "league" || m.stage === "group");
  leagueLike.sort((a, b) => a.round - b.round || String(a.group || "").localeCompare(String(b.group || "")) || matches.indexOf(a) - matches.indexOf(b));
  const phases = leagueLike.length ? [leagueLike] : [];
  const ko = play.filter((m) => m.stage === "ko" || m.stage === "third");
  const rounds = [...new Set(ko.map((m) => m.round))].sort((a, b) => a - b);
  rounds.forEach((r) => phases.push(ko.filter((m) => m.round === r).sort((a, b) => (a.stage === "third" ? -1 : b.stage === "third" ? 1 : 0))));
  return phases;
}

/**
 * 試合を時間の枠（slot）とコートに割りふる。同じ枠には同じチームを入れず、なるべく続けて出ないように（前の枠に出たチームは後まわし）。
 * 不戦勝の試合は入れない。[{ id, slot, court }]（slot は 0 から、court は 1 から）を、試合の順に返す
 */
export function schedule(matches, { courts = 1 } = {}) {
  const per = Math.max(1, Math.floor(courts));
  const out = [];
  let slot = 0;
  for (const phase of phasesOf(matches)) {
    let remaining = [...phase];
    let prev = new Set();
    while (remaining.length) {
      const chosen = [];
      const used = new Set();
      for (const strict of [true, false]) {
        for (const m of remaining) {
          if (chosen.length >= per) break;
          if (chosen.includes(m)) continue;
          const keys = matchKeys(m);
          if (keys.some((k) => used.has(k))) continue;
          if (strict && keys.some((k) => prev.has(k))) continue;
          chosen.push(m);
          keys.forEach((k) => used.add(k));
        }
        if (chosen.length >= per) break;
      }
      chosen.forEach((m, i) => out.push({ id: m.id, slot, court: i + 1 }));
      remaining = remaining.filter((m) => !chosen.includes(m));
      prev = used;
      slot += 1;
    }
  }
  return out;
}

// 時刻の文字（"09:30"）に分を足した時刻の文字を返す。読めないときは ""
export function addMinutes(hhmm, minutes) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ""));
  if (!m) return "";
  const total = Number(m[1]) * 60 + Number(m[2]) + Math.round(minutes);
  const day = 24 * 60;
  const t = ((total % day) + day) % day;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}
