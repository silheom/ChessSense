import { Chess } from "https://cdn.jsdelivr.net/npm/chess.js@1.4.0/+esm";

/*
 * ChessSense
 *
 * STEP 2 — Material + Superior Minor Pieces + Pawn Structure
 *
 * 원칙
 * 1. Stockfish는 계산/검증 담당.
 * 2. ChessSense는 전략적 사실을 먼저 수집하고 해석한다.
 * 3. 구조적 특징(detected)과 실제 약점(actual value)을 구분한다.
 * 4. 활동성(activity)과 기물의 실질적 품질(quality)을 구분한다.
 * 5. 현재 단계에서는 dominant imbalance / Fantasy / 후보수의 최종 판단을 하지 않는다.
 */

const $ = id => document.getElementById(id);

const els = {
  inputView: $("inputView"),
  analysisView: $("analysisView"),
  pgnInput: $("pgnInput"),
  analyzeBtn: $("analyzeBtn"),
  exampleBtn: $("exampleBtn"),
  backBtn: $("backBtn"),
  errorBox: $("errorBox"),
  engineStatus: $("engineStatus"),
  board: $("board"),
  moveList: $("moveList"),
  moveLabel: $("moveLabel"),
  positionLabel: $("positionLabel"),
  gameMeta: $("gameMeta"),
  evalValue: $("evalValue"),
  depthValue: $("depthValue"),
  progressBar: $("progressBar"),
  positionInsight: $("positionInsight"),
  candidateList: $("candidateList"),
  humanFactors: $("humanFactors"),
  firstBtn: $("firstBtn"),
  prevBtn: $("prevBtn"),
  nextBtn: $("nextBtn"),
  lastBtn: $("lastBtn")
};

const EXAMPLE = `[Event "Human Chess Insight Demo"]
[Site "Local"]
[Date "2026.01.01"]
[Round "1"]
[White "White"]
[Black "Black"]
[Result "*"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 8. c3 O-O 9. h3 *`;

const ENGINE_PATH =
  new URL("stockfish/stockfish-19-lite-single.js", import.meta.url).toString();

const COLOR_NAMES = { w: "백", b: "흑" };
const OPPOSITE = { w: "b", b: "w" };

const PIECE_VALUES = {
  p: 1,
  n: 3.2,
  b: 3.3,
  r: 5,
  q: 9,
  k: 0
};

const CENTER_SQUARES = new Set(["d4", "e4", "d5", "e5"]);

const EXTENDED_CENTER = new Set([
  "c3", "d3", "e3", "f3", "c4", "d4", "e4", "f4",
  "c5", "d5", "e5", "f5", "c6", "d6", "e6", "f6"
]);

let engine = null;
let engineReady = false;
let engineInitPromise = null;
let currentAnalysis = null;
let analysisToken = 0;
let positions = [];
let currentPly = 0;
let analysisCache = new Map();

/* =========================================================
   ENGINE
   ========================================================= */

function setStatus(text, type = "loading") {
  if (!els.engineStatus) return;
  els.engineStatus.textContent = text;
  els.engineStatus.className = `status ${type}`;
}

function showError(text) {
  if (!els.errorBox) return;
  els.errorBox.textContent = text;
  els.errorBox.hidden = false;
}

function clearError() {
  if (!els.errorBox) return;
  els.errorBox.hidden = true;
  els.errorBox.textContent = "";
}

function renderProgress(percent, depth = 0) {
  if (els.progressBar) {
    els.progressBar.style.width =
      `${Math.max(0, Math.min(100, percent))}%`;
  }

  if (els.depthValue) {
    els.depthValue.textContent =
      depth ? String(depth) : "—";
  }
}

function initEngine() {
  if (engineInitPromise) return engineInitPromise;

  engineInitPromise = new Promise((resolve, reject) => {
    setStatus("Stockfish 로딩 중…", "loading");

    try {
      engine = new Worker(ENGINE_PATH);
    } catch (error) {
      reject(error);
      return;
    }

    let phase = "boot";

    const timer = setTimeout(() => {
      reject(
        new Error("Stockfish 로딩 시간이 초과되었습니다.")
      );
    }, 30000);

    engine.onerror = event => {
      clearTimeout(timer);

      reject(
        new Error(
          event?.message || "Stockfish Worker 오류"
        )
      );
    };

    engine.onmessage = event => {
      const line =
        typeof event.data === "string"
          ? event.data.trim()
          : "";

      if (!line) return;

      if (line === "uciok" && phase === "boot") {
        phase = "waiting-ready";

        engine.postMessage(
          "setoption name MultiPV value 3"
        );

        engine.postMessage("isready");
        return;
      }

      if (
        line === "readyok" &&
        phase === "waiting-ready"
      ) {
        clearTimeout(timer);

        phase = "ready";
        engineReady = true;

        setStatus(
          "Stockfish 준비 완료",
          "ready"
        );

        resolve();
        return;
      }

      if (currentAnalysis) {
        currentAnalysis.onLine(line);
      }
    };

    engine.postMessage("uci");
  }).catch(error => {
    engineReady = false;
    setStatus("엔진 오류", "error");
    throw error;
  });

  return engineInitPromise;
}

function parseScore(tokens) {
  const i = tokens.indexOf("score");

  if (i < 0) return null;

  const kind = tokens[i + 1];
  const value = Number(tokens[i + 2]);

  if (!kind || Number.isNaN(value)) {
    return null;
  }

  if (kind === "cp") {
    return {
      type: "cp",
      raw: value
    };
  }

  if (kind === "mate") {
    return {
      type: "mate",
      raw: value
    };
  }

  return null;
}

function whiteScore(score, turn) {
  if (!score) return null;

  if (score.type === "cp") {
    return (
      (turn === "w"
        ? score.raw
        : -score.raw) / 100
    );
  }

  const sign = score.raw > 0 ? 1 : -1;

  return turn === "w"
    ? sign * 100
    : -sign * 100;
}

