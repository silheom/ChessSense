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
    폰 구조를 먼저 수집한다.

    마이너 피스의 실전적 가치 평가에서
    현재 폰 구조를 사용할 수 있도록 한다.
  */

  snapshot.pawnStructure =
    analyzePawnStructure(
      chess,
      snapshot
    );


  /*
    그 다음 마이너 피스를 분석한다.
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
   특정 기물의 색에 맞춰 합법적인 이동 계산
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
   특정 칸의 공격자 목록
========================================================= */

function findAttackersOfSquare(
  board,
  targetSquare,
  attackerColor
) {

  const attackers = [];


  for (let rank = 1; rank <= 8; rank++) {

    for (let file = 0; file < 8; file++) {

      const square =
        coordsToSquare(
          file,
          rank - 1
        );


      const piece =
        getBoardPiece(
          board,
          square
        );


      if (
        !piece ||
        piece.color !== attackerColor
      ) {

        continue;

      }


      if (
        isPieceAttackingSquare(
          board,
          square,
          targetSquare,
          attackerColor
        )
      ) {

        attackers.push({
          square,
          type: piece.type
        });

      }

    }

  }


  return attackers;
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


  /*
     상대 진영 쪽에 있는 칸이어야 한다.
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
     가장자리 파일은 일반적인
     아웃포스트로 보기 어렵다.
  */

  if (
    file === 0 ||
    file === 7
  ) {

    return false;

  }


  const board =
    chess.board();


  const enemy =
    oppositeColor(color);


  /*
     현재 칸이 상대 폰에게 공격받고 있다면
     지속 가능한 아웃포스트 후보로 보지 않는다.
  */

  const enemyPawnAttack =
    findAttackersOfSquare(
      board,
      square,
      enemy
    ).some(
      (attacker) =>
        attacker.type === "p"
    );


  if (enemyPawnAttack) {

    return false;

  }


  return true;
}


/* =========================================================
   나이트 아웃포스트 지속 가능성
========================================================= */

