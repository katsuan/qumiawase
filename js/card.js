// くみあわせ：おくるんのお知らせカード（OQRN.cardUrl）に渡す中身（組み合わせ表・順位表を文で）と、試合や順位の言い方。画面には触らない（テストで呼ぶ）
// app.js・js/image.js から読む（import）
import { FORMATS, TOOL } from "./settings.js?v=202610280757";
import { roundName } from "./pairing.js?v=202610280757";
import { podium, table } from "./stats.js?v=202610280757";
import { LINK_MAX, viewUrl } from "./link.js?v=202610280757";

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
    for (const row of table(g.ids, ms, t.results, t.points)) lines.push(`${row.rank}位 ${teamName(t, row.id)} ${row.pts}点（${row.win}勝${row.draw}分${row.loss}敗）`);
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
