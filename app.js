import { Chess } from "https://cdn.jsdelivr.net/npm/chess.js@1.4.0/+esm";

const $ = (id) => document.getElementById(id);

const pgnInput = $("pgnInput");
const exampleButton = $("exampleButton");
const analyzeButton = $("analyzeButton");
const boardElement = $("board");
const analysisResult = $("analysisResult");
const debugOutput = $("debugOutput");

const EXAMPLE_PGN = `[Event "ChessSense Demo"]
[Site "?"]
[Date "2026.10.07"]
[Round "1"]
[White "White"]
[Black "Black"]
[Result "*"]

1. e4 e5
2. Nf3 Nc6
3. Bc4 Bc5
4. c3 Nf6
5. d4 exd4
6. cxd4 Bb4+
7. Nc3 Nxe4
8. O-O Bxc3
9. bxc3 d5
10. Bb5 O-O *`;


/* =========================================================
   기본 유틸리티
========================================================= */

function pieceName(type) {
  const names = {
    p: "폰",
    n: "나이트",
    b: "비숍",
    r: "룩",
    q: "퀸",
    k: "킹"
  };

  return names[type] || type;
}

function colorName(color) {
  return color === "w" ? "백" : "흑";
}

function createEmptySideData() {
  return {
    pieces: [],
    pawns: [],
    material: {
      p: 0,
      n: 0,
      b: 0,
      r: 0,
      q: 0,
      k: 0
    }
  };
}


/* =========================================================
   Position Snapshot
========================================================= */

function createPositionSnapshot(chess) {
  const board = chess.board();

  const snapshot = {
    fen: chess.fen(),
    turn: chess.turn(),
    fullmoveNumber: chess.moveNumber(),
    inCheck: chess.isCheck(),

    white: createEmptySideData(),
    black: createEmptySideData(),

    board: []
  };

  for (let row = 0; row < board.length; row++) {
    const rank = 8 - row;

    for (let col = 0; col < board[row].length; col++) {
      const piece = board[row][col];

      if (!piece) {
        continue;
      }

      const file = String.fromCharCode(97 + col);
      const square = `${file}${rank}`;

      const pieceData = {
        color: piece.color,
        type: piece.type,
        square
      };

      snapshot.board.push(pieceData);

      const side =
        piece.color === "w"
          ? snapshot.white
          : snapshot.black;

      side.pieces.push(pieceData);
      side.material[piece.type] += 1;

      if (piece.type === "p") {
        side.pawns.push(pieceData);
      }
    }
  }

  return snapshot;
}


/* =========================================================
   체스판 표시
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


function renderBoard(snapshot) {
  boardElement.innerHTML = "";

  const boardGrid = document.createElement("div");
  boardGrid.className = "chess-board";

  const piecesBySquare = {};

  for (const piece of snapshot.board) {
    piecesBySquare[piece.square] = piece;
  }

  for (let rank = 8; rank >= 1; rank--) {
    for (let fileIndex = 0; fileIndex < 8; fileIndex++) {

      const file = String.fromCharCode(97 + fileIndex);
      const square = `${file}${rank}`;

      const squareElement = document.createElement("div");
      squareElement.className = "chess-square";

      const isLight =
        (rank + fileIndex) % 2 === 0;

      squareElement.classList.add(
        isLight ? "light-square" : "dark-square"
      );

      const piece = piecesBySquare[square];

      if (piece) {
        const pieceElement = document.createElement("span");

        pieceElement.className =
          piece.color === "w"
            ? "white-piece"
            : "black-piece";

        pieceElement.textContent =
          PIECE_SYMBOLS[piece.color][piece.type];

        squareElement.appendChild(pieceElement);
      }

      boardGrid.appendChild(squareElement);
    }
  }

  boardElement.appendChild(boardGrid);
}


/* =========================================================
   Position Snapshot 화면 출력
========================================================= */

function renderSnapshotSummary(snapshot) {
  const whitePieces = snapshot.white.pieces.length;
  const blackPieces = snapshot.black.pieces.length;

  const sideToMove =
    snapshot.turn === "w"
      ? "백"
      : "흑";

  analysisResult.innerHTML = `
    <div class="snapshot-card">

      <div class="snapshot-row">
        <span>현재 차례</span>
        <strong>${sideToMove}</strong>
      </div>

      <div class="snapshot-row">
        <span>백 기물 수</span>
        <strong>${whitePieces}</strong>
      </div>

      <div class="snapshot-row">
        <span>흑 기물 수</span>
        <strong>${blackPieces}</strong>
      </div>

      <div class="snapshot-row">
        <span>체크</span>
        <strong>${snapshot.inCheck ? "있음" : "없음"}</strong>
      </div>

      <div class="snapshot-note">
        현재 단계에서는 체스판의 사실 관계만 수집합니다.
        전략적 판단은 다음 단계에서 추가합니다.
      </div>

    </div>
  `;
}


/* =========================================================
   DEBUG 출력
========================================================= */

function renderDebug(snapshot) {
  const debugData = {
    fen: snapshot.fen,
    turn: colorName(snapshot.turn),
    fullmoveNumber: snapshot.fullmoveNumber,
    inCheck: snapshot.inCheck,

    white: {
      materialCount: snapshot.white.pieces.length,
      material: snapshot.white.material,
      pieces: snapshot.white.pieces
    },

    black: {
      materialCount: snapshot.black.pieces.length,
      material: snapshot.black.material,
      pieces: snapshot.black.pieces
    }
  };

  debugOutput.textContent =
    JSON.stringify(debugData, null, 2);
}


/* =========================================================
   PGN 분석
========================================================= */

function analyzePGN() {
  const pgn = pgnInput.value.trim();

  if (!pgn) {
    alert("먼저 PGN을 입력해주세요.");
    return;
  }

  const chess = new Chess();

  try {
    chess.loadPgn(pgn);

    const snapshot =
      createPositionSnapshot(chess);

    renderBoard(snapshot);
    renderSnapshotSummary(snapshot);
    renderDebug(snapshot);

  } catch (error) {
    console.error(error);

    analysisResult.innerHTML = `
      <p class="error-message">
        PGN을 읽지 못했습니다.
        PGN 형식을 확인해주세요.
      </p>
    `;

    debugOutput.textContent =
      error instanceof Error
        ? error.message
        : String(error);
  }
}


/* =========================================================
   예제 PGN
========================================================= */

exampleButton.addEventListener("click", () => {
  pgnInput.value = EXAMPLE_PGN;
});


/* =========================================================
   분석 시작
========================================================= */

analyzeButton.addEventListener("click", analyzePGN);


/* =========================================================
   초기 상태
========================================================= */

pgnInput.value = EXAMPLE_PGN;

analysisResult.innerHTML = `
  <p class="empty-message">
    예제 PGN이 준비되어 있습니다.
    "게임 분석 시작"을 눌러보세요.
  </p>
`;
