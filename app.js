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

  return color === "w"
    ? "백"
    : "흑";
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

    board: [],

    minorPieces: null

  };


  for (
    let row = 0;
    row < board.length;
    row++
  ) {

    const rank = 8 - row;


    for (
      let col = 0;
      col < board[row].length;
      col++
    ) {

      const piece =
        board[row][col];


      if (!piece) {
        continue;
      }


      const file =
        String.fromCharCode(
          97 + col
        );


      const square =
        `${file}${rank}`;


      const pieceData = {

        color: piece.color,

        type: piece.type,

        square

      };


      snapshot.board.push(
        pieceData
      );


      const side =
        piece.color === "w"
          ? snapshot.white
          : snapshot.black;


      side.pieces.push(
        pieceData
      );


      side.material[piece.type] += 1;


      if (piece.type === "p") {

        side.pawns.push(
          pieceData
        );

      }

    }

  }


  /*
    ② Superior Minor Piece

    현재 Position Snapshot 단계에서
    비숍 / 나이트의 실제 활동성 정보를 수집한다.

    여기서는 최종적인 우세 판정을 하지 않는다.
  */

  snapshot.minorPieces =
    analyzeSuperiorMinorPieces(
      chess,
      snapshot
    );


  return snapshot;
}


/* =========================================================
   ① Material Analyzer
========================================================= */

function analyzeMaterial(snapshot) {

  function calculateSideMaterial(sideData) {

    let total = 0;


    for (
      const type of Object.keys(PIECE_VALUES)
    ) {

      const count =
        sideData.material[type];


      const value =
        PIECE_VALUES[type];


      total +=
        count * value;

    }


    return total;
  }


  const whiteTotal =
    calculateSideMaterial(
      snapshot.white
    );


  const blackTotal =
    calculateSideMaterial(
      snapshot.black
    );


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

      pieces:
        snapshot.white.material

    },

    black: {

      total: blackTotal,

      pieces:
        snapshot.black.material

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

  if (
    Math.abs(value) < 0.05
  ) {

    return "0.0";

  }


  return value.toFixed(1);
}


/* =========================================================
   좌표 변환
========================================================= */

function squareToCoords(square) {

  const file =
    square.charCodeAt(0) - 97;


  const rank =
    Number(square[1]) - 1;


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
    String.fromCharCode(97 + file) +
    String(rank + 1)
  );

}


/* =========================================================
   반대 색
========================================================= */

function oppositeColor(color) {

  return color === "w"
    ? "b"
    : "w";

}


/* =========================================================
   보드에서 특정 칸의 기물 가져오기
========================================================= */

function getBoardPiece(board, square) {

  const {
    file,
    rank
  } = squareToCoords(square);


  return board[7 - rank]?.[file] || null;

}


/* =========================================================
   특정 칸이 특정 색에게 공격받고 있는지
=========================================================

   chess.js의 별도 공격 API에 의존하지 않고
   ChessSense가 직접 공격 관계를 계산한다.

   이것은 "안전한 이동 가능성"을 평가하기 위한
   내부 분석용 함수다.
========================================================= */

