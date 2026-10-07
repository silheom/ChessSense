import { Chess } from "https://cdn.jsdelivr.net/npm/chess.js@1.4.0/+esm";


/* =========================================================
   ChessSense
   Human Chess Insight
   =========================================================

   핵심 구조

   1. PGN
   2. 현재 포지션 재구성
   3. 즉각적인 전술 확인
   4. 7가지 불균형 진단
   5. 싸울 지역 판단
   6. 전략적 후보 생성
   7. Stockfish 계산
   8. 사람의 언어로 설명

   Stockfish는 "생각 자체"가 아니라
   계산 / 검증 역할을 담당한다.
   ========================================================= */


/* =========================================================
   DOM
   ========================================================= */

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


/* =========================================================
   EXAMPLE PGN
   ========================================================= */

const EXAMPLE_PGN = `[Event "ChessSense Demo"]
[Site "Local"]
[Date "2026.01.01"]
[Round "1"]
[White "White"]
[Black "Black"]
[Result "*"]

1. e4 e5
2. Nf3 Nc6
3. Bb5 a6
4. Ba4 Nf6
5. O-O Be7
6. Re1 b5
7. Bb3 d6
8. c3 O-O
9. h3 *`;


/* =========================================================
   STOCKFISH
   ========================================================= */

const ENGINE_PATH =
  new URL(
    "stockfish/stockfish-19-lite-single.js",
    import.meta.url
  ).toString();


let engine = null;
let engineReady = false;
let engineInitPromise = null;

let currentAnalysis = null;
let analysisToken = 0;

const analysisCache = new Map();

let positions = [];
let currentPly = 0;


/* =========================================================
   BASIC UTILITIES
   ========================================================= */

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}


function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}


function setStatus(text, type = "loading") {
  if (!els.engineStatus) return;

  els.engineStatus.textContent = text;
  els.engineStatus.className =
    `status ${type}`;
}


function showError(text) {
  if (!els.errorBox) return;

  els.errorBox.textContent = text;
  els.errorBox.hidden = false;
}


function clearError() {
  if (!els.errorBox) return;

  els.errorBox.textContent = "";
  els.errorBox.hidden = true;
}


function setProgress(percent, depth = 0) {
  if (els.progressBar) {
    els.progressBar.style.width =
      `${clamp(percent, 0, 100)}%`;
  }

  if (els.depthValue) {
    els.depthValue.textContent =
      depth ? String(depth) : "—";
  }
}


/* =========================================================
   STOCKFISH INITIALIZATION
   ========================================================= */

function initEngine() {
  if (engineReady && engine) {
    return Promise.resolve();
  }

  if (engineInitPromise) {
    return engineInitPromise;
  }

  engineInitPromise =
    new Promise((resolve, reject) => {

      setStatus(
        "Stockfish 로딩 중…",
        "loading"
      );

      let settled = false;
      let phase = "uci";

      try {
        engine =
          new Worker(ENGINE_PATH);
      } catch (error) {
        engineInitPromise = null;
        reject(
          new Error(
            "Stockfish Worker를 만들지 못했습니다."
          )
        );
        return;
      }


      const timer =
        setTimeout(() => {
          if (settled) return;

          settled = true;

          try {
            engine?.terminate();
          } catch {}

          engine = null;
          engineReady = false;
          engineInitPromise = null;

          reject(
            new Error(
              "Stockfish 로딩 시간이 초과되었습니다."
            )
          );
        }, 30000);


      engine.onerror = event => {
        if (settled) return;

        settled = true;
        clearTimeout(timer);

        engineReady = false;
        engine = null;
        engineInitPromise = null;

        reject(
          new Error(
            event?.message ||
            "Stockfish Worker에서 오류가 발생했습니다."
          )
        );
      };


      engine.onmessage = event => {
        const line =
          typeof event.data === "string"
            ? event.data.trim()
            : "";

        if (!line) return;


        if (
          line === "uciok" &&
          phase === "uci"
        ) {
          phase = "ready";

          engine.postMessage(
            "setoption name MultiPV value 3"
          );

          engine.postMessage(
            "isready"
          );

          return;
        }


        if (
          line === "readyok" &&
          phase === "ready"
        ) {
          settled = true;

          clearTimeout(timer);

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
    })
    .catch(error => {
      engineReady = false;
      engineInitPromise = null;

      setStatus(
        "Stockfish 준비 실패",
        "error"
      );

      throw error;
    });

  return engineInitPromise;
}


/* =========================================================
   STOCKFISH SCORE
   ========================================================= */

function parseScore(tokens) {
  const index =
    tokens.indexOf("score");

  if (index < 0) return null;

  const type =
    tokens[index + 1];

  const raw =
    Number(tokens[index + 2]);

  if (!type || Number.isNaN(raw)) {
    return null;
  }

  if (
    type !== "cp" &&
    type !== "mate"
  ) {
    return null;
  }

  return {
    type,
    raw
  };
}


function scoreFromSideToMove(score, turn) {
  if (!score) return null;

  if (score.type === "cp") {
    const value =
      score.raw / 100;

    return turn === "w"
      ? value
      : -value;
  }

  if (score.type === "mate") {
    const sign =
      score.raw > 0 ? 1 : -1;

    return turn === "w"
      ? sign * 100
      : -sign * 100;
  }

  return null;
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
    return value > 0
      ? "+M"
      : "−M";
  }

  return (
    value >= 0 ? "+" : "−"
  ) +
  Math.abs(value).toFixed(1);
}


function scoreLabel(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return "평가를 계산하는 중입니다.";
  }

  const abs =
    Math.abs(value);

  if (abs < 0.25) {
    return "균형에 가까운 포지션입니다.";
  }

  if (abs < 0.8) {
    return value > 0
      ? "백이 조금 더 편한 포지션입니다."
      : "흑이 조금 더 편한 포지션입니다.";
  }

  if (abs < 1.8) {
    return value > 0
      ? "백에게 뚜렷한 실전적 우세가 있습니다."
      : "흑에게 뚜렷한 실전적 우세가 있습니다.";
  }

  if (abs < 3.5) {
    return value > 0
      ? "백의 우세가 상당합니다."
      : "흑의 우세가 상당합니다.";
  }

  return value > 0
    ? "백 쪽으로 크게 기울었습니다."
    : "흑 쪽으로 크게 기울었습니다.";
}


/* =========================================================
   STOCKFISH ANALYSIS
   ========================================================= */

function cancelCurrentAnalysis() {
  if (!currentAnalysis) {
    return;
  }

  const old =
    currentAnalysis;

  currentAnalysis = null;

  clearTimeout(
    old.timeout
  );

  if (engineReady && engine) {
    try {
      engine.postMessage("stop");
    } catch {}
  }
}


