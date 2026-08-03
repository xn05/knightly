import { Chess } from "chess.js";

const PIECE_VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 99 };
const NON_PAWN_PIECES = new Set(["n", "b", "r", "q"]);

/**
 * Converts a white-perspective Stockfish evaluation into an expected score.
 * 1.00 = always winning, 0.00 = always losing, 0.50 = even.
 * The 0.0035 gradient matches Chess.com's published expected-points model.
 */
export function expectedPoints(evaluation) {
  if (evaluation.type === "mate") return evaluation.value > 0 ? 1 : evaluation.value < 0 ? 0 : 0.5;
  return 1 / (1 + Math.exp(-0.0035 * evaluation.value));
}

/** Expected points from the perspective of the moving player. */
function playerPoints(evaluation, color) {
  const whitePoints = expectedPoints(evaluation);
  return color === "w" ? whitePoints : 1 - whitePoints;
}

/**
 * Returns all legal captures of `piece` on `square` by `color` in the given FEN,
 * overriding the side to move so we can check either player's captures.
 */
function legalCapturesOf(fen, color, square, piece) {
  const fields = fen.split(" ");
  fields[1] = color;
  const board = new Chess(fields.join(" "));
  return board.moves({ verbose: true }).filter(m => m.to === square && m.captured === piece);
}

/**
 * Returns true if the move is a voluntary piece sacrifice — i.e. the moving
 * piece (knight, bishop, rook, or queen) lands on a square where the opponent
 * can immediately recapture it, and the material given up exceeds what was taken.
 *
 * For captures: we only check that the piece can be recaptured on the landing
 * square. We do NOT disqualify because the piece was already under attack at its
 * origin — a capture-sacrifice (e.g. Nxf7 flying into a defended pawn) is still
 * voluntary even if the piece was threatened before the move.
 *
 * For quiet moves (no capture): we additionally require the piece was NOT already
 * under attack before the move, so we don't misclassify escape-moves as sacrifices.
 */
function staticExchangeSwing(afterFen, move) {
  const board = new Chess(afterFen);
  const gains = [move.captured ? PIECE_VALUE[move.captured] : 0];
  let occupantValue = PIECE_VALUE[move.piece];
  let side = move.color === "w" ? "b" : "w";

  for (let ply = 0; ply < 16; ply += 1) {
    const fields = board.fen().split(" ");
    fields[1] = side;
    const probe = new Chess(fields.join(" "));
    const captures = probe.moves({ verbose: true }).filter((m) => m.to === move.to);
    if (!captures.length) break;
    captures.sort((a, b) => PIECE_VALUE[a.piece] - PIECE_VALUE[b.piece]);
    const capture = captures[0];
    gains.push(occupantValue - gains[gains.length - 1]);
    const attacker = board.get(capture.from);
    board.remove(move.to);
    board.remove(capture.from);
    board.put({ type: attacker.type, color: attacker.color }, move.to);
    occupantValue = PIECE_VALUE[capture.piece];
    side = side === "w" ? "b" : "w";
  }

  for (let i = gains.length - 1; i > 0; i -= 1) gains[i - 1] = -Math.max(-gains[i - 1], gains[i]);
  return gains[0];
}

function hasVoluntaryPieceSacrifice(move, positions, index) {
  if (!NON_PAWN_PIECES.has(move.piece)) return false;

  const swing = staticExchangeSwing(positions[index + 1], move);
  if (swing >= 0) return false; // fair trade or better — not a sacrifice

  if (!move.captured) {
    const opponent = move.color === "w" ? "b" : "w";
    const beforeCaptures = legalCapturesOf(positions[index], opponent, move.from, move.piece);
    if (beforeCaptures.length > 0) return false;
  }

  return true;
}

/**
 * Returns true if the captured piece had no other defenders besides the moving piece —
 * i.e. taking it was completely safe regardless of what you played.
 * Used to exclude trivial "free captures" from Great and Brilliant classification.
 */
function isFreeCapture(move, positions, index) {
  if (!move.captured) return false;
  const before = new Chess(positions[index]);
  // For en passant the captured pawn is not on the destination square.
  const captureSquare = move.flags.includes("e")
    ? `${move.to[0]}${move.color === "w" ? "5" : "4"}`
    : move.to;
  const otherDefenders = before.attackers(captureSquare, move.color).filter(sq => sq !== move.from);
  return otherDefenders.length === 0;
}

/** Returns true when there is only one legal move — classifications are trivial there. */
function isForcedPosition(positions, index) {
  return new Chess(positions[index]).moves().length <= 1;
}

/**
 * MISS — You had a clearly winning position but played a move that let the opponent
 * back into the game, throwing away the win without actually losing.
 *
 * Two cases:
 *   1. You had forced mate but played a non-mating move and are now merely equal or better.
 *   2. You were clearly winning (≥0.85) and dropped to a roughly equal result (0.40–0.65).
 *      The upper bound on "after" is generous: ending up at 0.65 after being at 0.90
 *      is a meaningful miss even if you're still slightly better.
 */
function isMiss(move, previous, current) {
  const before = playerPoints(previous, move.color);
  const after = playerPoints(current, move.color);

  // Had forced mate, played a non-mating move, but didn't actually lose.
  if (previous.type === "mate" && playerPoints(previous, move.color) === 1) {
    return current.type !== "mate" && after >= 0.40;
  }

  // Was clearly winning, now the game is roughly equal.
  return before >= 0.85 && after >= 0.40 && after < 0.65;
}

