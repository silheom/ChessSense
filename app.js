import { Chess } from "https://cdn.jsdelivr.net/npm/chess.js@1.4.0/+esm";

/* ===== DOM ===== */
const $ = id => document.getElementById(id);
const els = {};
["inputView","analysisView","pgnInput","analyzeBtn","exampleBtn","backBtn","errorBox","engineStatus",
 "board","moveList","moveLabel","positionLabel","gameMeta","evalValue","depthValue","progressBar",
 "positionInsight","candidateList","humanFactors","firstBtn","prevBtn","nextBtn","lastBtn"
].forEach(id => { els[id] = $(id); });

const EXAMPLE_PGN = `[Event "Example"]
[White "White"]
[Black "Black"]
[Result "*"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 8. c3 O-O 9. h3 *`;

const ENGINE_PATH = new URL("stockfish/stockfish-19-lite-single.js", import.meta.url).toString();

/* ===== 상태 ===== */
let engine = null, engineReady = false, engineInit = null;
let current = null;          // 진행 중인 분석
let ignoreBest = 0;          // 취소된 분석이 남기는 bestmove 개수
let positions = [], currentPly = 0, token = 0;
const cache = new Map();

/* ===== 유틸 ===== */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
function setStatus(t, type) { els.engineStatus.textContent = t; els.engineStatus.className = "status " + type; }
function showError(t) { els.errorBox.textContent = t; els.errorBox.hidden = false; }
function clearError() { els.errorBox.textContent = ""; els.errorBox.hidden = true; }
function setProgress(p, d) { els.progressBar.style.width = clamp(p, 0, 100) + "%"; els.depthValue.textContent = d ? d : "—"; }

/* ===== Stockfish ===== */
function initEngine() {
  if (engineReady) return Promise.resolve();
  if (engineInit) return engineInit;
  engineInit = new Promise((resolve, reject) => {
    setStatus("Stockfish 로딩 중…", "loading");
    let w, phase = "uci", done = false;
    const fail = msg => {
      if (done) return; done = true;
      try { w && w.terminate(); } catch {}
      engine = null; engineReady = false; engineInit = null;
      setStatus("Stockfish 준비 실패", "error");
      reject(new Error(msg));
    };
    try { w = new Worker(ENGINE_PATH); } catch (e) { return fail("Stockfish Worker 생성 실패: " + e.message); }
    engine = w;
    const timer = setTimeout(() => fail("Stockfish 로딩 시간 초과 (stockfish 폴더/파일 확인)"), 30000);
    w.onerror = e => { clearTimeout(timer); fail("Stockfish 오류: " + (e.message || "파일을 찾을 수 없음")); };
    w.onmessage = ev => {
      const line = typeof ev.data === "string" ? ev.data.trim() : "";
      if (!line) return;
      if (phase === "uci" && line === "uciok") {
        phase = "ready";
        w.postMessage("setoption name MultiPV value 3");
        w.postMessage("isready");
      } else if (phase === "ready" && line === "readyok") {
        phase = "run"; done = true; clearTimeout(timer); engineReady = true;
        setStatus("Stockfish 준비 완료", "ready");
        resolve();
      } else if (phase === "run") handleLine(line);
    };
    w.postMessage("uci");
  });
  return engineInit;
}

function handleLine(line) {
  if (line.startsWith("bestmove")) {
    if (ignoreBest > 0) { ignoreBest--; return; }
    if (current) current.finish();
    return;
  }
  if (ignoreBest > 0 || !current) return;
  if (line.startsWith("info ") && line.includes(" pv ")) current.info(line);
}

function cancelAnalysis() {
  if (!current) return;
  const old = current; current = null;
  clearTimeout(old.timer);
  ignoreBest++;
  try { engine.postMessage("stop"); } catch {}
  old.reject(new Error("cancelled"));
}

function analyzeFen(fen, depth = 12) {
  if (cache.has(fen)) return Promise.resolve(cache.get(fen));
  if (!engineReady) return Promise.reject(new Error("Stockfish가 준비되지 않았습니다."));
  cancelAnalysis();
  return new Promise((resolve, reject) => {
    const turn = fen.split(" ")[1];
    const result = { fen, depth: 0, lines: [] };
    const me = {
      reject,
      timer: setTimeout(() => { if (current === me) { current = null; ignoreBest++; engine.postMessage("stop"); reject(new Error("분석 시간 초과")); } }, 60000),
      info(line) {
        const t = line.split(/\s+/);
        const num = k => { const i = t.indexOf(k); return i >= 0 ? Number(t[i + 1]) : null; };
        const d = num("depth") || 0, mpv = num("multipv") || 1;
        const si = t.indexOf("score"), pi = t.indexOf("pv");
        if (si < 0 || pi < 0) return;
        const type = t[si + 1], raw = Number(t[si + 2]);
        let score = type === "cp" ? raw / 100 : type === "mate" ? (raw > 0 ? 100 : -100) : null;
        if (score === null) return;
        if (turn === "b") score = -score;      // 항상 백 기준
        result.depth = Math.max(result.depth, d);
        const item = { index: mpv, score, pv: t.slice(pi + 1) };
        const ex = result.lines.find(l => l.index === mpv);
        if (ex) Object.assign(ex, item); else result.lines.push(item);
        setProgress(Math.min(95, d / depth * 100), d);
      },
      finish() {
        clearTimeout(me.timer); current = null;
        result.lines.sort((a, b) => a.index - b.index);
        cache.set(fen, result);
        resolve(result);
      }
    };
    current = me;
    engine.postMessage("position fen " + fen);
    engine.postMessage("go depth " + depth);
  });
}

