import { Chess } from "https://cdn.jsdelivr.net/npm/chess.js@1.4.0/+esm";

const $ = (id) => document.getElementById(id);

const pgnInput = $("pgnInput");
const exampleButton = $("exampleButton");
const analyzeButton = $("analyzeButton");
const boardElement = $("board");
const analysisResult = $("analysisResult");
const debugOutput = $("debugOutput");


/* =========================================================
   예제 PGN
========================================================= */

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
   기물 이름
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


/* =========================================================
   기물 가치
=========================================================

   주의:
   이 값은 Stockfish 평가값이 아니다.

   ChessSense 내부에서 물질 구조를 비교하기 위한
   분석용 기준값이다.
========================================================= */

const PIECE_VALUES = {
  p: 1,
  n: 3.2,
  b: 3.3,
  r: 5,
  q: 9,
  k: 0
};


/* =========================================================
   빈 진영 데이터
========================================================= */

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
   ① Material Analyzer
========================================================= */

function analyzeMaterial(snapshot) {

  function calculateSideMaterial(sideData) {

    let total = 0;

    for (const type of Object.keys(PIECE_VALUES)) {

      const count = sideData.material[type];
      const value = PIECE_VALUES[type];

      total += count * value;
    }

    return total;
  }


  const whiteTotal =
    calculateSideMaterial(snapshot.white);

  const blackTotal =
    calculateSideMaterial(snapshot.black);


  const difference =
    whiteTotal - blackTotal;


  let advantage = "equal";
  let advantageSide = null;


  if (difference > 0.05) {

    advantage = "white";
    advantageSide = "w";

  } else if (difference < -0.05) {

    advantage = "black";
    advantageSide = "b";
  }


  return {

    type: "material",

    white: {
      total: whiteTotal,
      pieces: snapshot.white.material
    },

    black: {
      total: blackTotal,
      pieces: snapshot.black.material
    },

    difference,

    advantage,

    advantageSide,

    importance: 0
  };
}


/* =========================================================
   Material 표시용 숫자
========================================================= */

function formatScore(value) {

  if (Math.abs(value) < 0.05) {
    return "0.0";
  }

  return value.toFixed(1);
}


/* =========================================================
   Material Analyzer 화면
========================================================= */

function renderMaterialAnalysis(material) {

  let description = "";


  if (material.advantage === "equal") {

    description =
      "양쪽의 물질 가치가 거의 같습니다.";

  } else if (material.advantage === "white") {

    description =
      `백이 물질적으로 +${formatScore(material.difference)}입니다.`;

  } else {

    description =
      `흑이 물질적으로 +${formatScore(
        Math.abs(material.difference)
      )}입니다.`;
  }


  return `
    <div class="analysis-card">

      <div class="analysis-card-title">
        물질
      </div>

      <div class="analysis-row">
        <span>백</span>
        <strong>${formatScore(material.white.total)}</strong>
      </div>

      <div class="analysis-row">
        <span>흑</span>
        <strong>${formatScore(material.black.total)}</strong>
      </div>

      <div class="analysis-row">
        <span>차이</span>
        <strong>${formatScore(
          material.difference
        )}</strong>
      </div>

      <div class="analysis-description">
        ${description}
      </div>

      <div class="analysis-note">
        현재 단계에서는 물질적 사실만 기록합니다.
        실제 포지션의 유불리는 다른 불균형과 함께 판단합니다.
      </div>

    </div>
  `;
}


/* =========================================================
   체스판
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

  const boardGrid =
    document.createElement("div");

  boardGrid.className = "chess-board";


  const piecesBySquare = {};


  for (const piece of snapshot.board) {

    piecesBySquare[piece.square] = piece;

  }


  for (let rank = 8; rank >= 1; rank--) {

    for (let fileIndex = 0; fileIndex < 8; fileIndex++) {

      const file =
        String.fromCharCode(97 + fileIndex);

      const square =
        `${file}${rank}`;


      const squareElement =
        document.createElement("div");

      squareElement.className =
        "chess-square";


      const isLight =
        (rank + fileIndex) % 2 === 0;


      squareElement.classList.add(
        isLight
          ? "light-square"
          : "dark-square"
      );


      const piece =
        piecesBySquare[square];


      if (piece) {

        const pieceElement =
          document.createElement("span");

        pieceElement.className =
          piece.color === "w"
            ? "white-piece"
            : "black-piece";

        pieceElement.textContent =
          PIECE_SYMBOLS[
            piece.color
          ][
            piece.type
          ];

        squareElement.appendChild(
          pieceElement
        );
      }


      boardGrid.appendChild(
        squareElement
      );
    }
  }


  boardElement.appendChild(
    boardGrid
  );
}


/* =========================================================
   Position Snapshot 화면
========================================================= */

function renderSnapshotSummary(
  snapshot,
  material
) {

  const whitePieces =
    snapshot.white.pieces.length;

  const blackPieces =
    snapshot.black.pieces.length;


  const sideToMove =
    snapshot.turn === "w"
      ? "백"
      : "흑";


  analysisResult.innerHTML = `

    ${renderMaterialAnalysis(material)}

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
        <strong>
          ${snapshot.inCheck ? "있음" : "없음"}
        </strong>
      </div>

      <div class="snapshot-note">
        현재 단계에서는 체스판의 사실 관계와
        물질 구조를 수집합니다.
        전략적 판단은 이후 단계에서 추가합니다.
      </div>

    </div>
  `;
}


/* =========================================================
   DEBUG
========================================================= */

function renderDebug(
  snapshot,
  material
) {

  const debugData = {

    position: {

      fen: snapshot.fen,

      turn:
        colorName(snapshot.turn),

      fullmoveNumber:
        snapshot.fullmoveNumber,

      inCheck:
        snapshot.inCheck
    },


    material: {

      pieceValues:
        PIECE_VALUES,

      white: material.white,

      black: material.black,

      difference:
        material.difference,

      advantage:
        material.advantage
    },


    white: {

      materialCount:
        snapshot.white.pieces.length,

      material:
        snapshot.white.material,

      pieces:
        snapshot.white.pieces
    },


    black: {

      materialCount:
        snapshot.black.pieces.length,

      material:
        snapshot.black.material,

      pieces:
        snapshot.black.pieces
    }

  };


  debugOutput.textContent =
    JSON.stringify(
      debugData,
      null,
      2
    );
}


/* =========================================================
   PGN 분석
========================================================= */

function analyzePGN() {

  const pgn =
    pgnInput.value.trim();


  if (!pgn) {

    alert(
      "먼저 PGN을 입력해주세요."
    );

    return;
  }


  const chess =
    new Chess();


  try {

    chess.loadPgn(pgn);


    const snapshot =
      createPositionSnapshot(
        chess
      );


    const material =
      analyzeMaterial(
        snapshot
      );


    renderBoard(
      snapshot
    );


    renderSnapshotSummary(
      snapshot,
      material
    );


    renderDebug(
      snapshot,
      material
    );


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

exampleButton.addEventListener(
  "click",
  () => {

    pgnInput.value =
      EXAMPLE_PGN;

  }
);


/* =========================================================
   분석 시작
========================================================= */

analyzeButton.addEventListener(
  "click",
  analyzePGN
);


/* =========================================================
   초기 상태
========================================================= */

pgnInput.value =
  EXAMPLE_PGN;


analysisResult.innerHTML = `

  <p class="empty-message">
    예제 PGN이 준비되어 있습니다.
    "게임 분석 시작"을 눌러보세요.
  </p>

`;