function analyzeFen(
  fen,
  depth = 10
) {
  if (analysisCache.has(fen)) {
    return Promise.resolve(
      analysisCache.get(fen)
    );
  }

  if (!engineReady || !engine) {
    return Promise.reject(
      new Error(
        "Stockfish가 아직 준비되지 않았습니다."
      )
    );
  }

  cancelCurrentAnalysis();

  return new Promise(
    (resolve, reject) => {

      const token =
        ++analysisToken;

      const turn =
        fen.split(" ")[1];

      const result = {
        fen,
        turn,
        depth: 0,
        lines: []
      };


      const timeout =
        setTimeout(() => {

          if (
            currentAnalysis?.token !== token
          ) {
            return;
          }

          currentAnalysis = null;

          reject(
            new Error(
              "엔진 분석 시간이 초과되었습니다."
            )
          );

        }, 45000);


      currentAnalysis = {

        token,

        timeout,

        onLine(line) {

          if (
            currentAnalysis?.token !== token
          ) {
            return;
          }


          if (
            line.startsWith("info ") &&
            line.includes(" pv ")
          ) {

            const tokens =
              line.split(/\s+/);

            const depthIndex =
              tokens.indexOf("depth");

            const multiPvIndex =
              tokens.indexOf("multipv");

            const pvIndex =
              tokens.indexOf("pv");


            const d =
              depthIndex >= 0
                ? Number(
                    tokens[
                      depthIndex + 1
                    ]
                  )
                : 0;


            const multiPv =
              multiPvIndex >= 0
                ? Number(
                    tokens[
                      multiPvIndex + 1
                    ]
                  )
                : 1;


            const parsed =
              parseScore(tokens);


            const score =
              scoreFromSideToMove(
                parsed,
                turn
              );


            const pv =
              pvIndex >= 0
                ? tokens.slice(
                    pvIndex + 1
                  )
                : [];


            result.depth =
              Math.max(
                result.depth,
                d
              );


            if (
              score !== null &&
              pv.length
            ) {

              const existing =
                result.lines.find(
                  line =>
                    line.index === multiPv
                );


              const item = {
                index: multiPv,
                score,
                pv
              };


              if (existing) {
                Object.assign(
                  existing,
                  item
                );
              } else {
                result.lines.push(
                  item
                );
              }
            }


            if (d > 0) {
              setProgress(
                Math.min(
                  95,
                  d / depth * 100
                ),
                d
              );
            }
          }


          if (
            line.startsWith("bestmove")
          ) {

            clearTimeout(timeout);

            currentAnalysis = null;

            result.lines.sort(
              (a, b) =>
                a.index - b.index
            );

            analysisCache.set(
              fen,
              result
            );

            setProgress(
              100,
              result.depth
            );

            resolve(result);
          }
        }
      };


      try {
        engine.postMessage(
          "position fen " + fen
        );

        engine.postMessage(
          `go depth ${depth}`
        );

      } catch (error) {

        clearTimeout(timeout);

        currentAnalysis = null;

        reject(error);
      }
    }
  );
}


/* =========================================================
   PGN / POSITION HISTORY
   ========================================================= */