function evaluateKnightOutpostDurability(
  chess,
  piece
) {

  if (
    piece.type !== "n" ||
    !piece.outpostCandidate
  ) {

    return {

      score: 0,

      reasons: []

    };

  }


  const board =
    chess.board();


  const enemy =
    oppositeColor(
      piece.color
    );


  const attackers =
    findAttackersOfSquare(
      board,
      piece.square,
      enemy
    );


  const enemyPawnAttackers =
    attackers.filter(
      (item) =>
        item.type === "p"
    );


  const enemyMinorAttackers =
    attackers.filter(
      (item) =>
        item.type === "n" ||
        item.type === "b"
    );


  let score = 0;

  const reasons = [];


  if (
    enemyPawnAttackers.length === 0
  ) {

    score += 8;

    reasons.push(
      "현재 위치를 상대 폰으로 바로 쫓아내기 어려움"
    );

  } else {

    score -= 8;

    reasons.push(
      "상대 폰으로 쫓아낼 가능성이 있음"
    );

  }


  if (
    enemyMinorAttackers.length === 0
  ) {

    score += 3;

    reasons.push(
      "상대 마이너 피스의 직접적인 압박이 제한적임"
    );

  }


  return {

    score,

    reasons

  };

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

      longDiagonalAccess: 0,

      usefulTargets: []

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

  const usefulTargets = [];


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


          usefulTargets.push({

            square:
              currentSquare,

            type:
              targetPiece.type

          });

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

    longDiagonalAccess,

    usefulTargets

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


  const captureTargets = [];


  const safeDestinationSquares = [];


  for (
    const move of legalMoves
  ) {

    destinationSquares.push(
      move.to
    );


    if (move.captured) {

      captureMoves += 1;


      captureTargets.push({

        square:
          move.to,

        type:
          move.captured

      });

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

        safeDestinationSquares.push(
          move.to
        );

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


  /*
     현재 위치에서 직접 공격하고 있는
     상대 기물 목록.
  */

  const board =
    chess.board();


  const enemy =
    oppositeColor(color);


  const directAttackers =
    findAttackersOfSquare(
      board,
      square,
      enemy
    );


  const defendedBy =
    findAttackersOfSquare(
      board,
      square,
      color
    );


  /*
     활동성 참고값

     이것은 "기물이 얼마나 움직일 수 있는가"만
     보여주는 별도의 지표다.
  */

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

    captureTargets,

    centralMoves,

    centrality,

    outpostCandidate,

    bishopInfo,

    destinationSquares,

    safeDestinationSquares,

    directAttackers,

    defendedBy,

    activityScore

  };

}


/* =========================================================
   마이너 피스의 폰 구조 적합성
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


  const enemyData =
    piece.color === "w"
      ? pawnStructure.black
      : pawnStructure.white;


  const reasons = [];

  let score = 0;


  if (piece.type === "b") {

    const bishopInfo =
      piece.bishopInfo;


    if (
      bishopInfo &&
      bishopInfo.blockedDiagonals === 0
    ) {

      score += 7;

      reasons.push(
        "자기 폰에 의해 막힌 대각선이 적음"
      );

    } else if (
      bishopInfo &&
      bishopInfo.blockedDiagonals >= 2
    ) {

      score -= 7;

      reasons.push(
        "자기 폰에 의해 막힌 대각선이 많음"
      );

    }


    if (
      bishopInfo &&
      bishopInfo.longDiagonalAccess >= 1
    ) {

      score += 4;

      reasons.push(
        "장거리 대각선 접근 가능"
      );

    }


    if (
      bishopInfo &&
      bishopInfo.usefulTargets &&
      bishopInfo.usefulTargets.length
    ) {

      score += Math.min(
        6,
        bishopInfo.usefulTargets.length * 3
      );

      reasons.push(
        "대각선 끝에서 상대 기물이나 폰에 실제 접근 가능"
      );

    }


    /*
       폰 구조에 존재하는 브레이크가
       비숍의 선을 열 가능성을 기록한다.

       이것은 즉시 좋은 비숍이라는 뜻이 아니라
       "앞으로 개선될 가능성"이다.
    */

    if (
      sideData.breaks &&
      sideData.breaks.length
    ) {

      score += 2;

      reasons.push(
        "폰 브레이크를 통해 대각선이 더 열릴 가능성이 있음"
      );

    }


    void enemyData;

  }


  if (piece.type === "n") {

    if (
      piece.outpostCandidate
    ) {

      score += 7;

      reasons.push(
        "현재 칸에서 아웃포스트 후보 성격이 있음"
      );

    }


    if (
      piece.centralMoves >= 2
    ) {

      score += 4;

      reasons.push(
        "여러 중앙 접근 경로를 가짐"
      );

    }


    /*
       자기 폰 구조에 공격받고 있는
       상대 폰이 존재하는 경우에는
       실제 계획과 연결될 가능성을 조금 높인다.

       단, 공격 가능 = 약점이라고 판단하지 않는다.
    */

    const attackableTargets =
      enemyData.targets || [];


    if (
      attackableTargets.length
    ) {

      score += Math.min(
        6,
        attackableTargets.length * 2
      );

      reasons.push(
        "상대 폰 구조에서 실제 접근 가능한 대상이 관측됨"
      );

    }

  }


  return {

    score,

    reasons

  };

}


/* =========================================================
   상대 기물/폰 대상의 실질적 가치
========================================================= */

