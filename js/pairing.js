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

// トーナメント表の2つの場所（0 から）が当たる回（1＝1回戦）を返す
const meetRound = (p, q) => {
  let k = 1;
  while (p >> k !== q >> k) k++;
  return k;
};

/**
 * グループのあとの決勝トーナメントに上がる側を、シードの順（knockout にそのまま渡す並び）にして返す。
 * 1位はグループの順にシード1・2・3…。2位からは、そのシードの帯の場所のうち、同じグループのチームと当たる回がいちばん遅くなる場所に置く
 * （4グループ×2チームなら A1-C2・D1-B2・B1-D2・C1-A2 で、同じグループどうしは決勝まで当たらない。2グループなら A1-B2・B1-A2）
 */
export function groupEntrants(groups, advance) {
  const tiers = [];
  for (let rank = 1; rank <= advance; rank++) tiers.push(groups.filter((g) => g.ids.length >= rank).map((g) => ({ groupRank: [g.key, rank] })));
  const count = tiers.reduce((n, t) => n + t.length, 0);
  if (count < 2) return tiers.flat();
  const order = seedOrder(nextPow2(count));
  const posOf = (seed) => order.indexOf(seed);
  const placed = []; // { pos, group }
  const bySeed = [];
  let seed = 1;
  tiers.forEach((tier, ti) => {
    const free = tier.map((_, i) => seed + i).filter((sd) => sd <= count);
    for (const side of tier) {
      let pick = free[0];
      if (ti > 0) {
        // 同じグループのチームと当たる回がいちばん遅い場所（同じなら、シードの若いほう）
        const score = (sd) => Math.min(...placed.filter((x) => x.group === side.groupRank[0]).map((x) => meetRound(posOf(sd), x.pos)), 99);
        pick = free.reduce((best, sd) => (score(sd) > score(best) ? sd : best), free[0]);
      }
      free.splice(free.indexOf(pick), 1);
      placed.push({ pos: posOf(pick), group: side.groupRank[0] });
      bySeed[pick - 1] = side;
    }
    seed += tier.length;
  });
  return bySeed;
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
    const entrants = groupEntrants(groups, opts.advance);
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
 * 日程の時刻を決める：コートごとに、空いた時刻から試合を入れていく。1試合は minutes 分。
 * avoid が true なら、同じチームは前の試合が終わってから rest 分あける（そのぶんコートを空けて待つ＝バッファ）。false ならすぐ次でもよい。
 * トーナメントの回は、前の回の試合が全部終わってから（勝ち上がったチームにも rest をとる）。グループの順位で上がるチームは、そのグループの最後の試合のあと。
 * 入れる順：始められる時刻がいちばん早い試合から（同じなら回の順）。不戦勝は入れない。
 * [{ id, start（はじまりからの分）, end, court（1 から）, slot（同じ時刻のまとまりの番号。0 から） }] を、時刻の順に返す
 */
export function timeSchedule(matches, { courts = 1, minutes = 20, rest = 0, avoid = true } = {}) {
  const per = Math.max(1, Math.floor(courts));
  const len = Math.max(1, minutes);
  const gap = avoid ? Math.max(0, rest) : 0;
  const courtFree = Array(per).fill(0);
  const teamFree = new Map(); // チームの見分け → 次に出られる時刻
  const endOf = {}; // 試合の id → 終わる時刻
  const groupEnd = {}; // グループ → いちばん遅い試合の終わる時刻
  const out = [];
  // 側が、次に出られる時刻（チームなら前の試合のあと、勝者・敗者ならその試合のあと、グループの順位ならそのグループの最後のあと）
  const readyOf = (side) => {
    if (!side || side.empty) return 0;
    if (side.team) return teamFree.get(side.team) || 0;
    if (side.winnerOf || side.loserOf) return (endOf[side.winnerOf || side.loserOf] ?? 0) + gap;
    if (side.groupRank) return (groupEnd[side.groupRank[0]] ?? 0) + gap;
    return 0;
  };
  let phaseStart = 0;
  for (const phase of phasesOf(matches)) {
    let remaining = [...phase];
    let phaseEnd = phaseStart;
    while (remaining.length) {
      // いちばん早く始められる試合（同じなら先の回）と、そのとき空くコート
      let best = null;
      for (const m of remaining) {
        const court = courtFree.indexOf(Math.min(...courtFree));
        const start = Math.max(phaseStart, courtFree[court], readyOf(m.home), readyOf(m.away));
        if (!best || start < best.start) best = { m, start, court };
      }
      const { m, start, court } = best;
      const end = start + len;
      courtFree[court] = end;
      endOf[m.id] = end;
      for (const side of [m.home, m.away]) if (side.team) teamFree.set(side.team, end + gap);
      if (m.group) groupEnd[m.group] = Math.max(groupEnd[m.group] ?? 0, end);
      out.push({ id: m.id, start, end, court: court + 1 });
      phaseEnd = Math.max(phaseEnd, end);
      remaining = remaining.filter((x) => x !== m);
    }
    phaseStart = phaseEnd; // 次の回は、この回が全部終わってから
    courtFree.fill(phaseStart);
  }
  out.sort((a, b) => a.start - b.start || a.court - b.court);
  const starts = [...new Set(out.map((o) => o.start))];
  return out.map((o) => ({ ...o, slot: starts.indexOf(o.start) }));
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

// 試合 m に出るチーム（決まっているぶん）の id のならびを返す。resolved は js/stats.js の resolve の返り値
const playersOf = (m, resolved) => [resolved?.[m.id]?.home || m.home?.team, resolved?.[m.id]?.away || m.away?.team].filter(Boolean);

/**
 * 審判に入れるチーム：その試合に出ないチームで、同じ時間にほかのコートで試合をしていないチーム（決まっているぶんで見る）。
 * ids はチームの並び、plan は timeSchedule の返り値。チームの id のならびを返す（いなければ []）
 */
export function refereeOptions(m, ids, resolved, plan, matches) {
  const at = plan.find((p) => p.id === m.id);
  const byId = Object.fromEntries(matches.map((x) => [x.id, x]));
  const busy = new Set(playersOf(m, resolved));
  if (at) for (const p of plan) if (p.id !== m.id && p.start < at.end && at.start < p.end && byId[p.id]) playersOf(byId[p.id], resolved).forEach((id) => busy.add(id));
  return ids.filter((id) => !busy.has(id));
}

/**
 * 審判をまだ入れていない試合（出るチームが決まっているもの）に、審判を入れた新しい { 試合の id: チームの id } を返す（入っているものはそのまま）。
 * 試合の順に、入れられるチームのうち、審判の数が少ないチーム → このあと入れられる試合が少ないチーム → 前後 rest 分に試合がないチーム → 並びの順。入れられるチームがなければ入れない（−）
 */
export function autoReferees(matches, ids, resolved, plan, current = {}, rest = 0) {
  const out = { ...current };
  const count = Object.fromEntries(ids.map((id) => [id, 0]));
  for (const id of Object.values(out)) if (id in count) count[id] += 1;
  const byId = Object.fromEntries(matches.map((x) => [x.id, x]));
  // チームごとの、これから審判に入れる試合の数（少ないチームを先にしないと、あとで入れる所がなくなる）
  // 出るチームがまだ決まらない試合（トーナメントの先）は入れない。結果が入ってから、もう一度押すと入る
  const todo = plan.filter((p) => byId[p.id] && !byId[p.id].bye && !out[p.id] && playersOf(byId[p.id], resolved).length === 2);
  const left = Object.fromEntries(ids.map((id) => [id, 0]));
  const optionsOf = Object.fromEntries(todo.map((p) => [p.id, refereeOptions(byId[p.id], ids, resolved, plan, matches)]));
  for (const p of todo) for (const id of optionsOf[p.id]) left[id] += 1;
  for (const p of todo) {
    const m = byId[p.id];
    for (const id of optionsOf[p.id]) left[id] -= 1;
    // 前後 rest 分に自分の試合があるチーム（入れられるが、できれば避ける）
    const near = new Set();
    for (const q of plan) if (q.id !== p.id && q.start < p.end + rest && p.start - rest < q.end && byId[q.id]) playersOf(byId[q.id], resolved).forEach((id) => near.add(id));
    const options = optionsOf[p.id];
    if (!options.length) continue;
    const best = [...options].sort((a, b) => count[a] - count[b] || left[a] - left[b] || near.has(a) - near.has(b) || ids.indexOf(a) - ids.indexOf(b))[0];
    out[m.id] = best;
    count[best] += 1;
  }
  // ならす：いちばん多いチームから、審判を少ないチームへ順につけかえる（A の試合を B に、B の試合を C に…。入れたばかりの試合だけ）。
  // かたよりが 1 以下になるか、つけかえられなくなるまで
  const mine = new Set(todo.map((p) => p.id));
  for (let guard = 0; guard < todo.length; guard++) {
    const top = [...ids].sort((x, y) => count[y] - count[x])[0];
    const prev = { [top]: null };
    const queue = [top];
    let goal = null;
    while (queue.length && !goal) {
      const from = queue.shift();
      for (const [mid, id] of Object.entries(out)) {
        if (id !== from || !mine.has(mid)) continue;
        for (const to of optionsOf[mid]) {
          if (to in prev) continue;
          prev[to] = { from, mid };
          if (count[to] <= count[top] - 2) goal = to;
          else queue.push(to);
          if (goal) break;
        }
        if (goal) break;
      }
    }
    if (!goal) break;
    for (let id = goal; prev[id]; id = prev[id].from) out[prev[id].mid] = id;
    count[top] -= 1;
    count[goal] += 1;
  }
  return out;
}
