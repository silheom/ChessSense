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
   현재 Pawn Snapshot
========================================================= */

let currentPawnSnapshot = null;


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

    minorPieces: null,

    pawnStructure: null

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
    먼저 폰 구조의 사실을 수집한다.

    마이너 피스 평가에서 현재 폰 구조와의
    관계를 참고하기 위해 이 순서가 필요하다.
  */

  snapshot.pawnStructure =
    analyzePawnStructure(
      chess,
      snapshot
    );


  /*
    그 다음 마이너 피스를 평가한다.

    아직 공간/파일/전개/이니셔티브는
    평가하지 않는다.
  */

  snapshot.minorPieces =
    analyzeSuperiorMinorPieces(
      chess,
      snapshot
    );


  return snapshot;
}


/* =========================================================
   Material Analyzer
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
   특정 기물의 색에 맞춰 합법적인 이동을 계산
========================================================= */

function getLegalMovesForPiece(
  chess,
  square,
  color
) {

  try {

    const fen =
      chess.fen();


    const fenParts =
      fen.split(" ");


    fenParts[1] =
      color;


    const testChess =
      new Chess(
        fenParts.join(" ")
      );


    return testChess.moves({

      square,

      verbose: true

    });

  } catch (error) {

    return [];

  }

}


/* =========================================================
   특정 기물의 색에 맞춘 테스트용 Chess 객체
========================================================= */

