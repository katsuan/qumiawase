// くみあわせ：ツールの名前・色・数の上限などの決まり。名前を変えるときは、まずここ（ほかに index.html の meta・manifest・README）
// app.js・js/ のほかの部品から読む（import）

// ツールの名前（仮）。画面の見出し・カード・画像に出す
export const TOOL = {
  key: "qumiawase", // 端末に残すキー・おくるんの from に使う（名前を変えても変えない）
  name: "くみあわせ",
  en: "QumiAwase",
  copy: "トーナメントも総当たりも、すぐできる",
  url: "https://katsuan.github.io/qumiawase/"
};

// ほかのツールの URL（さくせん盤・ろくが）
export const SAQSEN_URL = "https://katsuan.github.io/soccer/";
export const ROQGA_URL = "https://katsuan.github.io/score-recorder/";
export const QRONOS_URL = "https://katsuan.github.io/countdown/"; // くろのす（カウントダウン）

// チームの色：さくせん盤・ろくがと同じ8色（並びも同じ）。ほかの色はカスタムで
export const TEAM_COLORS = [
  { label: "緑", hex: "#22a447" },
  { label: "黄", hex: "#ffd23f" },
  { label: "白", hex: "#ffffff" },
  { label: "赤", hex: "#e53935" },
  { label: "青", hex: "#1e63d6" },
  { label: "紺", hex: "#1b2a59" },
  { label: "オレンジ", hex: "#ff8a1f" },
  { label: "黒", hex: "#222222" }
];

// 数の上限
export const LIMITS = {
  teams: 32, // チームの数（2〜32）
  name: 20, // チーム名（さくせん盤と同じ）
  title: 30, // 大会の名前
  place: 30, // 会場
  score: 99, // 1試合の点
  tournaments: 30, // この端末に保存できる大会の数
  courts: 8, // コートの数
  minutes: 240 // 1試合の時間（分）
};

// 勝ち点（はじめの値。設定で変えられる）
export const DEFAULT_POINTS = { win: 3, draw: 1, loss: 0 };

// 作れる形
export const FORMATS = {
  knockout: "トーナメント",
  league: "総当たり",
  groups: "グループ → 決勝トーナメント"
};