/**
 * GREAT MOVE — Critical to the outcome: turns a losing position into an equal one,
 * an equal position into a winning one, or is the only move that avoids a serious
 * deterioration.
 *
 * Conditions (all must hold):
 *   - No significant expected-points loss (≤0.02)
 *   - Not a forced move (would be trivial)
 *   - Not a free capture (anyone could see it)
 *   - Either: it's the only good move (second-best continuation is ≥0.10 worse), OR
 *             it rescues or wins the game (before < 0.45, after ≥ 0.50)
 *
 * Unlike Brilliant, Great does NOT require the move to be a piece sacrifice, and
 * does NOT require it to be Stockfish's literal top-ranked move — it just has to
 * be near-best (loss ≤ 0.02).
 */
function isGreatMove({ move, positions, index, loss, secondEval, previous, current }) {
  if (loss > 0.02) return false;
  if (isForcedPosition(positions, index)) return false;
  if (isFreeCapture(move, positions, index)) return false;

  const before = playerPoints(previous, move.color);
  const after = playerPoints(current, move.color);

  // "Only good move": the second-best continuation is considerably worse.
  const secondAfter = secondEval !== null ? playerPoints(secondEval, move.color) : null;
  const onlyGoodMove = secondAfter !== null && (after - secondAfter) >= 0.10;

  // "Saves or wins": rescues a losing or equal position into a winning one.
  const savesOrWins = before < 0.45 && after >= 0.50;

  return onlyGoodMove || savesOrWins;
}

/**
 * BRILLIANT MOVE — The best or nearly best move AND a voluntary piece sacrifice,
 * where you don't end up in a bad position, and you weren't already completely
 * winning via other means.
 *
 * Conditions (all must hold):
 *   - No significant expected-points loss (≤0.02) — must be best or nearly best
 *   - Not a forced move
 *   - Qualifies as a voluntary piece sacrifice (see hasVoluntaryPieceSacrifice)
 *   - After the move you are not in a bad position (after ≥ 0.45)
 *   - Even the second-best continuation wasn't already completely winning (secondAfter < 0.90)
 *     — this enforces "you should not be completely winning even if you hadn't found the move"
 */
function isBrilliantMove({ move, positions, index, loss, secondEval, current }) {
  if (loss > 0.02) return false;
  if (isForcedPosition(positions, index)) return false;
  if (!hasVoluntaryPieceSacrifice(move, positions, index)) return false;

  const after = playerPoints(current, move.color);
  if (after < 0.45) return false;

  // The second-best alternative must not have been completely winning already.
  // If secondEval is unavailable, we can't confirm this condition, so skip brilliant.
  if (secondEval === null) return false;
  const secondAfter = playerPoints(secondEval, move.color);
  return secondAfter < 0.90;
}

/**
 * Classify a single played move using Stockfish evaluations and multi-PV lines.
 *
 * Inputs:
 *   index           — move index into `moves` and `positions`
 *   moves           — array of chess.js verbose move objects
 *   positions       — array of FEN strings (positions[0] = start, positions[i+1] = after moves[i])
 *   evaluations     — Map<index, {type, value}> of Stockfish evals (index = position index)
 *   bestMoves       — Map<index, SAN> of Stockfish's top move from each position
 *   engineLines     — Map<index, {"1": eval, "2": eval, "3": eval}> of multi-PV evaluations
 *   isTheory        — optional function(index) => bool for opening theory detection
 *
 * Priority order: theory → miss → brilliant → great → best → excellent → good →
 *                 inaccuracy → mistake → blunder
 */
export function classifyMove({ index, moves, positions, evaluations, bestMoves, engineLines, isTheory }) {
  if (index < 0 || !moves[index]) return null;
  if (!evaluations.has(index) || !evaluations.has(index - 1)) return null;
  if (isTheory?.(index)) return "theory";

  const move = moves[index];
  const previous = evaluations.get(index - 1); // eval of position before this move
  const current = evaluations.get(index);       // eval of position after this move
  const before = playerPoints(previous, move.color);
  const after = playerPoints(current, move.color);
  const loss = Math.max(0, before - after);

  // engineLines are keyed by string "1", "2", "3" (MultiPV rank from Stockfish).
  // These are evaluations of the position BEFORE this move was played, so they
  // represent alternative continuations the moving player could have chosen.
  const topLines = engineLines.get(index - 1) ?? {};
  // "2" = second-best move's evaluation from the position before this move.
  const secondEval = topLines["2"] ?? null;

  const bestMove = bestMoves.get(index - 1);

  // Special classifications checked first, in priority order.
  if (isMiss(move, previous, current)) return "miss";
  if (isBrilliantMove({ move, positions, index, loss, secondEval, current })) return "brilliant";
  if (isGreatMove({ move, positions, index, loss, secondEval, previous, current })) return "great";

  // Standard expected-points table.
  // Best: played Stockfish's top move (loss rounds to 0.00).
  if (bestMove === move.san) return "best";
  if (loss <= 0.02) return "excellent";
  if (loss <= 0.05) return "good";
  if (loss <= 0.10) return "inaccuracy";
  if (loss <= 0.20) return "mistake";
  return "blunder";
}