function isSquareAttackedBy(
  board,
  targetSquare,
  attackerColor
) {

  const target =
    squareToCoords(
      targetSquare
    );


  /*
     폰 공격
  */

  const pawnDirection =
    attackerColor === "w"
      ? 1
      : -1;


  for (const fileOffset of [-1, 1]) {

    const pawnFile =
      target.file - fileOffset;


    const pawnRank =
      target.rank - pawnDirection;


    const square =
      coordsToSquare(
        pawnFile,
        pawnRank
      );


    if (!square) {
      continue;
    }


    const piece =
      getBoardPiece(
        board,
        square
      );


    if (
      piece &&
      piece.color === attackerColor &&
      piece.type === "p"
    ) {

      return true;

    }

  }


  /*
     나이트 공격
  */

  const knightOffsets = [

    [1, 2],
    [2, 1],
    [2, -1],
    [1, -2],
    [-1, -2],
    [-2, -1],
    [-2, 1],
    [-1, 2]

  ];


  for (
    const [df, dr] of knightOffsets
  ) {

    const square =
      coordsToSquare(
        target.file + df,
        target.rank + dr
      );


    if (!square) {
      continue;
    }


    const piece =
      getBoardPiece(
        board,
        square
      );


    if (
      piece &&
      piece.color === attackerColor &&
      piece.type === "n"
    ) {

      return true;

    }

  }


  /*
     킹 공격
  */

  for (let df = -1; df <= 1; df++) {

    for (let dr = -1; dr <= 1; dr++) {

      if (
        df === 0 &&
        dr === 0
      ) {
        continue;
      }


      const square =
        coordsToSquare(
          target.file + df,
          target.rank + dr
        );


      if (!square) {
        continue;
      }


      const piece =
        getBoardPiece(
          board,
          square
        );


      if (
        piece &&
        piece.color === attackerColor &&
        piece.type === "k"
      ) {

        return true;

      }

    }

  }


  /*
     직선 / 대각선 기물
  */

  const directions = [

    {
      df: 1,
      dr: 0,
      types: ["r", "q"]
    },

    {
      df: -1,
      dr: 0,
      types: ["r", "q"]
    },

    {
      df: 0,
      dr: 1,
      types: ["r", "q"]
    },

    {
      df: 0,
      dr: -1,
      types: ["r", "q"]
    },

    {
      df: 1,
      dr: 1,
      types: ["b", "q"]
    },

    {
      df: 1,
      dr: -1,
      types: ["b", "q"]
    },

    {
      df: -1,
      dr: 1,
      types: ["b", "q"]
    },

    {
      df: -1,
      dr: -1,
      types: ["b", "q"]
    }

  ];


  for (const direction of directions) {

    let file =
      target.file +
      direction.df;


    let rank =
      target.rank +
      direction.dr;


    while (
      file >= 0 &&
      file <= 7 &&
      rank >= 0 &&
      rank <= 7
    ) {

      const square =
        coordsToSquare(
          file,
          rank
        );


      const piece =
        getBoardPiece(
          board,
          square
        );


      if (piece) {

        if (
          piece.color === attackerColor &&
          direction.types.includes(
            piece.type
          )
        ) {

          return true;

        }


        break;

      }


      file +=
        direction.df;


      rank +=
        direction.dr;

    }

  }


  return false;
}


/* =========================================================
   중앙성
=========================================================

   중앙에 가까운 정도를 내부 참고값으로 계산한다.

   이것만으로 기물의 우열을 판단하지 않는다.
========================================================= */

function calculateCentrality(square) {

  const {
    file,
    rank
  } = squareToCoords(square);


  const distance =
    Math.abs(file - 3.5) +
    Math.abs(rank - 3.5);


  const maximumDistance = 7;


  return Math.max(
    0,
    1 - (
      distance /
      maximumDistance
    )
  );

}


/* =========================================================
   나이트 아웃포스트 후보
========================================================= */

function isKnightOutpost(
  chess,
  square,
  color
) {

  const {
    file,
    rank
  } = squareToCoords(square);


  /*
     너무 가장자리인 칸은
     일반적인 아웃포스트 후보에서 제외한다.
  */

  if (
    file === 0 ||
    file === 7
  ) {

    return false;

  }


  /*
     백 나이트는 흑 진영 쪽,
     흑 나이트는 백 진영 쪽으로
     진입한 경우를 우선 후보로 본다.
  */

  if (
    color === "w" &&
    rank < 4
  ) {

    return false;

  }


  if (
    color === "b" &&
    rank > 3
  ) {

    return false;

  }


  /*
     상대 폰에게 공격받는지 확인한다.
  */

  const board =
    chess.board();


  const enemy =
    oppositeColor(color);


  if (
    isSquareAttackedBy(
      board,
      square,
      enemy
    )
  ) {

    /*
       여기에는 상대 나이트나 다른 기물의 공격도
       포함되므로 실제 '폰으로 쫓아낼 수 없는'
       전형적인 아웃포스트보다 엄격하다.

       따라서 이 단계에서는
       "아웃포스트 후보" 정도로만 기록한다.
    */

    return false;

  }


  return true;
}


/* =========================================================
   비숍 대각선 활동성
========================================================= */

