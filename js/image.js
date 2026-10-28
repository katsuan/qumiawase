// くみあわせ：「📷 画像で保存」の画像を描く（見出し・トーナメント表・順位表・試合の一覧）。canvas を返すだけで、保存の画面は app.js
// app.js から読む（import）
import { TOOL } from "./settings.js?v=202610281925";
import { roundName } from "./pairing.js?v=202610281925";
import { table } from "./stats.js?v=202610281925";
import { CARD_COLOR, dateLabel, matchLine, sideLabel, teamName } from "./card.js?v=202610281925";

const W = 1080;
const PAD = 48;
const FONT = '"M PLUS Rounded 1c", "Hiragino Maru Gothic ProN", sans-serif';

// 字の形（太さと大きさ）を返す
const font = (size, weight = 700) => `${weight} ${size}px ${FONT}`;

// 角の丸い四角の道を作る（roundRect がない古いブラウザでも）
function roundBox(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) return ctx.roundRect(x, y, w, h, r);
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// 文字が maxWidth に入るよう、はみ出すところを「…」にして返す
function fit(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let s = [...text];
  while (s.length && ctx.measureText(s.join("") + "…").width > maxWidth) s.pop();
  return s.join("") + "…";
}

// チームの色の丸（白いふちつき）を描く
function dot(ctx, x, y, r, color) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = color || "#cccccc";
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#c9c4bd";
  ctx.stroke();
}

// トーナメント表の大きさ（高さ）を返す。回ごとの列・1回戦の試合の数から
function bracketHeight(ko) {
  const first = ko.filter((m) => m.round === 1).length;
  return first ? first * 132 + 40 : 0;
}

// トーナメント表（回ごとの列。線で次の回へつなぐ。勝ったほうを太く）を、y から描く。描いた高さを返す
function drawBracket(ctx, t, gen, resolved, y) {
  const ko = gen.matches.filter((m) => m.stage === "ko");
  if (!ko.length) return 0;
  const total = Math.max(...ko.map((m) => m.round));
  const colW = (W - PAD * 2) / total;
  const boxW = colW - 28;
  const boxH = 96;
  const height = bracketHeight(ko);
  const centers = {};
  for (let round = 1; round <= total; round++) {
    const list = ko.filter((m) => m.round === round);
    const x = PAD + (round - 1) * colW;
    ctx.font = font(22, 800);
    ctx.fillStyle = "#6b6a63";
    ctx.textAlign = "left";
    ctx.fillText(roundName(round, total), x, y + 22);
    list.forEach((m, i) => {
      const span = (height - 40) / list.length;
      const cy = y + 40 + span * i + span / 2;
      centers[m.id] = cy;
      const top = cy - boxH / 2;
      const r = resolved[m.id] || {};
      const res = t.results[m.id];
      // 前の回からの線
      if (round > 1) {
        ctx.strokeStyle = "#c9c4bd";
        ctx.lineWidth = 3;
        for (const side of [m.home, m.away]) {
          const from = centers[side.winnerOf];
          if (from === undefined) continue;
          ctx.beginPath();
          ctx.moveTo(x - 28, from);
          ctx.lineTo(x - 14, from);
          ctx.lineTo(x - 14, cy);
          ctx.lineTo(x, cy);
          ctx.stroke();
        }
      }
      roundBox(ctx, x, top, boxW, boxH, 14);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#e3ddd5";
      ctx.stroke();
      [[m.home, r.home, 0], [m.away, r.away, 1]].forEach(([side, id, k]) => {
        const rowY = top + 30 + k * 40;
        const team = t.teams.find((x2) => x2.id === id);
        const won = r.winner && r.winner === id;
        if (team) dot(ctx, x + 22, rowY - 7, 9, team.color);
        ctx.font = font(22, won ? 800 : 500);
        ctx.fillStyle = id ? "#1f1f1c" : "#9a978f";
        const name = id ? teamName(t, id) : side.empty ? "シード" : sideLabel(side, gen);
        const score = res && !m.bye ? String(res.s[k]) + (res.pk ? `(${res.pk[k]})` : "") : "";
        ctx.textAlign = "left";
        ctx.fillText(fit(ctx, name, boxW - 48 - (score ? 64 : 0)), x + 38, rowY);
        if (score) {
          ctx.textAlign = "right";
          ctx.font = font(22, 800);
          ctx.fillText(score, x + boxW - 12, rowY);
        }
      });
    });
  }
  return height + 24;
}