function evaluateTargetAccess(
  chess,
  piece
) {

  const board =
    chess.board();


  const enemy =
    oppositeColor(
      piece.color
    );


  const targets = [];


  /*
     현재 기물의 합법적인 잡기 가능 수를 조사한다.
  */

  const legalMoves =
    getLegalMovesForPiece(
      chess,
      piece.square,
      piece.color
    );


  for (
    const move of legalMoves
  ) {

    if (!move.captured) {
      continue;
    }


    const targetPiece =
      getBoardPiece(
        board,
        move.to
      );


    if (
      !targetPiece ||
      targetPiece.color !== enemy
    ) {

      continue;

    }


    const defenders =
      findAttackersOfSquare(
        board,
        move.to,
        enemy
      );


    /*
       방어자가 많다고 해서
       공격 가치가 0이 되는 것은 아니다.

       여기서는 "접근 가능성"을 기록한다.
    */

    let value = 2;


    if (
      targetPiece.type === "q" ||
      targetPiece.type === "r"
    ) {

      value += 3;

    } else if (
      targetPiece.type === "b" ||
      targetPiece.type === "n"
    ) {

      value += 2;

    } else if (
      targetPiece.type === "p"
    ) {

      value += 1;

    }


    if (
      defenders.length === 0
    ) {

      value += 3;

    } else if (
      defenders.length === 1
    ) {

      value += 1;

    } else {

      value -= 1;

    }


    targets.push({

      square:
        move.to,

      type:
        targetPiece.type,

      defenders:
        defenders.map(
          (item) =>
            item.square
        ),

      value

    });

  }


  /*
     현재 칸 자체가 상대 기물에 의해
     공격받고 있는지도 기록한다.
  */

  const attackers =
    findAttackersOfSquare(
      board,
      piece.square,
      enemy
    );


  return {

    targets,

    attackers

  };

}


/* =========================================================
   마이너 피스 실전적 가치 평가
=========================================================

   중요:

   이 값은 Stockfish 평가값이 아니다.

   활동성 자체를 그대로 우세라고 판단하지 않고

   1. 이동 가능성
   2. 안전성
   3. 중앙 접근
   4. 실제 대상 접근
   5. 아웃포스트 지속 가능성
   6. 비숍 대각선 활용
   7. 폰 구조와의 적합성
   8. 같은 진영의 다른 기물과의 관계

   를 종합한다.
========================================================= */