function analyzeBishopDiagonals(
  chess,
  square
) {

  const board =
    chess.board();


  const piece =
    getBoardPiece(
      board,
      square
    );


  if (
    !piece ||
    piece.type !== "b"
  ) {

    return {

      reachableSquares: 0,

      openDiagonals: 0,

      blockedDiagonals: 0,

      longDiagonalAccess: 0

    };

  }


  const {
    file,
    rank
  } = squareToCoords(square);


  const directions = [

    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1]

  ];


  let reachableSquares = 0;

  let openDiagonals = 0;

  let blockedDiagonals = 0;

  let longDiagonalAccess = 0;


  for (
    const [df, dr] of directions
  ) {

    let currentFile =
      file + df;


    let currentRank =
      rank + dr;


    let distance = 0;

    let encounteredBlock =
      false;


    while (
      currentFile >= 0 &&
      currentFile <= 7 &&
      currentRank >= 0 &&
      currentRank <= 7
    ) {

      const currentSquare =
        coordsToSquare(
          currentFile,
          currentRank
        );


      const targetPiece =
        getBoardPiece(
          board,
          currentSquare
        );


      if (targetPiece) {

        /*
           적 기물이 있으면 그 칸까지는
           비숍의 영향 범위에 포함한다.
        */

        if (
          targetPiece.color !==
          piece.color
        ) {

          reachableSquares += 1;

        }


        encounteredBlock = true;

        break;

      }


      reachableSquares += 1;

      distance += 1;


      currentFile += df;

      currentRank += dr;

    }


    if (encounteredBlock) {

      blockedDiagonals += 1;

    } else {

      openDiagonals += 1;

    }


    if (distance >= 3) {

      longDiagonalAccess += 1;

    }

  }


  return {

    reachableSquares,

    openDiagonals,

    blockedDiagonals,

    longDiagonalAccess

  };

}


/* =========================================================
   마이너 피스 한 개 분석
========================================================= */

function analyzeMinorPiece(
  chess,
  pieceData
) {

  const color =
    pieceData.color;


  const type =
    pieceData.type;


  const square =
    pieceData.square;


  const legalMoves =
    chess.moves({

      square,

      verbose: true

    });


  let safeMoves = 0;

  let captureMoves = 0;

  let centralMoves = 0;


  const destinationSquares = [];


  for (
    const move of legalMoves
  ) {

    destinationSquares.push(
      move.to
    );


    if (move.captured) {

      captureMoves += 1;

    }


    const destinationCentrality =
      calculateCentrality(
        move.to
      );


    if (
      destinationCentrality >= 0.65
    ) {

      centralMoves += 1;

    }


    /*
       실제 이동 후의 보드에서
       목적지가 공격받는지 확인한다.

       원래 포지션의 공격 여부만 보는 것보다
       실제 이동 이후를 확인하는 것이 중요하다.
    */

    try {

      const testChess =
        new Chess(
          chess.fen()
        );


      testChess.move({

        from: move.from,

        to: move.to,

        promotion: move.promotion

      });


      const safe =
        !isSquareAttackedBy(

          testChess.board(),

          move.to,

          oppositeColor(color)

        );


      if (safe) {

        safeMoves += 1;

      }

    } catch (error) {

      /*
         특정 이동의 안전성 계산이 실패하더라도
         전체 분석은 계속한다.
      */

    }

  }


  const legalMobility =
    legalMoves.length;


  const mobilityRatio =
    legalMobility > 0
      ? safeMoves / legalMobility
      : 0;


  const centrality =
    calculateCentrality(
      square
    );


  let outpostCandidate =
    false;


  if (type === "n") {

    outpostCandidate =
      isKnightOutpost(
        chess,
        square,
        color
      );

  }


  let bishopInfo = null;


  if (type === "b") {

    bishopInfo =
      analyzeBishopDiagonals(
        chess,
        square
      );

  }


  /*
     내부 활동성 점수

     중요:
     이 값은 Stockfish 평가값이 아니다.
     또한 "비숍/나이트 우열"을 의미하지 않는다.

     현재 단계에서
     활동성의 여러 요소를 하나의 참고값으로
     묶어 놓은 것이다.
  */

  let activityScore = 0;


  /*
     기본 이동성
  */

  activityScore +=
    Math.min(
      legalMobility,
      8
    ) * 4;


  /*
     안전한 이동성
  */

  activityScore +=
    Math.min(
      safeMoves,
      8
    ) * 4;


  /*
     중앙 접근
  */

  activityScore +=
    centrality * 15;


  /*
     잡을 수 있는 기물에 접근
  */

  activityScore +=
    Math.min(
      captureMoves,
      3
    ) * 5;


  /*
     나이트 아웃포스트 후보
  */

  if (outpostCandidate) {

    activityScore += 10;

  }


  /*
     비숍의 긴 대각선 접근
  */

  if (bishopInfo) {

    activityScore +=
      bishopInfo.longDiagonalAccess * 3;

    activityScore +=
      bishopInfo.openDiagonals * 2;

  }


  activityScore =
    Math.min(
      100,
      Math.round(
        activityScore
      )
    );


  return {

    color,

    side:
      colorName(color),

    type,

    name:
      pieceName(type),

    square,

    legalMobility,

    safeMobility:
      safeMoves,

    mobilityRatio,

    captureMoves,

    centralMoves,

    centrality,

    outpostCandidate,

    bishopInfo,

    destinationSquares,

    activityScore

  };

}


