import "./style.css";
import { Chess } from "chess.js";
import { createBoard } from "./board.js";
import { classifyMove } from "./classifier.js";
import bestIcon from "./assets/best.png";
import blunderIcon from "./assets/blunder.png";
import excellentIcon from "./assets/excellent.png";
import goodIcon from "./assets/good.png";
import greatIcon from "./assets/great.png";
import inaccuracyIcon from "./assets/inaccuracy.png";
import mistakeIcon from "./assets/mistake.png";
import theoryIcon from "./assets/theory.png";
import brilliantIcon from "./assets/brilliant.png";
import missIcon from "./assets/miss.png";
import openings from "./assets/openings.json";

const icons = { best: bestIcon, blunder: blunderIcon, excellent: excellentIcon, good: goodIcon, great: greatIcon, inaccuracy: inaccuracyIcon, mistake: mistakeIcon, theory: theoryIcon, brilliant: brilliantIcon, miss: missIcon };
const qualityColours = { brilliant: "#1baaa6", best: "#98bc49", excellent: "#98bc49", good: "#97af8b", great: "#5b8baf", theory: "#a88764", inaccuracy: "#f4bf44", mistake: "#e28c28", blunder: "#c93230", miss: "#a88764" };
document.querySelector("#app").innerHTML = `<main class="shell"><header class="topbar"><a class="brand" href="#"><span class="brand-mark">&#9822;</span>Knightly</a><div class="header-actions"><button class="settings-button" id="settings-button">Settings</button><label class="load-game">Load PGN<input id="pgn-file" type="file" accept=".pgn,text/plain"></label></div></header><section class="review-layout"><aside class="evaluation"><span id="eval-label">0.00</span><div id="eval-fill"></div></aside><div class="board-area"><div class="board-wrap"><div id="board"></div><i class="move-highlight hidden" id="from-highlight"></i><i class="move-highlight hidden" id="to-highlight"></i><img class="move-badge hidden" id="move-badge" alt="Move quality"></div><div class="board-actions"><button id="flip">Flip board</button><span id="engine-status">Starting engine…</span></div></div><section class="analysis-panel"><div class="panel-heading"><div><p>GAME REVIEW</p><h1>Move analysis</h1><div class="game-opening" id="game-opening">Starting position</div></div><button class="icon-button" id="new-game">&#8634;</button></div><div class="current-move" id="current-move"></div><div class="move-summary" id="move-summary"></div><div class="move-list" id="move-list"></div><div class="navigation"><button id="first">&#124;&#8249;</button><button id="previous">&#8249;</button><button id="next">&#8250;</button><button id="last">&#8250;&#124;</button></div></section></section></main><div class="settings-backdrop hidden" id="settings-backdrop"><section class="settings-card" role="dialog" aria-modal="true" aria-labelledby="settings-title"><div><p>ENGINE SETTINGS</p><h2 id="settings-title">Engine Settings</h2>

<label class="settings-label" for="engine-select">
    Engine Version
</label>

<select id="engine-select" class="settings-select">
    <option value="stockfish-18-lite.js">
        Stockfish 18 Lite (7 MB)
    </option>

    <option value="stockfish-18-lite-single.js" selected>
        Stockfish 18 Lite Single (7 MB)
    </option>
</select>

<label class="settings-label">
    Analysis Depth
</label></div><div class="depth-value"><span id="depth-value">16</span><small>ply</small></div><input id="depth-slider" type="range" min="8" max="22" value="16"><div class="depth-scale"><span>Fast</span><span>Stronger · slower</span></div><button id="close-settings">Done</button></section></div><div class="promotion-backdrop hidden" id="promotion-backdrop"><section class="promotion-card" role="dialog" aria-modal="true" aria-label="Choose promotion"><p>Promote pawn to</p><div><button data-piece="q">♕</button><button data-piece="r">♖</button><button data-piece="b">♗</button><button data-piece="n">♘</button></div></section></div>`;