function fmtScore(v) {
  if (v == null) return "—";
  if (Math.abs(v) >= 99) return v > 0 ? "+M" : "−M";
  return (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(1);
}
function scoreLabel(v) {
  const a = Math.abs(v), side = v > 0 ? "백" : "흑";
  if (a < 0.25) return "엔진은 거의 균형으로 봅니다.";
  if (a < 0.8) return `엔진은 ${side}이 조금 더 편하다고 봅니다.`;
  if (a < 1.8) return `엔진은 ${side}에게 뚜렷한 우세가 있다고 봅니다.`;
  return `엔진은 ${side}의 우세가 크다고 봅니다.`;
}

/* ===== PGN ===== */
function parseHeaders(text) {
  const h = {}; const re = /^\s*\[(\w+)\s+"([^"]*)"\]\s*$/gm; let m;
  while ((m = re.exec(text))) h[m[1]] = m[2];
  return h;
}
function buildPositions(chess) {
  const list = [{ fen: new Chess().fen(), san: null, uci: null }];
  const replay = new Chess();
  for (const mv of chess.history({ verbose: true })) {
    const made = replay.move({ from: mv.from, to: mv.to, promotion: mv.promotion });
    list.push({ fen: replay.fen(), san: made.san, uci: made.from + made.to + (made.promotion || "") });
  }
  return list;
}
function uciToSan(fen, uci) {
  try {
    const c = new Chess(fen);
    return c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san;
  } catch { return uci; }
}

/* ===== 보드 ===== */
const GLYPH = { w: { p:"♙",n:"♘",b:"♗",r:"♖",q:"♕",k:"♔" }, b: { p:"♟",n:"♞",b:"♝",r:"♜",q:"♛",k:"♚" } };
function renderBoard(fen) {
  const rows = new Chess(fen).board();
  els.board.innerHTML = "";
  rows.forEach((row, r) => row.forEach((p, c) => {
    const d = document.createElement("div");
    d.className = "sq " + ((r + c) % 2 === 0 ? "light" : "dark");
    if (p) d.textContent = GLYPH[p.color][p.type];
    els.board.appendChild(d);
  }));
}
function renderMoves() {
  els.moveList.innerHTML = "";
  positions.forEach((p, i) => {
    if (!i) return;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "moveItem" + (i === currentPly ? " active" : "");
    b.textContent = (i % 2 ? Math.ceil(i / 2) + "." : Math.ceil(i / 2) + "...") + " " + p.san;
    b.addEventListener("click", () => selectPly(i));
    els.moveList.appendChild(b);
  });
}

/* ===== 전략 분석 (데이터만 반환, Chess 인스턴스는 저장하지 않음) ===== */
const VAL = { p: 1, n: 3.2, b: 3.3, r: 5, q: 9, k: 0 };
const FILES = "abcdefgh";
const other = c => (c === "w" ? "b" : "w");
const allPieces = chess => chess.board().flat().filter(Boolean);

function materialOf(chess) {
  const m = { w: 0, b: 0 };
  allPieces(chess).forEach(p => { m[p.color] += VAL[p.type]; });
  return { white: +m.w.toFixed(1), black: +m.b.toFixed(1), diff: +(m.w - m.b).toFixed(1) };
}

function movesFor(fen, square) {
  try {
    const parts = fen.split(" ");
    const piece = new Chess(fen).get(square);
    if (!piece) return [];
    parts[1] = piece.color; parts[3] = "-";
    return new Chess(parts.join(" ")).moves({ square, verbose: true });
  } catch { return []; }
}