function evaluateMinorPieceQuality(
  chess,
  piece,
  sideData,
  pawnStructure
) {

  /*
     실전적 가치의 기본값은
     활동성 참고값을 그대로 복사하지 않는다.

     여러 요소를 별도로 계산한다.
  */

  let score = 40;

  const reasons = [];


  /*
     ------------------------------------------------------
     1. 이동 가능성
     ------------------------------------------------------
  */

  if (
    piece.legalMobility >= 6
  ) {

    score += 8;

    reasons.push(
      "이동 가능한 칸이 많음"
    );

  } else if (
    piece.legalMobility <= 2
  ) {

    score -= 7;

    reasons.push(
      "이동 가능한 칸이 제한적임"
    );

  } else {

    score += 3;

  }


  /*
     ------------------------------------------------------
     2. 안전한 이동
     ------------------------------------------------------
  */

  if (
    piece.mobilityRatio >= 0.65
  ) {

    score += 9;

    reasons.push(
      "이동 가능 칸 중 안전한 칸의 비율이 높음"
    );

  } else if (
    piece.mobilityRatio < 0.30
  ) {

    score -= 9;

    reasons.push(
      "안전하게 이동할 수 있는 칸이 제한적임"
    );

  } else {

    score += 2;

  }


  /*
     ------------------------------------------------------
     3. 중앙 접근
     ------------------------------------------------------
  */

  if (
    piece.centralMoves >= 2
  ) {

    score += 6;

    reasons.push(
      "중앙으로 접근할 수 있는 이동이 여러 개 있음"
    );

  } else if (
    piece.centralMoves === 0
  ) {

    score -= 2;

  }


  /*
     ------------------------------------------------------
     4. 실제 공격 대상
     ------------------------------------------------------
  */

  const targetAccess =
    evaluateTargetAccess(
      chess,
      piece
    );


  piece.targetAccess =
    targetAccess;


  if (
    targetAccess.targets.length
  ) {

    const totalTargetValue =
      targetAccess.targets.reduce(
        (sum, target) =>
          sum + target.value,
        0
      );


    score += Math.min(
      12,
      totalTargetValue
    );


    reasons.push(
      `현재 위치에서 실제로 접근 가능한 상대 대상 ${targetAccess.targets.length}개가 있음`
    );

  }


  /*
     ------------------------------------------------------
     5. 현재 기물의 안전성
     ------------------------------------------------------
  */

  if (
    targetAccess.attackers.length === 0
  ) {

    score += 5;

    reasons.push(
      "현재 기물에 대한 직접적인 상대 압박이 없음"
    );

  } else {

    score -= Math.min(
      8,
      targetAccess.attackers.length * 3
    );

    reasons.push(
      "현재 기물이 상대 기물의 직접적인 압박을 받고 있음"
    );

  }


  /*
     ------------------------------------------------------
     6. 나이트
     ------------------------------------------------------
  */

  if (
    piece.type === "n"
  ) {

    if (
      piece.outpostCandidate
    ) {

      score += 8;

      reasons.push(
        "현재 위치에 아웃포스트 후보 성격이 있음"
      );


      const durability =
        evaluateKnightOutpostDurability(
          chess,
          piece
        );


      piece.outpostDurability =
        durability;


      score +=
        durability.score;


      for (
        const reason of durability.reasons
      ) {

        reasons.push(
          reason
        );

      }

    }


    if (
      piece.captureMoves >= 2
    ) {

      score += 4;

      reasons.push(
        "현재 위치에서 여러 상대 기물에 접근 가능"
      );

    }


    if (
      piece.safeMobility >= 3
    ) {

      score += 3;

    }

  }


  /*
     ------------------------------------------------------
     7. 비숍
     ------------------------------------------------------
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


    if (
      piece.bishopInfo.usefulTargets &&
      piece.bishopInfo.usefulTargets.length
    ) {

      score += Math.min(
        7,
        piece.bishopInfo.usefulTargets.length * 3
      );

      reasons.push(
        "대각선 끝에서 실제 상대 대상을 바라보고 있음"
      );

    }

  }


  /*
     ------------------------------------------------------
     8. 폰 구조와의 관계
     ------------------------------------------------------
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
     ------------------------------------------------------
     9. 같은 진영 마이너 피스와의 관계
     ------------------------------------------------------
  */

  const ownMinorPieces =
    sideData.pieces.filter(
      (item) =>
        (
          item.type === "b" ||
          item.type === "n"
        ) &&
        item.square !== piece.square
    );


  if (
    ownMinorPieces.length === 0
  ) {

    /*
       마이너 피스가 하나뿐인 경우
       평균 계산에서 특별히 유리/불리하게
       만들지 않는다.
    */

  }


  /*
     최종 범위.

     이것은 엔진 점수가 아니다.
  */

  score =
    Math.max(
      0,
      Math.min(
        100,
        Math.round(score)
      )
    );


  /*
     같은 이유가 반복되는 것을 방지한다.
  */

  const uniqueReasons =
    [...new Set(reasons)];


  return {

    score,

    reasons:
      uniqueReasons.slice(
        0,
        6
      )

  };

}


/* =========================================================
   진영 전체의 마이너 피스 관계 평가
========================================================= */

