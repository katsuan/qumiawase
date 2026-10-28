// くみあわせ：おくるんのお知らせカード（OQRN.cardUrl）に渡す中身（組み合わせ表・順位表を文で）と、試合や順位の言い方。画面には触らない（テストで呼ぶ）
// app.js・js/image.js から読む（import）
import { FORMATS, TOOL } from "./settings.js?v=202610282212";
import { roundName } from "./pairing.js?v=202610282212";
import { podium, table } from "./stats.js?v=202610282212";
import { LINK_MAX, viewUrl } from "./link.js?v=202610282212";

export const CARD_COLOR = "#D9622B"; // くみあわせの色（ロゴのオレンジ）
const DETAIL_MAX = 600;

// 日にちの文字（"2026-11-03" → "11/3（月）"）を返す。読めなければ ""
export function dateLabel(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || "");
  if (!m) return "";
  const day = "日月火水木金土"[new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getDay()];
  return `${Number(m[2])}/${Number(m[3])}（${day}）`;
}

// 試合の見出し（「A組 1」「準決勝 2」「3位決定戦」「第3節 1」）を返す。ko は gen の中のトーナメントの回の数を見る
export function matchTitle(match, gen) {
  const n = Number(match.id.split("-").pop());
  if (match.stage === "third") return "3位決定戦";
  if (match.stage === "ko") {
    const total = Math.max(...gen.matches.filter((m) => m.stage === "ko").map((m) => m.round));
    const count = gen.matches.filter((m) => m.stage === "ko" && m.round === match.round).length;
    return count > 1 ? `${roundName(match.round, total)} ${n}` : roundName(match.round, total);
  }
  if (match.stage === "group") return `${match.group}組 第${match.round}節`;
  return `第${match.round}節`;
}

// 側が決まっていないときの呼び名（「A組1位」「準決勝 1の勝者」）を返す
export function sideLabel(side, gen) {
  if (!side || side.empty) return "（不戦勝）";
  if (side.groupRank) return `${side.groupRank[0]}組${side.groupRank[1]}位`;
  const ref = gen.matches.find((m) => m.id === (side.winnerOf || side.loserOf));
  if (ref) return `${matchTitle(ref, gen)}の${side.winnerOf ? "勝者" : "敗者"}`;
  return "未定";
}

// 勝ち点の言い方（「勝3・分1・負0」。PK をするときは引き分けがないので「勝3・PK勝2・PK負1・負0」）を返す
export const pointsLabel = (p) => `勝${p.win}${p.pk ? `・PK勝${p.pkWin}・PK負${p.pkLoss}` : `・分${p.draw}`}・負${p.loss}`;

// チームの名前（空なら「チーム3」）を返す
export const teamName = (t, id) => {
  const i = t.teams.findIndex((x) => x.id === id);
  return i < 0 ? "" : t.teams[i].name || `チーム${i + 1}`;
};

// 試合1つの文（「準決勝 1　FC青 2-1 レッズ」「PK 4-3」）を返す
export function matchLine(t, gen, resolved, match) {
  const r = resolved[match.id] || {};
  const home = r.home ? teamName(t, r.home) : sideLabel(match.home, gen);
  const away = r.away ? teamName(t, r.away) : sideLabel(match.away, gen);
  const res = t.results[match.id];
  const score = res ? `${res.s[0]}-${res.s[1]}${res.pk ? `（PK ${res.pk[0]}-${res.pk[1]}）` : ""}` : "vs";
  return `${matchTitle(match, gen)}　${home} ${score} ${away}`;
}

// 順位表の文（グループごと。「A組　1位 FC青 6点」…）のならびを返す
export function standingLines(t, gen) {
  const lines = [];
  const groups = gen.groups?.length ? gen.groups : t.format === "league" ? [{ key: "", ids: t.teams.map((x) => x.id) }] : [];
  for (const g of groups) {
    const ms = gen.matches.filter((m) => (g.key ? m.group === g.key : m.stage === "league"));
    if (!ms.some((m) => t.results[m.id])) continue;
    if (g.key) lines.push(`【${g.key}組】`);
    for (const row of table(g.ids, ms, t.results, t.points)) lines.push(`${row.rank}位 ${teamName(t, row.id)} ${row.pts}点（${row.win}勝${t.points.pk ? `${row.pkWin}PK勝${row.pkLoss}PK負` : `${row.draw}分`}${row.loss}敗）`);
  }
  return lines;
}

/**
 * カードの本文：結果が入っていれば順位表（総当たり）か優勝（トーナメント）、そのあとに試合の一覧（不戦勝は書かない）。
 * 長いときは途中で切って「ほか N 試合」
 */