function formatScore(value) {
  if (
    value === null ||
    value === undefined ||
    Number.isNaN(value)
  ) {
    return "—";
  }

  if (Math.abs(value) >= 99) {
    return value > 0 ? "+M" : "−M";
  }

  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(1)}`;
}
/* =========================================================
   ENGINE ANALYSIS
   ========================================================= */

function cancelCurrentAnalysis() {
  analysisToken++;

  if (currentAnalysis) {
    currentAnalysis.cancelled = true;
    currentAnalysis = null;
  }

  if (engineReady && engine) {
    try {
      engine.postMessage("stop");
    } catch (_) {}
  }
}

function analyzeFen(fen, depth = 10) {
  if (!engineReady || !engine) {
    return Promise.reject(
      new Error("Stockfish가 아직 준비되지 않았습니다.")
    );
  }

  const cacheKey = `${fen}|${depth}`;

  if (analysisCache.has(cacheKey)) {
    return Promise.resolve(
      analysisCache.get(cacheKey)
    );
  }

  cancelCurrentAnalysis();

  const token = analysisToken;

  return new Promise((resolve, reject) => {
    const resultMap = new Map();

    currentAnalysis = {
      cancelled: false,

      onLine(line) {
        if (token !== analysisToken) return;

        if (line === "bestmove") {
          finish();
          return;
        }

        if (!line.startsWith("info")) {
          return;
        }

        const tokens = line.split(/\s+/);

        const depthIndex = tokens.indexOf("depth");
        const multipvIndex = tokens.indexOf("multipv");
        const pvIndex = tokens.indexOf("pv");

        const currentDepth =
          depthIndex >= 0
            ? Number(tokens[depthIndex + 1])
            : 0;

        const multiPv =
          multipvIndex >= 0
            ? Number(tokens[multipvIndex + 1])
            : 1;

        const score = parseScore(tokens);

        const pv =
          pvIndex >= 0
            ? tokens.slice(pvIndex + 1)
            : [];

        if (!score) return;

        resultMap.set(multiPv, {
          multipv: multiPv,
          depth: currentDepth,
          score,
          whiteScore: whiteScore(
            score,
            fen.split(/\s+/)[1]
          ),
          pv
        });

        const percent =
          Math.min(
            100,
            Math.round(
              (currentDepth / depth) * 100
            )
          );

        renderProgress(
          percent,
          currentDepth
        );
      }
    };

    function finish() {
      if (token !== analysisToken) {
        reject(
          new Error("분석이 취소되었습니다.")
        );
        return;
      }

      if (
        !currentAnalysis ||
        currentAnalysis.cancelled
      ) {
        reject(
          new Error("분석이 취소되었습니다.")
        );
        return;
      }

      const results =
        [...resultMap.values()]
          .sort(
            (a, b) =>
              a.multipv - b.multipv
          );

      const finalResult = {
        fen,
        depth:
          results.reduce(
            (max, item) =>
              Math.max(max, item.depth || 0),
            0
          ),
        lines: results
      };

      analysisCache.set(
        cacheKey,
        finalResult
      );

      currentAnalysis = null;

      resolve(finalResult);
    }

    currentAnalysis.onLine = (
      originalOnLine => line => {
        if (line === "bestmove") {
          finish();
          return;
        }

        originalOnLine(line);
      }
    )(currentAnalysis.onLine);

    try {
      engine.postMessage("ucinewgame");
      engine.postMessage(
        `position fen ${fen}`
      );
      engine.postMessage(
        `go depth ${depth}`
      );
    } catch (error) {
      currentAnalysis = null;
      reject(error);
    }
  });
}


/* =========================================================
   BASIC CHESS HELPERS
   ========================================================= */

function oppositeColor(color) {
  return OPPOSITE[color];
}

function colorName(color) {
  return COLOR_NAMES[color] || color;
}

function clamp(value, min = 0, max = 1) {
  return Math.max(
    min,
    Math.min(max, value)
  );
}

function average(values) {
  if (!values.length) return 0;

  return (
    values.reduce(
      (sum, value) =>
        sum + value,
      0
    ) / values.length
  );
}

function weightedAverage(items, key) {
  const valid =
    items.filter(
      item =>
        Number.isFinite(item[key])
    );

  if (!valid.length) return 0;

  return average(
    valid.map(
      item => item[key]
    )
  );
}

function getBoardPiece(chess, square) {
  try {
    const board = chess.board();

    const file =
      square.charCodeAt(0) -
      "a".charCodeAt(0);

    const rank =
      8 - Number(square[1]);

    if (
      file < 0 ||
      file > 7 ||
      rank < 0 ||
      rank > 7
    ) {
      return null;
    }

    return board[rank]?.[file] || null;
  } catch (_) {
    return null;
  }
}

function squareToCoords(square) {
  if (
    typeof square !== "string" ||
    square.length !== 2
  ) {
    return null;
  }

  const file =
    square.charCodeAt(0) -
    "a".charCodeAt(0);

  const rank =
    Number(square[1]) - 1;

  if (
    file < 0 ||
    file > 7 ||
    rank < 0 ||
    rank > 7
  ) {
    return null;
  }

  return {
    file,
    rank
  };
}

function coordsToSquare(file, rank) {
  if (
    file < 0 ||
    file > 7 ||
    rank < 0 ||
    rank > 7
  ) {
    return null;
  }

  return (
    String.fromCharCode(
      "a".charCodeAt(0) + file
    ) +
    String(rank + 1)
  );
}

function manhattanDistance(
  squareA,
  squareB
) {
  const a =
    squareToCoords(squareA);
  const b =
    squareToCoords(squareB);

  if (!a || !b) return 99;

  return (
    Math.abs(a.file - b.file) +
    Math.abs(a.rank - b.rank)
  );
}

function chebyshevDistance(
  squareA,
  squareB
) {
  const a =
    squareToCoords(squareA);
  const b =
    squareToCoords(squareB);

  if (!a || !b) return 99;

  return Math.max(
    Math.abs(a.file - b.file),
    Math.abs(a.rank - b.rank)
  );
}


/*
 * chess.js의 moves({ square })는
 * 현재 side-to-move의 기물만 정상적으로 처리한다.
 *
 * 따라서 특정 색 기물의 움직임을 확인할 때는
 * FEN의 side-to-move를 해당 색으로 바꾼 임시 Chess를 사용한다.
 */
function createChessForColor(
  chess,
  color
) {
  try {
    const fenParts =
      chess.fen().split(" ");

    fenParts[1] = color;

    return new Chess(
      fenParts.join(" ")
    );
  } catch (_) {
    return null;
  }
}

function getLegalMovesForPiece(
  chess,
  square,
  color
) {
  try {
    const testChess =
      createChessForColor(
        chess,
        color
      );

    if (!testChess) {
      return [];
    }

    return testChess.moves({
      square,
      verbose: true
    });
  } catch (_) {
    return [];
  }
}


/*
 * 특정 기물이 실제로 이동한 뒤
 * 그 도착 칸이 상대 기물에게 공격받는지 확인한다.
 *
 * 이것은 "안전성"을 평가하기 위한 휴리스틱이다.
 * 완전한 전술 계산을 대신하지 않는다.
 */
function isDestinationSafe(
  chess,
  move,
  color
) {
  try {
    const testChess =
      createChessForColor(
        chess,
        color
      );

    if (!testChess) {
      return false;
    }

    const executed =
      testChess.move({
        from: move.from,
        to: move.to,
        promotion:
          move.promotion || "q"
      });

    if (!executed) {
      return false;
    }

    const enemy =
      oppositeColor(color);

    return !testChess.isAttacked(
      move.to,
      enemy
    );
  } catch (_) {
    return false;
  }
}


/*
 * 특정 칸을 공격하는 기물 목록.
 *
 * 여기서 말하는 attack은 우선 "기하학적인 공격 관계"를
 * 수집하기 위한 것이다.
 * 핀 때문에 실제로 움직이지 못하는 기물까지
 * 전략적 압박 계산에서 자동으로 제외하지 않는다.
 */
function getAttackersOfSquare(
  chess,
  square,
  color
) {
  const attackers = [];

  const testChess =
    createChessForColor(
      chess,
      color
    );

  if (!testChess) {
    return attackers;
  }

  const board =
    testChess.board();

  for (let rank = 1; rank <= 8; rank++) {
    for (
      let fileIndex = 0;
      fileIndex < 8;
      fileIndex++
    ) {
      const from =
        String.fromCharCode(
          "a".charCodeAt(0) +
            fileIndex
        ) +
        String(rank);

      const piece =
        getBoardPiece(
          testChess,
          from
        );

      if (
        !piece ||
        piece.color !== color
      ) {
        continue;
      }

      const moves =
        getLegalMovesForPiece(
          testChess,
          from,
          color
        );

      if (
        moves.some(
          move =>
            move.to === square
        )
      ) {
        attackers.push({
          square: from,
          type: piece.type
        });
      }
    }
  }

  return attackers;
}


/*
 * pawn이 특정 칸을 방어하는지 확인.
 * 일반 기물의 방어와 구분해서
 * "pawn defender"만 따로 계산한다.
 */
function getPawnDefenders(
  chess,
  square,
  color
) {
  const result = [];
  const target =
    squareToCoords(square);

  if (!target) return result;

  const pawnRank =
    color === "w"
      ? target.rank - 1
      : target.rank + 1;

  for (
    const fileOffset of [-1, 1]
  ) {
    const pawnFile =
      target.file + fileOffset;

    if (
      pawnFile < 0 ||
      pawnFile > 7
    ) {
      continue;
    }

    const pawnSquare =
      coordsToSquare(
        pawnFile,
        pawnRank
      );

    if (!pawnSquare) continue;

    const piece =
      getBoardPiece(
        chess,
        pawnSquare
      );

    if (
      piece &&
      piece.color === color &&
      piece.type === "p"
    ) {
      result.push(
        pawnSquare
      );
    }
  }

  return result;
}


/* =========================================================
   GAME PHASE
   ========================================================= */

function getGamePhase(chess) {
  const fullmove =
    chess.moveNumber();

  const pieceCounts = {
    q: 0,
    r: 0,
    b: 0,
    n: 0
  };

  for (
    const row of chess.board()
  ) {
    for (const piece of row) {
      if (
        piece &&
        pieceCounts[piece.type] !== undefined
      ) {
        pieceCounts[piece.type]++;
      }
    }
  }

  const queens =
    pieceCounts.q;

  const rooks =
    pieceCounts.r;

  const minors =
    pieceCounts.b +
    pieceCounts.n;

  if (
    fullmove <= 10 &&
    (queens >= 2 || minors >= 6)
  ) {
    return "opening";
  }

  if (
    queens === 0 &&
    rooks <= 2 &&
    minors <= 3
  ) {
    return "endgame";
  }

  return "middlegame";
}


/* =========================================================
   MATERIAL
   ========================================================= */

function analyzeMaterial(chess) {
  const sides = {
    w: {
      p: 0,
      n: 0,
      b: 0,
      r: 0,
      q: 0,
      k: 0
    },
    b: {
      p: 0,
      n: 0,
      b: 0,
      r: 0,
      q: 0,
      k: 0
    }
  };

  for (
    const row of chess.board()
  ) {
    for (const piece of row) {
      if (!piece) continue;

      sides[piece.color][
        piece.type
      ]++;
    }
  }

  for (const color of ["w", "b"]) {
    sides[color].total =
      Object.entries(
        sides[color]
      ).reduce(
        (sum, [type, count]) =>
          sum +
          PIECE_VALUES[type] *
            count,
        0
      );
  }

  const difference =
    sides.w.total -
    sides.b.total;

  let type = "equal";

  if (difference > 0.35) {
    type = "white_advantage";
  } else if (difference < -0.35) {
    type = "black_advantage";
  }

  return {
    white: sides.w,
    black: sides.b,
    difference,
    type,
    relevance: clamp(
      Math.abs(difference) / 5
    )
  };
       }
/* =========================================================
   MINOR PIECES
   ========================================================= */

/*
 * 기물의 기본 활동성을 계산한다.
 *
 * activityScore와 qualityScore를 분리한다.
 *
 * activityScore
 *   → 현재 얼마나 움직일 수 있는가
 *
 * qualityScore
 *   → 그 움직임이 실제로 얼마나 유용한가
 *
 * 둘을 같은 값으로 취급하지 않는다.
 */

function getPieceActivityData(
  chess,
  square,
  color
) {
  const piece =
    getBoardPiece(chess, square);

  if (
    !piece ||
    piece.color !== color ||
    !["n", "b"].includes(
      piece.type
    )
  ) {
    return null;
  }

  const moves =
    getLegalMovesForPiece(
      chess,
      square,
      color
    );

  const safeMoves =
    moves.filter(move =>
      isDestinationSafe(
        chess,
        move,
        color
      )
    );

  const centralMoves =
    moves.filter(move =>
      EXTENDED_CENTER.has(
        move.to
      )
    );

  const safeCentralMoves =
    safeMoves.filter(move =>
      EXTENDED_CENTER.has(
        move.to
      )
    );

  const captures =
    moves.filter(
      move => move.captured
    );

  const safeCaptures =
    safeMoves.filter(
      move => move.captured
    );

  const mobilityScore =
    clamp(
      moves.length / 8
    );

  const safeMobilityScore =
    clamp(
      safeMoves.length / 6
    );

  const centralityScore =
    clamp(
      centralMoves.length / 4
    );

  const safeCentralityScore =
    clamp(
      safeCentralMoves.length / 3
    );

  const captureAccessScore =
    clamp(
      captures.length / 3
    );

  const safeCaptureAccessScore =
    clamp(
      safeCaptures.length / 2
    );

  const activityScore =
    clamp(
      mobilityScore * 0.30 +
      safeMobilityScore * 0.30 +
      centralityScore * 0.15 +
      safeCentralityScore * 0.15 +
      captureAccessScore * 0.05 +
      safeCaptureAccessScore * 0.05
    );

  return {
    square,
    color,
    type: piece.type,

    legalMoves: moves,
    safeMoves,

    mobility: moves.length,
    safeMobility: safeMoves.length,

    centralMoves: centralMoves.length,
    safeCentralMoves:
      safeCentralMoves.length,

    captures: captures.length,
    safeCaptures:
      safeCaptures.length,

    mobilityScore,
    safeMobilityScore,
    centralityScore,
    safeCentralityScore,
    captureAccessScore,
    safeCaptureAccessScore,

    activityScore
  };
}


/* ---------------------------------------------------------
   KNIGHT
   --------------------------------------------------------- */

function isKnightOutpost(
  chess,
  square,
  color
) {
  const coords =
    squareToCoords(square);

  if (!coords) {
    return {
      detected: false,
      durable: false,
      enemyPawnChallenge: false,
      defenders: [],
      explanation: ""
    };
  }

  /*
   * 기본 조건:
   * - 상대 폰에게 공격받지 않는 칸
   * - 자신의 진영보다 상대 진영 쪽에 위치
   *
   * 단순히 중앙에 있다는 이유만으로
   * outpost라고 판정하지 않는다.
   */

  const enemy =
    oppositeColor(color);

  const rank =
    coords.rank + 1;

  const advancedEnough =
    color === "w"
      ? rank >= 5
      : rank <= 4;

  if (!advancedEnough) {
    return {
      detected: false,
      durable: false,
      enemyPawnChallenge: false,
      defenders:
        getAttackersOfSquare(
          chess,
          square,
          color
        ),
      explanation:
        "상대 진영에 충분히 전진한 칸이 아닙니다."
    };
  }

  const enemyPawnDefenders =
    getPawnDefenders(
      chess,
      square,
      enemy
    );

  /*
   * getPawnDefenders는 해당 칸을
   * 공격할 수 있는 상대 폰을 찾는다.
   */
  const enemyPawnChallenge =
    enemyPawnDefenders.length > 0;

  const defenders =
    getAttackersOfSquare(
      chess,
      square,
      color
    );

  const friendlyPawnDefenders =
    getPawnDefenders(
      chess,
      square,
      color
    );

  const detected =
    !enemyPawnChallenge;

  const durable =
    detected &&
    (
      defenders.length >= 1 ||
      friendlyPawnDefenders.length >= 1
    );

  let explanation =
    "나이트가 안정적으로 자리 잡을 수 있는지 확인합니다.";

  if (detected && durable) {
    explanation =
      "상대 폰으로 쫓기기 어렵고 방어도 가능한 나이트 거점 후보입니다.";
  } else if (detected) {
    explanation =
      "상대 폰에게 직접 쫓기지는 않지만 방어 안정성은 더 확인해야 합니다.";
  } else {
    explanation =
      "상대 폰으로 거점을 직접 도전받을 수 있습니다.";
  }

  return {
    detected,
    durable,
    enemyPawnChallenge,
    defenders,
    friendlyPawnDefenders,
    explanation
  };
}


function analyzeKnight(
  chess,
  square,
  color
) {
  const activity =
    getPieceActivityData(
      chess,
      square,
      color
    );

  if (!activity) {
    return null;
  }

  const outpost =
    isKnightOutpost(
      chess,
      square,
      color
    );

  const enemy =
    oppositeColor(color);

  const enemyTargets =
    [];

  for (
    const move of activity.legalMoves
  ) {
    if (!move.to) continue;

    const target =
      getBoardPiece(
        chess,
        move.to
      );

    if (
      target &&
      target.color === enemy
    ) {
      enemyTargets.push({
        square: move.to,
        type: target.type,
        value:
          PIECE_VALUES[target.type]
      });
    }
  }

  const targetAccessScore =
    clamp(
      enemyTargets.length / 3
    );

  const outpostScore =
    outpost.detected
      ? (
          outpost.durable
            ? 1
            : 0.72
        )
      : 0;

  /*
   * 나이트는 중앙성만으로 평가하지 않는다.
   * 실제 이동 가능성과 안정성,
   * 적 기물/폰에 대한 접근을 함께 본다.
   */
  const qualityScore =
    clamp(
      activity.safeMobilityScore * 0.25 +
      activity.safeCentralityScore * 0.15 +
      activity.safeCaptureAccessScore * 0.15 +
      targetAccessScore * 0.20 +
      outpostScore * 0.25
    );

  const practicalScore =
    clamp(
      qualityScore * 0.65 +
      activity.activityScore * 0.35
    );

  return {
    square,
    color,
    type: "n",

    activityScore:
      activity.activityScore,

    qualityScore,
    practicalScore,

    mobility:
      activity.mobility,

    safeMobility:
      activity.safeMobility,

    centralMoves:
      activity.centralMoves,

    safeCentralMoves:
      activity.safeCentralMoves,

    targetAccess:
      enemyTargets,

    targetAccessScore,

    outpost,

    evidence: {
      mobility:
        activity.mobility,
      safeMobility:
        activity.safeMobility,
      centralMoves:
        activity.centralMoves,
      targetAccess:
        enemyTargets.length,
      outpost:
        outpost.detected,
      durableOutpost:
        outpost.durable
    }
  };
}


/* ---------------------------------------------------------
   BISHOP
   --------------------------------------------------------- */

function getBishopDiagonalData(
  chess,
  square,
  color
) {
  const coords =
    squareToCoords(square);

  if (!coords) {
    return {
      totalRaySquares: 0,
      openRaySquares: 0,
      usefulRaySquares: 0,
      blockedDirections: 0,
      longDiagonalAccess: 0
    };
  }

  const directions = [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1]
  ];

  let totalRaySquares = 0;
  let openRaySquares = 0;
  let usefulRaySquares = 0;
  let blockedDirections = 0;
  let longDiagonalAccess = 0;

  for (
    const [df, dr] of directions
  ) {
    let file =
      coords.file + df;

    let rank =
      coords.rank + dr;

    let directionLength = 0;
    let directionOpen = true;

    while (
      file >= 0 &&
      file <= 7 &&
      rank >= 0 &&
      rank <= 7
    ) {
      directionLength++;

      const target =
        coordsToSquare(
          file,
          rank
        );

      if (!target) break;

      const targetPiece =
        getBoardPiece(
          chess,
          target
        );

      totalRaySquares++;

      if (!targetPiece) {
        openRaySquares++;

        if (
          CENTER_SQUARES.has(
            target
          ) ||
          EXTENDED_CENTER.has(
            target
          )
        ) {
          usefulRaySquares++;
        }
      } else {
        directionOpen = false;

        if (
          targetPiece.color !== color
        ) {
          usefulRaySquares++;
        }

        break;
      }

      file += df;
      rank += dr;
    }

    if (!directionOpen) {
      blockedDirections++;
    }

    if (directionLength >= 4) {
      longDiagonalAccess++;
    }
  }

  return {
    totalRaySquares,
    openRaySquares,
    usefulRaySquares,
    blockedDirections,
    longDiagonalAccess
  };
}


function analyzeBishop(
  chess,
  square,
  color
) {
  const activity =
    getPieceActivityData(
      chess,
      square,
      color
    );

  if (!activity) {
    return null;
  }

  const diagonal =
    getBishopDiagonalData(
      chess,
      square,
      color
    );

  const enemy =
    oppositeColor(color);

  const enemyTargets =
    [];

  for (
    const move of activity.legalMoves
  ) {
    if (!move.to) continue;

    const target =
      getBoardPiece(
        chess,
        move.to
      );

    if (
      target &&
      target.color === enemy
    ) {
      enemyTargets.push({
        square: move.to,
        type: target.type,
        value:
          PIECE_VALUES[target.type]
      });
    }
  }

  const diagonalScore =
    clamp(
      diagonal.openRaySquares / 10
    );

  const usefulDiagonalScore =
    clamp(
      diagonal.usefulRaySquares / 5
    );

  const longDiagonalScore =
    clamp(
      diagonal.longDiagonalAccess / 2
    );

  const targetAccessScore =
    clamp(
      enemyTargets.length / 3
    );

  /*
   * 비숍은 "비숍이니까 좋은 기물"로 평가하지 않는다.
   *
   * 실제로 열려 있는 대각선,
   * 유용한 대각선,
   * 공격 대상 접근,
   * 안전한 활동성을 함께 본다.
   */
  const qualityScore =
    clamp(
      activity.safeMobilityScore * 0.20 +
      diagonalScore * 0.20 +
      usefulDiagonalScore * 0.20 +
      longDiagonalScore * 0.10 +
      targetAccessScore * 0.20 +
      activity.safeCentralityScore * 0.10
    );

  const practicalScore =
    clamp(
      qualityScore * 0.65 +
      activity.activityScore * 0.35
    );

  return {
    square,
    color,
    type: "b",

    activityScore:
      activity.activityScore,

    qualityScore,
    practicalScore,

    mobility:
      activity.mobility,

    safeMobility:
      activity.safeMobility,

    centralMoves:
      activity.centralMoves,

    safeCentralMoves:
      activity.safeCentralMoves,

    targetAccess:
      enemyTargets,

    targetAccessScore,

    diagonal,

    evidence: {
      mobility:
        activity.mobility,
      safeMobility:
        activity.safeMobility,
      openRaySquares:
        diagonal.openRaySquares,
      usefulRaySquares:
        diagonal.usefulRaySquares,
      longDiagonalAccess:
        diagonal.longDiagonalAccess,
      targetAccess:
        enemyTargets.length
    }
  };
    }
/* =========================================================
   MINOR PIECE COMPARISON
   ========================================================= */

/*
 * 한쪽의 나이트/비숍 정보를 모은다.
 */
function analyzeMinorPiecesForSide(
  chess,
  color
) {
  const pieces = [];

  for (
    let rank = 1;
    rank <= 8;
    rank++
  ) {
    for (
      let fileIndex = 0;
      fileIndex < 8;
      fileIndex++
    ) {
      const square =
        String.fromCharCode(
          "a".charCodeAt(0) +
            fileIndex
        ) +
        String(rank);

      const piece =
        getBoardPiece(
          chess,
          square
        );

      if (
        !piece ||
        piece.color !== color ||
        !["n", "b"].includes(
          piece.type
        )
      ) {
        continue;
      }

      let analysis = null;

      if (piece.type === "n") {
        analysis =
          analyzeKnight(
            chess,
            square,
            color
          );
      } else {
        analysis =
          analyzeBishop(
            chess,
            square,
            color
          );
      }

      if (analysis) {
        pieces.push(analysis);
      }
    }
  }

  const knights =
    pieces.filter(
      piece =>
        piece.type === "n"
    );

  const bishops =
    pieces.filter(
      piece =>
        piece.type === "b"
    );

  /*
   * 비숍 페어는 그 자체로 "우세 확정"이 아니다.
   *
   * 열린 포지션에서 활용 가능성이 있는 경우
   * 추가적인 긍정 신호로만 사용한다.
   */
  const bishopPair =
    bishops.length >= 2;

  const averageActivity =
    weightedAverage(
      pieces,
      "activityScore"
    );

  const averageQuality =
    weightedAverage(
      pieces,
      "qualityScore"
    );

  const averagePractical =
    weightedAverage(
      pieces,
      "practicalScore"
    );

  const strongest =
    pieces.length
      ? [...pieces].sort(
          (a, b) =>
            b.qualityScore -
            a.qualityScore
        )[0]
      : null;

  const weakest =
    pieces.length
      ? [...pieces].sort(
          (a, b) =>
            a.qualityScore -
            b.qualityScore
        )[0]
      : null;

  return {
    color,

    pieces,
    knights,
    bishops,

    knightCount:
      knights.length,

    bishopCount:
      bishops.length,

    bishopPair,

    averageActivity,
    averageQuality,
    averagePractical,

    strongest,
    weakest
  };
}


/*
 * 서로 다른 종류의 기물을 단순히 평균으로 비교하면
 * 실제 전략적 의미를 놓칠 수 있다.
 *
 * 예:
 * 백 비숍 1개가 매우 강하고
 * 백 나이트 1개가 평범한 경우
 *
 * 흑 나이트 2개가 모두 평범하다고 해서
 * 평균값 하나만으로 판단하지 않는다.
 */
function compareMinorPieces(
  white,
  black
) {
  const whitePieces =
    white.pieces || [];

  const blackPieces =
    black.pieces || [];

  const whiteStrongest =
    white.strongest;

  const blackStrongest =
    black.strongest;

  const whiteWeakest =
    white.weakest;

  const blackWeakest =
    black.weakest;

  const averageDifference =
    white.averageQuality -
    black.averageQuality;

  const practicalDifference =
    white.averagePractical -
    black.averagePractical;

  let strongestDifference = 0;

  if (
    whiteStrongest &&
    blackWeakest
  ) {
    strongestDifference =
      whiteStrongest.qualityScore -
      blackWeakest.qualityScore;
  }

  let weakestDifference = 0;

  if (
    blackStrongest &&
    whiteWeakest
  ) {
    weakestDifference =
      blackStrongest.qualityScore -
      whiteWeakest.qualityScore;
  }

  /*
   * 양쪽 모두 같은 수의 기물이 있는 경우와
   * 기물 수가 다른 경우를 구분한다.
   */
  const equalCount =
    whitePieces.length ===
    blackPieces.length;

  let whiteScore =
    averageDifference * 0.40 +
    practicalDifference * 0.25;

  let blackScore =
    -averageDifference * 0.40 +
    -practicalDifference * 0.25;

  /*
   * 가장 강한 기물과 상대의 가장 약한 기물 사이의
   * 실제 활용 가능성도 반영한다.
   */
  if (
    strongestDifference > 0
  ) {
    whiteScore +=
      clamp(
        strongestDifference
      ) * 0.20;
  } else {
    blackScore +=
      clamp(
        -strongestDifference
      ) * 0.20;
  }

  if (
    weakestDifference > 0
  ) {
    blackScore +=
      clamp(
        weakestDifference
      ) * 0.15;
  } else {
    whiteScore +=
      clamp(
        -weakestDifference
      ) * 0.15;
  }

  /*
   * 비숍 페어는 보조적인 신호.
   * 자동으로 큰 점수를 주지 않는다.
   */
  if (white.bishopPair) {
    whiteScore += 0.05;
  }

  if (black.bishopPair) {
    blackScore += 0.05;
  }

  const difference =
    whiteScore - blackScore;

  let favoredSide = "equal";

  if (difference > 0.12) {
    favoredSide = "w";
  } else if (difference < -0.12) {
    favoredSide = "b";
  }

  const confidence =
    clamp(
      Math.abs(difference) /
      0.8
    );

  /*
   * "우세"가 아니라 "우세 후보".
   *
   * 아직 pawn structure와 space,
   * key squares 등의 관계를 모두 반영하지 않았기 때문이다.
   */
  const status =
    favoredSide === "equal"
      ? "균형 또는 불명확"
      : "우세 후보";

  return {
    favoredSide,
    status,

    confidence,

    whiteScore,
    blackScore,

    averageDifference,
    practicalDifference,

    strongestDifference,
    weakestDifference,

    equalCount,

    explanation:
      buildMinorComparisonExplanation(
        favoredSide,
        white,
        black,
        difference
      )
  };
}


function buildMinorComparisonExplanation(
  favoredSide,
  white,
  black,
  difference
) {
  if (
    favoredSide === "equal"
  ) {
    return (
      "현재 기물의 활동성과 활용 가능성만으로는 한쪽의 명확한 우세를 확정하기 어렵습니다."
    );
  }

  const side =
    favoredSide === "w"
      ? "백"
      : "흑";

  const own =
    favoredSide === "w"
      ? white
      : black;

  const opponent =
    favoredSide === "w"
      ? black
      : white;

  const reasons = [];

  if (
    own.averageQuality >
    opponent.averageQuality +
      0.08
  ) {
    reasons.push(
      "평균적인 기물 활용 가능성이 더 높습니다"
    );
  }

  if (
    own.averagePractical >
    opponent.averagePractical +
      0.08
  ) {
    reasons.push(
      "실전적으로 사용할 수 있는 활동성이 더 높습니다"
    );
  }

  if (
    own.strongest &&
    opponent.weakest &&
    own.strongest.qualityScore >
      opponent.weakest.qualityScore +
        0.10
  ) {
    reasons.push(
      "강한 기물을 실제 약한 상대 기물과 연결해 활용할 가능성이 있습니다"
    );
  }

  if (own.bishopPair) {
    reasons.push(
      "비숍 페어가 추가적인 긍정 신호입니다"
    );
  }

  if (!reasons.length) {
    reasons.push(
      "현재 계산된 활동성과 활용 가능성에서 작은 차이가 있습니다"
    );
  }

  return `${side} 쪽이 ${reasons.join(
    ", "
  )} 때문에 기물 우세 후보를 가집니다.`;
}


/* =========================================================
   MINOR PIECE SIDE ANALYSIS
   ========================================================= */

function analyzeMinorPieces(
  chess
) {
  const white =
    analyzeMinorPiecesForSide(
      chess,
      "w"
    );

  const black =
    analyzeMinorPiecesForSide(
      chess,
      "b"
    );

  const comparison =
    compareMinorPieces(
      white,
      black
    );

  return {
    white,
    black,
    comparison
  };
}


/* =========================================================
   PAWN STRUCTURE HELPERS
   ========================================================= */

function getPawnSquares(
  chess,
  color
) {
  const pawns = [];

  for (
    let rank = 1;
    rank <= 8;
    rank++
  ) {
    for (
      let fileIndex = 0;
      fileIndex < 8;
      fileIndex++
    ) {
      const square =
        String.fromCharCode(
          "a".charCodeAt(0) +
            fileIndex
        ) +
        String(rank);

      const piece =
        getBoardPiece(
          chess,
          square
        );

      if (
        piece &&
        piece.color === color &&
        piece.type === "p"
      ) {
        pawns.push(square);
      }
    }
  }

  return pawns;
}


function groupPawnsByFile(
  pawnSquares
) {
  const files = {};

  for (
    let fileIndex = 0;
    fileIndex < 8;
    fileIndex++
  ) {
    const file =
      String.fromCharCode(
        "a".charCodeAt(0) +
          fileIndex
      );

    files[file] = [];
  }

  for (
    const square of pawnSquares
  ) {
    const file =
      square[0];

    files[file].push(
      square
    );
  }

  for (
    const file of Object.keys(files)
  ) {
    files[file].sort(
      (a, b) =>
        Number(a[1]) -
        Number(b[1])
    );
  }

  return files;
}


function isPawnIsolated(
  pawnSquare,
  pawnFiles
) {
  const fileIndex =
    pawnSquare.charCodeAt(0) -
    "a".charCodeAt(0);

  const adjacentFiles = [];

  if (fileIndex > 0) {
    adjacentFiles.push(
      String.fromCharCode(
        "a".charCodeAt(0) +
          fileIndex -
          1
      )
    );
  }

  if (fileIndex < 7) {
    adjacentFiles.push(
      String.fromCharCode(
        "a".charCodeAt(0) +
          fileIndex +
          1
      )
    );
  }

  return !adjacentFiles.some(
    file =>
      pawnFiles[file]?.length
  );
}


function isPawnDoubled(
  pawnSquare,
  pawnFiles
) {
  const file =
    pawnSquare[0];

  return (
    (pawnFiles[file]?.length || 0) >=
    2
  );
}


/*
 * 같은 색 폰이 대각선으로 연결되어 있는지 확인한다.
 *
 * 방향이 중요하다.
 *
 * 백:
 *   c3 → d4 / b4
 *
 * 흑:
 *   c6 → d5 / b5
 */
function findPawnChainLinks(
  pawnSquares,
  color
) {
  const links = [];

  const set =
    new Set(pawnSquares);

  for (
    const square of pawnSquares
  ) {
    const coords =
      squareToCoords(square);

    if (!coords) continue;

    const direction =
      color === "w"
        ? 1
        : -1;

    for (
      const fileOffset of [-1, 1]
    ) {
      const target =
        coordsToSquare(
          coords.file +
            fileOffset,
          coords.rank +
            direction
        );

      if (
        target &&
        set.has(target)
      ) {
        links.push({
          from: square,
          to: target
        });
      }
    }
  }

  return links;
}


function isPassedPawn(
  chess,
  square,
  color
) {
  const coords =
    squareToCoords(square);

  if (!coords) return false;

  const enemy =
    oppositeColor(color);

  const enemyPawns =
    getPawnSquares(
      chess,
      enemy
    );

  for (
    const enemySquare of enemyPawns
  ) {
    const enemyCoords =
      squareToCoords(
        enemySquare
      );

    if (!enemyCoords) continue;

    if (
      Math.abs(
        enemyCoords.file -
          coords.file
      ) > 1
    ) {
      continue;
    }

    if (color === "w") {
      if (
        enemyCoords.rank >
        coords.rank
      ) {
        return false;
      }
    } else {
      if (
        enemyCoords.rank <
        coords.rank
      ) {
        return false;
      }
    }
  }

  return true;
}


function isProtectedPassedPawn(
  chess,
  square,
  color
) {
  if (
    !isPassedPawn(
      chess,
      square,
      color
    )
  ) {
    return false;
  }

  /*
   * "보호된 passed pawn"은
   * 같은 색 폰이 보호해야 한다.
   *
   * 비숍이나 룩이 보호한다고 해서
   * protected passed pawn으로 부르지 않는다.
   */
  const pawnDefenders =
    getPawnDefenders(
      chess,
      square,
      color
    );

  return (
    pawnDefenders.length > 0
  );
}


/*
 * backward pawn은 완전히 확정하기 어려운 개념이므로
 * 여기서는 "후보"로만 기록한다.
 *
 * 확정적인 전략 판단은 나중에
 * 실제 공격 가능성 / 전진 가능성 / 교환 구조와
 * 함께 평가한다.
 */
function isBackwardPawnCandidate(
  chess,
  square,
  color,
  pawnFiles
) {
  const coords =
    squareToCoords(square);

  if (!coords) return false;

  if (
    isPawnIsolated(
      square,
      pawnFiles
    )
  ) {
    return false;
  }

  const fileIndex =
    coords.file;

  const adjacentFiles = [];

  if (fileIndex > 0) {
    adjacentFiles.push(
      String.fromCharCode(
        "a".charCodeAt(0) +
          fileIndex -
          1
      )
    );
  }

  if (fileIndex < 7) {
    adjacentFiles.push(
      String.fromCharCode(
        "a".charCodeAt(0) +
          fileIndex +
          1
      )
    );
  }

  const direction =
    color === "w"
      ? 1
      : -1;

  const hasMoreAdvancedNeighbor =
    adjacentFiles.some(
      file =>
        pawnFiles[file]?.some(
          pawnSquare => {
            const pawnCoords =
              squareToCoords(
                pawnSquare
              );

            if (!pawnCoords) {
              return false;
            }

            return color === "w"
              ? pawnCoords.rank >
                  coords.rank
              : pawnCoords.rank <
                  coords.rank;
          }
        )
    );

  if (
    !hasMoreAdvancedNeighbor
  ) {
    return false;
  }

  /*
   * 앞 칸이 막혀 있으면
   * backward 후보라는 신호가 조금 강해진다.
   */
  const frontRank =
    coords.rank +
    direction;

  const frontSquare =
    coordsToSquare(
      coords.file,
      frontRank
    );

  const frontPiece =
    frontSquare
      ? getBoardPiece(
          chess,
          frontSquare
        )
      : null;

  return (
    !!frontPiece &&
    frontPiece.color !== color
  );
         }
/* =========================================================
   PAWN STRUCTURE ANALYSIS
   ========================================================= */

function analyzePawnSide(
  chess,
  color
) {
  const pawnSquares =
    getPawnSquares(
      chess,
      color
    );

  const pawnFiles =
    groupPawnsByFile(
      pawnSquares
    );

  const enemy =
    oppositeColor(color);

  const pawns = [];

  for (
    const square of pawnSquares
  ) {
    const coords =
      squareToCoords(square);

    if (!coords) continue;

    const isolated =
      isPawnIsolated(
        square,
        pawnFiles
      );

    const doubled =
      isPawnDoubled(
        square,
        pawnFiles
      );

    const passed =
      isPassedPawn(
        chess,
        square,
        color
      );

    const protectedPassed =
      isProtectedPassedPawn(
        chess,
        square,
        color
      );

    const backwardCandidate =
      isBackwardPawnCandidate(
        chess,
        square,
        color,
        pawnFiles
      );

    const pawnDefenders =
      getPawnDefenders(
        chess,
        square,
        color
      );

    const pawnAttackers =
      getPawnDefenders(
        chess,
        square,
        enemy
      );

    /*
     * 해당 폰 자체가 상대 폰에게
     * 직접 공격받는지 확인한다.
     */
    const attackers =
      getAttackersOfSquare(
        chess,
        square,
        enemy
      );

    const defenders =
      getAttackersOfSquare(
        chess,
        square,
        color
      );

    /*
     * 전진 가능성.
     *
     * 여기서는 "당장 법적으로 한 칸 전진할 수 있는가"를
     * 확인한다.
     *
     * 이것만으로 좋은 폰/나쁜 폰을 확정하지 않는다.
     */
    const legalPawnMoves =
      getLegalMovesForPiece(
        chess,
        square,
        color
      );

    const forwardMoves =
      legalPawnMoves.filter(
        move =>
          !move.captured
      );

    const captureMoves =
      legalPawnMoves.filter(
        move =>
          !!move.captured
      );

    /*
     * 폰이 실제로 상대 폰을 공격하고 있는지도 기록한다.
     */
    const attackedEnemyPawns =
      captureMoves.filter(
        move => {
          const target =
            getBoardPiece(
              chess,
              move.to
            );

          return (
            target &&
            target.color === enemy &&
            target.type === "p"
          );
        }
      );

    const file =
      square[0];

    const rank =
      Number(square[1]);

    /*
     * 폰의 상대 진영 전진 정도.
     * 이것 역시 강함/약함이 아니라
     * 구조적 위치를 표현하기 위한 값이다.
     */
    const advancement =
      color === "w"
        ? clamp(
            (rank - 2) / 5
          )
        : clamp(
            (7 - rank) / 5
          );

    pawns.push({
      square,
      color,

      file,
      rank,

      isolated,
      doubled,

      passed,
      protectedPassed,

      backwardCandidate,

      pawnDefenders,
      pawnAttackers,

      attackers,
      defenders,

      attackerCount:
        attackers.length,

      defenderCount:
        defenders.length,

      legalPawnMoves:
        legalPawnMoves.length,

      forwardMoves:
        forwardMoves.length,

      captureMoves:
        captureMoves.length,

      attackedEnemyPawns:
        attackedEnemyPawns.length,

      advancement
    });
  }

  const chains =
    findPawnChainLinks(
      pawnSquares,
      color
    );

  const passedPawns =
    pawns.filter(
      pawn => pawn.passed
    );

  const protectedPassedPawns =
    pawns.filter(
      pawn =>
        pawn.protectedPassed
    );

  const isolatedPawns =
    pawns.filter(
      pawn =>
        pawn.isolated
    );

  const doubledPawns =
    pawns.filter(
      pawn =>
        pawn.doubled
    );

  const backwardCandidates =
    pawns.filter(
      pawn =>
        pawn.backwardCandidate
    );

  const targets =
    pawns.filter(
      pawn =>
        pawn.attackerCount >
        0
    );

  /*
   * 구조적 사실을 모은다.
   *
   * 여기서는 아직
   * "고립폰 = 약점"
   * "더블폰 = 약점"
   * 같은 최종 결론을 내리지 않는다.
   */
  return {
    color,

    pawnSquares,
    pawnFiles,

    pawns,

    pawnCount:
      pawns.length,

    chains,

    chainCount:
      chains.length,

    passedPawns,

    protectedPassedPawns,

    isolatedPawns,

    doubledPawns,

    backwardCandidates,

    targets,

    structuralFacts: {
      isolatedCount:
        isolatedPawns.length,

      doubledCount:
        doubledPawns.length,

      passedCount:
        passedPawns.length,

      protectedPassedCount:
        protectedPassedPawns.length,

      backwardCandidateCount:
        backwardCandidates.length,

      chainCount:
        chains.length
    }
  };
}


/* =========================================================
   PAWN BREAKS
   ========================================================= */

/*
 * 모든 폰 전진을 "pawn break"라고 부르지 않는다.
 *
 * 여기서는 다음과 같은 경우를 break 후보로 기록한다.
 *
 * 1. 폰이 상대 폰을 직접 잡을 수 있는 경우
 * 2. 폰이 전진함으로써 상대 폰을 새롭게 공격하게 되는 경우
 *
 * 최종적인 전략적 의미는 나중에
 * fixed structure / space / open file과 함께 판단한다.
 */
function findPawnBreaks(
  chess,
  color
) {
  const pawnSquares =
    getPawnSquares(
      chess,
      color
    );

  const enemy =
    oppositeColor(color);

  const breaks = [];

  for (
    const square of pawnSquares
  ) {
    const moves =
      getLegalMovesForPiece(
        chess,
        square,
        color
      );

    for (
      const move of moves
    ) {
      let isBreak =
        false;

      let reason =
        "";

      /*
       * A. 상대 폰을 직접 잡는 경우
       */
      if (
        move.captured
      ) {
        const target =
          getBoardPiece(
            chess,
            move.to
          );

        if (
          target &&
          target.color === enemy &&
          target.type === "p"
        ) {
          isBreak = true;

          reason =
            "상대 폰을 직접 공격/교환하는 pawn break 후보";
        }
      }

      /*
       * B. 전진 후 상대 폰을 공격하게 되는 경우
       */
      if (
        !isBreak &&
        !move.captured
      ) {
        try {
          const testChess =
            createChessForColor(
              chess,
              color
            );

          if (testChess) {
            const executed =
              testChess.move({
                from: move.from,
                to: move.to,
                promotion:
                  move.promotion ||
                  "q"
              });

            if (executed) {
              const newPawn =
                getBoardPiece(
                  testChess,
                  move.to
                );

              if (
                newPawn &&
                newPawn.type === "p" &&
                newPawn.color === color
              ) {
                const coords =
                  squareToCoords(
                    move.to
                  );

                if (coords) {
                  const direction =
                    color === "w"
                      ? 1
                      : -1;

                  for (
                    const fileOffset of [
                      -1,
                      1
                    ]
                  ) {
                    const target =
                      coordsToSquare(
                        coords.file +
                          fileOffset,
                        coords.rank +
                          direction
                      );

                    if (!target) {
                      continue;
                    }

                    const targetPiece =
                      getBoardPiece(
                        testChess,
                        target
                      );

                    if (
                      targetPiece &&
                      targetPiece.color ===
                        enemy &&
                      targetPiece.type === "p"
                    ) {
                      isBreak = true;

                      reason =
                        "전진 후 상대 폰 구조를 직접 압박하는 pawn break 후보";

                      break;
                    }
                  }
                }
              }
            }
          }
        } catch (_) {}
      }

      if (isBreak) {
        breaks.push({
          from: move.from,
          to: move.to,
          color,
          captured:
            move.captured || null,
          reason
        });
      }
    }
  }

  return breaks;
}


/* =========================================================
   PAWN STRUCTURE COMPARISON
   ========================================================= */

function scorePawnStructureFacts(
  sideData
) {
  /*
   * 이 값은 "좋고 나쁨"의 확정 점수가 아니다.
   *
   * 단순히 향후 실질적 약점 평가에 사용할
   * 구조적 신호를 정리하는 내부 휴리스틱이다.
   */

  const passedBonus =
    sideData.passedPawns.length *
    0.18;

  const protectedPassedBonus =
    sideData.protectedPassedPawns.length *
    0.12;

  const isolatedSignal =
    sideData.isolatedPawns.length *
    0.12;

  const doubledSignal =
    sideData.doubledPawns.length *
    0.10;

  const backwardSignal =
    sideData.backwardCandidates.length *
    0.12;

  const chainSignal =
    sideData.chains.length *
    0.05;

  /*
   * 여기서는 좋은/나쁜 점수를 바로 만들지 않고
   * "구조 복잡도" 정도만 기록한다.
   */
  return {
    passedBonus,
    protectedPassedBonus,
    isolatedSignal,
    doubledSignal,
    backwardSignal,
    chainSignal,

    structuralComplexity:
      clamp(
        (
          isolatedSignal +
          doubledSignal +
          backwardSignal +
          chainSignal
        ) / 2
      )
  };
}


function comparePawnStructures(
  white,
  black
) {
  const whiteSignals =
    scorePawnStructureFacts(
      white
    );

  const blackSignals =
    scorePawnStructureFacts(
      black
    );

  /*
   * 중요한 원칙:
   *
   * isolated / doubled / backward가 많다고 해서
   * 바로 그쪽이 불리하다고 결론내리지 않는다.
   *
   * 상대가 실제로 공격할 수 있어야 한다.
   */

  const whitePassed =
    white.passedPawns.length;

  const blackPassed =
    black.passedPawns.length;

  const whiteProtectedPassed =
    white.protectedPassedPawns.length;

  const blackProtectedPassed =
    black.protectedPassedPawns.length;

  const whiteTargets =
    white.targets.length;

  const blackTargets =
    black.targets.length;

  let structuralDirection =
    "unclear";

  if (
    whiteProtectedPassed >
      blackProtectedPassed ||
    (
      whitePassed >
        blackPassed &&
      whiteTargets <=
        blackTargets
    )
  ) {
    structuralDirection = "w";
  } else if (
    blackProtectedPassed >
      whiteProtectedPassed ||
    (
      blackPassed >
        whitePassed &&
      blackTargets <=
        whiteTargets
    )
  ) {
    structuralDirection = "b";
  }

  /*
   * 이것은 매우 보수적인 값이다.
   * 실제 pawn structure 우세는
   * 공격 가능성, 공간, 열린 파일,
   * 기물 배치 등을 추가해야 확정할 수 있다.
   */
  const confidence =
    structuralDirection ===
      "unclear"
      ? 0
      : 0.25;

  return {
    structuralDirection,

    confidence,

    whiteSignals,
    blackSignals,

    whitePassed,
    blackPassed,

    whiteProtectedPassed,
    blackProtectedPassed,

    whiteTargets,
    blackTargets,

    explanation:
      buildPawnComparisonExplanation(
        structuralDirection,
        white,
        black
      )
  };
}


function buildPawnComparisonExplanation(
  direction,
  white,
  black
) {
  if (
    direction ===
    "unclear"
  ) {
    return (
      "현재 폰 구조의 사실만으로는 한쪽의 명확한 구조적 우세를 확정하기 어렵습니다."
    );
  }

  const side =
    direction === "w"
      ? "백"
      : "흑";

  const own =
    direction === "w"
      ? white
      : black;

  const reasons = [];

  if (
    own.protectedPassedPawns
      .length > 0
  ) {
    reasons.push(
      "보호된 패스폰이 있습니다"
    );
  }

  if (
    own.passedPawns.length > 0
  ) {
    reasons.push(
      "패스폰 후보가 있습니다"
    );
  }

  if (
    own.chains.length > 0
  ) {
    reasons.push(
      "폰 연결 구조가 있습니다"
    );
  }

  if (!reasons.length) {
    reasons.push(
      "상대보다 유리할 가능성이 있는 구조적 신호가 있습니다"
    );
  }

  return `${side} 쪽에 ${reasons.join(
    ", "
  )}. 다만 실제 약점 여부는 기물의 공격 가능성과 함께 판단해야 합니다.`;
}


/* =========================================================
   COMPLETE PAWN ANALYSIS
   ========================================================= */

function analyzePawnStructure(
  chess
) {
  const white =
    analyzePawnSide(
      chess,
      "w"
    );

  const black =
    analyzePawnSide(
      chess,
      "b"
    );

  const whiteBreaks =
    findPawnBreaks(
      chess,
      "w"
    );

  const blackBreaks =
    findPawnBreaks(
      chess,
      "b"
    );

  white.pawnBreaks =
    whiteBreaks;

  black.pawnBreaks =
    blackBreaks;

  const comparison =
    comparePawnStructures(
      white,
      black
    );

  return {
    white,
    black,

    comparison,

    breaks: {
      white: whiteBreaks,
      black: blackBreaks
    }
  };
                   }
/* =========================================================
   POSITION SNAPSHOT
   ========================================================= */

/*
 * 현재 포지션에서 관찰할 수 있는 전략적 사실을
 * 하나의 객체로 묶는다.
 *
 * 중요한 원칙:
 *
 * 이 단계에서는
 * "백이 좋다 / 흑이 좋다"를 최종적으로 결정하지 않는다.
 *
 * 사실을 모으고,
 * 나중 단계에서 dominant imbalance와
 * fantasy position을 판단할 수 있도록 구조화한다.
 */

function createPositionSnapshot(
  chess
) {
  const phase =
    getGamePhase(chess);

  const material =
    analyzeMaterial(chess);

  const minorPieces =
    analyzeMinorPieces(chess);

  const pawnStructure =
    analyzePawnStructure(chess);

  return {
    fen: chess.fen(),

    turn: chess.turn(),

    moveNumber:
      chess.moveNumber(),

    phase,

    material,

    minorPieces,

    pawnStructure,

    /*
     * 아래 항목들은 다음 단계에서 확장한다.
     */
    weakSquares: null,

    space: null,

    center: null,

    openFiles: null,

    development: null,

    initiative: null,

    king: null,

    dominantImbalance: null,

    sideOfBoard: null,

    counterplay: null,

    preventivePlan: null,

    fantasyPosition: null,

    candidates: []
  };
}


/* =========================================================
   SNAPSHOT TEXT
   ========================================================= */

function getMaterialText(
  material
) {
  if (!material) {
    return "물질 정보를 계산할 수 없습니다.";
  }

  const difference =
    material.difference;

  if (
    Math.abs(difference) <
    0.35
  ) {
    return "양쪽의 물질은 거의 균형입니다.";
  }

  if (difference > 0) {
    return (
      `백이 약 ${difference.toFixed(
        1
      )}점의 물질적 우세를 가지고 있습니다.`
    );
  }

  return (
    `흑이 약 ${Math.abs(
      difference
    ).toFixed(
      1
    )}점의 물질적 우세를 가지고 있습니다.`
  );
}


function getMinorPieceText(
  minorPieces
) {
  if (!minorPieces) {
    return "기물 활동 정보를 계산할 수 없습니다.";
  }

  const comparison =
    minorPieces.comparison;

  if (
    comparison.favoredSide ===
    "equal"
  ) {
    return (
      "현재 비숍과 나이트의 활동성만으로는 명확한 우세를 확정하기 어렵습니다."
    );
  }

  const side =
    comparison.favoredSide ===
      "w"
      ? "백"
      : "흑";

  const confidence =
    Math.round(
      comparison.confidence *
        100
    );

  return (
    `${side} 쪽의 기물 활용 가능성이 우세 후보입니다. ` +
    `현재 신뢰도는 약 ${confidence}%이며, ` +
    `이는 엔진 점수가 아니라 ChessSense의 구조적 평가입니다.`
  );
}


function getPawnStructureText(
  pawnStructure
) {
  if (!pawnStructure) {
    return "폰 구조 정보를 계산할 수 없습니다.";
  }

  const comparison =
    pawnStructure.comparison;

  const white =
    pawnStructure.white;

  const black =
    pawnStructure.black;

  const facts = [];

  if (
    white.isolatedPawns.length
  ) {
    facts.push(
      `백 고립폰 ${white.isolatedPawns.length}개`
    );
  }

  if (
    black.isolatedPawns.length
  ) {
    facts.push(
      `흑 고립폰 ${black.isolatedPawns.length}개`
    );
  }

  if (
    white.doubledPawns.length
  ) {
    facts.push(
      `백 더블폰 ${white.doubledPawns.length}개`
    );
  }

  if (
    black.doubledPawns.length
  ) {
    facts.push(
      `흑 더블폰 ${black.doubledPawns.length}개`
    );
  }

  if (
    white.passedPawns.length
  ) {
    facts.push(
      `백 패스폰 ${white.passedPawns.length}개`
    );
  }

  if (
    black.passedPawns.length
  ) {
    facts.push(
      `흑 패스폰 ${black.passedPawns.length}개`
    );
  }

  if (
    white.pawnBreaks.length
  ) {
    facts.push(
      `백 pawn break 후보 ${white.pawnBreaks.length}개`
    );
  }

  if (
    black.pawnBreaks.length
  ) {
    facts.push(
      `흑 pawn break 후보 ${black.pawnBreaks.length}개`
    );
  }

  if (!facts.length) {
    return (
      "현재 포지션에서 뚜렷하게 잡히는 주요 폰 구조 신호가 많지 않습니다."
    );
  }

  return (
    facts.join(" · ") +
    "."
  );
}


/* =========================================================
   MINOR PIECE DETAIL TEXT
   ========================================================= */

function describeMinorPiece(
  piece
) {
  const type =
    piece.type === "n"
      ? "나이트"
      : "비숍";

  const details = [];

  details.push(
    `${type} ${piece.square}`
  );

  details.push(
    `이동 ${piece.mobility}`
  );

  details.push(
    `안전한 이동 ${piece.safeMobility}`
  );

  if (
    piece.type === "n" &&
    piece.outpost?.detected
  ) {
    details.push(
      piece.outpost.durable
        ? "안정적 거점 후보"
        : "거점 후보"
    );
  }

  if (
    piece.type === "b"
  ) {
    if (
      piece.diagonal.openRaySquares >
      0
    ) {
      details.push(
        `열린 대각선 ${piece.diagonal.openRaySquares}`
      );
    }

    if (
      piece.diagonal.longDiagonalAccess >
      0
    ) {
      details.push(
        "장거리 대각선 접근 가능"
      );
    }
  }

  if (
    piece.targetAccess?.length
  ) {
    details.push(
      `직접 접근 대상 ${piece.targetAccess.length}`
    );
  }

  return details.join(
    " · "
  );
}


function renderMinorPieceDetails(
  minorPieces
) {
  const lines = [];

  for (
    const color of ["w", "b"]
  ) {
    const data =
      minorPieces[color];

    const name =
      color === "w"
        ? "백"
        : "흑";

    if (!data.pieces.length) {
      lines.push(
        `${name}: 남은 비숍/나이트 없음`
      );
      continue;
    }

    const pieces =
      data.pieces.map(
        describeMinorPiece
      );

    lines.push(
      `${name}: ${pieces.join(
        " / "
      )}`
    );
  }

  return lines;
}


/* =========================================================
   PAWN DETAIL TEXT
   ========================================================= */

function describePawn(
  pawn
) {
  const flags = [];

  if (pawn.isolated) {
    flags.push(
      "고립"
    );
  }

  if (pawn.doubled) {
    flags.push(
      "더블"
    );
  }

  if (pawn.passed) {
    flags.push(
      pawn.protectedPassed
        ? "보호된 패스폰"
        : "패스폰"
    );
  }

  if (
    pawn.backwardCandidate
  ) {
    flags.push(
      "후방 폰 후보"
    );
  }

  if (
    pawn.attackerCount > 0
  ) {
    flags.push(
      `공격 ${pawn.attackerCount}`
    );
  }

  if (
    pawn.defenderCount > 0
  ) {
    flags.push(
      `방어 ${pawn.defenderCount}`
    );
  }

  if (!flags.length) {
    flags.push(
      "특이 구조 없음"
    );
  }

  return `${pawn.square}: ${flags.join(
    ", "
  )}`;
}


function renderPawnDetails(
  pawnStructure
) {
  const lines = [];

  for (
    const color of ["w", "b"]
  ) {
    const data =
      pawnStructure[color];

    const name =
      color === "w"
        ? "백"
        : "흑";

    if (!data.pawns.length) {
      lines.push(
        `${name}: 폰 없음`
      );
      continue;
    }

    const pawnText =
      data.pawns.map(
        describePawn
      );

    lines.push(
      `${name}: ${pawnText.join(
        " / "
      )}`
    );

    if (
      data.pawnBreaks.length
    ) {
      const breaks =
        data.pawnBreaks.map(
          item =>
            `${item.from}-${item.to}`
        );

      lines.push(
        `${name} break 후보: ${breaks.join(
          ", "
        )}`
      );
    }

    if (
      data.chains.length
    ) {
      lines.push(
        `${name} 폰 연결: ${data.chains.length}개`
      );
    }
  }

  return lines;
}


/* =========================================================
   HUMAN FACTOR RENDERING
   ========================================================= */

function renderFactors(
  snapshot
) {
  if (!els.humanFactors) {
    return;
  }

  const materialText =
    getMaterialText(
      snapshot.material
    );

  const minorText =
    getMinorPieceText(
      snapshot.minorPieces
    );

  const pawnText =
    getPawnStructureText(
      snapshot.pawnStructure
    );

  const minorDetails =
    renderMinorPieceDetails(
      snapshot.minorPieces
    );

  const pawnDetails =
    renderPawnDetails(
      snapshot.pawnStructure
    );

  els.humanFactors.innerHTML = `
    <div class="factor">
      <div class="factorTitle">물질</div>
      <div class="factorText">
        ${escapeHtml(materialText)}
      </div>
    </div>

    <div class="factor">
      <div class="factorTitle">기물 활동</div>
      <div class="factorText">
        ${escapeHtml(minorText)}
      </div>

      <div class="factorDetail">
        ${minorDetails
          .map(
            line =>
              `<div>${escapeHtml(
                line
              )}</div>`
          )
          .join("")}
      </div>
    </div>

    <div class="factor">
      <div class="factorTitle">폰 구조</div>
      <div class="factorText">
        ${escapeHtml(pawnText)}
      </div>

      <div class="factorDetail">
        ${pawnDetails
          .map(
            line =>
              `<div>${escapeHtml(
                line
              )}</div>`
          )
          .join("")}
      </div>
    </div>

    <div class="factor">
      <div class="factorTitle">다음 단계</div>
      <div class="factorText">
        현재는 물질·기물 활동·폰 구조를 먼저
        구조적으로 분석합니다.
        공간, 주요 칸, 개발, 주도권은
        다음 분석 단계에서 연결합니다.
      </div>
    </div>
  `;
}


/* =========================================================
   HTML ESCAPE
   ========================================================= */

function escapeHtml(
  value
) {
  return String(
    value ?? ""
  )
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll(
      "'",
      "&#039;"
    );
}


/* =========================================================
   POSITION INSIGHT
   ========================================================= */

function renderPositionInsight(
  snapshot
) {
  if (
    !els.positionInsight
  ) {
    return;
  }

  const side =
    snapshot.turn === "w"
      ? "백"
      : "흑";

  const phaseText =
    snapshot.phase ===
      "opening"
      ? "오프닝"
      : snapshot.phase ===
        "endgame"
        ? "엔드게임"
        : "미들게임";

  const minor =
    snapshot.minorPieces
      ?.comparison;

  const pawn =
    snapshot.pawnStructure
      ?.comparison;

  const observations = [];

  if (
    minor &&
    minor.favoredSide !==
      "equal"
  ) {
    observations.push(
      minor.explanation
    );
  }

  if (
    pawn &&
    pawn.structuralDirection !==
      "unclear"
  ) {
    observations.push(
      pawn.explanation
    );
  }

  if (!observations.length) {
    observations.push(
      "현재 단계에서는 뚜렷한 단일 전략 우세보다 여러 구조적 요소를 함께 확인해야 합니다."
    );
  }

  els.positionInsight.innerHTML = `
    <div class="insightMain">
      ${escapeHtml(
        `${phaseText} · ${side} 차례`
      )}
    </div>

    <div class="insightText">
      ${observations
        .map(
          item =>
            `<div>${escapeHtml(
              item
            )}</div>`
        )
        .join("")}
    </div>

    <div class="insightNote">
      이 설명은 엔진 평가값을 그대로 번역한 것이 아니라
      현재 포지션에서 관찰한 구조적 신호입니다.
    </div>
  `;
     }
/* =========================================================
   BOARD RENDERING
   ========================================================= */

const PIECE_SYMBOLS = {
  w: {
    k: "♔",
    q: "♕",
    r: "♖",
    b: "♗",
    n: "♘",
    p: "♙"
  },
  b: {
    k: "♚",
    q: "♛",
    r: "♜",
    b: "♝",
    n: "♞",
    p: "♟"
  }
};

function renderBoard(
  fen
) {
  if (!els.board) {
    return;
  }

  let chess;

  try {
    chess = new Chess(fen);
  } catch (error) {
    return;
  }

  const board =
    chess.board();

  els.board.innerHTML = "";

  for (
    let row = 0;
    row < 8;
    row++
  ) {
    for (
      let col = 0;
      col < 8;
      col++
    ) {
      const square =
        coordsToSquare(
          col,
          7 - row
        );

      if (!square) continue;

      const piece =
        board[row]?.[col];

      const cell =
        document.createElement(
          "div"
        );

      cell.className =
        `sq ${
          (row + col) % 2 === 0
            ? "light"
            : "dark"
        }`;

      cell.dataset.square =
        square;

      if (piece) {
        cell.textContent =
          PIECE_SYMBOLS[
            piece.color
          ][piece.type];

        cell.classList.add(
          piece.color === "w"
            ? "whitePiece"
            : "blackPiece"
        );
      }

      /*
       * rank / file 표시
       */
      if (col === 0) {
        const rank =
          document.createElement(
            "span"
          );

        rank.className =
          "rankLabel";

        rank.textContent =
          String(8 - row);

        cell.appendChild(
          rank
        );
      }

      if (row === 7) {
        const file =
          document.createElement(
            "span"
          );

        file.className =
          "fileLabel";

        file.textContent =
          String.fromCharCode(
            "a".charCodeAt(0) +
              col
          );

        cell.appendChild(
          file
        );
      }

      els.board.appendChild(
        cell
      );
    }
  }
}


/* =========================================================
   PGN POSITION BUILD
   ========================================================= */

function buildPositions(
  chess
) {
  const history =
    chess.history({
      verbose: true
    });

  const initial =
    new Chess();

  const result = [
    {
      ply: 0,
      fen: initial.fen(),
      move: null
    }
  ];

  for (
    let i = 0;
    i < history.length;
    i++
  ) {
    const move =
      history[i];

    initial.move({
      from: move.from,
      to: move.to,
      promotion:
        move.promotion
    });

    result.push({
      ply: i + 1,
      fen: initial.fen(),
      move
    });
  }

  return result;
}


/* =========================================================
   MOVE LIST
   ========================================================= */

function formatMove(
  move,
  index
) {
  if (!move) {
    return "";
  }

  const moveNumber =
    Math.floor(index / 2) + 1;

  if (index % 2 === 0) {
    return `${moveNumber}. ${move.san}`;
  }

  return `${moveNumber}... ${move.san}`;
}


function renderMoves() {
  if (!els.moveList) {
    return;
  }

  els.moveList.innerHTML = "";

  if (positions.length <= 1) {
    els.moveList.innerHTML =
      `<div class="moveItem">아직 수가 없습니다.</div>`;

    return;
  }

  for (
    let i = 1;
    i < positions.length;
    i++
  ) {
    const position =
      positions[i];

    const item =
      document.createElement(
        "button"
      );

    item.type = "button";

    item.className =
      "moveItem";

    if (
      i === currentPly
    ) {
      item.classList.add(
        "active"
      );
    }

    item.textContent =
      formatMove(
        position.move,
        i - 1
      );

    item.addEventListener(
      "click",
      () => {
        selectPly(i);
      }
    );

    els.moveList.appendChild(
      item
    );
  }
}


/* =========================================================
   POSITION LABELS
   ========================================================= */

function renderPositionLabels(
  ply
) {
  if (els.moveLabel) {
    if (ply === 0) {
      els.moveLabel.textContent =
        "시작 포지션";
    } else {
      const move =
        positions[ply]?.move;

      els.moveLabel.textContent =
        move
          ? `${ply}수 · ${move.san}`
          : `${ply}수`;
    }
  }

  if (els.positionLabel) {
    els.positionLabel.textContent =
      `${ply} / ${
        Math.max(
          0,
          positions.length - 1
        )
      }`;
  }
}


/* =========================================================
   GAME META
   ========================================================= */

function parsePgnHeaders(
  text
) {
  const headers = {};

  const regex =
    /^\s*\[([A-Za-z0-9_]+)\s+"([^"]*)"\]\s*$/gm;

  let match;

  while (
    (match = regex.exec(text))
  ) {
    headers[match[1]] =
      match[2];
  }

  return headers;
}


function renderGameMeta(
  headers
) {
  if (!els.gameMeta) {
    return;
  }

  const event =
    headers.Event ||
    "ChessSense 분석";

  const white =
    headers.White ||
    "White";

  const black =
    headers.Black ||
    "Black";

  const date =
    headers.Date ||
    "";

  els.gameMeta.innerHTML = `
    <div>
      <strong>${escapeHtml(
        event
      )}</strong>
    </div>

    <div>
      ${escapeHtml(
        white
      )}
      -
      ${escapeHtml(
        black
      )}
    </div>

    ${
      date
        ? `<div>${escapeHtml(
            date
          )}</div>`
        : ""
    }
  `;
}


/* =========================================================
   ENGINE CANDIDATE RENDER
   ========================================================= */

function getCandidateDescription(
  line,
  index
) {
  if (!line?.pv?.length) {
    return "계속되는 엔진 계산 수가 없습니다.";
  }

  const firstMove =
    line.pv[0];

  if (index === 0) {
    return (
      "엔진이 현재 포지션에서 가장 높은 평가를 준 수입니다. " +
      "ChessSense의 전략 판단과는 별도로 계산 결과를 표시합니다."
    );
  }

  if (index === 1) {
    return (
      "엔진의 또 다른 주요 후보입니다. " +
      "최선수와 비교해 전략적 차이를 확인할 수 있습니다."
    );
  }

  return (
    "엔진이 계산한 대안 후보입니다. " +
    "단순히 최선수와 같다고 보지 않고 실제 계획과 함께 비교해야 합니다."
  );
}


function renderCandidates(
  result
) {
  if (!els.candidateList) {
    return;
  }

  els.candidateList.innerHTML = "";

  const lines =
    result?.lines || [];

  if (!lines.length) {
    els.candidateList.innerHTML =
      `<div class="candidate">
        분석 결과가 없습니다.
      </div>`;

    return;
  }

  lines.forEach(
    (line, index) => {
      const candidate =
        document.createElement(
          "div"
        );

      candidate.className =
        "candidate";

      const top =
        document.createElement(
          "div"
        );

      top.className =
        "candidateTop";

      const score =
        formatScore(
          line.whiteScore
        );

      const move =
        line.pv?.[0] ||
        "—";

      top.innerHTML = `
        <strong>
          ${escapeHtml(
            move
          )}
        </strong>

        <span>
          ${escapeHtml(
            score
          )}
        </span>
      `;

      const description =
        document.createElement(
          "div"
        );

      description.className =
        "candidateText";

      description.textContent =
        getCandidateDescription(
          line,
          index
        );

      const pv =
        document.createElement(
          "div"
        );

      pv.className =
        "candidatePv";

      pv.textContent =
        line.pv
          ? line.pv
              .slice(0, 8)
              .join(" ")
          : "";

      candidate.appendChild(
        top
      );

      candidate.appendChild(
        description
      );

      if (pv.textContent) {
        candidate.appendChild(
          pv
        );
      }

      els.candidateList.appendChild(
        candidate
      );
    }
  );
}


/* =========================================================
   ENGINE EVALUATION UI
   ========================================================= */

function renderEngineEvaluation(
  result
) {
  if (!result) {
    return;
  }

  const first =
    result.lines?.[0];

  if (els.evalValue) {
    els.evalValue.textContent =
      first
        ? formatScore(
            first.whiteScore
          )
        : "—";
  }

  if (els.depthValue) {
    els.depthValue.textContent =
      String(
        result.depth || "—"
      );
  }

  renderProgress(
    100,
    result.depth || 0
  );

  renderCandidates(
    result
  );
}


/* =========================================================
   HUMAN SUMMARY
   ========================================================= */

function renderSnapshot(
  snapshot
) {
  renderFactors(
    snapshot
  );

  renderPositionInsight(
    snapshot
  );
}


/* =========================================================
   POSITION SELECTION
   ========================================================= */

async function selectPly(
  ply
) {
  if (!positions.length) {
    return;
  }

  const safePly =
    Math.max(
      0,
      Math.min(
        positions.length - 1,
        ply
      )
    );

  currentPly =
    safePly;

  const position =
    positions[currentPly];

  if (!position) {
    return;
  }

  let chess;

  try {
    chess =
      new Chess(
        position.fen
      );
  } catch (error) {
    showError(
      "현재 포지션을 읽을 수 없습니다."
    );
    return;
  }

  clearError();

  renderBoard(
    position.fen
  );

  renderMoves();

  renderPositionLabels(
    currentPly
  );

  const snapshot =
    createPositionSnapshot(
      chess
    );

  renderSnapshot(
    snapshot
  );

  /*
   * 새 포지션을 선택하면 이전 엔진 계산은 취소한다.
   */
  cancelCurrentAnalysis();

  renderProgress(
    0,
    0
  );

  if (els.evalValue) {
    els.evalValue.textContent =
      "분석 중…";
  }

  try {
    await initEngine();

    if (
      currentPly !== safePly
    ) {
      return;
    }

    const result =
      await analyzeFen(
        position.fen,
        10
      );

    if (
      currentPly !== safePly
    ) {
      return;
    }

    renderEngineEvaluation(
      result
    );
  } catch (error) {
    if (
      String(
        error?.message || ""
      ).includes(
        "취소"
      )
    ) {
      return;
    }

    console.error(error);

    if (els.evalValue) {
      els.evalValue.textContent =
        "분석 실패";
    }

    showError(
      `엔진 분석에 실패했습니다: ${
        error?.message ||
        "알 수 없는 오류"
      }`
    );
  }
}


/* =========================================================
   GAME START
   ========================================================= */

async function startGame() {
  clearError();

  const text =
    els.pgnInput?.value?.trim();

  if (!text) {
    showError(
      "PGN을 먼저 입력해주세요."
    );
    return;
  }

  cancelCurrentAnalysis();

  if (els.analyzeBtn) {
    els.analyzeBtn.disabled =
      true;
  }

  try {
    const chess =
      new Chess();

    chess.loadPgn(
      text,
      {
        strict: false
      }
    );

    if (
      chess.history().length ===
      0
    ) {
      throw new Error(
        "PGN에서 수를 찾지 못했습니다."
      );
    }

    positions =
      buildPositions(
        chess
      );

    currentPly = 0;

    currentAnalysis = null;

    const headers =
      parsePgnHeaders(
        text
      );

    renderGameMeta(
      headers
    );

    if (els.inputView) {
      els.inputView.hidden =
        true;
    }

    if (els.analysisView) {
      els.analysisView.hidden =
        false;
    }

    renderMoves();

    await initEngine();

    await selectPly(0);
  } catch (error) {
    console.error(error);

    showError(
      `PGN을 읽지 못했습니다: ${
        error?.message ||
        "형식이 올바르지 않습니다."
      }`
    );
  } finally {
    if (els.analyzeBtn) {
      els.analyzeBtn.disabled =
        false;
    }
  }
}


/* =========================================================
   BACK TO INPUT
   ========================================================= */

function backToInput() {
  cancelCurrentAnalysis();

  positions = [];

  currentPly = 0;

  currentAnalysis = null;

  if (els.analysisView) {
    els.analysisView.hidden =
      true;
  }

  if (els.inputView) {
    els.inputView.hidden =
      false;
  }

  clearError();

  if (els.evalValue) {
    els.evalValue.textContent =
      "—";
  }

  if (els.depthValue) {
    els.depthValue.textContent =
      "—";
  }

  renderProgress(
    0,
    0
  );
}


/* =========================================================
   NAVIGATION BUTTONS
   ========================================================= */

function goFirst() {
  if (!positions.length) {
    return;
  }

  selectPly(0);
}

function goPrevious() {
  if (!positions.length) {
    return;
  }

  selectPly(
    currentPly - 1
  );
}

function goNext() {
  if (!positions.length) {
    return;
  }

  selectPly(
    currentPly + 1
  );
}

function goLast() {
  if (!positions.length) {
    return;
  }

  selectPly(
    positions.length - 1
  );
}


/* =========================================================
   BUTTON EVENTS
   ========================================================= */

if (els.exampleBtn) {
  els.exampleBtn.addEventListener(
    "click",
    () => {
      if (els.pgnInput) {
        els.pgnInput.value =
          EXAMPLE;
      }

      clearError();
    }
  );
}

if (els.analyzeBtn) {
  els.analyzeBtn.addEventListener(
    "click",
    () => {
      startGame();
    }
  );
}

if (els.backBtn) {
  els.backBtn.addEventListener(
    "click",
    () => {
      backToInput();
    }
  );
}

if (els.firstBtn) {
  els.firstBtn.addEventListener(
    "click",
    () => {
      goFirst();
    }
  );
}

if (els.prevBtn) {
  els.prevBtn.addEventListener(
    "click",
    () => {
      goPrevious();
    }
  );
}

if (els.nextBtn) {
  els.nextBtn.addEventListener(
    "click",
    () => {
      goNext();
    }
  );
}

if (els.lastBtn) {
  els.lastBtn.addEventListener(
    "click",
    () => {
      goLast();
    }
  );
}


/* =========================================================
   INITIAL STATE
   ========================================================= */

if (els.analysisView) {
  els.analysisView.hidden =
    true;
}

if (els.inputView) {
  els.inputView.hidden =
    false;
}

if (els.pgnInput) {
  els.pgnInput.value =
    "";
}

setStatus(
  "Stockfish 준비 중…",
  "loading"
);

renderProgress(
  0,
  0
);


/*
 * 앱을 열었을 때 Stockfish를 미리 준비한다.
 *
 * 실패하더라도 페이지 자체가 죽지 않도록
 * catch 처리한다.
 */
initEngine().catch(
  error => {
    console.error(
      "Engine initialization failed:",
      error
    );

    setStatus(
      "Stockfish 준비 실패",
      "error"
    );
  }
);