function parsePgnHeaders(text) {
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


function buildPositions(chess) {
  const list = [];

  const replay =
    new Chess();


  list.push({
    ply: 0,
    fen: replay.fen(),
    san: null,
    uci: null
  });


  const history =
    chess.history({
      verbose: true
    });


  history.forEach(
    (move, index) => {

      const made =
        replay.move({
          from: move.from,
          to: move.to,
          promotion:
            move.promotion
        });


      list.push({
        ply: index + 1,
        fen: replay.fen(),
        san: made.san,
        uci:
          `${made.from}${made.to}${made.promotion || ""}`
      });
    }
  );


  return list;
}


/* =========================================================
   BOARD
   ========================================================= */

const PIECES = {
  w: {
    p: "♙",
    n: "♘",
    b: "♗",
    r: "♖",
    q: "♕",
    k: "♔"
  },

  b: {
    p: "♟",
    n: "♞",
    b: "♝",
    r: "♜",
    q: "♛",
    k: "♚"
  }
};


function renderBoard(fen) {
  const chess =
    new Chess(fen);

  const board =
    chess.board();


  els.board.innerHTML = "";


  board.forEach(
    (row, rowIndex) => {

      row.forEach(
        (piece, colIndex) => {

          const square =
            document.createElement(
              "div"
            );


          square.className =
            `sq ${
              (rowIndex + colIndex) % 2 === 0
                ? "light"
                : "dark"
            }`;


          if (piece) {
            square.textContent =
              PIECES[
                piece.color
              ][piece.type];
          }


          els.board.appendChild(
            square
          );
        }
      );
    }
  );
}


/* =========================================================
   MOVE LIST
   ========================================================= */

function renderMoves() {
  els.moveList.innerHTML = "";


  positions.forEach(
    (position, index) => {

      if (index === 0) {
        return;
      }


      const button =
        document.createElement(
          "button"
        );


      button.type = "button";


      button.className =
        "moveItem";


      if (
        index === currentPly
      ) {
        button.classList.add(
          "active"
        );
      }


      const moveNumber =
        Math.ceil(index / 2);


      const prefix =
        index % 2 === 1
          ? `${moveNumber}.`
          : `${moveNumber}...`;


      button.textContent =
        `${prefix} ${position.san}`;


      button.addEventListener(
        "click",
        () => {
          selectPly(index);
        }
      );


      els.moveList.appendChild(
        button
      );
    }
  );
}


/* =========================================================
   GAME META
   ========================================================= */

function renderGameMeta(headers) {
  const white =
    headers.White || "White";

  const black =
    headers.Black || "Black";

  const event =
    headers.Event || "Chess Game";

  els.gameMeta.textContent =
    `${white} vs ${black} · ${event}`;
}


/* =========================================================
   MATERIAL
   ========================================================= */

const PIECE_VALUES = {
  p: 1,
  n: 3.2,
  b: 3.3,
  r: 5,
  q: 9,
  k: 0
};


function countMaterial(chess) {
  const result = {
    white: {
      p: 0,
      n: 0,
      b: 0,
      r: 0,
      q: 0,
      total: 0
    },

    black: {
      p: 0,
      n: 0,
      b: 0,
      r: 0,
      q: 0,
      total: 0
    }
  };


  const board =
    chess.board();


  board.forEach(
    row => {
      row.forEach(
        piece => {

          if (!piece) return;

          if (
            piece.type === "k"
          ) {
            return;
          }

          const side =
            piece.color === "w"
              ? result.white
              : result.black;


          side[piece.type]++;

          side.total +=
            PIECE_VALUES[
              piece.type
            ];
        }
      );
    }
  );


  result.white.total =
    Number(
      result.white.total.toFixed(1)
    );

  result.black.total =
    Number(
      result.black.total.toFixed(1)
    );

  result.difference =
    Number(
      (
        result.white.total -
        result.black.total
      ).toFixed(1)
    );


  return result;
}


/* =========================================================
   GAME PHASE
   ========================================================= */

function getGamePhase(chess) {
  const material =
    countMaterial(chess);

  const pieces =
    material.white.n +
    material.white.b +
    material.white.r +
    material.white.q +
    material.black.n +
    material.black.b +
    material.black.r +
    material.black.q;


  if (pieces >= 12) {
    return "opening";
  }

  if (pieces >= 7) {
    return "middlegame";
  }

  return "endgame";
}


function getPhaseName(phase) {
  if (phase === "opening") {
    return "오프닝";
  }

  if (phase === "middlegame") {
    return "미들게임";
  }

  return "엔드게임";
}


/* =========================================================
   BOARD HELPERS
   ========================================================= */

function boardPieces(chess) {
  const pieces = [];

  chess.board().forEach(
    row => {
      row.forEach(
        piece => {
          if (piece) {
            pieces.push(piece);
          }
        }
      );
    }
  );

  return pieces;
}


function piecesOf(
  chess,
  color,
  type = null
) {
  return boardPieces(chess)
    .filter(
      piece =>
        piece.color === color &&
        (!type || piece.type === type)
    );
}


function squareName(row, col) {
  return (
    "abcdefgh"[col] +
    (8 - row)
  );
}


function squareCoords(square) {
  return {
    col:
      "abcdefgh".indexOf(
        square[0]
      ),

    row:
      8 - Number(square[1])
  };
}


function insideBoard(row, col) {
  return (
    row >= 0 &&
    row < 8 &&
    col >= 0 &&
    col < 8
  );
}


/* =========================================================
   LEGAL MOVES FOR ANY PIECE
   ========================================================= */

function chessWithTurn(
  fen,
  color
) {
  const parts =
    fen.split(" ");

  parts[1] =
    color;

  return new Chess(
    parts.join(" ")
  );
}


function legalMovesForPiece(
  chess,
  square
) {
  const piece =
    chess.get(square);

  if (!piece) {
    return [];
  }


  const temp =
    chessWithTurn(
      chess.fen(),
      piece.color
    );


  try {
    return temp.moves({
      square,
      verbose: true
    });
  } catch {
    return [];
  }
}


/* =========================================================
   ATTACK DETECTION
   ========================================================= */

function attacksSquare(
  chess,
  from,
  target
) {
  const piece =
    chess.get(from);

  if (!piece) {
    return false;
  }


  const { row, col } =
    squareCoords(from);

  const targetCoords =
    squareCoords(target);


  const tr =
    targetCoords.row;

  const tc =
    targetCoords.col;


  const dr =
    tr - row;

  const dc =
    tc - col;


  if (piece.type === "p") {

    const direction =
      piece.color === "w"
        ? -1
        : 1;

    return (
      dr === direction &&
      Math.abs(dc) === 1
    );
  }


  if (piece.type === "n") {
    return (
      (Math.abs(dr) === 2 &&
        Math.abs(dc) === 1) ||
      (Math.abs(dr) === 1 &&
        Math.abs(dc) === 2)
    );
  }


  if (piece.type === "k") {
    return (
      Math.max(
        Math.abs(dr),
        Math.abs(dc)
      ) === 1
    );
  }


  const diagonal =
    Math.abs(dr) ===
    Math.abs(dc);

  const straight =
    dr === 0 ||
    dc === 0;


  if (
    piece.type === "b" &&
    !diagonal
  ) {
    return false;
  }


  if (
    piece.type === "r" &&
    !straight
  ) {
    return false;
  }


  if (
    piece.type === "q" &&
    !diagonal &&
    !straight
  ) {
    return false;
  }


  const stepRow =
    Math.sign(dr);

  const stepCol =
    Math.sign(dc);


  let r =
    row + stepRow;

  let c =
    col + stepCol;


  while (
    r !== tr ||
    c !== tc
  ) {

    if (
      !insideBoard(r, c)
    ) {
      return false;
    }


    if (
      chess.get(
        squareName(r, c)
      )
    ) {
      return false;
    }


    r += stepRow;
    c += stepCol;
  }


  return true;
}


function attackersOf(
  chess,
  target,
  color
) {
  return boardPieces(chess)
    .filter(
      piece =>
        piece.color === color &&
        attacksSquare(
          chess,
          piece.square,
          target
        )
    );
}


/* =========================================================
   MINOR PIECES
   ========================================================= */

function centralityScore(square) {
  const { row, col } =
    squareCoords(square);

  const distance =
    Math.abs(3.5 - row) +
    Math.abs(3.5 - col);

  return clamp(
    1 -
      distance / 7,
    0,
    1
  );
}


function analyzeMinorPiece(
  chess,
  piece
) {
  const moves =
    legalMovesForPiece(
      chess,
      piece.square
    );


  const mobility =
    moves.length;


  const safeMoves =
    moves.filter(
      move => {

        const target =
          move.to;

        const enemyAttackers =
          attackersOf(
            chess,
            target,
            piece.color === "w"
              ? "b"
              : "w"
          );


        return (
          enemyAttackers.length === 0
        );
      }
    );


  const centrality =
    centralityScore(
      piece.square
    );


  let activity =
    clamp(
      mobility / 10,
      0,
      1
    );


  activity =
    activity * 0.55 +
    clamp(
      safeMoves.length / 8,
      0,
      1
    ) * 0.25 +
    centrality * 0.20;


  let notes = [];


  if (mobility <= 2) {
    notes.push(
      "이동 가능한 칸이 적습니다."
    );
  } else if (mobility >= 6) {
    notes.push(
      "여러 방향으로 활동할 수 있습니다."
    );
  }


  if (
    piece.type === "n" &&
    centrality > 0.7
  ) {
    notes.push(
      "중앙에 가까운 위치입니다."
    );
  }


  if (
    piece.type === "b" &&
    mobility >= 5
  ) {
    notes.push(
      "긴 대각선 활용 가능성이 있습니다."
    );
  }


  return {
    square: piece.square,
    type: piece.type,
    color: piece.color,
    mobility,
    safeMobility:
      safeMoves.length,
    centrality,
    activity:
      Number(activity.toFixed(2)),
    notes
  };
}


function analyzeMinorPieces(chess) {
  const result = {
    white: [],
    black: [],
    comparison: null
  };


  ["w", "b"].forEach(
    color => {

      result[
        color === "w"
          ? "white"
          : "black"
      ] =
        piecesOf(
          chess,
          color
        )
        .filter(
          piece =>
            piece.type === "n" ||
            piece.type === "b"
        )
        .map(
          piece =>
            analyzeMinorPiece(
              chess,
              piece
            )
        );
    }
  );


  const whiteAverage =
    result.white.length
      ? result.white.reduce(
          (sum, p) =>
            sum + p.activity,
          0
        ) /
        result.white.length
      : 0;


  const blackAverage =
    result.black.length
      ? result.black.reduce(
          (sum, p) =>
            sum + p.activity,
          0
        ) /
        result.black.length
      : 0;


  result.whiteAverage =
    Number(
      whiteAverage.toFixed(2)
    );

  result.blackAverage =
    Number(
      blackAverage.toFixed(2)
    );


  result.difference =
    Number(
      (
        whiteAverage -
        blackAverage
      ).toFixed(2)
    );


  return result;
}


/* =========================================================
   PAWN STRUCTURE
   ========================================================= */

function analyzePawnStructure(
  chess,
  color
) {
  const pawns =
    piecesOf(
      chess,
      color,
      "p"
    );


  const enemy =
    color === "w"
      ? "b"
      : "w";


  const files =
    Array.from(
      { length: 8 },
      () => []
    );


  pawns.forEach(
    pawn => {
      const file =
        "abcdefgh".indexOf(
          pawn.square[0]
        );

      files[file].push(
        pawn
      );
    }
  );


  const isolated = [];
  const doubled = [];
  const passed = [];
  const backward = [];


  pawns.forEach(
    pawn => {

      const file =
        "abcdefgh".indexOf(
          pawn.square[0]
        );


      if (
        files[file].length > 1
      ) {
        doubled.push(
          pawn.square
        );
      }


      const adjacentFiles =
        [];


      if (file > 0) {
        adjacentFiles.push(
          file - 1
        );
      }


      if (file < 7) {
        adjacentFiles.push(
          file + 1
        );
      }


      const hasNeighbor =
        adjacentFiles.some(
          f =>
            files[f].length > 0
        );


      if (!hasNeighbor) {
        isolated.push(
          pawn.square
        );
      }


      const rank =
        Number(
          pawn.square[1]
        );


      const enemyPawns =
        piecesOf(
          chess,
          enemy,
          "p"
        );


      const blockedByEnemy =
        enemyPawns.some(
          ep => {

            const epFile =
              "abcdefgh".indexOf(
                ep.square[0]
              );

            const epRank =
              Number(
                ep.square[1]
              );

            return (
              Math.abs(
                epFile - file
              ) <= 1 &&
              (
                color === "w"
                  ? epRank > rank
                  : epRank < rank
              )
            );
          }
        );


      if (!blockedByEnemy) {
        passed.push(
          pawn.square
        );
      }
    }
  );


  /*
   * 후방폰은 매우 엄격하게 판단하지 않는다.
   * 주변 폰보다 뒤에 있으면서 전진이 제한된 경우를
   * 후보로 잡는다.
   */

  pawns.forEach(
    pawn => {

      const file =
        "abcdefgh".indexOf(
          pawn.square[0]
        );


      const rank =
        Number(
          pawn.square[1]
        );


      const neighbors =
        [];


      if (file > 0) {
        neighbors.push(
          ...files[file - 1]
        );
      }


      if (file < 7) {
        neighbors.push(
          ...files[file + 1]
        );
      }


      if (!neighbors.length) {
        return;
      }


      const aheadNeighbor =
        neighbors.some(
          other => {

            const otherRank =
              Number(
                other.square[1]
              );

            return color === "w"
              ? otherRank > rank
              : otherRank < rank;
          }
        );


      const canMove =
        legalMovesForPiece(
          chess,
          pawn.square
        ).some(
          move =>
            move.to !== pawn.square
        );


      if (
        !aheadNeighbor &&
        !canMove
      ) {
        backward.push(
          pawn.square
        );
      }
    }
  );


  const weakness =
    isolated.length * 0.7 +
    doubled.length * 0.35 +
    backward.length * 0.8;


  return {
    pawns: pawns.map(
      pawn => pawn.square
    ),

    isolated,

    doubled,

    passed,

    backward,

    weakness:
      Number(
        clamp(
          weakness / 4,
          0,
          1
        ).toFixed(2)
      )
  };
}


/* =========================================================
   SPACE
   ========================================================= */

function analyzeSpace(
  chess,
  color
) {
  const enemy =
    color === "w"
      ? "b"
      : "w";


  let controlled = 0;
  let enemyRestricted = 0;


  const enemyPieces =
    piecesOf(
      chess,
      enemy
    );


  enemyPieces.forEach(
    piece => {

      const moves =
        legalMovesForPiece(
          chess,
          piece.square
        );


      if (
        moves.length <= 3
      ) {
        enemyRestricted++;
      }
    }
  );


  boardPieces(chess)
    .filter(
      piece =>
        piece.color === color
    )
    .forEach(
      piece => {

        controlled +=
          legalMovesForPiece(
            chess,
            piece.square
          ).length;
      }
    );


  return {
    controlled,
    restricted:
      enemyRestricted,

    score:
      Number(
        clamp(
          (
            controlled / 45 +
            enemyRestricted / 8
          ) / 2,
          0,
          1
        ).toFixed(2)
      )
  };
}


/* =========================================================
   FILES
   ========================================================= */

function analyzeFiles(chess) {
  const result = [];


  for (
    let file = 0;
    file < 8;
    file++
  ) {

    const letter =
      "abcdefgh"[file];


    const whitePawns =
      piecesOf(
        chess,
        "w",
        "p"
      ).filter(
        pawn =>
          pawn.square[0] ===
          letter
      );


    const blackPawns =
      piecesOf(
        chess,
        "b",
        "p"
      ).filter(
        pawn =>
          pawn.square[0] ===
          letter
      );


    let type =
      "closed";


    if (
      whitePawns.length === 0 &&
      blackPawns.length === 0
    ) {
      type = "open";
    } else if (
      whitePawns.length === 0 ||
      blackPawns.length === 0
    ) {
      type = "semi-open";
    }


    const rooksWhite =
      piecesOf(
        chess,
        "w",
        "r"
      ).filter(
        rook =>
          rook.square[0] ===
          letter
      );


    const rooksBlack =
      piecesOf(
        chess,
        "b",
        "r"
      ).filter(
        rook =>
          rook.square[0] ===
          letter
      );


    result.push({
      file: letter,
      type,
      whitePawns:
        whitePawns.length,
      blackPawns:
        blackPawns.length,
      whiteRooks:
        rooksWhite.length,
      blackRooks:
        rooksBlack.length
    });
  }


  return result;
}


/* =========================================================
   DEVELOPMENT
   ========================================================= */

function analyzeDevelopment(
  chess,
  color
) {
  const pieces =
    piecesOf(
      chess,
      color
    )
    .filter(
      piece =>
        piece.type !== "p" &&
        piece.type !== "k"
    );


  let developed = 0;
  let active = 0;


  pieces.forEach(
    piece => {

      const home =
        color === "w"
          ? (
              piece.type === "n"
                ? ["b1", "g1"]
                : piece.type === "b"
                  ? ["c1", "f1"]
                  : piece.type === "q"
                    ? ["d1"]
                    : piece.type === "r"
                      ? ["a1", "h1"]
                      : []
            )
          : (
              piece.type === "n"
                ? ["b8", "g8"]
                : piece.type === "b"
                  ? ["c8", "f8"]
                  : piece.type === "q"
                    ? ["d8"]
                    : piece.type === "r"
                      ? ["a8", "h8"]
                      : []
            );


      if (
        !home.includes(
          piece.square
        )
      ) {
        developed++;
      }


      const mobility =
        legalMovesForPiece(
          chess,
          piece.square
        ).length;


      if (
        mobility >= 3
      ) {
        active++;
      }
    }
  );


  return {
    developed,
    active,

    score:
      Number(
        (
          developed * 0.08 +
          active * 0.05
        ).toFixed(2)
      )
  };
}


/* =========================================================
   INITIATIVE
   ========================================================= */

function analyzeInitiative(
  chess,
  color
) {
  const enemy =
    color === "w"
      ? "b"
      : "w";


  let forcing = 0;
  let attacks = 0;


  const ownPieces =
    piecesOf(
      chess,
      color
    );


  ownPieces.forEach(
    piece => {

      const moves =
        legalMovesForPiece(
          chess,
          piece.square
        );


      moves.forEach(
        move => {

          if (
            move.captured
          ) {
            attacks++;
          }
        }
      );
    }
  );


  const enemyKing =
    piecesOf(
      chess,
      enemy,
      "k"
    )[0];


  if (enemyKing) {

    const kingSquare =
      enemyKing.square;


    ownPieces.forEach(
      piece => {

        if (
          attacksSquare(
            chess,
            piece.square,
            kingSquare
          )
        ) {
          forcing++;
        }
      }
    );
  }


  return {
    forcing,
    attacks,

    score:
      Number(
        clamp(
          (
            forcing * 0.25 +
            attacks * 0.05
          ),
          0,
          1
        ).toFixed(2)
      )
  };
}


/* =========================================================
   KING SAFETY
   ========================================================= */

function analyzeKingSafety(
  chess,
  color
) {
  const king =
    piecesOf(
      chess,
      color,
      "k"
    )[0];


  if (!king) {
    return {
      score: 0
    };
  }


  const enemy =
    color === "w"
      ? "b"
      : "w";


  const { row, col } =
    squareCoords(
      king.square
    );


  let attackedSquares = 0;


  for (
    let r = row - 1;
    r <= row + 1;
    r++
  ) {

    for (
      let c = col - 1;
      c <= col + 1;
      c++
    ) {

      if (
        !insideBoard(r, c)
      ) {
        continue;
      }


      const square =
        squareName(r, c);


      if (
        attackersOf(
          chess,
          square,
          enemy
        ).length
      ) {
        attackedSquares++;
      }
    }
  }


  return {
    kingSquare:
      king.square,

    attackedSquares,

    score:
      Number(
        clamp(
          attackedSquares / 8,
          0,
          1
        ).toFixed(2)
      )
  };
}


/* =========================================================
   KEY SQUARES
   ========================================================= */

function analyzeKeySquares(
  chess
) {
  const squares = [
    "d4",
    "e4",
    "d5",
    "e5",
    "c4",
    "f4",
    "c5",
    "f5"
  ];


  return squares.map(
    square => {

      const white =
        attackersOf(
          chess,
          square,
          "w"
        ).length;


      const black =
        attackersOf(
          chess,
          square,
          "b"
        ).length;


      const occupant =
        chess.get(square);


      return {
        square,
        white,
        black,

        occupiedBy:
          occupant
            ? occupant.color
            : null,

        difference:
          white - black
      };
    }
  );
}


/* =========================================================
   BATTLEFIELD
   ========================================================= */

function battlefieldScore(
  chess,
  color,
  files
) {
  const pawn =
    analyzePawnStructure(
      chess,
      color
    );


  const space =
    analyzeSpace(
      chess,
      color
    );


  const initiative =
    analyzeInitiative(
      chess,
      color
    );


  const queenside =
    pawn.pawns.filter(
      square =>
        ["a", "b", "c"].includes(
          square[0]
        )
    ).length;


  const kingside =
    pawn.pawns.filter(
      square =>
        ["f", "g", "h"].includes(
          square[0]
        )
    ).length;


  const center =
    pawn.pawns.filter(
      square =>
        ["d", "e"].includes(
          square[0]
        )
    ).length;


  return {
    queenside:
      queenside * 0.08 +
      space.score * 0.25 +
      initiative.score * 0.15,

    center:
      center * 0.08 +
      space.score * 0.30 +
      initiative.score * 0.20,

    kingside:
      kingside * 0.08 +
      space.score * 0.25 +
      initiative.score * 0.20
  };
}


function chooseBattlefield(
  chess
) {
  const white =
    battlefieldScore(
      chess,
      "w"
    );


  const black =
    battlefieldScore(
      chess,
      "b"
    );


  const result = [
    {
      name: "queenside",
      score:
        white.queenside -
        black.queenside
    },

    {
      name: "center",
      score:
        white.center -
        black.center
    },

    {
      name: "kingside",
      score:
        white.kingside -
        black.kingside
    }
  ];


  result.sort(
    (a, b) =>
      Math.abs(b.score) -
      Math.abs(a.score)
  );


  return result;
}


/* =========================================================
   DOMINANT IMBALANCE
   ========================================================= */

function findDominantImbalance(
  chess,
  material,
  minor,
  whitePawn,
  blackPawn,
  files,
  whiteDevelopment,
  blackDevelopment,
  initiative
) {
  const candidates = [];


  const materialAbs =
    Math.abs(
      material.difference
    );


  if (
    materialAbs >= 1
  ) {
    candidates.push({
      type: "material",
      score:
        clamp(
          materialAbs / 5,
          0,
          1
        )
    });
  }


  const minorDifference =
    Math.abs(
      minor.difference
    );


  if (
    minorDifference >= 0.12
  ) {
    candidates.push({
      type: "minor_piece",
      score:
        clamp(
          minorDifference,
          0,
          1
        )
    });
  }


  const pawnWeakness =
    Math.max(
      whitePawn.weakness,
      blackPawn.weakness
    );


  if (
    pawnWeakness > 0.15
  ) {
    candidates.push({
      type: "pawn_structure",
      score:
        pawnWeakness
    });
  }


  const openFiles =
    files.filter(
      file =>
        file.type === "open" ||
        file.type === "semi-open"
    ).length;


  if (
    openFiles
  ) {
    candidates.push({
      type: "key_file",
      score:
        clamp(
          openFiles / 4,
          0,
          1
        )
    });
  }


  const developmentDifference =
    Math.abs(
      whiteDevelopment.score -
      blackDevelopment.score
    );


  if (
    developmentDifference >
    0.08
  ) {
    candidates.push({
      type: "development",
      score:
        clamp(
          developmentDifference,
          0,
          1
        )
    });
  }


  const initiativeDifference =
    Math.abs(
      initiative.white.score -
      initiative.black.score
    );


  if (
    initiativeDifference >
    0.08
  ) {
    candidates.push({
      type: "initiative",
      score:
        clamp(
          initiativeDifference,
          0,
          1
        )
    });
  }


  if (!candidates.length) {
    return {
      type: "balanced",
      score: 0
    };
  }


  candidates.sort(
    (a, b) =>
      b.score - a.score
  );


  return candidates[0];
}


function imbalanceName(type) {
  const names = {
    material: "물질",
    minor_piece: "기물 활동성",
    pawn_structure: "폰 구조",
    key_file: "중요한 파일과 칸",
    development: "전개",
    initiative: "주도권",
    balanced: "뚜렷한 불균형 없음"
  };

  return (
    names[type] ||
    type
  );
}


/* =========================================================
   POSITION SNAPSHOT
   ========================================================= */

function createPositionSnapshot(
  fen
) {
  const chess =
    new Chess(fen);


  const material =
    countMaterial(chess);


  const minorPieces =
    analyzeMinorPieces(
      chess
    );


  const whitePawn =
    analyzePawnStructure(
      chess,
      "w"
    );


  const blackPawn =
    analyzePawnStructure(
      chess,
      "b"
    );


  const space = {
    white:
      analyzeSpace(
        chess,
        "w"
      ),

    black:
      analyzeSpace(
        chess,
        "b"
      )
  };


  const files =
    analyzeFiles(chess);


  const keySquares =
    analyzeKeySquares(chess);


  const development = {
    white:
      analyzeDevelopment(
        chess,
        "w"
      ),

    black:
      analyzeDevelopment(
        chess,
        "b"
      )
  };


  const initiative = {
    white:
      analyzeInitiative(
        chess,
        "w"
      ),

    black:
      analyzeInitiative(
        chess,
        "b"
      )
  };


  initiative.difference =
    Number(
      (
        initiative.white.score -
        initiative.black.score
      ).toFixed(2)
    );


  const kingSafety = {
    white:
      analyzeKingSafety(
        chess,
        "w"
      ),

    black:
      analyzeKingSafety(
        chess,
        "b"
      )
  };


  const battlefield =
    chooseBattlefield(
      chess
    );


  const dominant =
    findDominantImbalance(
      chess,
      material,
      minorPieces,
      whitePawn,
      blackPawn,
      files,
      development.white,
      development.black,
      initiative
    );


  return {
    fen,

    turn:
      chess.turn(),

    moveNumber:
      chess.moveNumber(),

    phase:
      getGamePhase(chess),

    material,

    minorPieces,

    pawnStructure: {
      white: whitePawn,
      black: blackPawn
    },

    space,

    files,

    keySquares,

    development,

    initiative,

    kingSafety,

    battlefield,

    dominant
  };
}


/* =========================================================
   STRATEGIC FACTORS UI
   ========================================================= */

function renderStrategicFactors(
  snapshot
) {
  if (!els.humanFactors) {
    return;
  }


  const material =
    snapshot.material;


  const materialText =
    Math.abs(
      material.difference
    ) < 0.3
      ? "물질적으로 거의 균형입니다."
      : material.difference > 0
        ? `백이 약 ${Math.abs(material.difference).toFixed(1)}점 앞섭니다.`
        : `흑이 약 ${Math.abs(material.difference).toFixed(1)}점 앞섭니다.`;


  const minor =
    snapshot.minorPieces;


  const activityText =
    minor.difference > 0.12
      ? "백의 기물들이 평균적으로 더 활동적입니다."
      : minor.difference < -0.12
        ? "흑의 기물들이 평균적으로 더 활동적입니다."
        : "양쪽 기물 활동성에 큰 차이가 없습니다.";


  const whitePawn =
    snapshot.pawnStructure.white;

  const blackPawn =
    snapshot.pawnStructure.black;


  const pawnParts = [];


  if (
    whitePawn.isolated.length
  ) {
    pawnParts.push(
      `백 고립폰 ${whitePawn.isolated.join(", ")}`
    );
  }


  if (
    blackPawn.isolated.length
  ) {
    pawnParts.push(
      `흑 고립폰 ${blackPawn.isolated.join(", ")}`
    );
  }


  if (
    whitePawn.doubled.length
  ) {
    pawnParts.push(
      `백 더블폰 ${whitePawn.doubled.join(", ")}`
    );
  }


  if (
    blackPawn.doubled.length
  ) {
    pawnParts.push(
      `흑 더블폰 ${blackPawn.doubled.join(", ")}`
    );
  }


  if (
    whitePawn.passed.length
  ) {
    pawnParts.push(
      `백 통과폰 ${whitePawn.passed.join(", ")}`
    );
  }


  if (
    blackPawn.passed.length
  ) {
    pawnParts.push(
      `흑 통과폰 ${blackPawn.passed.join(", ")}`
    );
  }


  const pawnText =
    pawnParts.length
      ? pawnParts.join(" · ")
      : "눈에 띄는 대표적인 폰 구조 요소가 많지 않습니다.";


  const openFiles =
    snapshot.files
      .filter(
        file =>
          file.type === "open" ||
          file.type === "semi-open"
      )
      .map(
        file =>
          `${file.file}파일(${file.type})`
      );


  const fileText =
    openFiles.length
      ? openFiles.join(" · ")
      : "현재 열린 파일의 활용 가능성이 크지 않습니다.";


  const developmentDifference =
    snapshot.development.white.score -
    snapshot.development.black.score;


  const developmentText =
    developmentDifference > 0.08
      ? "백이 전개에서 앞서 있습니다."
      : developmentDifference < -0.08
        ? "흑이 전개에서 앞서 있습니다."
        : "전개 차이가 크지 않습니다.";


  const initiative =
    snapshot.initiative;


  const initiativeText =
    initiative.difference > 0.2
      ? "백이 상대에게 더 많은 대응을 요구하고 있습니다."
      : initiative.difference < -0.2
        ? "흑이 상대에게 더 많은 대응을 요구하고 있습니다."
        : "주도권 차이가 크지 않습니다.";


  const battlefield =
    snapshot.battlefield[0];


  const battlefieldName =
    battlefield?.name === "queenside"
      ? "퀸사이드"
      : battlefield?.name === "kingside"
        ? "킹사이드"
        : "중앙";


  const dominant =
    imbalanceName(
      snapshot.dominant.type
    );


  const items = [
    [
      "게임 단계",
      `현재 ${getPhaseName(snapshot.phase)}입니다.`
    ],

    [
      "물질",
      materialText
    ],

    [
      "기물 활동",
      activityText
    ],

    [
      "폰 구조",
      pawnText
    ],

    [
      "공간",
      `백 공간 점수 ${snapshot.space.white.score.toFixed(2)} · 흑 공간 점수 ${snapshot.space.black.score.toFixed(2)}`
    ],

    [
      "중요한 파일",
      fileText
    ],

    [
      "전개",
      developmentText
    ],

    [
      "주도권",
      initiativeText
    ],

    [
      "현재 가장 중요한 불균형",
      dominant
    ],

    [
      "싸울 지역",
      `${battlefieldName}에서 실제로 활용 가능한 요소를 먼저 확인하세요.`
    ]
  ];


  els.humanFactors.innerHTML =
    items
      .map(
        ([title, text]) => `
          <div class="factor">
            <b>${escapeHtml(title)}</b>
            <span>${escapeHtml(text)}</span>
          </div>
        `
      )
      .join("");
}


/* =========================================================
   STRATEGIC INSIGHT
   ========================================================= */

function renderStrategicInsight(
  snapshot
) {
  if (!els.positionInsight) {
    return;
  }


  const dominant =
    snapshot.dominant;


  const battlefield =
    snapshot.battlefield[0];


  const sideName =
    snapshot.turn === "w"
      ? "백"
      : "흑";


  let first =
    "현재는 뚜렷하게 하나의 불균형만 압도한다고 보기 어렵습니다.";


  if (
    dominant.type !== "balanced"
  ) {
    first =
      `먼저 <b>${escapeHtml(
        imbalanceName(
          dominant.type
        )
      )}</b>을 확인하세요.`;
  }


  let battlefieldText =
    "중앙·퀸사이드·킹사이드를 모두 비교한 뒤 실제로 활용할 수 있는 지역을 선택합니다.";


  if (battlefield) {

    const name =
      battlefield.name === "queenside"
        ? "퀸사이드"
        : battlefield.name === "kingside"
          ? "킹사이드"
          : "중앙";


    battlefieldText =
      `현재 분석에서는 <b>${name}</b> 쪽을 먼저 살펴볼 가치가 있습니다.`;
  }


  const initiative =
    snapshot.initiative;


  let initiativeText =
    "양쪽의 주도권 차이가 크지 않습니다.";


  if (
    initiative.difference > 0.2
  ) {
    initiativeText =
      "백이 상대에게 대응을 요구하는 요소가 더 많습니다.";
  }


  if (
    initiative.difference < -0.2
  ) {
    initiativeText =
      "흑이 상대에게 대응을 요구하는 요소가 더 많습니다.";
  }


  els.positionInsight.innerHTML = `
    <div class="insightBlock">
      <strong>먼저 볼 것</strong>
      <p>${first}</p>
    </div>

    <div class="insightBlock">
      <strong>어디에서 싸울 것인가</strong>
      <p>${battlefieldText}</p>
    </div>

    <div class="insightBlock">
      <strong>상대의 관점</strong>
      <p>${sideName}이 계획을 세우기 전에 상대가 어떤 불균형을 이용하려 하는지 확인하세요.</p>
    </div>

    <div class="insightBlock">
      <strong>주도권</strong>
      <p>${initiativeText}</p>
    </div>

    <div class="insightBlock">
      <strong>생각의 순서</strong>
      <p>
        전술적 위협 확인 →
        불균형 확인 →
        싸울 지역 선택 →
        원하는 포지션 상상 →
        후보 수 생성 →
        엔진으로 계산
      </p>
    </div>
  `;
}


/* =========================================================
   CANDIDATE GENERATION
   ========================================================= */

function generateStrategicCandidates(
  fen,
  snapshot
) {
  const chess =
    new Chess(fen);


  const side =
    chess.turn();


  const candidates = [];


  const ownPieces =
    piecesOf(
      chess,
      side
    );


  /*
   * 1. 개선 수
   */

  const minor =
    ownPieces.filter(
      piece =>
        piece.type === "n" ||
        piece.type === "b"
    );


  minor.forEach(
    piece => {

      const moves =
        legalMovesForPiece(
          chess,
          piece.square
        );


      moves
        .filter(
          move =>
            !move.captured
        )
        .slice(0, 3)
        .forEach(
          move => {

            const clone =
              new Chess(fen);


            let san;


            try {
              const made =
                clone.move({
                  from: move.from,
                  to: move.to,
                  promotion:
                    move.promotion
                });

              san =
                made.san;

            } catch {
              return;
            }


            candidates.push({
              move:
                `${move.from}${move.to}${move.promotion || ""}`,

              san,

              type:
                "IMPROVING",

              purpose:
                "기물의 활동성을 개선",

              strategicFit:
                snapshot.dominant.type ===
                "minor_piece"
                  ? 0.85
                  : 0.55
            });
          }
        );
    }
  );


  /*
   * 2. 폰 브레이크 후보
   */

  const pawns =
    piecesOf(
      chess,
      side,
      "p"
    );


  pawns.forEach(
    pawn => {

      const moves =
        legalMovesForPiece(
          chess,
          pawn.square
        );


      moves.forEach(
        move => {

          if (
            move.captured
          ) {
            return;
          }


          if (
            Math.abs(
              Number(
                move.to[1]
              ) -
              Number(
                pawn.square[1]
              )
            ) !== 1
          ) {
            return;
          }


          const enemy =
            side === "w"
              ? "b"
              : "w";


          const target =
            chess.get(
              move.to
            );


          const adjacentEnemy =
            attackersOf(
              chess,
              move.to,
              enemy
            ).length;


          if (
            target ||
            adjacentEnemy
          ) {

            let san;


            try {

              const clone =
                new Chess(fen);

              san =
                clone.move({
                  from: move.from,
                  to: move.to
                }).san;

            } catch {
              return;
            }


            candidates.push({
              move:
                `${move.from}${move.to}`,

              san,

              type:
                "BREAK",

              purpose:
                "상대 폰 구조를 흔들 수 있는 폰 브레이크",

              strategicFit:
                snapshot.dominant.type ===
                "pawn_structure"
                  ? 0.9
                  : 0.5
            });
          }
        }
      );
    }
  );


  /*
   * 3. 캡처 / 전술 후보
   */

  ownPieces.forEach(
    piece => {

      const moves =
        legalMovesForPiece(
          chess,
          piece.square
        );


      moves.forEach(
        move => {

          if (
            !move.captured
          ) {
            return;
          }


          let san;


          try {

            const clone =
              new Chess(fen);

            san =
              clone.move({
                from: move.from,
                to: move.to,
                promotion:
                  move.promotion
              }).san;

          } catch {
            return;
          }


          candidates.push({
            move:
              `${move.from}${move.to}${move.promotion || ""}`,

            san,

            type:
              "TACTICAL",

            purpose:
              "즉각적인 전술 또는 물질 변화 확인",

            strategicFit:
              0.7
          });
        }
      );
    }
  );


  /*
   * 중복 제거
   */

  const unique =
    [];


  const seen =
    new Set();


  candidates.forEach(
    candidate => {

      if (
        seen.has(
          candidate.move
        )
      ) {
        return;
      }


      seen.add(
        candidate.move
      );

      unique.push(
        candidate
      );
    }
  );


  /*
   * 너무 많은 후보를
   * 엔진에 보내지 않는다.
   */

  return unique
    .sort(
      (a, b) =>
        b.strategicFit -
        a.strategicFit
    )
    .slice(0, 5);
}


/* =========================================================
   UCI → SAN
   ========================================================= */

function uciToSan(
  fen,
  uci
) {
  try {

    const chess =
      new Chess(fen);


    const move =
      chess.move({
        from:
          uci.slice(0, 2),

        to:
          uci.slice(2, 4),

        promotion:
          uci[4]
      });


    return move
      ? move.san
      : uci;

  } catch {
    return uci;
  }
}


/* =========================================================
   ENGINE CANDIDATES
   ========================================================= */

function renderCandidates(
  result,
  strategicCandidates,
  fen
) {
  if (!els.candidateList) {
    return;
  }


  const engineLines =
    result.lines || [];


  const cards = [];


  engineLines.forEach(
    (line, index) => {

      const firstMove =
        line.pv?.[0];


      const san =
        firstMove
          ? uciToSan(
              fen,
              firstMove
            )
          : "—";


      const strategic =
        strategicCandidates.find(
          candidate =>
            candidate.move ===
            firstMove
        );


      const label =
        index === 0
          ? "엔진 최선"
          : strategic
            ? "전략적 후보"
            : "엔진 후보";


      const purpose =
        strategic?.purpose ||
        "엔진이 계산한 주요 후보 수";


      cards.push(`
        <div class="candidate ${
          index === 0
            ? "candidateTop"
            : ""
        }">

          <div class="candidateTitle">
            <strong>${escapeHtml(san)}</strong>
            <span>${escapeHtml(label)}</span>
          </div>

          <div class="candidateDesc">
            ${escapeHtml(purpose)}
          </div>

          <div class="candidatePv">
            ${escapeHtml(
              line.pv
                .slice(0, 6)
                .map(
                  move =>
                    uciToSan(
                      fen,
                      move
                    )
                )
                .join(" ")
            )}
          </div>

          <div class="candidateScore">
            ${formatScore(line.score)}
          </div>

        </div>
      `);
    }
  );


  if (!cards.length) {
    cards.push(`
      <div class="candidate">
        엔진 후보를 계산하지 못했습니다.
      </div>
    `);
  }


  els.candidateList.innerHTML =
    cards.join("");
}


/* =========================================================
   ANALYSIS RESULT
   ========================================================= */

function renderAnalysis(
  result,
  snapshot,
  strategicCandidates,
  fen
) {
  const evaluation =
    result.lines?.[0]?.score ??
    null;


  els.evalValue.textContent =
    formatScore(
      evaluation
    );


  els.positionInsight.innerHTML += `
    <div class="insightBlock">
      <strong>엔진 평가</strong>
      <p>
        ${escapeHtml(
          scoreLabel(
            evaluation
          )
        )}
      </p>
    </div>
  `;


  renderCandidates(
    result,
    strategicCandidates,
    fen
  );


  els.depthValue.textContent =
    result.depth || "—";


  setProgress(
    100,
    result.depth
  );
}


/* =========================================================
   SELECT POSITION
   ========================================================= */

async function selectPly(
  ply
) {
  if (!positions.length) {
    return;
  }


  currentPly =
    clamp(
      ply,
      0,
      positions.length - 1
    );


  const position =
    positions[currentPly];


  renderBoard(
    position.fen
  );


  renderMoves();


  els.moveLabel.textContent =
    `${currentPly} / ${positions.length - 1}`;


  els.positionLabel.textContent =
    currentPly === 0
      ? "시작 포지션"
      : `${Math.ceil(currentPly / 2)}${
          currentPly % 2
            ? ". "
            : "… "
        }${position.san}`;


  els.firstBtn.disabled =
    currentPly === 0;

  els.prevBtn.disabled =
    currentPly === 0;

  els.nextBtn.disabled =
    currentPly ===
    positions.length - 1;

  els.lastBtn.disabled =
    currentPly ===
    positions.length - 1;


  clearError();


  setProgress(
    0,
    0
  );


  els.evalValue.textContent =
    "분석 중…";


  els.candidateList.innerHTML =
    "";


  const snapshot =
    createPositionSnapshot(
      position.fen
    );


  renderStrategicFactors(
    snapshot
  );


  renderStrategicInsight(
    snapshot
  );


  const strategicCandidates =
    generateStrategicCandidates(
      position.fen,
      snapshot
    );


  try {

    const result =
      await analyzeFen(
        position.fen,
        10
      );


    if (
      currentPly === ply
    ) {

      renderAnalysis(
        result,
        snapshot,
        strategicCandidates,
        position.fen
      );
    }

  } catch (error) {

    if (
      currentPly === ply
    ) {

      els.evalValue.textContent =
        "—";


      showError(
        error?.message ||
        "분석에 실패했습니다."
      );
    }
  }
}


/* =========================================================
   START GAME
   ========================================================= */

async function startGame() {
  clearError();


  const text =
    els.pgnInput.value.trim();


  if (!text) {

    showError(
      "PGN을 먼저 입력해주세요."
    );

    return;
  }


  const chess =
    new Chess();


  try {

    chess.loadPgn(
      text,
      {
        strict: false
      }
    );

  } catch (error) {

    showError(
      "PGN을 읽을 수 없습니다. 수순 형식과 PGN 태그를 확인해주세요."
    );

    return;
  }


  positions =
    buildPositions(
      chess
    );


  currentPly = 0;


  analysisCache.clear();


  const headers =
    parsePgnHeaders(
      text
    );


  renderGameMeta(
    headers
  );


  els.inputView.hidden =
    true;

  els.analysisView.hidden =
    false;


  renderMoves();


  await initEngine();


  await selectPly(0);
}


/* =========================================================
   RETURN TO INPUT
   ========================================================= */

function backToInput() {
  cancelCurrentAnalysis();


  els.analysisView.hidden =
    true;


  els.inputView.hidden =
    false;


  setProgress(
    0,
    0
  );
}


/* =========================================================
   NAVIGATION
   ========================================================= */

function goFirst() {
  selectPly(0);
}


function goPrevious() {
  selectPly(
    currentPly - 1
  );
}


function goNext() {
  selectPly(
    currentPly + 1
  );
}


function goLast() {
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

      els.pgnInput.value =
        EXAMPLE_PGN;

      clearError();

      setStatus(
        engineReady
          ? "Stockfish 준비 완료"
          : "Stockfish 준비 중…",
        engineReady
          ? "ready"
          : "loading"
      );
    }
  );
}