/* =========================================================
   ② Superior Minor Piece Analyzer
=========================================================

   목적:

   "비숍이 좋다 / 나이트가 좋다"를 즉시 선언하는 것이
   아니다.

   먼저 실제 포지션에서 각 마이너 피스가

   - 얼마나 움직일 수 있는가
   - 안전한 이동 칸이 얼마나 있는가
   - 중앙에 접근할 수 있는가
   - 상대 기물/폰에 접근할 수 있는가
   - 나이트가 아웃포스트 후보를 가지고 있는가
   - 비숍이 대각선을 얼마나 활용하는가

   를 기록한다.

   이것이 이후 "Superior Minor Piece" 판단의
   기초 데이터가 된다.
========================================================= */

function analyzeSuperiorMinorPieces(
  chess,
  snapshot
) {

  const whitePieces =
    snapshot.white.pieces.filter(
      (piece) =>
        piece.type === "b" ||
        piece.type === "n"
    );


  const blackPieces =
    snapshot.black.pieces.filter(
      (piece) =>
        piece.type === "b" ||
        piece.type === "n"
    );


  const whiteAnalysis =
    whitePieces.map(
      (piece) =>
        analyzeMinorPiece(
          chess,
          piece
        )
    );


  const blackAnalysis =
    blackPieces.map(
      (piece) =>
        analyzeMinorPiece(
          chess,
          piece
        )
    );


  const whiteBishops =
    whiteAnalysis.filter(
      (piece) =>
        piece.type === "b"
    );


  const whiteKnights =
    whiteAnalysis.filter(
      (piece) =>
        piece.type === "n"
    );


  const blackBishops =
    blackAnalysis.filter(
      (piece) =>
        piece.type === "b"
    );


  const blackKnights =
    blackAnalysis.filter(
      (piece) =>
        piece.type === "n"
    );


  function averageActivity(
    pieces
  ) {

    if (!pieces.length) {

      return null;

    }


    const total =
      pieces.reduce(
        (sum, piece) =>
          sum + piece.activityScore,
        0
      );


    return Math.round(
      total / pieces.length
    );

  }


  const whiteAverage =
    averageActivity(
      whiteAnalysis
    );


  const blackAverage =
    averageActivity(
      blackAnalysis
    );


  let activityDifference = null;


  if (
    whiteAverage !== null &&
    blackAverage !== null
  ) {

    activityDifference =
      whiteAverage -
      blackAverage;

  }


  return {

    type:
      "superior_minor_piece",

    white: {

      pieces:
        whiteAnalysis,

      bishops:
        whiteBishops,

      knights:
        whiteKnights,

      bishopCount:
        whiteBishops.length,

      knightCount:
        whiteKnights.length,

      bishopPair:
        whiteBishops.length >= 2,

      averageActivity:
        whiteAverage

    },

    black: {

      pieces:
        blackAnalysis,

      bishops:
        blackBishops,

      knights:
        blackKnights,

      bishopCount:
        blackBishops.length,

      knightCount:
        blackKnights.length,

      bishopPair:
        blackBishops.length >= 2,

      averageActivity:
        blackAverage

    },

    activityDifference,

    /*
       아직 실제 우세 판정을 하지 않는다.
    */

    advantage:
      "undetermined",

    importance: 0

  };

}


