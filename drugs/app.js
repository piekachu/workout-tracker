const sb = Auth.client;
const DRUGS = window.DRUGS;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---------- dates (local, never UTC -- see the note in expenses/app.js) ----------
const pad = (n) => String(n).padStart(2, "0");
const localISO = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const START = "2026-11-04";   // day 1 of the sequence; today's drug = DRUGS[(days since START) % N]
function dayNumber(iso) {      // whole days since START, via UTC date maths so DST can't skew it
  const [y, m, d] = iso.split("-").map(Number), [y0, m0, d0] = START.split("-").map(Number);
  return Math.floor((Date.UTC(y, m - 1, d) - Date.UTC(y0, m0 - 1, d0)) / 86400000);
}
const addDaysISO = (iso, n) => { const [y, m, d] = iso.split("-").map(Number); return localISO(new Date(y, m - 1, d + n)); };
const mod = (a, n) => ((a % n) + n) % n;
const TODAY = localISO();
const todayNum = Math.max(0, dayNumber(TODAY));
const todayIdx = mod(todayNum, DRUGS.length);

function safeGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function safeSet(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } }
function toast(msg) { const t = $("toast"); t.textContent = msg; t.classList.add("on"); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("on"), 2400); }

const state = {
  offset: 0,                       // days back from today (0 = today)
  browseIdx: null,                 // set when opening a drug from the list
  recall: safeGet("drugs.recall") === "1",
  studied: new Map(),              // iso date -> {drug_id, quiz_correct, quiz_total}
  quiz: null,
  logError: false,
};
const viewIdx = () => state.browseIdx != null ? state.browseIdx : mod(todayNum - state.offset, DRUGS.length);
const isTodayView = () => state.browseIdx == null && state.offset === 0;

// ---------- structure svg cache ----------
const svgCache = new Map();
async function structureSvg(id) {
  if (!svgCache.has(id)) {
    svgCache.set(id, fetch(`svg/${id}.svg`).then((r) => (r.ok ? r.text() : "")).catch(() => ""));
  }
  return svgCache.get(id);
}

// ---------- study log (Supabase) ----------
async function loadLog() {
  const { data, error } = await sb.from("drug_log").select("studied_on, drug_id, quiz_correct, quiz_total");
  if (error) { state.logError = true; return; }
  state.studied = new Map((data || []).map((r) => [r.studied_on, r]));
}
function streak() {
  let day = state.studied.has(TODAY) ? TODAY : addDaysISO(TODAY, -1), n = 0;
  while (state.studied.has(day)) { n++; day = addDaysISO(day, -1); }
  return n;
}
function renderStats() {
  $("stat-streak").textContent = state.logError ? "–" : streak();
  $("stat-total").textContent = state.logError ? "–" : state.studied.size;
  $("dots").innerHTML = Array.from({ length: 14 }, (_, i) => {
    const iso = addDaysISO(TODAY, i - 13);
    return `<i class="${state.studied.has(iso) ? "on" : ""}${iso === TODAY ? " today" : ""}" title="${iso}"></i>`;
  }).join("");
}