function minorPieces(fen, chess) {
  const out = { w: [], b: [] };
  allPieces(chess).filter(p => p.type === "n" || p.type === "b").forEach(p => {
    const mv = movesFor(fen, p.square);
    let safe = 0;
    mv.forEach(m => { try { if (!new Chess(m.after).isAttacked(m.to, other(p.color))) safe++; } catch {} });
    const f = FILES.indexOf(p.square[0]), r = Number(p.square[1]) - 1;
    const central = clamp(1 - (Math.abs(3.5 - f) + Math.abs(3.5 - r)) / 7, 0, 1);
    const activity = +(clamp(mv.length / 10, 0, 1) * 0.5 + clamp(safe / 8, 0, 1) * 0.3 + central * 0.2).toFixed(2);
    out[p.color].push({ square: p.square, type: p.type, mobility: mv.length, safe, activity });
  });
  const avg = a => (a.length ? a.reduce((s, x) => s + x.activity, 0) / a.length : 0);
  return { white: out.w, black: out.b, whiteAvg: +avg(out.w).toFixed(2), blackAvg: +avg(out.b).toFixed(2) };
}

function pawnStructure(chess, color) {
  const pawns = allPieces(chess).filter(p => p.type === "p" && p.color === color);
  const enemy = allPieces(chess).filter(p => p.type === "p" && p.color !== color);
  const fileOf = p => FILES.indexOf(p.square[0]);
  const isolated = [], doubled = [], passed = [];
  pawns.forEach(p => {
    const f = fileOf(p), r = Number(p.square[1]);
    if (pawns.filter(q => fileOf(q) === f).length > 1) doubled.push(p.square);
    if (!pawns.some(q => Math.abs(fileOf(q) - f) === 1)) isolated.push(p.square);
    const blocked = enemy.some(e => Math.abs(fileOf(e) - f) <= 1 && (color === "w" ? Number(e.square[1]) > r : Number(e.square[1]) < r));
    if (!blocked) passed.push(p.square);
  });
  return { isolated, doubled, passed };
}

function snapshot(fen) {
  const chess = new Chess(fen);
  return { fen, turn: chess.turn(), material: materialOf(chess), minor: minorPieces(fen, chess),
    pawns: { white: pawnStructure(chess, "w"), black: pawnStructure(chess, "b") } };
}

/* ===== 설명 생성 ===== */
const NAME = { n: "나이트", b: "비숍" };
function bestMinor(list) { return list.slice().sort((a, b) => b.activity - a.activity)[0]; }
function worstMinor(list) { return list.slice().sort((a, b) => a.activity - b.activity)[0]; }
function pawnText(s) {
  const parts = [];
  [["white","백"],["black","흑"]].forEach(([k, n]) => {
    const p = s.pawns[k];
    if (p.isolated.length) parts.push(`${n} 고립폰 ${p.isolated.join(",")}`);
    if (p.doubled.length) parts.push(`${n} 더블폰 ${[...new Set(p.doubled)].join(",")}`);
    if (p.passed.length) parts.push(`${n} 통과폰 ${p.passed.join(",")}`);
  });
  return parts.length ? parts.join(" · ") : "특별한 폰 구조 특징 없음";
}

function renderFactors(s) {
  const md = s.material.diff;
  const matText = Math.abs(md) < 0.3 ? "물질은 거의 균형" : md > 0 ? `백이 ${md}점 앞섬` : `흑이 ${-md}점 앞섬`;
  const mk = l => l.map(p => `${NAME[p.type]} ${p.square}(이동 ${p.mobility}, 안전 ${p.safe})`).join(", ") || "없음";
  const items = [
    ["물질", `백 ${s.material.white} · 흑 ${s.material.black} → ${matText}`],
    ["백 마이너 피스", mk(s.minor.white)],
    ["흑 마이너 피스", mk(s.minor.black)],
    ["폰 구조", pawnText(s)]
  ];
  els.humanFactors.innerHTML = items.map(([t, x]) =>
    `<div class="factor"><b>${esc(t)}</b><span>${esc(x)}</span></div>`).join("");
}

function renderInsight(s, evalScore) {
  const ps = [];
  const md = s.material.diff;
  if (Math.abs(md) >= 0.3) ps.push(`물질로는 ${md > 0 ? "백" : "흑"}이 약 ${Math.abs(md)}점 앞서지만, 이것은 포지션의 한 요소일 뿐입니다.`);
  else ps.push("물질은 거의 균형이라 기물의 활동성과 구조가 더 중요합니다.");
  const wb = bestMinor(s.minor.white), bb = bestMinor(s.minor.black);
  const ww = worstMinor(s.minor.white), bw = worstMinor(s.minor.black);
  if (wb && bb) {
    ps.push(`백의 가장 활동적인 마이너 피스는 ${NAME[wb.type]} ${wb.square}(안전한 이동 ${wb.safe}칸), 흑은 ${NAME[bb.type]} ${bb.square}(안전한 이동 ${bb.safe}칸)입니다.`);
    if (ww && ww.mobility <= 3) ps.push(`백 ${NAME[ww.type]} ${ww.square}은 이동 가능한 칸이 ${ww.mobility}개뿐이라 제한되어 있습니다.`);
    if (bw && bw.mobility <= 3) ps.push(`흑 ${NAME[bw.type]} ${bw.square}은 이동 가능한 칸이 ${bw.mobility}개뿐이라 제한되어 있습니다.`);
    const d = s.minor.whiteAvg - s.minor.blackAvg;
    ps.push(Math.abs(d) < 0.08 ? "양쪽 마이너 피스 활동성은 비슷합니다." : `마이너 피스 활동성은 ${d > 0 ? "백" : "흑"}이 더 좋습니다.`);
  }
  ps.push("폰 구조: " + pawnText(s) + ".");
  if (evalScore != null) ps.push(scoreLabel(evalScore));
  els.positionInsight.className = "card insight";
  els.positionInsight.innerHTML = ps.map(t => `<p>${esc(t)}</p>`).join("");
}