/* =========================================================
   Superior Minor Piece 화면용 설명
========================================================= */

function renderMinorPieceList(
  pieces
) {

  if (!pieces.length) {

    return `
      <div class="analysis-note">
        현재 이 진영에는 비숍이나 나이트가 없습니다.
      </div>
    `;

  }


  return pieces.map(
    (piece) => {

      const specialText =
        piece.type === "n"
          ? (
              piece.outpostCandidate
                ? "아웃포스트 후보 있음"
                : "아웃포스트 후보 없음"
            )
          : (
              `긴 대각선 접근 ${piece.bishopInfo.longDiagonalAccess}개`
            );


      return `
        <div class="minor-piece-item">

          <div class="minor-piece-header">

            <strong>
              ${piece.name} ${piece.square}
            </strong>

            <span>
              활동성 ${piece.activityScore}
            </span>

          </div>

          <div class="minor-piece-detail">

            이동 가능 ${piece.legalMobility}

            · 안전한 이동 ${piece.safeMobility}

            · 중앙 접근 ${piece.centralMoves}

            · 잡을 수 있는 기물 ${piece.captureMoves}

          </div>

          <div class="minor-piece-detail">

            ${specialText}

          </div>

        </div>
      `;

    }
  ).join("");

}


/* =========================================================
   Superior Minor Piece 화면
========================================================= */

function renderSuperiorMinorPieceAnalysis(
  minor
) {

  const whiteAverage =
    minor.white.averageActivity;


  const blackAverage =
    minor.black.averageActivity;


  let comparisonText =
    "현재 단계에서는 비숍/나이트의 실제 우열을 확정하지 않습니다.";


  if (
    whiteAverage !== null &&
    blackAverage !== null
  ) {

    if (
      whiteAverage >
      blackAverage
    ) {

      comparisonText =
        `현재 관측된 활동성 참고값은 백 ${whiteAverage}, 흑 ${blackAverage}입니다. ` +
        `다만 이것만으로 어느 쪽의 마이너 피스가 우월하다고 판단하지 않습니다.`;

    } else if (
      blackAverage >
      whiteAverage
    ) {

      comparisonText =
        `현재 관측된 활동성 참고값은 백 ${whiteAverage}, 흑 ${blackAverage}입니다. ` +
        `다만 이것만으로 어느 쪽의 마이너 피스가 우월하다고 판단하지 않습니다.`;

    } else {

      comparisonText =
        `현재 관측된 활동성 참고값은 백과 흑이 ${whiteAverage}로 같습니다. ` +
        `다만 실제 마이너 피스의 질은 다른 불균형과 함께 판단해야 합니다.`;

    }

  }


  return `

    <div class="analysis-card">

      <div class="analysis-card-title">
        우세한 마이너 피스
      </div>

      <div class="analysis-row">
        <span>백 마이너 피스 수</span>
        <strong>
          ${minor.white.pieces.length}
        </strong>
      </div>

      <div class="analysis-row">
        <span>흑 마이너 피스 수</span>
        <strong>
          ${minor.black.pieces.length}
        </strong>
      </div>

      <div class="analysis-row">
        <span>백 활동성 참고값</span>
        <strong>
          ${
            whiteAverage === null
              ? "-"
              : whiteAverage
          }
        </strong>
      </div>

      <div class="analysis-row">
        <span>흑 활동성 참고값</span>
        <strong>
          ${
            blackAverage === null
              ? "-"
              : blackAverage
          }
        </strong>
      </div>

      <div class="analysis-description">
        ${comparisonText}
      </div>

    </div>


    <div class="analysis-card">

      <div class="analysis-card-title">
        백 마이너 피스
      </div>

      ${renderMinorPieceList(
        minor.white.pieces
      )}

    </div>


    <div class="analysis-card">

      <div class="analysis-card-title">
        흑 마이너 피스
      </div>

      ${renderMinorPieceList(
        minor.black.pieces
      )}

    </div>


    <div class="analysis-card">

      <div class="analysis-card-title">
        현재 단계의 해석
      </div>

      <div class="analysis-description">

        비숍은 대각선의 개방 정도와 장거리 접근을,
        나이트는 이동 가능 칸과 안전한 이동,
        중앙 접근 및 아웃포스트 후보를 기록합니다.

      </div>

      <div class="analysis-note">

        "활동성 참고값"은 ChessSense 내부 분석값이며
        Stockfish 평가값이나 실제 승률이 아닙니다.
        또한 이 단계에서는 비숍과 나이트 중 어느 쪽이
        "우세한 마이너 피스"인지 최종 판정하지 않습니다.

      </div>

    </div>

  `;

}