if (els.analyzeBtn) {

  els.analyzeBtn.addEventListener(
    "click",
    async () => {

      els.analyzeBtn.disabled =
        true;


      try {

        await startGame();

      } catch (error) {

        console.error(
          error
        );


        showError(
          error?.message ||
          "게임 분석을 시작하지 못했습니다."
        );

      } finally {

        els.analyzeBtn.disabled =
          false;
      }
    }
  );
}


if (els.backBtn) {

  els.backBtn.addEventListener(
    "click",
    backToInput
  );
}


if (els.firstBtn) {

  els.firstBtn.addEventListener(
    "click",
    goFirst
  );
}


if (els.prevBtn) {

  els.prevBtn.addEventListener(
    "click",
    goPrevious
  );
}


if (els.nextBtn) {

  els.nextBtn.addEventListener(
    "click",
    goNext
  );
}


if (els.lastBtn) {

  els.lastBtn.addEventListener(
    "click",
    goLast
  );
}


/* =========================================================
   INITIAL SCREEN
   ========================================================= */

if (els.analysisView) {
  els.analysisView.hidden =
    true;
}


if (els.inputView) {
  els.inputView.hidden =
    false;
}


setProgress(
  0,
  0
);


setStatus(
  "Stockfish 준비 중…",
  "loading"
);


/* =========================================================
   INITIALIZE ENGINE
   ========================================================= */

initEngine()
  .catch(error => {

    console.error(
      "Initial engine error:",
      error
    );


    showError(
      "Stockfish를 불러오지 못했습니다. stockfish 폴더와 파일이 GitHub에 있는지 확인해주세요."
    );
  });


/* =========================================================
   RUNTIME ERROR LOG
   ========================================================= */

window.addEventListener(
  "error",
  event => {

    console.error(
      "ChessSense runtime error:",
      event.error
    );
  }
);


window.addEventListener(
  "unhandledrejection",
  event => {

    console.error(
      "ChessSense promise error:",
      event.reason
    );
  }
);
