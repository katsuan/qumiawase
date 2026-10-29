// くみあわせ：準備の「チーム」（名前と色・並べかえ・消す・足す・シャッフル・まとめて入れる）
// app.js から読む（import。描きなおしは renderTeams、ボタンと入力は bindTeams）
import { LIMITS, TEAM_COLORS } from "./settings.js?v=202610291801";
import { colorAt } from "./store.js?v=202610291801";
import { teamName } from "./card.js?v=202610291801";
import { $, esc, toast } from "./dom.js?v=202610291801";
import { change, current, persist, teamById, ui } from "./state.js?v=202610291801";

// チームの行（番号・色と名前の入力枠・↑↓✕・色の選択肢）を描きなおす。名前を入れているあいだは描きなおさない
export function renderTeams() {
  const t = current();
  $("teamsMeta").textContent = `${t.teams.length}チーム`;
  const list = $("teamList");
  list.replaceChildren(
    ...t.teams.map((team, i) => {
      const li = document.createElement("li");
      li.className = "team-row";
      li.dataset.tid = team.id;
      li.innerHTML = `
        <span class="team-no">${i + 1}</span>
        <div class="ls-pickfield">
          <button class="ls-pickfield-btn" type="button" aria-label="${esc(teamName(t, team.id))}の色を選ぶ"><span class="swatch" style="background:${esc(team.color)}"></span></button>
          <input class="team-name" maxlength="${LIMITS.name}" placeholder="チーム${i + 1}" autocomplete="off" enterkeyhint="next" aria-label="${i + 1}番目のチーム名">
        </div>
        <button class="ls-icon-button drag-handle" type="button" aria-label="${i + 1}番目。押したまま上下に動かすと並べかえ（↑↓ キーでも）">⠿</button>
        <button class="ls-icon-button" type="button" data-remove aria-label="このチームを消す" ${t.teams.length <= 2 ? "disabled" : ""}>✕</button>
        <div class="ls-picker" style="--cols: 9" hidden></div>`;
      li.querySelector(".team-name").value = team.name;
      bindTeamColor(li, team);
      const handle = li.querySelector(".drag-handle");
      handle.addEventListener("pointerdown", (e) => dragTeam(e, li));
      // つまみにフォーカスして ↑↓ キー：1つ上・下へ（動かしたあとも、そのチームのつまみにフォーカス）
      handle.addEventListener("keydown", (e) => {
        const d = { ArrowUp: -1, ArrowDown: 1 }[e.key];
        if (!d) return;
        e.preventDefault();
        const ids = current().teams.map((x) => x.id);
        const j = i + d;
        if (j < 0 || j >= ids.length) return;
        [ids[i], ids[j]] = [ids[j], ids[i]];
        reorderTeams(ids);
        $("teamList").querySelector(`[data-tid="${team.id}"] .drag-handle`)?.focus();
      });
      return li;
    })
  );
  $("addTeam").disabled = t.teams.length >= LIMITS.teams;
}

// チームの行の色の丸を押す・名前を入れるあいだ、色の選択肢（8色とカスタム）を出す（Q キットの pickField）
function bindTeamColor(li, team) {
  const field = li.querySelector(".ls-pickfield");
  const button = li.querySelector(".ls-pickfield-btn");
  const input = li.querySelector(".team-name");
  const picker = li.querySelector(".ls-picker");
  // 色を選ぶ（決まった色ならたたむ。カスタムは開いたまま）
  const pick = (hex, close) => {
    team.color = hex;
    button.querySelector(".swatch").style.background = hex;
    persist();
    ui.renderResults();
    fill();
    if (close && document.activeElement !== input) api?.close();
  };
  // 選択肢を作りなおす（いまの色に印）
  const fill = () => {
    const now = team.color.toLowerCase();
    const items = TEAM_COLORS.map((c) => {
      const b = Object.assign(document.createElement("button"), { type: "button", className: "ls-picker-item" });
      b.setAttribute("aria-pressed", String(now === c.hex));
      b.setAttribute("aria-label", c.label);
      const sw = Object.assign(document.createElement("span"), { className: "swatch" });
      sw.style.background = c.hex;
      b.append(sw);
      b.addEventListener("click", () => pick(c.hex, true));
      return b;
    });
    const custom = Object.assign(document.createElement("label"), { className: "ls-picker-item" });
    const isPreset = TEAM_COLORS.some((c) => c.hex === now);
    custom.setAttribute("aria-pressed", String(!isPreset));
    const sw = Object.assign(document.createElement("span"), { className: "swatch is-custom" });
    if (!isPreset) sw.style.setProperty("--c", now);
    const color = Object.assign(document.createElement("input"), { type: "color", value: now });
    color.setAttribute("aria-label", "カスタムの色");
    color.addEventListener("change", () => pick(color.value, false));
    sw.append(color);
    custom.append(sw);
    picker.replaceChildren(...items, custom);
  };
  const api = window.LineShareUI?.pickField?.({ field, button, input, picker, onOpen: fill });
  if (!api) button.addEventListener("click", () => ((picker.hidden = !picker.hidden), fill()));
}