let moves = [], positions = [new Chess().fen()], current = -1, position = new Chess(), engineReady = false, engine, activeAnalysis = null, analysisQueue = [], analysisRevision = 0, flipped = false, analysisDepth = 16, pendingPromotion = null, pendingEngineResult = null, mainLine = null, branchStart = null;
let selectedEngine = "stockfish-18-lite-single.js";
const evaluations = new Map();
const bestMoves = new Map();
const engineLines = new Map();
const board = createBoard(document.getElementById("board"), makeMove);
const legalDests = chess => { const dests = new Map(); chess.moves({ verbose: true }).forEach(move => { if (!dests.has(move.from)) dests.set(move.from, []); dests.get(move.from).push(move.to); }); return dests; };
function syncBoard() { position = new Chess(positions[current + 1]); const turnColor = position.turn() === "w" ? "white" : "black"; board.set({ fen: position.fen(), turnColor, lastMove: current >= 0 ? [moves[current].from, moves[current].to] : undefined, movable: { free: false, color: turnColor, dests: legalDests(position), events: { after: makeMove } }, premovable: { enabled: false } }); }
function resetAnalysisCache() { analysisRevision += 1; evaluations.clear(); bestMoves.clear(); engineLines.clear(); }
function commitMove(from, to, promotion) { const expectedMove = moves[current + 1]; if (mainLine && moves === mainLine.moves && expectedMove && expectedMove.from === from && expectedMove.to === to && (!expectedMove.promotion || expectedMove.promotion === promotion)) return setMove(current + 1); const move = position.move({ from, to, promotion }); if (!move) return syncBoard(); if (mainLine && moves === mainLine.moves) { branchStart = current + 1; moves = moves.slice(0, current + 1); positions = positions.slice(0, current + 2); resetAnalysisCache(); } else { moves = moves.slice(0, current + 1); positions = positions.slice(0, current + 2); } moves.push(move); positions.push(position.fen()); current += 1; evaluations.delete(current); setMove(current); }
function makeMove(from, to) { const movingPiece = position.get(from); if (movingPiece?.type === "p" && (to[1] === "1" || to[1] === "8")) { pendingPromotion = { from, to }; syncBoard(); document.getElementById("promotion-backdrop").classList.remove("hidden"); return; } commitMove(from, to, "q"); }
function newGame() { moves = []; positions = [new Chess().fen()]; mainLine = null; branchStart = null; current = -1; resetAnalysisCache(); setMove(-1); }
function loadPgn(pgn) { const parsed = new Chess(); try { parsed.loadPgn(pgn); } catch (error) { alert(`Illegal PGN: ${error.message}`); return; } const loaded = parsed.history({ verbose: true }); if (!loaded.length) return alert("No legal moves found in this PGN."); const replay = new Chess(); moves = []; positions = [replay.fen()]; loaded.forEach(move => { moves.push(replay.move(move)); positions.push(replay.fen()); }); mainLine = { moves, positions }; branchStart = null; resetAnalysisCache(); setMove(-1); }
function isTheory(index) { return index >= 0 && Boolean(openings[positions[index + 1].split(" ")[0]]); }
function openingNameAt(index) { for (let moveIndex = index; moveIndex >= -1; moveIndex -= 1) { const name = openings[positions[moveIndex + 1].split(" ")[0]]; if (name) return name; } return "Starting position"; }
function moveQuality(index) { return classifyMove({ index, moves, positions, evaluations, bestMoves, engineLines, isTheory }); }
function moveCell(move, index) { if (!move) return `<span class="move-cell empty"></span>`; const quality = moveQuality(index); return `<button class="move-cell ${index === current ? "selected" : ""}" data-index="${index}">${quality ? `<img src="${icons[quality]}" alt="">` : ""}<span>${move.san}</span></button>`; }
function renderMoves() { let rows = ""; for (let index = 0; index < moves.length; index += 2) rows += `<div class="move-pair"><span class="move-number">${index / 2 + 1}.</span>${moveCell(moves[index], index)}${moveCell(moves[index + 1], index + 1)}</div>`; document.getElementById("move-list").innerHTML = rows; document.querySelectorAll(".move-cell[data-index]").forEach(button => button.onclick = () => setMove(Number(button.dataset.index))); }
function updateMoveSummary() { const summary = document.getElementById("move-summary"), move = moves[current], quality = moveQuality(current); if (!move || !quality) { summary.innerHTML = ""; summary.classList.remove("visible"); return; } const label = `${quality[0].toUpperCase()}${quality.slice(1)}`; summary.innerHTML = `<img src="${icons[quality]}" alt=""><strong>${move.san} ${label}.</strong><span>${bestMoveText(current) ? `Best was ${bestMoveText(current)}` : "Analysed by Stockfish"}</span>`; summary.classList.add("visible"); }
function squarePosition(square) { const file = square.charCodeAt(0) - 97, rank = Number(square[1]) - 1; return { x: flipped ? 7 - file : file, y: flipped ? rank : 7 - rank }; }
function boardGeometry() { const wrap = document.querySelector(".board-wrap").getBoundingClientRect(); const visualBoard = document.querySelector("#board cg-board") || document.getElementById("board"); const boardRect = visualBoard.getBoundingClientRect(); return { left: boardRect.left - wrap.left, top: boardRect.top - wrap.top, width: boardRect.width, height: boardRect.height, square: boardRect.width / 8 }; }
function placeBadge() { const badge = document.getElementById("move-badge"), fromHighlight = document.getElementById("from-highlight"), toHighlight = document.getElementById("to-highlight"), move = moves[current], quality = moveQuality(current); if (!move || !quality) { badge.classList.add("hidden"); fromHighlight.classList.add("hidden"); toHighlight.classList.add("hidden"); return; } const from = squarePosition(move.from), to = squarePosition(move.to), colour = qualityColours[quality], geometry = boardGeometry(); [fromHighlight, toHighlight].forEach((highlight, index) => { const point = index ? to : from; highlight.style.left = `${geometry.left + point.x * geometry.square}px`; highlight.style.top = `${geometry.top + point.y * geometry.square}px`; highlight.style.width = `${geometry.square}px`; highlight.style.height = `${geometry.square}px`; highlight.style.backgroundColor = colour; highlight.classList.remove("hidden"); }); const badgeSize = geometry.square * .58, rawLeft = geometry.left + (to.x + 1) * geometry.square - badgeSize * .52, rawTop = geometry.top + to.y * geometry.square - badgeSize * .18; badge.src = icons[quality]; badge.style.width = `${badgeSize}px`; badge.style.height = `${badgeSize}px`; badge.style.left = `${Math.min(geometry.left + geometry.width - badgeSize, Math.max(geometry.left, rawLeft))}px`; badge.style.top = `${Math.min(geometry.top + geometry.height - badgeSize, Math.max(geometry.top, rawTop))}px`; badge.classList.remove("hidden"); }
new ResizeObserver(placeBadge).observe(document.getElementById("board"));
function setMove(index) { current = Math.max(-1, Math.min(moves.length - 1, index)); syncBoard(); document.getElementById("game-opening").textContent = openingNameAt(current); const move = moves[current], quality = moveQuality(current); document.getElementById("current-move").innerHTML = move ? `<span>Move ${Math.ceil((current + 1) / 2)}${move.color === "w" ? "." : "…"}</span><strong>${move.san}</strong><small id="move-description">${quality ? `${quality[0].toUpperCase()}${quality.slice(1)} move` : "Analysing move…"}</small>` : `<span>${position.turn() === "w" ? "White" : "Black"} to move</span><strong>Make a move</strong><small id="move-description">Opening</small>`; if (evaluations.has(current)) displayEvaluation(evaluations.get(current)); else { document.getElementById("eval-label").textContent = "…"; document.getElementById("eval-fill").style.height = "50%"; } renderMoves(); updateMoveSummary(); placeBadge(); scheduleAnalysis(current === -1 ? [-1] : [current - 1, current]); }
function scoreText(evaluation) { if (evaluation.type === "mate") return `M${Math.abs(evaluation.value)}`; return evaluation.value >= 0 ? `+${(evaluation.value / 100).toFixed(2)}` : (evaluation.value / 100).toFixed(2); }
function bestMoveText(moveIndex) { return bestMoves.get(moveIndex - 1) || null; }
function updateDescription() { const quality = moveQuality(current), currentEvaluation = evaluations.get(current), description = document.getElementById("move-description"); if (!description || !quality) return; const evaluationText = currentEvaluation ? ` · ${scoreText(currentEvaluation)}` : ""; const bestMove = bestMoveText(current); description.textContent = `${quality[0].toUpperCase()}${quality.slice(1)} move${evaluationText}${bestMove ? ` · Best: ${bestMove}` : ""}`; updateMoveSummary(); }
function displayEvaluation(evaluation) { const barHeight = evaluation.type === "mate" ? (evaluation.value > 0 ? 95 : 5) : Math.max(6, Math.min(94, 50 + evaluation.value / 12)); document.getElementById("eval-fill").style.height = `${barHeight}%`; document.getElementById("eval-label").textContent = scoreText(evaluation); }
function updateEvaluation(evaluation, index) { evaluations.set(index, evaluation); if (index === current) displayEvaluation(evaluation); updateDescription(); renderMoves(); placeBadge(); }
function saveBestMove(index, uci) { try { const chess = new Chess(positions[index + 1]); const san = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }); if (san) bestMoves.set(index, san.san); } catch { /* Ignore incomplete engine lines. */ } if (index === current - 1) { updateDescription(); renderMoves(); placeBadge(); updateMoveSummary(); } }
function scheduleAnalysis(indices) { if (!engineReady) return; analysisQueue = [...new Set(indices.filter(index => index >= -1 && !evaluations.has(index)))].map(index => ({ index, revision: analysisRevision })); runNextAnalysis(); }
function runNextAnalysis() { if (!engineReady || activeAnalysis !== null || !analysisQueue.length) return; activeAnalysis = analysisQueue.shift(); pendingEngineResult = null; document.getElementById("engine-status").textContent = `Analysing depth ${analysisDepth}…`; engine.postMessage(`position fen ${positions[activeAnalysis.index + 1]}`); engine.postMessage(`go depth ${analysisDepth}`); }
function startEngine() {
  const status = document.getElementById("engine-status");
  const engineUrl = new URL(`${import.meta.env.BASE_URL}stockfish/${selectedEngine}`, window.location.href).href;
  engine = new Worker(engineUrl);
  const timeout = window.setTimeout(() => { if (!engineReady) status.textContent = "Engine did not start — check Console"; }, 12000);
  engine.onmessage = ({ data }) => {
    if (data === "uciok") { engine.postMessage("setoption name MultiPV value 3"); engine.postMessage("isready"); }
    if (data === "readyok") { window.clearTimeout(timeout); engineReady = true; status.textContent = "Stockfish ready"; scheduleAnalysis([-1]); }
    const scoreMatch = typeof data === "string" && /\bscore (cp|mate) (-?\d+)/.exec(data);
    const depthMatch = typeof data === "string" && /\bdepth (\d+)/.exec(data);
    const pvMatch = typeof data === "string" && /\bpv\s+([a-h][1-8][a-h][1-8][qrbn]?)/.exec(data);
    const multiPvMatch = typeof data === "string" && /\bmultipv (\d+)/.exec(data);
    const multiPv = multiPvMatch ? Number(multiPvMatch[1]) : 1;
    if (pvMatch && activeAnalysis !== null && multiPv === 1) { pendingEngineResult ??= {}; pendingEngineResult.uci = pvMatch[1]; }
    if (scoreMatch && depthMatch && activeAnalysis !== null && Number(depthMatch[1]) >= 5) { const depth = Number(depthMatch[1]); const value = Number(scoreMatch[2]); const whiteValue = positions[activeAnalysis.index + 1].split(" ")[1] === "b" ? -value : value; const evaluation = { type: scoreMatch[1] === "mate" ? "mate" : "centipawn", value: whiteValue }; pendingEngineResult ??= {}; pendingEngineResult.lines ??= {}; const recorded = pendingEngineResult.lines[multiPv]; if (!recorded || depth >= recorded.depth) pendingEngineResult.lines[multiPv] = { depth, evaluation }; if (multiPv === 1 && (!pendingEngineResult.evaluationDepth || depth >= pendingEngineResult.evaluationDepth)) { pendingEngineResult.evaluation = evaluation; pendingEngineResult.evaluationDepth = depth; } }
    if (typeof data === "string" && data.startsWith("bestmove") && activeAnalysis !== null) { const task = activeAnalysis; const finishedIndex = task.index; const isCurrentAnalysis = task.revision === analysisRevision; if (isCurrentAnalysis && pendingEngineResult?.lines) engineLines.set(finishedIndex, Object.fromEntries(Object.entries(pendingEngineResult.lines).map(([rank, line]) => [rank, line.evaluation]))); if (isCurrentAnalysis && pendingEngineResult?.evaluation) updateEvaluation(pendingEngineResult.evaluation, finishedIndex); if (isCurrentAnalysis && pendingEngineResult?.uci) saveBestMove(finishedIndex, pendingEngineResult.uci); pendingEngineResult = null; activeAnalysis = null; status.textContent = "Stockfish ready"; runNextAnalysis(); }
  };
  engine.onerror = event => {
    console.error("Worker error:", event);
    console.error("Filename:", event.filename);
    console.error("Line:", event.lineno);
    console.error("Message:", event.message);

    status.textContent = `Engine error: ${event.message}`;
};
  engine.onmessageerror = event => { window.clearTimeout(timeout); status.textContent = "Engine error: invalid worker message"; console.error("Stockfish worker message error", event); };
  engine.postMessage("uci");
}
function returnToMainLine(target) { if (!mainLine || branchStart === null || target >= branchStart) return; moves = mainLine.moves; positions = mainLine.positions; branchStart = null; resetAnalysisCache(); }
document.getElementById("pgn-file").onchange = async event => loadPgn(await event.target.files[0].text()); document.getElementById("new-game").onclick = newGame; document.querySelector(".brand").onclick = event => { event.preventDefault(); newGame(); }; document.getElementById("first").onclick = () => { returnToMainLine(0); setMove(0); }; document.getElementById("previous").onclick = () => { const target = current - 1; returnToMainLine(target); setMove(target); }; document.getElementById("next").onclick = () => setMove(current + 1); document.getElementById("last").onclick = () => setMove(moves.length - 1); document.getElementById("flip").onclick = () => { flipped = !flipped; board.toggleOrientation(); placeBadge(); };
const settingsBackdrop = document.getElementById("settings-backdrop"), depthSlider = document.getElementById("depth-slider");
document.getElementById("settings-button").onclick = () => settingsBackdrop.classList.remove("hidden"); document.getElementById("close-settings").onclick = () => settingsBackdrop.classList.add("hidden"); settingsBackdrop.onclick = event => { if (event.target === settingsBackdrop) settingsBackdrop.classList.add("hidden"); };
depthSlider.oninput = () => { analysisDepth = Number(depthSlider.value); document.getElementById("depth-value").textContent = analysisDepth; resetAnalysisCache(); scheduleAnalysis(current === -1 ? [-1] : [current - 1, current]); };
document.querySelectorAll(".promotion-card button").forEach(button => button.onclick = () => { if (!pendingPromotion) return; document.getElementById("promotion-backdrop").classList.add("hidden"); const { from, to } = pendingPromotion; pendingPromotion = null; commitMove(from, to, button.dataset.piece); });
setMove(-1); startEngine();
const engineSelect = document.getElementById("engine-select");

engineSelect.onchange = () => {
    selectedEngine = engineSelect.value;

    engineReady = false;
    activeAnalysis = null;
    analysisQueue = [];
    pendingEngineResult = null;

    if (engine) {
        engine.terminate();
    }

    resetAnalysisCache();

    document.getElementById("engine-status").textContent =
        "Switching engine...";

    startEngine();
};