/* =========================================================
   Material Analyzer 화면
========================================================= */

function renderMaterialAnalysis(
  material
) {

  let description = "";


  if (
    material.advantage === "equal"
  ) {

    description =
      "양쪽의 물질 가치가 거의 같습니다.";

  } else if (
    material.advantage === "white"
  ) {

    description =
      `백이 물질적으로 +${formatScore(
        material.difference
      )}입니다.`;

  } else {

    description =
      `흑이 물질적으로 +${formatScore(
        Math.abs(
          material.difference
        )
      )}입니다.`;

  }


  return `

    <div class="analysis-card">

      <div class="analysis-card-title">
        물질
      </div>

      <div class="analysis-row">
        <span>백</span>
        <strong>
          ${formatScore(
            material.white.total
          )}
        </strong>
      </div>

      <div class="analysis-row">
        <span>흑</span>
        <strong>
          ${formatScore(
            material.black.total
          )}
        </strong>
      </div>

      <div class="analysis-row">
        <span>차이</span>
        <strong>
          ${formatScore(
            material.difference
          )}
        </strong>
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


function renderBoard(
  snapshot
) {

  boardElement.innerHTML = "";


  const boardGrid =
    document.createElement(
      "div"
    );


  boardGrid.className =
    "chess-board";


  const piecesBySquare = {};


  for (
    const piece of snapshot.board
  ) {

    piecesBySquare[
      piece.square
    ] = piece;

  }


  for (
    let rank = 8;
    rank >= 1;
    rank--
  ) {

    for (
      let fileIndex = 0;
      fileIndex < 8;
      fileIndex++
    ) {

      const file =
        String.fromCharCode(
          97 + fileIndex
        );


      const square =
        `${file}${rank}`;


      const squareElement =
        document.createElement(
          "div"
        );


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
        piecesBySquare[
          square
        ];


      if (piece) {

        const pieceElement =
          document.createElement(
            "span"
          );


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

    ${renderMaterialAnalysis(
      material
    )}

    ${renderSuperiorMinorPieceAnalysis(
      snapshot.minorPieces
    )}

    <div class="snapshot-card">

      <div class="snapshot-row">
        <span>현재 차례</span>
        <strong>
          ${sideToMove}
        </strong>
      </div>

      <div class="snapshot-row">
        <span>백 기물 수</span>
        <strong>
          ${whitePieces}
        </strong>
      </div>

      <div class="snapshot-row">
        <span>흑 기물 수</span>
        <strong>
          ${blackPieces}
        </strong>
      </div>

      <div class="snapshot-row">
        <span>체크</span>
        <strong>
          ${
            snapshot.inCheck
              ? "있음"
              : "없음"
          }
        </strong>
      </div>

      <div class="snapshot-note">

        현재 단계에서는 체스판의 사실 관계,
        물질 구조, 마이너 피스의 활동성을
        수집합니다.

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

      fen:
        snapshot.fen,

      turn:
        colorName(
          snapshot.turn
        ),

      fullmoveNumber:
        snapshot.fullmoveNumber,

      inCheck:
        snapshot.inCheck

    },


    material: {

      pieceValues:
        PIECE_VALUES,

      white:
        material.white,

      black:
        material.black,

      difference:
        material.difference,

      advantage:
        material.advantage

    },


    superiorMinorPiece:
      snapshot.minorPieces,


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

    chess.loadPgn(
      pgn
    );


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

    console.error(
      error
    );


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