// ---------- study view ----------
function fact(title, inner, extraClass = "") {
  return `<section class="fact ${extraClass}"><h3>${esc(title)}</h3>${inner}</section>`;
}
async function renderStudy() {
  const i = viewIdx(), d = DRUGS[i];
  const num = state.browseIdx != null ? null : todayNum - state.offset;

  // header / nav
  const prevOK = state.browseIdx == null;
  $("prev-day").disabled = !prevOK || num <= 0;
  $("next-day").disabled = !prevOK || state.offset === 0;
  if (state.browseIdx != null) {
    $("day-label").textContent = `Browsing · drug ${i + 1} of ${DRUGS.length}`;
  } else {
    const dt = new Date(...addDaysISO(TODAY, -state.offset).split("-").map((v, k) => (k === 1 ? v - 1 : +v)));
    $("day-label").textContent = `${state.offset === 0 ? "Today" : dt.toLocaleDateString("en-US", { weekday: "short" })} · ${dt.toLocaleDateString("en-US", { month: "short", day: "numeric" })} · day ${num + 1}`;
  }
  const banner = $("banner");
  banner.hidden = state.browseIdx == null;
  if (state.browseIdx != null) banner.innerHTML = `<span>Studying out of order — quizzes here don't count toward your streak.</span><button type="button" id="back-today">Back to today</button>`;

  const props = [
    ["", d.formula], ["MW", d.mw.toFixed(1)], ["cLogP", d.logp.toFixed(1)], ["HBD", d.hbd], ["HBA", d.hba], ["TPSA", d.tpsa],
  ].map(([k, v]) => `<span class="prop">${k ? `<b>${k}</b>` : ""}${esc(v)}</span>`).join("") +
    `<span class="prop ${d.ro5 === 0 ? "ok" : ""}"><b>Ro5</b>${d.ro5 === 0 ? "passes" : d.ro5 + " violation" + (d.ro5 > 1 ? "s" : "")}</span>` +
    (d.stereo ? `<span class="prop"><b>stereocentres</b>${d.stereo}</span>` : "");

  const pk = d.pk;
  const html = `
    <div class="hero">
      <div class="structure" id="structure" role="img" aria-label="2D structure of ${esc(d.name)}"></div>
      <div class="hero-body">
        <h2 class="drug-name">${esc(d.name)}</h2>
        <div class="brands">${esc((d.brands || []).join(" · "))}</div>
        <span class="cls">${esc(d.cls)}</span>
        <div class="props">${props}</div>
      </div>
    </div>

    <div class="toolbar">
      <button type="button" class="switch" id="recall-switch" aria-pressed="${state.recall}"><span class="track"></span>Recall mode</button>
      <button type="button" class="btn" id="start-quiz">Quiz me</button>
    </div>

    <div id="facts" class="${state.recall ? "recall" : ""}">
      ${fact("Target & mechanism", `<div class="body"><div class="lead">${esc(d.target)}</div>${esc(d.mech)}</div>`)}
      ${fact("Uses", `<div class="body">${esc(d.use)}</div>`)}
      ${fact("Pharmacokinetics", `<dl class="pkgrid">
        <div><dt>Half-life</dt><dd>${esc(pk.half_life)}</dd></div>
        <div><dt>Bioavailability</dt><dd>${esc(pk.bioavailability)}</dd></div>
        <div><dt>Metabolism</dt><dd>${esc(pk.metabolism)}</dd></div>
        <div><dt>Elimination</dt><dd>${esc(pk.excretion)}</dd></div></dl>`)}
      ${fact("Adverse effects & safety", `<div class="body"><ul>${d.adverse.map((a) => `<li>${esc(a)}</li>`).join("")}</ul></div>`)}
      ${fact("Pearl", `<div class="body">${esc(d.pearl)}</div>`)}
    </div>`;
  $("study").innerHTML = html;
  structureSvg(d.id).then((svg) => { const el = $("structure"); if (el) el.innerHTML = svg; });
}