// 順位表（グループごと）を y から描く。描いた高さを返す
function drawTables(ctx, t, gen, y) {
  const groups = gen.groups?.length ? gen.groups : t.format === "league" ? [{ key: "", ids: t.teams.map((x) => x.id) }] : [];
  let h = 0;
  const cols = [["勝点", "pts"], ["勝", "win"], ["分", "draw"], ["負", "loss"], ["得", "gf"], ["失", "ga"], ["差", "gd"]];
  for (const g of groups) {
    const ms = gen.matches.filter((m) => (g.key ? m.group === g.key : m.stage === "league"));
    const rows = table(g.ids, ms, t.results, t.points);
    ctx.font = font(26, 800);
    ctx.fillStyle = "#1f1f1c";
    ctx.textAlign = "left";
    ctx.fillText(g.key ? `📊 ${g.key}組` : "📊 順位表", PAD, y + h + 30);
    h += 48;
    ctx.font = font(20, 700);
    ctx.fillStyle = "#6b6a63";
    cols.forEach(([label], i) => {
      ctx.textAlign = "right";
      ctx.fillText(label, W - PAD - (cols.length - 1 - i) * 62, y + h + 22);
    });
    h += 34;
    rows.forEach((row, i) => {
      const rowY = y + h + 34;
      if (i % 2 === 0) {
        ctx.fillStyle = "#f6f2ec";
        ctx.fillRect(PAD, rowY - 30, W - PAD * 2, 44);
      }
      const team = t.teams.find((x) => x.id === row.id);
      ctx.font = font(22, 800);
      ctx.fillStyle = "#1f1f1c";
      ctx.textAlign = "left";
      ctx.fillText(String(row.rank), PAD + 10, rowY);
      dot(ctx, PAD + 58, rowY - 8, 10, team?.color);
      ctx.fillStyle = "#1f1f1c";
      ctx.font = font(22, 600);
      ctx.fillText(fit(ctx, teamName(t, row.id), W - PAD * 2 - 90 - cols.length * 62), PAD + 78, rowY);
      cols.forEach(([, key], k) => {
        ctx.textAlign = "right";
        ctx.font = font(22, key === "pts" ? 800 : 500);
        ctx.fillText(String(row[key]), W - PAD - (cols.length - 1 - k) * 62, rowY);
      });
      h += 44;
    });
    h += 24;
  }
  return h;
}

// 試合の一覧（日程があれば時刻・コートつき）の行のならびを返す
function matchRows(t, gen, resolved, sched) {
  const timeOf = Object.fromEntries((sched || []).map((s) => [s.id, s]));
  const play = gen.matches.filter((m) => !m.bye);
  if (sched) play.sort((a, b) => (timeOf[a.id]?.slot ?? 0) - (timeOf[b.id]?.slot ?? 0) || (timeOf[a.id]?.court ?? 0) - (timeOf[b.id]?.court ?? 0));
  return play.map((m) => {
    const s = timeOf[m.id];
    const when = s && s.time ? `${s.time}${t.sched.courts > 1 ? ` コート${s.court}` : ""}　` : "";
    return when + matchLine(t, gen, resolved, m);
  });
}

/**
 * 大会の画像（幅 1080）を描いた canvas を返す。sched は時刻を入れた日程（[{ id, slot, court, time }]。なければ null）
 */
export function drawTournament(t, gen, resolved, sched = null) {
  const probe = document.createElement("canvas").getContext("2d");
  probe.font = font(22, 500);
  const rows = matchRows(t, gen, resolved, sched);
  const ko = gen.matches.filter((m) => m.stage === "ko");
  const groups = gen.groups?.length || (t.format === "league" ? 1 : 0);
  const teamsPerGroup = gen.groups?.length ? Math.max(...gen.groups.map((g) => g.ids.length)) : t.teams.length;
  const head = 150;
  const height = head + 30 + (ko.length ? bracketHeight(ko) + 40 : 0) + (groups ? groups * (110 + teamsPerGroup * 44) : 0) + 60 + rows.length * 40 + 80;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = Math.min(16000, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fffaf3";
  ctx.fillRect(0, 0, W, canvas.height);
  // 見出しの帯
  ctx.fillStyle = CARD_COLOR;
  ctx.fillRect(0, 0, W, head);
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "left";
  ctx.font = font(48, 800);
  ctx.fillText(fit(ctx, t.name || "組み合わせ", W - PAD * 2), PAD, 78);
  ctx.font = font(24, 600);
  const when = [dateLabel(t.sched.on ? t.sched.date : ""), t.sched.on ? t.sched.place : "", `${t.teams.length}チーム`].filter(Boolean).join("　");
  ctx.fillText(fit(ctx, when, W - PAD * 2), PAD, 122);
  let y = head + 30;
  if (ko.length) y += drawBracket(ctx, t, gen, resolved, y) + 16;
  if (groups) y += drawTables(ctx, t, gen, y);
  // 試合の一覧
  ctx.font = font(26, 800);
  ctx.fillStyle = "#1f1f1c";
  ctx.textAlign = "left";
  ctx.fillText("📋 試合", PAD, y + 30);
  y += 60;
  ctx.font = font(22, 500);
  for (const line of rows) {
    ctx.fillText(fit(ctx, line, W - PAD * 2), PAD, y + 26);
    y += 40;
  }
  ctx.font = font(20, 600);
  ctx.fillStyle = "#9a978f";
  ctx.fillText(`${TOOL.name}（${TOOL.en}）で作りました`, PAD, Math.min(canvas.height - 28, y + 50));
  return canvas;
}