export function cardDetail(t, gen, resolved) {
  const lines = [];
  const p = podium(gen, resolved);
  if (p.first) lines.push(`🏆 優勝 ${teamName(t, p.first)}${p.second ? `　準優勝 ${teamName(t, p.second)}` : ""}${p.third ? `　3位 ${teamName(t, p.third)}` : ""}`);
  lines.push(...standingLines(t, gen));
  if (lines.length) lines.push("");
  const play = gen.matches.filter((m) => !m.bye);
  let used = lines.join("\n").length;
  let shown = 0;
  for (const m of play) {
    const line = matchLine(t, gen, resolved, m);
    if (used + line.length + 1 > DETAIL_MAX - 20) break;
    lines.push(line);
    used += line.length + 1;
    shown += 1;
  }
  if (shown < play.length) lines.push(`ほか ${play.length - shown} 試合`);
  return lines.join("\n").trim();
}

// おくるんのお知らせカードに渡す中身を返す。リンクが長すぎるときは、ボタンはくみあわせを開くだけ
export function cardParams(t, gen, resolved) {
  const link = viewUrl(t);
  const done = Object.keys(t.results).length > 0;
  const when = [dateLabel(t.sched.on ? t.sched.date : ""), t.sched.on ? t.sched.place : ""].filter(Boolean).join(" ");
  return new URLSearchParams({
    headerTitle: done ? `🏆 ${FORMATS[t.format]}の結果` : `🏆 ${FORMATS[t.format]}の組み合わせ`,
    title: t.name || "組み合わせ",
    date: when,
    showDate: when ? "true" : "false",
    detail: cardDetail(t, gen, resolved),
    showDetail: "true",
    theme: "custom",
    customColor: CARD_COLOR,
    showAction: "true",
    actionLabel: `🏆 ${TOOL.name}で見る`,
    actionUrl: link.length <= LINK_MAX ? link : TOOL.url,
    from: TOOL.key
  });
}

// 形の説明（「トーナメント（3位決定戦あり）」「総当たり 2回」「グループ 3つ → 各2チームが決勝トーナメントへ」）を返す
export function formatLabel(t) {
  const o = t.opts;
  if (t.format === "league") return `総当たり${o.legs === 2 ? " 2回（ホーム・アウェイ）" : ""}`;
  if (t.format === "groups") return `グループ ${o.groups}つの総当たり${o.legs === 2 ? " 2回" : ""} → 各${o.advance}チームが決勝トーナメントへ${o.thirdPlace ? "（3位決定戦あり）" : ""}`;
  return `トーナメント${o.thirdPlace ? "（3位決定戦あり）" : ""}`;
}

/**
 * 大会のまとめ（文。LINE・メモに貼る・印刷にも使う）を返す：名前・日にちと会場・形・チーム・試合（何試合目・時刻・コート・結果）・順位・優勝。
 * order は試合の順（[{ id, slot, court, time? }]。日程がなければ時刻なし）
 */
export function summaryText(t, gen, resolved, order) {
  const lines = [`🏆 ${t.name || "組み合わせ"}`];
  const when = [dateLabel(t.sched.on ? t.sched.date : ""), t.sched.on ? t.sched.place : ""].filter(Boolean).join(" ");
  if (when) lines.push(when);
  lines.push(`${formatLabel(t)}・${t.teams.length}チーム`);
  if (t.sched.on) lines.push(`日程：${t.sched.start}〜・コート${t.sched.courts}・1試合${t.sched.minutes}分`);
  if (t.format !== "knockout") lines.push(`勝ち点：${pointsLabel(t.points)}`);
  lines.push("", "【チーム】");
  if (gen.groups?.length) for (const g of gen.groups) lines.push(`${g.key}組：${g.ids.map((id) => teamName(t, id)).join("・")}`);
  else t.teams.forEach((x, i) => lines.push(`${i + 1}. ${teamName(t, x.id)}`));
  lines.push("", "【試合】");
  const byId = Object.fromEntries(gen.matches.map((m) => [m.id, m]));
  [...order].sort((a, b) => a.slot - b.slot || a.court - b.court).forEach((s, i) => {
    const when2 = s.time ? `${s.time}${t.sched.courts > 1 ? ` コート${s.court}` : ""}` : `第${i + 1}試合`;
    const ref = t.referees?.[s.id];
    lines.push(`${when2}　${matchLine(t, gen, resolved, byId[s.id])}${ref ? `（審判 ${teamName(t, ref)}）` : ""}`);
  });
  const standings = standingLines(t, gen);
  if (standings.length) lines.push("", "【順位】", ...standings);
  const p = podium(gen, resolved);
  if (p.first) lines.push("", `【結果】優勝 ${teamName(t, p.first)}${p.second ? `・準優勝 ${teamName(t, p.second)}` : ""}${p.third ? `・3位 ${teamName(t, p.third)}` : ""}`);
  return lines.join("\n");
}