// ---------- quiz ----------
function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function pickOptions(correct, getVal, pool, n = 4) {
  const seen = new Set([correct]);
  const out = [];
  for (const d of shuffle(pool)) { const v = getVal(d); if (v && !seen.has(v)) { seen.add(v); out.push(v); if (out.length === n - 1) break; } }
  return shuffle([correct, ...out]);
}
function buildQuiz(idx) {
  const d = DRUGS[idx], others = DRUGS.filter((_, i) => i !== idx);
  const qs = [
    { kind: "struct", text: "Which drug is this?", id: d.id, answer: d.name, options: pickOptions(d.name, (x) => x.name, others), explain: `${d.name} — ${d.cls}.` },
    { text: `What is the main target or mechanism of ${d.name}?`, answer: d.target, options: pickOptions(d.target, (x) => x.target, others), explain: d.mech },
    { text: `Which class does ${d.name} belong to?`, answer: d.cls, options: pickOptions(d.cls, (x) => x.cls, others), explain: `${d.name}: ${d.cls}.` },
    { text: `${d.name} is mainly used for…`, answer: d.use, options: pickOptions(d.use, (x) => x.use, others), explain: d.use },
  ];
  // Fifth question: spaced review of an earlier drug in the sequence (or an adverse-effect question on day 1).
  const earlierCount = Math.min(todayNum, DRUGS.length - 1);
  if (earlierCount > 0) {
    const pastIdx = mod(todayNum - 1 - Math.floor(Math.random() * Math.min(earlierCount, 30)), DRUGS.length);
    if (pastIdx !== idx) {
      const p = DRUGS[pastIdx], po = DRUGS.filter((_, i) => i !== pastIdx);
      qs.push({ review: true, text: `Review: what is the main target or mechanism of ${p.name}?`, answer: p.target, options: pickOptions(p.target, (x) => x.target, po), explain: p.mech });
    }
  }
  if (qs.length < 5) {
    const ae = d.adverse[0];
    qs.push({ text: `Which is a key adverse effect or safety point for ${d.name}?`, answer: ae, options: pickOptions(ae, (x) => x.adverse[0], others), explain: d.adverse.join(" · ") });
  }
  return { idx, qs, i: 0, correct: 0, answered: null, log: [] };
}
async function renderQuiz() {
  const q = state.quiz, el = $("quiz");
  $("study").hidden = true; el.hidden = false;
  if (q.i >= q.qs.length) { return renderResult(); }
  const cur = q.qs[q.i];
  const struct = cur.kind === "struct" ? `<div class="qstruct" id="qstruct"></div>` : "";
  el.innerHTML = `<div class="quizcard">
      <div class="qprog"><span>Question ${q.i + 1} of ${q.qs.length}${cur.review ? " · review" : ""}</span><span>${q.correct} correct</span></div>
      <div class="qbar"><i style="width:${(q.i / q.qs.length) * 100}%"></i></div>
      <p class="qtext">${esc(cur.text)}</p>${struct}
      <div class="opts">${cur.options.map((o, k) => `<button type="button" class="opt" data-k="${k}">${esc(o)}</button>`).join("")}</div>
      <div id="qfeedback"></div>
      <div class="qnav"><button type="button" class="btn ghost" id="quit-quiz">Back to notes</button><button type="button" class="btn" id="next-q" hidden>${q.i + 1 === q.qs.length ? "See score" : "Next"}</button></div>
    </div>`;
  if (cur.kind === "struct") structureSvg(cur.id).then((svg) => { const s = $("qstruct"); if (s) s.innerHTML = svg; });
  el.scrollIntoView({ behavior: "smooth", block: "start" });
}
function answer(k) {
  const q = state.quiz, cur = q.qs[q.i];
  if (q.answered != null) return;
  q.answered = k;
  const picked = cur.options[k], ok = picked === cur.answer;
  if (ok) q.correct++;
  q.log.push({ text: cur.text, ok, answer: cur.answer });
  document.querySelectorAll(".opt").forEach((b, idx) => {
    b.disabled = true;
    if (cur.options[idx] === cur.answer) b.classList.add("right");
    else if (idx === k) b.classList.add("wrong");
  });
  $("qfeedback").innerHTML = `<div class="qexplain"><strong>${ok ? "Correct." : "Not quite."}</strong> ${esc(cur.explain || "")}</div>`;
  $("next-q").hidden = false; $("next-q").focus({ preventScroll: true });
}
async function renderResult() {
  const q = state.quiz, el = $("quiz");
  const pct = Math.round((q.correct / q.qs.length) * 100);
  let note = "";
  if (isTodayView() && q.idx === todayIdx) {
    const row = { studied_on: TODAY, drug_id: DRUGS[q.idx].id, quiz_correct: q.correct, quiz_total: q.qs.length };
    const { error } = await sb.from("drug_log").upsert(row, { onConflict: "studied_on" });
    if (error) { note = `Couldn't save your streak (${esc(error.message)}).`; }
    else { state.studied.set(TODAY, row); state.logError = false; renderStats(); note = "Saved — today counts toward your streak."; }
  } else note = "Practice run — only today's quiz on today's drug counts toward your streak.";
  el.innerHTML = `<div class="quizcard">
    <div class="qprog"><span>Finished</span><span>${DRUGS[q.idx].name}</span></div>
    <div class="score">${q.correct} / ${q.qs.length}</div>
    <div class="qexplain">${pct >= 80 ? "Solid." : pct >= 50 ? "Getting there." : "Worth another pass through the notes."} ${note}</div>
    <ul class="review-list">${q.log.map((l) => `<li><span>${l.ok ? "✓" : "✗"}</span><span>${esc(l.text)}${l.ok ? "" : `<br><span style="color:var(--text-dim)">Answer: ${esc(l.answer)}</span>`}</span></li>`).join("")}</ul>
    <div class="qnav"><button type="button" class="btn ghost" id="quit-quiz">Back to notes</button><button type="button" class="btn" id="retry-quiz">Try again</button></div>
  </div>`;
}
function startQuiz() { state.quiz = buildQuiz(viewIdx()); renderQuiz(); }
function leaveQuiz() { state.quiz = null; $("quiz").hidden = true; $("study").hidden = false; window.scrollTo({ top: 0, behavior: "smooth" }); }