function evaluateMinorSideQuality(
  pieces,
  sideData,
  pawnStructure,
  color
) {

  if (!pieces.length) {

    return {

      average: null,

      strongest: null,

      weakest: null,

      bishopPair: false,

      score: null,

      reasons: []

    };

  }


  const bishops =
    pieces.filter(
      (piece) =>
        piece.type === "b"
    );


  const knights =
    pieces.filter(
      (piece) =>
        piece.type === "n"
    );


  const bishopPair =
    bishops.length >= 2;


  /*
     개별 기물 평가
  */

  for (
    const piece of pieces
  ) {

    const quality =
      evaluateMinorPieceQuality(
        color === "w"
          ? piece.chess
          : piece.chess,
        piece,
        sideData,
        pawnStructure
      );


    piece.qualityScore =
      quality.score;


    piece.qualityReasons =
      quality.reasons;

  }


  const sorted =
    [...pieces].sort(
      (a, b) =>
        b.qualityScore -
        a.qualityScore
    );


  const strongest =
    sorted[0] || null;


  const weakest =
    sorted[
      sorted.length - 1
    ] || null;


  const average =
    Math.round(
      pieces.reduce(
        (sum, piece) =>
          sum + piece.qualityScore,
        0
      ) /
      pieces.length
    );


  /*
     비숍 페어는 "자동 우세"가 아니다.

     현재 단계에서는 작은 보조값만 준다.
  */

  let sideScore =
    average;


  const reasons = [];


  if (
    bishopPair
  ) {

    sideScore += 3;

    reasons.push(
      "비숍 페어를 보유하고 있음"
    );

  }


  if (
    strongest
  ) {

    reasons.push(
      `가장 실전적 가치가 높은 후보는 ${strongest.name} ${strongest.square}`
    );

  }


  if (
    weakest &&
    weakest !== strongest
  ) {

    reasons.push(
      `가장 제한된 마이너 피스는 ${weakest.name} ${weakest.square}`
    );

  }


  sideScore =
    Math.max(
      0,
      Math.min(
        100,
        Math.round(sideScore)
      )
    );


  return {

    average,

    strongest,

    weakest,

    bishopPair,

    score:
      sideScore,

    reasons

  };

}


/* =========================================================
   마이너 피스 우세 판단
========================================================= */