// チームの並びを、ids の順にする（並べかえ。組み合わせが変わるので、結果があれば消して「元に戻す」）
function reorderTeams(ids) {
  const now = current().teams.map((x) => x.id);
  if (ids.join() === now.join()) return renderTeams();
  change((t) => (t.teams = ids.map((id) => t.teams.find((x) => x.id === id))));
}

// つまみ（⠿）を押したまま上下に動かして、チームの行を並べかえる（指でもマウスでも）。はなしたら、その順にする
function dragTeam(e, li) {
  const handle = e.currentTarget;
  const list = $("teamList");
  e.preventDefault();
  try {
    handle.setPointerCapture(e.pointerId);
  } catch {
    // つかめなくても動かせる
  }
  li.classList.add("is-dragging");
  // 指の高さが、となりの行のまん中をこえたら入れかえる（行が動いても行ったり来たりしない）
  const onMove = (ev) => {
    const y = ev.clientY;
    const prev = li.previousElementSibling;
    const next = li.nextElementSibling;
    if (prev && y < prev.getBoundingClientRect().top + prev.offsetHeight / 2) list.insertBefore(li, prev);
    else if (next && y > next.getBoundingClientRect().top + next.offsetHeight / 2) list.insertBefore(next, li);
    if (y < 60) window.scrollBy(0, -12);
    else if (y > window.innerHeight - 60) window.scrollBy(0, 12);
  };
  // はなしたとき：並んだ順でチームを並べかえる
  const onUp = () => {
    handle.removeEventListener("pointermove", onMove);
    handle.removeEventListener("pointerup", onUp);
    handle.removeEventListener("pointercancel", onUp);
    li.classList.remove("is-dragging");
    reorderTeams([...list.children].map((row) => row.dataset.tid));
  };
  handle.addEventListener("pointermove", onMove);
  handle.addEventListener("pointerup", onUp);
  handle.addEventListener("pointercancel", onUp);
}

// 新しいチームの id（いまの t の番号より大きい番号）を返す
function nextTeamId(t) {
  const max = Math.max(0, ...t.teams.map((x) => Number(/^t(\d+)$/.exec(x.id)?.[1]) || 0));
  return `t${max + 1}`;
}

// 押す・入力を受けるしかけ（チームの名前・消す・足す・シャッフル・まとめて入れる）を付ける（app.js の init から1回）
export function bindTeams() {
  // チーム：名前・並べかえ・消す
  $("teamList").addEventListener("input", (e) => {
    const li = e.target.closest(".team-row");
    if (!li || !e.target.classList.contains("team-name")) return;
    const team = teamById(li.dataset.tid);
    team.name = e.target.value.slice(0, LIMITS.name);
    persist();
    ui.renderResults();
  });
  $("teamList").addEventListener("click", (e) => {
    const li = e.target.closest(".team-row");
    if (li && e.target.closest("[data-remove]")) {
      const name = teamName(current(), li.dataset.tid);
      change((t) => (t.teams = t.teams.filter((x) => x.id !== li.dataset.tid)), `「${name}」を消しました`);
    }
  });
  $("addTeam").addEventListener("click", () => {
    change((t) => t.teams.length < LIMITS.teams && t.teams.push({ id: nextTeamId(t), name: "", color: colorAt(t.teams.length) }));
    const inputs = document.querySelectorAll(".team-name");
    inputs[inputs.length - 1]?.focus();
  });
  $("shuffleTeams").addEventListener("click", () =>
    change((t) => {
      for (let i = t.teams.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [t.teams[i], t.teams[j]] = [t.teams[j], t.teams[i]];
      }
    }, "シャッフルしました")
  );
  $("bulkToggle").addEventListener("click", () => {
    const open = $("bulkBox").hidden;
    $("bulkBox").hidden = !open;
    $("bulkToggle").setAttribute("aria-expanded", String(open));
    if (open) $("bulkText").value = current().teams.map((x) => x.name).join("\n");
  });
  $("bulkApply").addEventListener("click", () => {
    const names = $("bulkText").value.split("\n").map((s) => s.trim().slice(0, LIMITS.name)).filter(Boolean).slice(0, LIMITS.teams);
    if (names.length < 2) return toast("2チーム以上入れてね");
    change((t) => {
      // 同じ名前のチームは、id と色をそのまま使う（結果と色を残す）
      const pool = [...t.teams];
      t.teams = names.map((name, i) => {
        const k = pool.findIndex((x) => x.name === name);
        if (k >= 0) return pool.splice(k, 1)[0];
        return { id: "", name, color: colorAt(i) };
      });
      t.teams.forEach((x) => !x.id && (x.id = nextTeamId(t)));
    }, `${names.length}チームを入れました`);
    $("bulkBox").hidden = true;
    $("bulkToggle").setAttribute("aria-expanded", "false");
  });
}