// ---------- browse ----------
function renderList() {
  const q = $("search").value.trim().toLowerCase();
  const seenIds = new Set([...state.studied.values()].map((r) => r.drug_id));
  const items = DRUGS.map((d, i) => ({ d, i })).filter(({ d }) => !q || [d.name, d.cls, d.target, d.use, ...(d.brands || [])].join(" ").toLowerCase().includes(q))
    .sort((a, b) => a.d.name.localeCompare(b.d.name));
  $("drug-count").textContent = `${items.length}/${DRUGS.length}`;
  $("drug-list").innerHTML = items.length
    ? `<div class="dl">${items.map(({ d, i }) => `<button type="button" class="drow" data-i="${i}"><span class="n">${esc(d.name)}</span><span class="c">${esc(d.cls)}</span><span class="tag ${seenIds.has(d.id) ? "seen" : ""}">${seenIds.has(d.id) ? "studied" : ""}</span></button>`).join("")}</div>`
    : `<p class="empty">No drugs match “${esc(q)}”.</p>`;
}

// ---------- wiring ----------
document.addEventListener("click", (e) => {
  const t = e.target;
  if (t.closest("#recall-switch")) {
    state.recall = !state.recall; safeSet("drugs.recall", state.recall ? "1" : "0");
    t.closest("#recall-switch").setAttribute("aria-pressed", state.recall);
    $("facts").classList.toggle("recall", state.recall);
    $("facts").querySelectorAll(".fact").forEach((f) => f.classList.remove("revealed"));
  } else if (t.closest(".recall .fact")) { t.closest(".fact").classList.toggle("revealed"); }
  else if (t.closest("#start-quiz") || t.closest("#retry-quiz")) startQuiz();
  else if (t.closest("#quit-quiz")) leaveQuiz();
  else if (t.closest("#next-q")) { state.quiz.i++; state.quiz.answered = null; renderQuiz(); }
  else if (t.closest(".opt")) answer(+t.closest(".opt").dataset.k);
  else if (t.closest("#back-today")) { state.browseIdx = null; state.offset = 0; state.quiz = null; $("quiz").hidden = true; $("study").hidden = false; renderStudy(); window.scrollTo({ top: 0, behavior: "smooth" }); }
  else if (t.closest(".drow")) { state.browseIdx = +t.closest(".drow").dataset.i; state.quiz = null; $("quiz").hidden = true; $("study").hidden = false; renderStudy(); window.scrollTo({ top: 0, behavior: "smooth" }); }
});
$("prev-day").onclick = () => { if (todayNum - state.offset > 0) { state.offset++; state.quiz = null; $("quiz").hidden = true; $("study").hidden = false; renderStudy(); } };
$("next-day").onclick = () => { if (state.offset > 0) { state.offset--; state.quiz = null; $("quiz").hidden = true; $("study").hidden = false; renderStudy(); } };
$("search").addEventListener("input", renderList);

renderStats();
renderStudy();
renderList();
loadLog().then(() => { renderStats(); renderList(); if (state.logError) toast("Study log unavailable — streak won't save."); });