function determineMinorPieceAdvantage(
  whiteAnalysis,
  blackAnalysis
) {

  const whiteScore =
    whiteAnalysis.score;


  const blackScore =
    blackAnalysis.score;


  if (
    whiteScore === null ||
    blackScore === null
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
    whiteScore -
    blackScore;


  /*
     평균 차이만으로 우세를 선언하지 않는다.

     실제로는 가장 좋은 기물과
     가장 제한된 기물의 관계도 함께 본다.
  */

  const whiteStrongest =
    whiteAnalysis.strongest;


  const blackStrongest =
    blackAnalysis.strongest;


  const whiteWeakest =
    whiteAnalysis.weakest;


  const blackWeakest =
    blackAnalysis.weakest;


  /*
     차이가 작으면 판단 보류.
  */

  if (
    Math.abs(difference) < 5
  ) {

    return {

      side: null,

      label:
        "뚜렷한 우세 후보 없음",

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


  const own =
    side === "w"
      ? whiteAnalysis
      : blackAnalysis;


  const opponent =
    side === "w"
      ? blackAnalysis
      : whiteAnalysis;


  const ownStrongest =
    own.strongest;


  const opponentStrongest =
    opponent.strongest;


  const ownWeakest =
    own.weakest;


  const opponentWeakest =
    opponent.weakest;


  const reasons = [];


  if (
    ownStrongest
  ) {

    if (
      ownStrongest.qualityReasons &&
      ownStrongest.qualityReasons.length
    ) {

      reasons.push(
        `${colorName(side)} ${ownStrongest.name} ${ownStrongest.square}: ` +
        ownStrongest.qualityReasons[0]
      );

    }

  }


  if (
    opponentWeakest
  ) {

    reasons.push(
      `${colorName(oppositeColor(side))}의 ` +
      `${opponentWeakest.name} ${opponentWeakest.square}는 ` +
      `현재 실전적 가치 참고값이 상대적으로 낮음`
    );

  }


  /*
     가장 좋은 기물끼리의 차이가 매우 작으면
     전체 평균 차이가 있더라도 판정을 낮춘다.
  */

  let confidence =
    "medium";


  if (
    ownStrongest &&
    opponentStrongest
  ) {

    const strongestDifference =
      ownStrongest.qualityScore -
      opponentStrongest.qualityScore;


    if (
      side === "b"
    ) {

      if (
        Math.abs(strongestDifference) < 4
      ) {

        confidence =
          "low";


        reasons.push(
          "가장 좋은 마이너 피스끼리의 차이는 크지 않음"
        );

      }

    } else {

      if (
        Math.abs(strongestDifference) < 4
      ) {

        confidence =
          "low";


        reasons.push(
          "가장 좋은 마이너 피스끼리의 차이는 크지 않음"
        );

      }

    }

  }


  if (
    Math.abs(difference) >= 15
  ) {

    confidence =
      "high";

  }


  /*
     신뢰도가 낮아졌다면
     "확정적인 우세" 대신 후보라고 명시한다.
  */

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


  /*
     평가 함수에서 Chess 객체를 사용할 수 있도록
     임시 참조를 연결한다.

     JSON DEBUG에는 함수/객체를 넣지 않는다.
  */

  for (
    const piece of whiteAnalysis
  ) {

    piece.chess =
      chess;

  }


  for (
    const piece of blackAnalysis
  ) {

    piece.chess =
      chess;

  }


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


  /*
     진영 전체 평가

     주의:
     여기서 quality는 activity와 별개로
     실제 대상/안전성/구조 적합성을 다시 평가한다.
  */

  const whiteSideQuality =
    evaluateMinorSideQuality(
      whiteAnalysis,
      snapshot.white,
      snapshot.pawnStructure,
      "w"
    );


  const blackSideQuality =
    evaluateMinorSideQuality(
      blackAnalysis,
      snapshot.black,
      snapshot.pawnStructure,
      "b"
    );


  const whiteAverageActivity =
    whiteAnalysis.length
      ? Math.round(
          whiteAnalysis.reduce(
            (sum, piece) =>
              sum + piece.activityScore,
            0
          ) /
          whiteAnalysis.length
        )
      : null;


  const blackAverageActivity =
    blackAnalysis.length
      ? Math.round(
          blackAnalysis.reduce(
            (sum, piece) =>
              sum + piece.activityScore,
            0
          ) /
          blackAnalysis.length
        )
      : null;


  const activityDifference =
    whiteAverageActivity !== null &&
    blackAverageActivity !== null
      ? whiteAverageActivity -
        blackAverageActivity
      : null;


  const qualityDifference =
    whiteSideQuality.score !== null &&
    blackSideQuality.score !== null
      ? whiteSideQuality.score -
        blackSideQuality.score
      : null;


  const advantage =
    determineMinorPieceAdvantage(
      whiteSideQuality,
      blackSideQuality
    );


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
        whiteSideQuality.bishopPair,

      averageActivity:
        whiteAverageActivity,

      averageQuality:
        whiteSideQuality.score,

      strongest:
        whiteSideQuality.strongest,

      weakest:
        whiteSideQuality.weakest,

      qualityReasons:
        whiteSideQuality.reasons

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
        blackSideQuality.bishopPair,

      averageActivity:
        blackAverageActivity,

      averageQuality:
        blackSideQuality.score,

      strongest:
        blackSideQuality.strongest,

      weakest:
        blackSideQuality.weakest,

      qualityReasons:
        blackSideQuality.reasons

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
        whiteSideQuality.bishopPair,

      black:
        blackSideQuality.bishopPair

    }

  };

}


/* =========================================================
   ③ Pawn Structure
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


  const sidePieces =
    color === "w"
      ? currentPawnSnapshot.white.pieces
      : currentPawnSnapshot.black.pieces;


  for (
    const piece of sidePieces
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


      const targetText =
        piece.targetAccess &&
        piece.targetAccess.targets &&
        piece.targetAccess.targets.length
          ? `실제 접근 대상 ${piece.targetAccess.targets.length}개`
          : "직접 접근 대상 뚜렷하지 않음";


      const reasonText =
        piece.qualityReasons &&
        piece.qualityReasons.length
          ? piece.qualityReasons
              .slice(0, 3)
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

            ${targetText}

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

  const whiteActivity =
    minor.white.averageActivity;


  const blackActivity =
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


  const strongestWhite =
    minor.white.strongest;


  const strongestBlack =
    minor.black.strongest;


  const strongestText = [];


  if (
    strongestWhite
  ) {

    strongestText.push(
      `백: ${strongestWhite.name} ${strongestWhite.square} (${strongestWhite.qualityScore})`
    );

  }


  if (
    strongestBlack
  ) {

    strongestText.push(
      `흑: ${strongestBlack.name} ${strongestBlack.square} (${strongestBlack.qualityScore})`
    );

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
            whiteActivity === null
              ? "-"
              : whiteActivity
          }
        </strong>
      </div>

      <div class="analysis-row">
        <span>흑 활동성 참고값</span>
        <strong>
          ${
            blackActivity === null
              ? "-"
              : blackActivity
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

      <div class="analysis-description">

        <strong>가장 강한 마이너 피스 후보</strong><br>

        ${
          strongestText.length
            ? strongestText.join(" · ")
            : "비교할 마이너 피스가 없습니다."
        }

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

        이번 단계에서는 단순한 이동 가능 수만 비교하지 않습니다.

        각 마이너 피스가 얼마나 안전하게 움직일 수 있는지,
        실제로 어떤 상대 기물이나 폰에 접근할 수 있는지,
        좋은 칸을 유지할 가능성이 있는지,
        비숍의 대각선이 실제 대상과 연결되는지,
        그리고 현재 폰 구조와 기물이 서로 잘 맞는지를
        함께 확인합니다.

      </div>

      <div class="analysis-description">

        따라서 활동성이 높은 기물이라고 해서
        자동으로 우세한 마이너 피스로 판정하지 않습니다.

        특히 비숍 페어 역시 자동으로 우세를 선언하지 않고,
        실제 포지션에서 그 장점을 사용할 수 있는지를
        이후 단계에서 다시 확인합니다.

      </div>

      <div class="analysis-note">

        "활동성 참고값"과 "실전적 가치 참고값"은
        ChessSense 내부 분석값이며 Stockfish 평가값이나
        실제 승률이 아닙니다.

        또한 이 단계의 "우세 후보"는 최종적인 포지션 평가가 아닙니다.
        이후 공간, 주요 파일과 칸, 전개, 이니셔티브,
        연결된 불균형 등을 함께 판단해야 합니다.

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

  /*
     chess 객체 같은 비직렬화 정보는
     DEBUG에서 제거한다.
  */

  function cleanMinorPiece(
    piece
  ) {

    const {
      chess,
      ...cleaned
    } = piece;


    return cleaned;

  }


  const cleanMinorSide =
    (side) => ({

      pieces:
        side.pieces.map(
          cleanMinorPiece
        ),

      bishops:
        side.bishops.map(
          cleanMinorPiece
        ),

      knights:
        side.knights.map(
          cleanMinorPiece
        ),

      bishopCount:
        side.bishopCount,

      knightCount:
        side.knightCount,

      bishopPair:
        side.bishopPair,

      averageActivity:
        side.averageActivity,

      averageQuality:
        side.averageQuality,

      strongest:
        side.strongest
          ? cleanMinorPiece(
              side.strongest
            )
          : null,

      weakest:
        side.weakest
          ? cleanMinorPiece(
              side.weakest
            )
          : null,

      qualityReasons:
        side.qualityReasons

    });


  const cleanMinor = {

    type:
      snapshot.minorPieces.type,

    white:
      cleanMinorSide(
        snapshot.minorPieces.white
      ),

    black:
      cleanMinorSide(
        snapshot.minorPieces.black
      ),

    activityDifference:
      snapshot.minorPieces
        .activityDifference,

    qualityDifference:
      snapshot.minorPieces
        .qualityDifference,

    advantage:
      snapshot.minorPieces
        .advantage,

    importance:
      snapshot.minorPieces
        .importance,

    bishopPair:
      snapshot.minorPieces
        .bishopPair

  };


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
      cleanMinor,


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