function createChessForColor(
  chess,
  color
) {

  const fen =
    chess.fen();


  const fenParts =
    fen.split(" ");


  fenParts[1] =
    color;


  return new Chess(
    fenParts.join(" ")
  );

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


  if (
    file === 0 ||
    file === 7
  ) {

    return false;

  }


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
    getLegalMovesForPiece(
      chess,
      square,
      color
    );


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


    try {

      const testChess =
        createChessForColor(
          chess,
          color
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
         안전성 계산 실패는
         전체 분석을 중단시키지 않는다.
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


  let activityScore = 0;


  activityScore +=
    Math.min(
      legalMobility,
      8
    ) * 4;


  activityScore +=
    Math.min(
      safeMoves,
      8
    ) * 4;


  activityScore +=
    centrality * 15;


  activityScore +=
    Math.min(
      captureMoves,
      3
    ) * 5;


  if (outpostCandidate) {

    activityScore += 10;

  }


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
   마이너 피스의 폰 구조 적합성
=========================================================

   이것은 "비숍은 좋고 나이트는 나쁘다" 같은
   일반 규칙을 적용하는 함수가 아니다.

   현재 포지션에서 해당 기물이 실제 폰 구조와
   어떤 관계를 갖는지 기록한다.
========================================================= */

function evaluatePawnFitForMinorPiece(
  piece,
  pawnStructure
) {

  if (!pawnStructure) {

    return {

      score: 0,

      reasons: []

    };

  }


  const sideData =
    piece.color === "w"
      ? pawnStructure.white
      : pawnStructure.black;


  const reasons = [];

  let score = 0;


  if (piece.type === "b") {

    const ownPawns =
      sideData.pawns || [];


    const sameColorPawnCount =
      ownPawns.length;


    /*
       비숍의 대각선을 막을 수 있는
       자기 폰의 존재를 간접적으로 기록한다.
    */

    const bishopInfo =
      piece.bishopInfo;


    if (
      bishopInfo &&
      bishopInfo.blockedDiagonals === 0
    ) {

      score += 8;

      reasons.push(
        "자기 폰에 의해 막힌 대각선이 적음"
      );

    } else if (
      bishopInfo &&
      bishopInfo.blockedDiagonals >= 2
    ) {

      score -= 8;

      reasons.push(
        "자기 폰에 의해 막힌 대각선이 많음"
      );

    }


    if (
      bishopInfo &&
      bishopInfo.longDiagonalAccess >= 1
    ) {

      score += 5;

      reasons.push(
        "장거리 대각선 접근 가능"
      );

    }


    /*
       폰 수 자체는 우열의 근거가 아니므로
       직접 점수에는 넣지 않는다.
    */

    void sameColorPawnCount;

  }


  if (piece.type === "n") {

    if (
      piece.outpostCandidate
    ) {

      score += 10;

      reasons.push(
        "현재 칸에서 아웃포스트 후보 성격이 있음"
      );

    }


    if (
      piece.centralMoves >= 2
    ) {

      score += 5;

      reasons.push(
        "여러 중앙 접근 경로를 가짐"
      );

    }


    /*
       나이트는 현재 폰 구조에서
       공격 대상이 되는 폰과 접근 경로가
       존재하는지 추가로 기록한다.
    */

    const targetCount =
      sideData.targets
        ? sideData.targets.length
        : 0;


    void targetCount;

  }


  return {

    score,

    reasons

  };

}


/* =========================================================
   마이너 피스 실전적 가치 평가
=========================================================

   중요:
   이 값은 Stockfish 평가값이 아니다.

   다음 정보를 조합한 ChessSense 내부 지표다.

   - 활동성
   - 안전한 이동
   - 중앙 접근
   - 아웃포스트 후보
   - 비숍 대각선
   - 폰 구조와의 관계
   - 같은 진영의 다른 마이너 피스와의 관계

   이 단계에서는 "확정적인 우세"보다
   "실전적 우세 후보"를 찾는 것을 목표로 한다.
========================================================= */

function evaluateMinorPieceQuality(
  piece,
  sideData,
  pawnStructure
) {

  let score =
    piece.activityScore;


  const reasons = [];


  /*
     안전성
  */

  if (
    piece.mobilityRatio >= 0.60
  ) {

    score += 7;

    reasons.push(
      "안전하게 이동할 수 있는 칸의 비율이 높음"
    );

  } else if (
    piece.mobilityRatio < 0.30
  ) {

    score -= 6;

    reasons.push(
      "안전한 이동 칸이 제한적임"
    );

  }


  /*
     중앙 접근
  */

  if (
    piece.centralMoves >= 2
  ) {

    score += 4;

    reasons.push(
      "중앙으로 접근할 수 있는 이동이 여러 개 있음"
    );

  }


  /*
     나이트
  */

  if (
    piece.type === "n"
  ) {

    if (
      piece.outpostCandidate
    ) {

      score += 10;

      reasons.push(
        "현재 위치에 아웃포스트 후보 성격이 있음"
      );

    }


    if (
      piece.captureMoves >= 2
    ) {

      score += 3;

      reasons.push(
        "현재 위치에서 여러 기물을 공격할 수 있음"
      );

    }

  }


  /*
     비숍
  */

  if (
    piece.type === "b" &&
    piece.bishopInfo
  ) {

    if (
      piece.bishopInfo.longDiagonalAccess >= 1
    ) {

      score += 5;

      reasons.push(
        "장거리 대각선에 접근할 수 있음"
      );

    }


    if (
      piece.bishopInfo.blockedDiagonals >= 2
    ) {

      score -= 5;

      reasons.push(
        "현재 대각선 일부가 막혀 있음"
      );

    }

  }


  /*
     폰 구조와의 관계
  */

  const pawnFit =
    evaluatePawnFitForMinorPiece(
      piece,
      pawnStructure
    );


  score +=
    pawnFit.score;


  for (
    const reason of pawnFit.reasons
  ) {

    if (
      !reasons.includes(reason)
    ) {

      reasons.push(reason);

    }

  }


  /*
     같은 진영의 다른 마이너 피스가
     너무 적어지는 경우에는 단순 평균 비교가
     왜곡될 수 있으므로 개별 점수는 별도로 보존한다.
  */

  void sideData;


  score =
    Math.max(
      0,
      Math.min(
        120,
        Math.round(score)
      )
    );


  return {

    score,

    reasons

  };

}


/* =========================================================
   마이너 피스 우세 판단
========================================================= */

function determineMinorPieceAdvantage(
  whitePieces,
  blackPieces,
  whiteAverage,
  blackAverage
) {

  if (
    whiteAverage === null ||
    blackAverage === null
  ) {

    return {

      side: null,

      label:
        "비교 불가",

      difference: null,

      confidence:
        "low",

      reasons: []

    };

  }


  const difference =
    whiteAverage -
    blackAverage;


  /*
     차이가 아주 작은 경우에는
     억지로 우세를 선언하지 않는다.
  */

  if (
    Math.abs(difference) < 5
  ) {

    return {

      side: null,

      label:
        "뚜렷한 우세 없음",

      difference,

      confidence:
        "low",

      reasons: [

        "양쪽 마이너 피스의 실전적 가치 차이가 크지 않음"

      ]

    };

  }


  const side =
    difference > 0
      ? "w"
      : "b";


  const sidePieces =
    side === "w"
      ? whitePieces
      : blackPieces;


  const opponentPieces =
    side === "w"
      ? blackPieces
      : whitePieces;


  const strongestPiece =
    [...sidePieces]
      .sort(
        (a, b) =>
          b.qualityScore -
          a.qualityScore
      )[0];


  const weakestOpponentPiece =
    [...opponentPieces]
      .sort(
        (a, b) =>
          a.qualityScore -
          b.qualityScore
      )[0];


  const reasons = [];


  if (
    strongestPiece &&
    strongestPiece.reasons.length
  ) {

    reasons.push(
      `${colorName(side)} ${strongestPiece.name} ${strongestPiece.square}: ` +
      strongestPiece.reasons[0]
    );

  }


  if (
    strongestPiece &&
    strongestPiece.outpostCandidate
  ) {

    reasons.push(
      `${colorName(side)}의 ${strongestPiece.name}이 현재 위치를 유지할 가능성을 추가 확인할 필요가 있음`
    );

  }


  if (
    weakestOpponentPiece
  ) {

    reasons.push(
      `${colorName(oppositeColor(side))}의 ` +
      `${weakestOpponentPiece.name} ${weakestOpponentPiece.square}보다 ` +
      `활용 가능한 요소가 더 많이 관측됨`
    );

  }


  /*
     차이가 너무 크다고 해서 곧바로
     확정적인 전략적 우세라고 부르지 않는다.
  */

  let confidence =
    "medium";


  if (
    Math.abs(difference) >= 15
  ) {

    confidence =
      "high";

  }


  return {

    side,

    label:
      `${colorName(side)} 우세 후보`,

    difference,

    confidence,

    reasons

  };

}


/* =========================================================
   ② Superior Minor Piece Analyzer
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


  function averageQuality(
    pieces
  ) {

    if (!pieces.length) {

      return null;

    }


    const total =
      pieces.reduce(
        (sum, piece) =>
          sum + piece.qualityScore,
        0
      );


    return Math.round(
      total / pieces.length
    );

  }


  /*
     개별 기물의 실전적 가치 평가
  */

  for (
    const piece of whiteAnalysis
  ) {

    const quality =
      evaluateMinorPieceQuality(
        piece,
        snapshot.white,
        snapshot.pawnStructure
      );


    piece.qualityScore =
      quality.score;


    piece.qualityReasons =
      quality.reasons;

  }


  for (
    const piece of blackAnalysis
  ) {

    const quality =
      evaluateMinorPieceQuality(
        piece,
        snapshot.black,
        snapshot.pawnStructure
      );


    piece.qualityScore =
      quality.score;


    piece.qualityReasons =
      quality.reasons;

  }


  const whiteAverage =
    averageActivity(
      whiteAnalysis
    );


  const blackAverage =
    averageActivity(
      blackAnalysis
    );


  const whiteQualityAverage =
    averageQuality(
      whiteAnalysis
    );


  const blackQualityAverage =
    averageQuality(
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


  let qualityDifference = null;


  if (
    whiteQualityAverage !== null &&
    blackQualityAverage !== null
  ) {

    qualityDifference =
      whiteQualityAverage -
      blackQualityAverage;

  }


  const advantage =
    determineMinorPieceAdvantage(
      whiteAnalysis,
      blackAnalysis,
      whiteQualityAverage,
      blackQualityAverage
    );


  /*
     bishop pair는 보조적인 정보로만 기록한다.
     이것 하나만으로 우세를 확정하지 않는다.
  */

  const whiteBishopPair =
    whiteBishops.length >= 2;


  const blackBishopPair =
    blackBishops.length >= 2;


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
        whiteBishopPair,

      averageActivity:
        whiteAverage,

      averageQuality:
        whiteQualityAverage

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
        blackBishopPair,

      averageActivity:
        blackAverage,

      averageQuality:
        blackQualityAverage

    },

    activityDifference,

    qualityDifference,

    advantage,

    importance:
      Math.min(
        1,
        Math.abs(
          qualityDifference || 0
        ) / 30
      ),

    bishopPair: {

      white:
        whiteBishopPair,

      black:
        blackBishopPair

    }

  };

}


/* =========================================================
   ③ Pawn Structure
=========================================================

   여기서는 폰 구조의 "사실"을 수집한다.

   중요:
   고립 폰 = 무조건 약점
   더블 폰 = 무조건 약점
   패스드 폰 = 무조건 강점

   으로 판단하지 않는다.

   실제 약점/강점 여부는 이후
   공격 가능성, 방어 가능성, 활동성,
   공간, 열린 파일, 계획과 함께 판단한다.
========================================================= */


/* ---------------------------------------------------------
   폰 정보 가져오기
--------------------------------------------------------- */

function getPawnsByColor(
  snapshot,
  color
) {

  return (
    color === "w"
      ? snapshot.white.pawns
      : snapshot.black.pawns
  );

}


/* ---------------------------------------------------------
   같은 파일의 폰
--------------------------------------------------------- */

function getPawnsOnFile(
  pawns,
  file
) {

  return pawns.filter(
    (pawn) =>
      pawn.square[0] === file
  );

}


/* ---------------------------------------------------------
   인접 파일
--------------------------------------------------------- */

function adjacentFiles(file) {

  const index =
    file.charCodeAt(0) - 97;


  const result = [];


  if (index > 0) {

    result.push(
      String.fromCharCode(
        97 + index - 1
      )
    );

  }


  if (index < 7) {

    result.push(
      String.fromCharCode(
        97 + index + 1
      )
    );

  }


  return result;

}


/* ---------------------------------------------------------
   상대 폰이 전진 방향에 존재하는지
--------------------------------------------------------- */

function enemyPawnAhead(
  snapshot,
  pawn,
  color
) {

  const enemy =
    oppositeColor(color);


  const enemyPawns =
    getPawnsByColor(
      snapshot,
      enemy
    );


  const {
    file,
    rank
  } = squareToCoords(
    pawn.square
  );


  for (
    const enemyPawn of enemyPawns
  ) {

    const enemyCoords =
      squareToCoords(
        enemyPawn.square
      );


    if (
      Math.abs(
        enemyCoords.file - file
      ) > 1
    ) {

      continue;

    }


    if (color === "w") {

      if (
        enemyCoords.rank > rank
      ) {

        return true;

      }

    } else {

      if (
        enemyCoords.rank < rank
      ) {

        return true;

      }

    }

  }


  return false;
}


/* ---------------------------------------------------------
   상대 폰이 같은 파일에 존재하는지
--------------------------------------------------------- */

function enemyPawnOnSameFile(
  snapshot,
  pawn,
  color
) {

  const enemy =
    oppositeColor(color);


  const enemyPawns =
    getPawnsByColor(
      snapshot,
      enemy
    );


  return enemyPawns.some(
    (enemyPawn) =>
      enemyPawn.square[0] ===
      pawn.square[0]
  );

}


/* ---------------------------------------------------------
   패스드 폰
--------------------------------------------------------- */

function isPassedPawn(
  snapshot,
  pawn,
  color
) {

  return !enemyPawnAhead(
    snapshot,
    pawn,
    color
  );

}


/* ---------------------------------------------------------
   연결된 폰
--------------------------------------------------------- */

function isConnectedPawn(
  pawns,
  pawn
) {

  const fileIndex =
    pawn.square.charCodeAt(0) - 97;


  const rank =
    Number(
      pawn.square[1]
    );


  return pawns.some(
    (other) => {

      if (
        other.square ===
        pawn.square
      ) {

        return false;

      }


      const otherFile =
        other.square.charCodeAt(0) - 97;


      const otherRank =
        Number(
          other.square[1]
        );


      return (
        Math.abs(
          otherFile - fileIndex
        ) === 1 &&
        otherRank === rank
      );

    }
  );

}


/* ---------------------------------------------------------
   폰 전진 가능성
--------------------------------------------------------- */

function canPawnAdvance(
  chess,
  pawn
) {

  try {

    const moves =
      getLegalMovesForPiece(
        chess,
        pawn.square,
        pawn.color
      );


    return moves.some(
      (move) =>
        move.to[0] ===
        pawn.square[0]
    );

  } catch (error) {

    return false;

  }

}


/* ---------------------------------------------------------
   폰 방어자
--------------------------------------------------------- */

function findPawnDefenders(
  chess,
  pawn
) {

  const color =
    pawn.color;


  const board =
    chess.board();


  const defenders = [];


  for (
    const piece of (
      color === "w"
        ? currentPawnSnapshot.white.pieces
        : currentPawnSnapshot.black.pieces
    )
  ) {

    if (
      piece.square ===
      pawn.square
    ) {

      continue;

    }


    if (
      isPieceAttackingSquare(
        board,
        piece.square,
        pawn.square,
        color
      )
    ) {

      defenders.push(
        piece.square
      );

    }

  }


  return defenders;

}


/* ---------------------------------------------------------
   기물이 특정 칸을 공격하는지
--------------------------------------------------------- */

function isPieceAttackingSquare(
  board,
  fromSquare,
  targetSquare,
  color
) {

  const piece =
    getBoardPiece(
      board,
      fromSquare
    );


  if (
    !piece ||
    piece.color !== color
  ) {

    return false;

  }


  const from =
    squareToCoords(
      fromSquare
    );


  const target =
    squareToCoords(
      targetSquare
    );


  const df =
    target.file -
    from.file;


  const dr =
    target.rank -
    from.rank;


  /*
     폰
  */

  if (
    piece.type === "p"
  ) {

    const direction =
      color === "w"
        ? 1
        : -1;


    return (
      dr === direction &&
      Math.abs(df) === 1
    );

  }


  /*
     나이트
  */

  if (
    piece.type === "n"
  ) {

    return (
      (
        Math.abs(df) === 1 &&
        Math.abs(dr) === 2
      ) ||
      (
        Math.abs(df) === 2 &&
        Math.abs(dr) === 1
      )
    );

  }


  /*
     킹
  */

  if (
    piece.type === "k"
  ) {

    return (
      Math.abs(df) <= 1 &&
      Math.abs(dr) <= 1 &&
      !(df === 0 && dr === 0)
    );

  }


  /*
     룩 / 퀸 직선
  */

  if (
    piece.type === "r" ||
    piece.type === "q"
  ) {

    if (
      df === 0 ||
      dr === 0
    ) {

      const stepFile =
        Math.sign(df);


      const stepRank =
        Math.sign(dr);


      let file =
        from.file +
        stepFile;


      let rank =
        from.rank +
        stepRank;


      while (
        file !== target.file ||
        rank !== target.rank
      ) {

        const square =
          coordsToSquare(
            file,
            rank
          );


        if (
          getBoardPiece(
            board,
            square
          )
        ) {

          return false;

        }


        file += stepFile;
        rank += stepRank;

      }


      return true;

    }

  }


  /*
     비숍 / 퀸 대각선
  */

  if (
    piece.type === "b" ||
    piece.type === "q"
  ) {

    if (
      Math.abs(df) !==
      Math.abs(dr)
    ) {

      return false;

    }


    const stepFile =
      Math.sign(df);


    const stepRank =
      Math.sign(dr);


    let file =
      from.file +
      stepFile;


    let rank =
      from.rank +
      stepRank;


    while (
      file !== target.file ||
      rank !== target.rank
    ) {

      const square =
        coordsToSquare(
          file,
          rank
        );


      if (
        getBoardPiece(
          board,
          square
        )
      ) {

        return false;

      }


      file += stepFile;
      rank += stepRank;

    }


    return true;

  }


  return false;
}


/* ---------------------------------------------------------
   폰 브레이크 후보
--------------------------------------------------------- */

function findPawnBreaks(
  chess,
  snapshot,
  color
) {

  const pawns =
    getPawnsByColor(
      snapshot,
      color
    );


  const breaks = [];


  for (
    const pawn of pawns
  ) {

    const moves =
      getLegalMovesForPiece(
        chess,
        pawn.square,
        color
      );


    for (
      const move of moves
    ) {

      if (
        move.captured === "p"
      ) {

        breaks.push({

          from:
            move.from,

          to:
            move.to,

          type:
            "capture",

          san:
            move.san

        });

      }

    }


    for (
      const move of moves
    ) {

      if (
        move.captured
      ) {

        continue;

      }


      if (
        move.to[0] ===
        pawn.square[0]
      ) {

        const targetRank =
          Number(
            move.to[1]
          );


        const enemy =
          oppositeColor(color);


        const enemyPawns =
          getPawnsByColor(
            snapshot,
            enemy
          );


        const createsContact =
          enemyPawns.some(
            (enemyPawn) => {

              const ef =
                enemyPawn.square
                  .charCodeAt(0) - 97;


              const tf =
                move.to
                  .charCodeAt(0) - 97;


              const er =
                Number(
                  enemyPawn.square[1]
                );


              return (
                Math.abs(
                  ef - tf
                ) <= 1 &&
                Math.abs(
                  er - targetRank
                ) <= 1
              );

            }
          );


        if (
          createsContact
        ) {

          breaks.push({

            from:
              move.from,

            to:
              move.to,

            type:
              "advance",

            san:
              move.san

          });

        }

      }

    }

  }


  return breaks;
}


/* ---------------------------------------------------------
   폰 타깃 후보
--------------------------------------------------------- */

function findPawnTargets(
  chess,
  snapshot,
  color
) {

  const pawns =
    getPawnsByColor(
      snapshot,
      color
    );


  const enemy =
    oppositeColor(color);


  const enemyPieces =
    enemy === "w"
      ? snapshot.white.pieces
      : snapshot.black.pieces;


  const targets = [];


  for (
    const pawn of pawns
  ) {

    const attackers = [];


    for (
      const piece of enemyPieces
    ) {

      if (
        isPieceAttackingSquare(
          chess.board(),
          piece.square,
          pawn.square,
          enemy
        )
      ) {

        attackers.push(
          piece.square
        );

      }

    }


    if (
      attackers.length > 0
    ) {

      targets.push({

        square:
          pawn.square,

        attackers

      });

    }

  }


  return targets;
}


/* ---------------------------------------------------------
   백워드 폰 후보
--------------------------------------------------------- */

function isBackwardPawnCandidate(
  snapshot,
  pawn,
  color
) {

  const pawns =
    getPawnsByColor(
      snapshot,
      color
    );


  const fileIndex =
    pawn.square.charCodeAt(0) - 97;


  const rank =
    Number(
      pawn.square[1]
    );


  const adjacent =
    pawns.filter(
      (other) => {

        if (
          other.square ===
          pawn.square
        ) {

          return false;

        }


        const otherFile =
          other.square.charCodeAt(0) - 97;


        return (
          Math.abs(
            otherFile -
            fileIndex
          ) === 1
        );

      }
    );


  if (!adjacent.length) {

    return false;

  }


  if (color === "w") {

    const moreAdvancedNeighbor =
      adjacent.some(
        (other) =>
          Number(
            other.square[1]
          ) > rank
      );


    if (
      !moreAdvancedNeighbor
    ) {

      return false;

    }

  } else {

    const moreAdvancedNeighbor =
      adjacent.some(
        (other) =>
          Number(
            other.square[1]
          ) < rank
      );


    if (
      !moreAdvancedNeighbor
    ) {

      return false;

    }

  }


  return enemyPawnAhead(
    snapshot,
    pawn,
    color
  );

}


/* ---------------------------------------------------------
   폰 체인
--------------------------------------------------------- */

function findPawnChains(
  pawns,
  color
) {

  const chains = [];

  const visited =
    new Set();


  function pawnKey(pawn) {

    return pawn.square;

  }


  for (
    const startPawn of pawns
  ) {

    if (
      visited.has(
        pawnKey(startPawn)
      )
    ) {

      continue;

    }


    const chain = [];


    const queue = [
      startPawn
    ];


    while (
      queue.length
    ) {

      const pawn =
        queue.shift();


      const key =
        pawnKey(pawn);


      if (
        visited.has(key)
      ) {

        continue;

      }


      visited.add(key);

      chain.push(
        pawn.square
      );


      const fileIndex =
        pawn.square
          .charCodeAt(0) - 97;


      const rank =
        Number(
          pawn.square[1]
        );


      for (
        const other of pawns
      ) {

        if (
          visited.has(
            pawnKey(other)
          )
        ) {

          continue;

        }


        const otherFile =
          other.square
            .charCodeAt(0) - 97;


        const otherRank =
          Number(
            other.square[1]
          );


        if (
          Math.abs(
            otherFile -
            fileIndex
          ) === 1 &&
          (
            otherRank === rank ||
            Math.abs(
              otherRank -
              rank
            ) === 1
          )
        ) {

          queue.push(
            other
          );

        }

      }

    }


    if (
      chain.length >= 2
    ) {

      chains.push(
        chain
      );

    }

  }


  return chains;
}


/* ---------------------------------------------------------
   체인의 기초 / 끝
--------------------------------------------------------- */

function chainBaseAndTip(
  chain,
  color
) {

  if (
    !chain.length
  ) {

    return {

      base: null,

      tip: null

    };

  }


  const sorted =
    [...chain].sort(
      (a, b) => {

        const rankA =
          Number(
            a[1]
          );


        const rankB =
          Number(
            b[1]
          );


        return color === "w"
          ? rankA - rankB
          : rankB - rankA;

      }
    );


  return {

    base:
      sorted[0],

    tip:
      sorted[
        sorted.length - 1
      ]

  };

}


/* ---------------------------------------------------------
   보호된 패스드 폰 안전 계산
--------------------------------------------------------- */

function isProtectedPassedPawnSafe(
  pawns,
  pawn
) {

  const fileIndex =
    pawn.square.charCodeAt(0) - 97;


  const rank =
    Number(
      pawn.square[1]
    );


  return pawns.some(
    (other) => {

      if (
        other.square ===
        pawn.square
      ) {

        return false;

      }


      const otherFile =
        other.square
          .charCodeAt(0) - 97;


      const otherRank =
        Number(
          other.square[1]
        );


      return (
        Math.abs(
          otherFile -
          fileIndex
        ) === 1 &&
        (
          otherRank === rank - 1 ||
          otherRank === rank + 1
        )
      );

    }
  );

}


/* ---------------------------------------------------------
   한 진영의 폰 구조 분석
--------------------------------------------------------- */

function analyzePawnSide(
  chess,
  snapshot,
  color
) {

  const pawns =
    getPawnsByColor(
      snapshot,
      color
    );


  const files = {};


  for (
    const file of "abcdefgh"
  ) {

    files[file] =
      getPawnsOnFile(
        pawns,
        file
      );

  }


  const doubled = [];


  for (
    const file of Object.keys(files)
  ) {

    if (
      files[file].length >= 2
    ) {

      doubled.push({

        file,

        pawns:
          files[file].map(
            (pawn) =>
              pawn.square
          )

      });

    }

  }


  const isolated = [];


  for (
    const pawn of pawns
  ) {

    const adjacent =
      adjacentFiles(
        pawn.square[0]
      );


    const hasFriendlyAdjacentPawn =
      adjacent.some(
        (file) =>
          files[file].length > 0
      );


    if (
      !hasFriendlyAdjacentPawn
    ) {

      isolated.push(
        pawn.square
      );

    }

  }


  const passed = [];

  const protectedPassed = [];

  const connected = [];

  const backward = [];


  for (
    const pawn of pawns
  ) {

    if (
      isPassedPawn(
        snapshot,
        pawn,
        color
      )
    ) {

      passed.push(
        pawn.square
      );


      if (
        isProtectedPassedPawnSafe(
          pawns,
          pawn
        )
      ) {

        protectedPassed.push(
          pawn.square
        );

      }

    }


    if (
      isConnectedPawn(
        pawns,
        pawn
      )
    ) {

      connected.push(
        pawn.square
      );

    }


    if (
      isBackwardPawnCandidate(
        snapshot,
        pawn,
        color
      )
    ) {

      backward.push(
        pawn.square
      );

    }

  }


  const chains =
    findPawnChains(
      pawns,
      color
    );


  const chainDetails =
    chains.map(
      (chain) => {

        const ends =
          chainBaseAndTip(
            chain,
            color
          );


        return {

          pawns:
            chain,

          base:
            ends.base,

          tip:
            ends.tip

        };

      }
    );


  const pawnDetails =
    pawns.map(
      (pawn) => {

        const defenders =
          findPawnDefenders(
            chess,
            pawn
          );


        return {

          square:
            pawn.square,

          isDoubled:
            files[
              pawn.square[0]
            ].length >= 2,

          isIsolated:
            isolated.includes(
              pawn.square
            ),

          isPassed:
            passed.includes(
              pawn.square
            ),

          isProtectedPassed:
            protectedPassed.includes(
              pawn.square
            ),

          isConnected:
            connected.includes(
              pawn.square
            ),

          isBackwardCandidate:
            backward.includes(
              pawn.square
            ),

          canAdvance:
            canPawnAdvance(
              chess,
              pawn
            ),

          defenders

        };

      }
    );


  const breaks =
    findPawnBreaks(
      chess,
      snapshot,
      color
    );


  const targets =
    findPawnTargets(
      chess,
      snapshot,
      color
    );


  return {

    color,

    side:
      colorName(color),

    pawnCount:
      pawns.length,

    pawns:
      pawnDetails,

    doubled,

    isolated,

    backward,

    connected,

    passed,

    protectedPassed,

    chains:
      chainDetails,

    breaks,

    targets

  };

}


/* ---------------------------------------------------------
   전체 Pawn Structure
--------------------------------------------------------- */

function analyzePawnStructure(
  chess,
  snapshot
) {

  currentPawnSnapshot =
    snapshot;


  const white =
    analyzePawnSide(
      chess,
      snapshot,
      "w"
    );


  const black =
    analyzePawnSide(
      chess,
      snapshot,
      "b"
    );


  return {

    type:
      "pawn_structure",

    white,

    black,

    advantage:
      "undetermined",

    importance: 0

  };

}


/* =========================================================
   Superior Minor Piece 화면
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


      const qualityText =
        piece.qualityScore !== undefined
          ? `실전적 가치 참고값 ${piece.qualityScore}`
          : "";


      const reasonText =
        piece.qualityReasons &&
        piece.qualityReasons.length
          ? piece.qualityReasons
              .slice(0, 2)
              .join(" · ")
          : "추가적인 우세 근거가 뚜렷하지 않음";


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

          <div class="minor-piece-detail">

            ${qualityText}

          </div>

          <div class="minor-piece-detail">

            ${reasonText}

          </div>

        </div>
      `;

    }
  ).join("");

}


function renderSuperiorMinorPieceAnalysis(
  minor
) {

  const whiteAverage =
    minor.white.averageActivity;


  const blackAverage =
    minor.black.averageActivity;


  const whiteQuality =
    minor.white.averageQuality;


  const blackQuality =
    minor.black.averageQuality;


  let comparisonText =
    "현재는 어느 쪽이 확실히 우월한지 판단하기 어렵습니다.";


  let advantageText =
    "뚜렷한 실전적 우세 후보 없음";


  if (
    minor.advantage
  ) {

    advantageText =
      minor.advantage.label;

  }


  if (
    minor.advantage &&
    minor.advantage.reasons &&
    minor.advantage.reasons.length
  ) {

    comparisonText =
      minor.advantage.reasons.join(" ");

  }


  const confidenceText = {

    low:
      "판단 신뢰도 낮음",

    medium:
      "판단 신뢰도 중간",

    high:
      "판단 신뢰도 높음"

  }[
    minor.advantage?.confidence
  ] || "판단 신뢰도 낮음";


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

      <div class="analysis-row">
        <span>백 실전적 가치 참고값</span>
        <strong>
          ${
            whiteQuality === null
              ? "-"
              : whiteQuality
          }
        </strong>
      </div>

      <div class="analysis-row">
        <span>흑 실전적 가치 참고값</span>
        <strong>
          ${
            blackQuality === null
              ? "-"
              : blackQuality
          }
        </strong>
      </div>

      <div class="analysis-description">

        <strong>
          ${advantageText}
        </strong>

      </div>

      <div class="analysis-description">

        ${comparisonText}

      </div>

      <div class="analysis-note">

        ${confidenceText}

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

        이번 단계에서는 단순한 이동 가능 수만 비교하지 않고,
        안전한 이동, 중앙 접근, 아웃포스트 후보,
        비숍의 대각선 활용, 현재 폰 구조와의 관계를
        함께 기록하여 마이너 피스의 실전적 가치를 추정합니다.

      </div>

      <div class="analysis-note">

        "활동성 참고값"과 "실전적 가치 참고값"은
        ChessSense 내부 분석값이며 Stockfish 평가값이나
        실제 승률이 아닙니다.

        또한 이 단계의 "우세 후보"는 최종적인 포지션 평가가 아닙니다.
        이후 공간, 주요 파일과 칸, 전개, 이니셔티브 등의
        다른 불균형과 함께 다시 판단해야 합니다.

      </div>

    </div>

  `;

}


/* =========================================================
   Pawn Structure 화면
========================================================= */

function pawnListText(
  items
) {

  if (
    !items ||
    !items.length
  ) {

    return "없음";

  }


  return items.join(", ");

}


function renderPawnSide(
  side
) {

  const doubledText =
    side.doubled.length
      ? side.doubled
          .map(
            (item) =>
              `${item.file}-파일 (${item.pawns.join(", ")})`
          )
          .join(" / ")
      : "없음";


  const chainText =
    side.chains.length
      ? side.chains
          .map(
            (chain) =>
              `${chain.pawns.join("–")} (기초 ${chain.base}, 끝 ${chain.tip})`
          )
          .join(" / ")
      : "없음";


  const breakText =
    side.breaks.length
      ? side.breaks
          .map(
            (item) =>
              `${item.san} (${item.from}→${item.to})`
          )
          .join(", ")
      : "없음";


  const targetText =
    side.targets.length
      ? side.targets
          .map(
            (item) =>
              `${item.square} ← ${item.attackers.join(", ")}`
          )
          .join(" / ")
      : "없음";


  return `

    <div class="analysis-card">

      <div class="analysis-card-title">
        ${side.side} 폰 구조
      </div>

      <div class="analysis-row">
        <span>폰 수</span>
        <strong>
          ${side.pawnCount}
        </strong>
      </div>

      <div class="analysis-row">
        <span>고립 폰 후보</span>
        <strong>
          ${pawnListText(side.isolated)}
        </strong>
      </div>

      <div class="analysis-row">
        <span>더블 폰</span>
        <strong>
          ${doubledText}
        </strong>
      </div>

      <div class="analysis-row">
        <span>백워드 폰 후보</span>
        <strong>
          ${pawnListText(side.backward)}
        </strong>
      </div>

      <div class="analysis-row">
        <span>연결된 폰</span>
        <strong>
          ${pawnListText(side.connected)}
        </strong>
      </div>

      <div class="analysis-row">
        <span>패스드 폰 후보</span>
        <strong>
          ${pawnListText(side.passed)}
        </strong>
      </div>

      <div class="analysis-row">
        <span>보호된 패스드 폰 후보</span>
        <strong>
          ${pawnListText(side.protectedPassed)}
        </strong>
      </div>

      <div class="analysis-row">
        <span>폰 체인</span>
        <strong>
          ${chainText}
        </strong>
      </div>

      <div class="analysis-row">
        <span>폰 브레이크 후보</span>
        <strong>
          ${breakText}
        </strong>
      </div>

      <div class="analysis-row">
        <span>공격 가능한 폰 후보</span>
        <strong>
          ${targetText}
        </strong>
      </div>

    </div>

  `;

}


function renderPawnDetails(
  side
) {

  if (
    !side.pawns.length
  ) {

    return `

      <div class="analysis-note">
        현재 이 진영에는 폰이 없습니다.
      </div>

    `;

  }


  return side.pawns.map(
    (pawn) => {

      const flags = [];


      if (pawn.isDoubled) {

        flags.push(
          "더블 폰"
        );

      }


      if (pawn.isIsolated) {

        flags.push(
          "고립 후보"
        );

      }


      if (pawn.isBackwardCandidate) {

        flags.push(
          "백워드 후보"
        );

      }


      if (pawn.isConnected) {

        flags.push(
          "연결 폰"
        );

      }


      if (pawn.isPassed) {

        flags.push(
          "패스드 후보"
        );

      }


      if (pawn.isProtectedPassed) {

        flags.push(
          "보호된 패스드 후보"
        );

      }


      if (pawn.canAdvance) {

        flags.push(
          "전진 가능"
        );

      } else {

        flags.push(
          "즉시 전진 어려움"
        );

      }


      const flagText =
        flags.length
          ? flags.join(" · ")
          : "특별한 구조적 특징 없음";


      const defenderText =
        pawn.defenders.length
          ? pawn.defenders.join(", ")
          : "없음";


      return `

        <div class="minor-piece-item">

          <div class="minor-piece-header">

            <strong>
              폰 ${pawn.square}
            </strong>

          </div>

          <div class="minor-piece-detail">

            ${flagText}

          </div>

          <div class="minor-piece-detail">

            방어자:
            ${defenderText}

          </div>

        </div>

      `;

    }
  ).join("");

}


function renderPawnStructureAnalysis(
  pawnStructure
) {

  return `

    <div class="analysis-card">

      <div class="analysis-card-title">
        폰 구조
      </div>

      <div class="analysis-description">

        폰 구조는 현재 포지션에서 어떤 폰이
        고정되어 있는지, 어떤 폰이 전진 가능한지,
        어떤 파일과 폰 사슬이 계획의 기반이 될 수 있는지를
        찾기 위한 기초 자료입니다.

      </div>

      <div class="analysis-note">

        고립 폰·더블 폰·백워드 폰은
        발견되었다고 해서 자동으로 약점이 아닙니다.
        실제 공격 가능성, 방어 가능성, 기물의 접근,
        폰 브레이크와 함께 판단해야 합니다.

      </div>

    </div>


    ${renderPawnSide(
      pawnStructure.white
    )}


    ${renderPawnSide(
      pawnStructure.black
    )}


    <div class="analysis-card">

      <div class="analysis-card-title">
        백 폰 상세
      </div>

      ${renderPawnDetails(
        pawnStructure.white
      )}

    </div>


    <div class="analysis-card">

      <div class="analysis-card-title">
        흑 폰 상세
      </div>

      ${renderPawnDetails(
        pawnStructure.black
      )}

    </div>

  `;

}


/* =========================================================
   Material 화면
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

    ${renderPawnStructureAnalysis(
      snapshot.pawnStructure
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
        물질 구조, 마이너 피스 활동성,
        폰 구조와 마이너 피스의 실전적 가치를
        수집합니다.

        공간, 주요 파일과 칸, 전개, 이니셔티브에 대한
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


    pawnStructure:
      snapshot.pawnStructure,


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