function renderCandidates(result, fen) {
  const labels = ["엔진 최선", "대안 후보", "대안 후보"];
  els.candidateList.innerHTML = result.lines.length
    ? result.lines.map((l, i) => `
      <div class="candidate ${i === 0 ? "top" : ""}">
        <div class="t"><strong>${esc(uciToSan(fen, l.pv[0]))}</strong><span>${fmtScore(l.score)}</span></div>
        <div class="small">${labels[i] || "후보"}</div>
        <div class="pv">${esc(l.pv.slice(0, 6).map((m, k) => { return k === 0 ? uciToSan(fen, m) : m; }).join(" "))}</div>
      </div>`).join("")
    : `<div class="candidate">후보를 계산하지 못했습니다.</div>`;
}

/* ===== 포지션 선택 ===== */
async function selectPly(ply) {
  if (!positions.length) return;
  currentPly = clamp(ply, 0, positions.length - 1);
  const my = ++token;
  const pos = positions[currentPly];
  renderBoard(pos.fen);
  renderMoves();
  els.moveLabel.textContent = `${currentPly} / ${positions.length - 1}`;
  els.positionLabel.textContent = currentPly === 0 ? "시작 포지션" : `${Math.ceil(currentPly / 2)}${currentPly % 2 ? ". " : "… "}${pos.san}`;
  els.firstBtn.disabled = els.prevBtn.disabled = currentPly === 0;
  els.nextBtn.disabled = els.lastBtn.disabled = currentPly === positions.length - 1;
  clearError();
  setProgress(0, 0);
  els.evalValue.textContent = "분석 중…";
  els.candidateList.innerHTML = "";

  let snap = null;
  try {
    snap = snapshot(pos.fen);
    renderFactors(snap);
    renderInsight(snap, null);
  } catch (e) {
    console.error(e);
    els.positionInsight.textContent = "전략 분석 중 오류: " + e.message;
  }

  try {
    await initEngine();
    const result = await analyzeFen(pos.fen, 12);
    if (my !== token) return;
    const sc = result.lines[0]?.score ?? null;
    els.evalValue.textContent = fmtScore(sc);
    if (snap) renderInsight(snap, sc);
    renderCandidates(result, pos.fen);
    setProgress(100, result.depth);
  } catch (e) {
    if (my !== token || e.message === "cancelled") return;
    els.evalValue.textContent = "—";
    showError(e.message);
  }
}

/* ===== 게임 시작 ===== */
function startGame() {
  clearError();
  const text = els.pgnInput.value.trim();
  if (!text) return showError("PGN을 먼저 입력해주세요.");
  const chess = new Chess();
  try { chess.loadPgn(text, { strict: false }); }
  catch (e) { return showError("PGN을 읽을 수 없습니다: " + e.message); }
  positions = buildPositions(chess);
  if (positions.length < 2) return showError("PGN에서 수를 찾지 못했습니다.");
  cache.clear();
  const h = parseHeaders(text);
  els.gameMeta.textContent = `${h.White || "White"} vs ${h.Black || "Black"}`;
  els.inputView.hidden = true;
  els.analysisView.hidden = false;
  selectPly(0);
}

/* ===== 이벤트 ===== */
els.exampleBtn.addEventListener("click", () => { els.pgnInput.value = EXAMPLE_PGN; clearError(); });
els.analyzeBtn.addEventListener("click", startGame);
els.backBtn.addEventListener("click", () => { token++; cancelAnalysis(); els.analysisView.hidden = true; els.inputView.hidden = false; });
els.firstBtn.addEventListener("click", () => selectPly(0));
els.prevBtn.addEventListener("click", () => selectPly(currentPly - 1));
els.nextBtn.addEventListener("click", () => selectPly(currentPly + 1));
els.lastBtn.addEventListener("click", () => selectPly(positions.length - 1));

/* ===== 시작 ===== */
els.analysisView.hidden = true;
els.inputView.hidden = false;
setProgress(0, 0);
initEngine().catch(e => { console.error(e); showError("Stockfish를 불러오지 못했습니다: " + e.message); });
