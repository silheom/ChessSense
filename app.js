import { Chess } from "https://cdn.jsdelivr.net/npm/chess.js@1.4.0/+esm";

/*
 * =========================================================
 * ChessSense
 * =========================================================
 *
 * 엔진의 숫자를 사람이 이해할 수 있는 생각으로 바꿉니다.
 *
 * 핵심 원칙
 * 1. ChessSense = 전략적 판단
 * 2. Stockfish = 계산 / 검증
 * 3. 엔진 최선수를 곧바로 인간의 전략적 정답으로 취급하지 않는다.
 *
 * 이번 버전의 우선순위:
 * - 앱 실행
 * - PGN 읽기
 * - 체스판 표시
 * - 수순 이동
 * - Stockfish 연결
 *
 * 이후 단계:
 * - 7가지 불균형
 * - Fantasy Position
 * - Candidate Moves
 * - 계획 검증
 * - 인간 언어 설명
 * =========================================================
 */


/* =========================================================
   DOM
   ========================================================= */

const $ = id =>
  document.getElementById(id);

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

const EXAMPLE = `[Event "ChessSense Demo"]
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

let analysisId = 0;


/* =========================================================
   GAME STATE
   ========================================================= */

let positions = [];

let currentPly = 0;

let currentHeaders = {};

let analysisCache =
  new Map();


/* =========================================================
   BASIC UI
   ========================================================= */

function setStatus(
  text,
  type = "loading"
) {
  if (!els.engineStatus) {
    return;
  }

  els.engineStatus.textContent =
    text;

  els.engineStatus.className =
    `status ${type}`;
}


function showError(text) {
  if (!els.errorBox) {
    return;
  }

  els.errorBox.textContent =
    text;

  els.errorBox.hidden =
    false;
}


function clearError() {
  if (!els.errorBox) {
    return;
  }

  els.errorBox.textContent =
    "";

  els.errorBox.hidden =
    true;
}


function setProgress(
  percent,
  depth = null
) {
  if (els.progressBar) {
    els.progressBar.style.width =
      `${Math.max(
        0,
        Math.min(
          100,
          percent
        )
      )}%`;
  }

  if (
    depth !== null &&
    els.depthValue
  ) {
    els.depthValue.textContent =
      String(depth);
  }
}


/* =========================================================
   SMALL HELPERS
   ========================================================= */

function clamp(
  value,
  min,
  max
) {
  return Math.max(
    min,
    Math.min(max, value)
  );
}


function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}


/* =========================================================
   STOCKFISH INITIALIZATION
   ========================================================= */

function initEngine() {
  if (
    engineReady &&
    engine
  ) {
    return Promise.resolve();
  }

  if (
    engineInitPromise
  ) {
    return engineInitPromise;
  }

  engineInitPromise =
    new Promise(
      (resolve, reject) => {
        setStatus(
          "Stockfish 로딩 중…",
          "loading"
        );

        let settled =
          false;

        let phase =
          "uci";

        const finishError =
          error => {
            if (settled) {
              return;
            }

            settled = true;

            engineReady =
              false;

            setStatus(
              "Stockfish 오류",
              "error"
            );

            reject(error);
          };

        const finishReady =
          () => {
            if (settled) {
              return;
            }

            settled = true;

            engineReady =
              true;

            setStatus(
              "Stockfish 준비 완료",
              "ready"
            );

            resolve();
          };

        try {
          engine =
            new Worker(
              ENGINE_PATH
            );
        } catch (error) {
          finishError(
            error
          );

          return;
        }

        const timeout =
          setTimeout(
            () => {
              finishError(
                new Error(
                  "Stockfish 로딩 시간이 초과되었습니다."
                )
              );
            },
            30000
          );

        engine.onerror =
          event => {
            clearTimeout(
              timeout
            );

            finishError(
              new Error(
                event?.message ||
                "Stockfish Worker 오류"
              )
            );
          };

        engine.onmessage =
          event => {
            const line =
              typeof event.data ===
              "string"
                ? event.data.trim()
                : "";

            if (!line) {
              return;
            }

            /*
             * UCI 시작
             */
            if (
              line === "uciok" &&
              phase === "uci"
            ) {
              phase =
                "ready";

              engine.postMessage(
                "setoption name MultiPV value 3"
              );

              engine.postMessage(
                "isready"
              );

              return;
            }

            /*
             * 준비 완료
             */
            if (
              line === "readyok" &&
              phase === "ready"
            ) {
              clearTimeout(
                timeout
              );

              finishReady();

              return;
            }

            /*
             * 실제 분석 중인 경우
             */
            if (
              currentAnalysis
            ) {
              currentAnalysis(
                line
              );
            }
          };

        engine.postMessage(
          "uci"
        );
      }
    ).catch(
      error => {
        engineInitPromise =
          null;

        throw error;
      }
    );

  return engineInitPromise;
}


/* =========================================================
   STOCKFISH SCORE
   ========================================================= */

function parseEngineScore(
  tokens
) {
  const index =
    tokens.indexOf(
      "score"
    );

  if (
    index < 0 ||
    index + 2 >=
      tokens.length
  ) {
    return null;
  }

  const type =
    tokens[index + 1];

  const value =
    Number(
      tokens[index + 2]
    );

  if (
    Number.isNaN(value)
  ) {
    return null;
  }

  if (
    type === "cp"
  ) {
    return {
      type: "cp",
      value
    };
  }

  if (
    type === "mate"
  ) {
    return {
      type: "mate",
      value
    };
  }

  return null;
}


function scoreForWhite(
  score,
  sideToMove
) {
  if (!score) {
    return null;
  }

  if (
    score.type === "cp"
  ) {
    const cp =
      sideToMove === "w"
        ? score.value
        : -score.value;

    return cp / 100;
  }

  const sign =
    score.value > 0
      ? 1
      : -1;

  return sideToMove === "w"
    ? sign * 100
    : -sign * 100;
}


function formatScore(
  score
) {
  if (
    score === null ||
    score === undefined ||
    Number.isNaN(score)
  ) {
    return "—";
  }

  if (
    Math.abs(score) >= 99
  ) {
    return score > 0
      ? "+M"
      : "−M";
  }

  return (
    score >= 0
      ? "+"
      : "−"
  ) +
    Math.abs(score)
      .toFixed(1);
}


function scoreDescription(
  score
) {
  const value =
    Math.abs(
      score || 0
    );

  if (
    value < 0.25
  ) {
    return "균형에 가까운 포지션입니다.";
  }

  if (
    value < 0.8
  ) {
    return score > 0
      ? "백이 조금 더 편한 포지션입니다."
      : "흑이 조금 더 편한 포지션입니다.";
  }

  if (
    value < 1.8
  ) {
    return score > 0
      ? "백에게 뚜렷한 실전적 우세가 있습니다."
      : "흑에게 뚜렷한 실전적 우세가 있습니다.";
  }

  if (
    value < 3.5
  ) {
    return score > 0
      ? "백의 우세가 상당합니다."
      : "흑의 우세가 상당합니다.";
  }

  return score > 0
    ? "백 쪽으로 크게 기울었습니다."
    : "흑 쪽으로 크게 기울었습니다.";
}


/* =========================================================
   STOCKFISH ANALYSIS
   ========================================================= */

function cancelAnalysis() {
  if (
    !currentAnalysis
  ) {
    return;
  }

  currentAnalysis =
    null;

  if (
    engineReady &&
    engine
  ) {
    engine.postMessage(
      "stop"
    );
  }
}


function analyzeFen(
  fen,
  depth = 10
) {
  if (
    analysisCache.has(
      fen
    )
  ) {
    return Promise.resolve(
      analysisCache.get(
        fen
      )
    );
  }

  if (
    !engineReady ||
    !engine
  ) {
    return Promise.reject(
      new Error(
        "Stockfish가 준비되지 않았습니다."
      )
    );
  }

  cancelAnalysis();

  const id =
    ++analysisId;

  const sideToMove =
    fen.split(" ")[1];

  return new Promise(
    (resolve, reject) => {
      const lines =
        new Map();

      let maxDepth =
        0;

      let finished =
        false;

      const timeout =
        setTimeout(
          () => {
            if (
              finished
            ) {
              return;
            }

            finished =
              true;

            if (
              currentAnalysis
            ) {
              currentAnalysis =
                null;
            }

            reject(
              new Error(
                "엔진 분석 시간이 초과되었습니다."
              )
            );
          },
          30000
        );

      function finish() {
        if (
          finished
        ) {
          return;
        }

        finished =
          true;

        clearTimeout(
          timeout
        );

        currentAnalysis =
          null;

        const result = {
          fen,
          depth: maxDepth,
          lines:
            [...lines.entries()]
              .sort(
                (a, b) =>
                  a[0] - b[0]
              )
              .map(
                entry =>
                  entry[1]
              )
        };

        analysisCache.set(
          fen,
          result
        );

        setProgress(
          100,
          maxDepth
        );

        resolve(
          result
        );
      }

      currentAnalysis =
        line => {
          if (
            finished ||
            id !== analysisId
          ) {
            return;
          }

          /*
           * info depth ... multipv ... score ... pv ...
           */
          if (
            line.startsWith(
              "info "
            ) &&
            line.includes(
              " pv "
            )
          ) {
            const tokens =
              line.split(
                /\s+/
              );

            const depthIndex =
              tokens.indexOf(
                "depth"
              );

            const multiPvIndex =
              tokens.indexOf(
                "multipv"
              );

            const pvIndex =
              tokens.indexOf(
                "pv"
              );

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

            const score =
              scoreForWhite(
                parseEngineScore(
                  tokens
                ),
                sideToMove
              );

            const pv =
              pvIndex >= 0
                ? tokens.slice(
                    pvIndex + 1
                  )
                : [];

            maxDepth =
              Math.max(
                maxDepth,
                d
              );

            if (
              d > 0
            ) {
              setProgress(
                Math.min(
                  95,
                  (d / depth) *
                    100
                ),
                d
              );
            }

            if (
              score !== null &&
              pv.length
            ) {
              lines.set(
                multiPv,
                {
                  score,
                  pv
                }
              );
            }

            return;
          }

          if (
            line.startsWith(
              "bestmove"
            )
          ) {
            finish();
          }
        };

      engine.postMessage(
        `position fen ${fen}`
      );

      engine.postMessage(
        `go depth ${depth}`
      );
    }
  );
                }

/* =========================================================
   PART 2 — PGN / POSITION HISTORY / BOARD
   ========================================================= */


/* =========================================================
   PIECE SYMBOLS
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


/* =========================================================
   PGN HEADERS
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


function renderGameMeta() {
  if (!els.gameMeta) {
    return;
  }

  const event =
    currentHeaders.Event ||
    "ChessSense";

  const white =
    currentHeaders.White ||
    "White";

  const black =
    currentHeaders.Black ||
    "Black";

  const date =
    currentHeaders.Date ||
    "";

  els.gameMeta.innerHTML = `
    <div>
      <strong>
        ${escapeHtml(event)}
      </strong>
    </div>

    <div>
      ${escapeHtml(white)}
      -
      ${escapeHtml(black)}
    </div>

    ${
      date
        ? `<div>${escapeHtml(date)}</div>`
        : ""
    }
  `;
}


/* =========================================================
   BUILD ALL POSITIONS
   ========================================================= */

/*
 * PGN을 읽은 뒤
 *
 * ply 0 = 시작 포지션
 * ply 1 = 첫 번째 수 이후
 * ply 2 = 두 번째 수 이후
 * ...
 *
 * 형태로 모든 포지션을 저장한다.
 *
 * 이것이 나중에
 * "예전 수로 돌아가서 직접 다른 수를 둔다"
 * 기능을 만들기 위한 기본 구조다.
 */

function buildPositions(
  game
) {
  const result = [];

  const replay =
    new Chess();

  /*
   * 시작 포지션
   */
  result.push({
    ply: 0,
    fen: replay.fen(),
    san: null,
    from: null,
    to: null,
    promotion: null
  });

  const history =
    game.history({
      verbose: true
    });

  for (
    let i = 0;
    i < history.length;
    i++
  ) {
    const originalMove =
      history[i];

    const move =
      replay.move({
        from: originalMove.from,
        to: originalMove.to,
        promotion:
          originalMove.promotion
      });

    if (!move) {
      throw new Error(
        `수순을 재구성할 수 없습니다: ${i + 1}`
      );
    }

    result.push({
      ply: i + 1,
      fen: replay.fen(),
      san: move.san,
      from: move.from,
      to: move.to,
      promotion:
        move.promotion || null
    });
  }

  return result;
}


/* =========================================================
   BOARD RENDERING
   ========================================================= */

function renderBoard(fen) {
  if (!els.board) {
    return;
  }

  let chess;

  try {
    chess =
      new Chess(fen);
  } catch (error) {
    showError(
      "체스판 포지션을 읽을 수 없습니다."
    );

    return;
  }

  const board =
    chess.board();

  els.board.innerHTML =
    "";

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
        document.createElement(
          "div"
        );

      square.className =
        `sq ${
          (row + col) % 2 === 0
            ? "light"
            : "dark"
        }`;

      const piece =
        board[row]?.[col];

      if (piece) {
        square.textContent =
          PIECE_SYMBOLS[
            piece.color
          ][piece.type];
      }

      els.board.appendChild(
        square
      );
    }
  }
}


/* =========================================================
   MOVE LIST
   ========================================================= */

function moveText(
  ply,
  san
) {
  if (!san) {
    return "";
  }

  const moveNumber =
    Math.ceil(ply / 2);

  /*
   * 백의 수
   */
  if (
    ply % 2 === 1
  ) {
    return `${moveNumber}. ${san}`;
  }

  /*
   * 흑의 수
   */
  return `${moveNumber}... ${san}`;
}


function renderMoves() {
  if (!els.moveList) {
    return;
  }

  els.moveList.innerHTML =
    "";

  /*
   * 시작 포지션에는 수가 없으므로
   * 실제 수는 1번부터 표시한다.
   */
  for (
    let i = 1;
    i < positions.length;
    i++
  ) {
    const position =
      positions[i];

    const button =
      document.createElement(
        "button"
      );

    button.type =
      "button";

    button.className =
      "moveItem";

    if (
      i === currentPly
    ) {
      button.classList.add(
        "active"
      );
    }

    button.textContent =
      moveText(
        position.ply,
        position.san
      );

    button.addEventListener(
      "click",
      () => {
        selectPly(i);
      }
    );

    els.moveList.appendChild(
      button
    );
  }
}


/* =========================================================
   POSITION LABELS
   ========================================================= */

function renderPositionLabel() {
  if (els.moveLabel) {
    els.moveLabel.textContent =
      currentPly === 0
        ? "시작 포지션"
        : `${currentPly}수`;
  }

  if (els.positionLabel) {
    if (
      currentPly === 0
    ) {
      els.positionLabel.textContent =
        "시작 포지션";

      return;
    }

    const position =
      positions[currentPly];

    els.positionLabel.textContent =
      moveText(
        position.ply,
        position.san
      );
  }
}


/* =========================================================
   NAVIGATION BUTTON STATE
   ========================================================= */

function updateNavigationButtons() {
  const hasGame =
    positions.length > 0;

  const atStart =
    !hasGame ||
    currentPly === 0;

  const atEnd =
    !hasGame ||
    currentPly ===
      positions.length - 1;

  if (els.firstBtn) {
    els.firstBtn.disabled =
      atStart;
  }

  if (els.prevBtn) {
    els.prevBtn.disabled =
      atStart;
  }

  if (els.nextBtn) {
    els.nextBtn.disabled =
      atEnd;
  }

  if (els.lastBtn) {
    els.lastBtn.disabled =
      atEnd;
  }
}


/* =========================================================
   POSITION SELECTION
   ========================================================= */

async function selectPly(
  requestedPly
) {
  if (
    !positions.length
  ) {
    return;
  }

  const nextPly =
    clamp(
      requestedPly,
      0,
      positions.length - 1
    );

  currentPly =
    nextPly;

  const position =
    positions[currentPly];

  /*
   * 현재 진행 중인 엔진 분석을 중지한다.
   */
  cancelAnalysis();

  /*
   * 화면 갱신
   */
  renderBoard(
    position.fen
  );

  renderMoves();

  renderPositionLabel();

  updateNavigationButtons();

  /*
   * 분석 화면 초기화
   */
  if (els.evalValue) {
    els.evalValue.textContent =
      "분석 중…";
  }

  if (els.positionInsight) {
    els.positionInsight.textContent =
      "현재 포지션을 분석하고 있습니다.";
  }

  if (els.candidateList) {
    els.candidateList.innerHTML =
      "";
  }

  setProgress(
    0,
    null
  );

  /*
   * 다음 단계에서 실제 Position Snapshot이 들어간다.
   *
   * 지금은 기본 정보만 표시한다.
   */
  renderBasicPositionInfo(
    position.fen
  );

  /*
   * Stockfish 분석
   */
  try {
    await initEngine();

    /*
     * 사용자가 분석 도중 다른 수를 눌렀다면
     * 이 분석 결과를 화면에 적용하지 않는다.
     */
    const analysisPly =
      currentPly;

    const result =
      await analyzeFen(
        position.fen,
        10
      );

    if (
      analysisPly !==
      currentPly
    ) {
      return;
    }

    renderEngineResult(
      result
    );
  } catch (error) {
    /*
     * 사용자가 다른 수로 이동하면서
     * 분석이 취소된 경우는 오류로 표시하지 않는다.
     */
    if (
      error?.message ===
      "이전 분석이 취소되었습니다."
    ) {
      return;
    }

    console.error(
      error
    );

    if (els.evalValue) {
      els.evalValue.textContent =
        "분석 실패";
    }

    showError(
      error?.message ||
      "엔진 분석에 실패했습니다."
    );
  }
}


/* =========================================================
   BASIC POSITION INFORMATION
   ========================================================= */

function getSideName(
  color
) {
  return color === "w"
    ? "백"
    : "흑";
}


function countMaterial(
  chess,
  color
) {
  const values = {
    p: 1,
    n: 3.2,
    b: 3.3,
    r: 5,
    q: 9
  };

  const pieces = {
    p: 0,
    n: 0,
    b: 0,
    r: 0,
    q: 0
  };

  let total = 0;

  const board =
    chess.board();

  board.forEach(
    row => {
      row.forEach(
        piece => {
          if (
            !piece ||
            piece.color !==
              color ||
            piece.type === "k"
          ) {
            return;
          }

          pieces[
            piece.type
          ]++;

          total +=
            values[
              piece.type
            ];
        }
      );
    }
  );

  return {
    pieces,
    total
  };
}


function renderBasicPositionInfo(
  fen
) {
  if (
    !els.humanFactors
  ) {
    return;
  }

  let chess;

  try {
    chess =
      new Chess(fen);
  } catch {
    return;
  }

  const white =
    countMaterial(
      chess,
      "w"
    );

  const black =
    countMaterial(
      chess,
      "b"
    );

  const difference =
    Number(
      (
        white.total -
        black.total
      ).toFixed(1)
    );

  const side =
    getSideName(
      chess.turn()
    );

  let materialText =
    "물질적 균형에 가깝습니다.";

  if (
    difference > 0.3
  ) {
    materialText =
      `백이 약 ${difference.toFixed(
        1
      )}점 앞섭니다.`;
  } else if (
    difference < -0.3
  ) {
    materialText =
      `흑이 약 ${Math.abs(
        difference
      ).toFixed(
        1
      )}점 앞섭니다.`;
  }

  els.humanFactors.innerHTML = `
    <div class="factor">
      <b>현재 차례</b>
      <span>${side} 차례입니다.</span>
    </div>

    <div class="factor">
      <b>물질</b>
      <span>${materialText}</span>
    </div>

    <div class="factor">
      <b>기물 활동</b>
      <span>
        아직 단순 이동 가능성만으로 판단하지 않습니다.
        다음 단계에서 실제 활동성과 좋은 배치 가능성을 분석합니다.
      </span>
    </div>

    <div class="factor">
      <b>폰 구조</b>
      <span>
        고립폰, 더블폰, 후방폰, 통과폰 등의 구조를
        다음 분석 단계에서 확인합니다.
      </span>
    </div>

    <div class="factor">
      <b>공간</b>
      <span>
        각 진영이 실제로 활용할 수 있는 공간을
        다음 분석 단계에서 비교합니다.
      </span>
    </div>

    <div class="factor">
      <b>킹 안전</b>
      <span>
        킹 주변의 실제 공격 가능성을
        다음 분석 단계에서 판단합니다.
      </span>
    </div>
  `;
}


/* =========================================================
   UCI → SAN
   ========================================================= */

function uciToSan(
  fen,
  uci
) {
  if (
    !uci ||
    uci.length < 4
  ) {
    return "—";
  }

  try {
    const chess =
      new Chess(fen);

    const move =
      chess.move({
        from:
          uci.slice(
            0,
            2
          ),

        to:
          uci.slice(
            2,
            4
          ),

        promotion:
          uci[4] ||
          undefined
      });

    return move
      ? move.san
      : uci;
  } catch {
    return uci;
  }
}


/* =========================================================
   ENGINE RESULT RENDERING
   ========================================================= */

function renderEngineResult(
  result
) {
  if (
    !result
  ) {
    return;
  }

  const first =
    result.lines?.[0];

  const score =
    first?.score ??
    null;

  if (els.evalValue) {
    els.evalValue.textContent =
      formatScore(score);
  }

  if (els.positionInsight) {
    els.positionInsight.textContent =
      scoreDescription(
        score
      );
  }

  if (els.depthValue) {
    els.depthValue.textContent =
      String(
        result.depth ||
        "—"
      );
  }

  setProgress(
    100,
    result.depth
  );

  renderCandidates(
    result
  );
}


/* =========================================================
   CANDIDATES
   ========================================================= */

function renderCandidates(
  result
) {
  if (
    !els.candidateList
  ) {
    return;
  }

  els.candidateList.innerHTML =
    "";

  const lines =
    result.lines || [];

  if (!lines.length) {
    els.candidateList.innerHTML =
      `
      <div class="candidate">
        <div class="candidateTop">
          분석 결과가 없습니다.
        </div>
      </div>
      `;

    return;
  }

  const position =
    positions[currentPly];

  lines
    .slice(0, 3)
    .forEach(
      (line, index) => {
        const san =
          uciToSan(
            position.fen,
            line.pv?.[0]
          );

        const label =
          index === 0
            ? "엔진 최선"
            : "엔진 후보";

        const candidate =
          document.createElement(
            "div"
          );

        candidate.className =
          "candidate";

        candidate.innerHTML = `
          <div class="candidateTop">
            <strong>
              ${index + 1}.
              ${escapeHtml(san)}
              ·
              ${label}
            </strong>

            <span>
              ${escapeHtml(
                formatScore(
                  line.score
                )
              )}
            </span>
          </div>

          <div class="candidateDesc">
            ${
              index === 0
                ? "현재 포지션에서 Stockfish가 가장 높게 평가한 수입니다."
                : "Stockfish가 계산한 다른 주요 후보입니다."
            }
          </div>

          <div class="candidatePv">
            ${
              line.pv
                ?.slice(
                  0,
                  8
                )
                .map(
                  move =>
                    escapeHtml(
                      uciToSan(
                        position.fen,
                        move
                      )
                    )
                )
                .join(" ")
                ||
              ""
            }
          </div>
        `;

        els.candidateList.appendChild(
          candidate
        );
      }
    );
}


/* =========================================================
   START GAME
   ========================================================= */

async function startGame() {
  clearError();

  const text =
    els.pgnInput
      ?.value
      ?.trim();

  if (!text) {
    showError(
      "PGN을 입력해주세요."
    );

    return;
  }

  let chess;

  try {
    chess =
      new Chess();

    chess.loadPgn(
      text,
      {
        strict: false
      }
    );
  } catch (error) {
    console.error(
      error
    );

    showError(
      "PGN을 읽지 못했습니다. PGN 형식을 확인해주세요."
    );

    return;
  }

  /*
   * 수가 하나도 없는 경우
   */
  if (
    chess.history().length ===
    0
  ) {
    showError(
      "PGN에서 체스 수순을 찾지 못했습니다."
    );

    return;
  }

  try {
    positions =
      buildPositions(
        chess
      );
  } catch (error) {
    console.error(
      error
    );

    showError(
      "게임의 수순을 재구성하지 못했습니다."
    );

    return;
  }

  currentHeaders =
    parsePgnHeaders(
      text
    );

  currentPly =
    0;

  analysisCache.clear();

  renderGameMeta();

  /*
   * 입력 화면 → 분석 화면
   */
  if (els.inputView) {
    els.inputView.hidden =
      true;
  }

  if (els.analysisView) {
    els.analysisView.hidden =
      false;
  }

  /*
   * 첫 포지션
   */
  await selectPly(
    0
  );
}


/* =========================================================
   BACK
   ========================================================= */

function backToInput() {
  cancelAnalysis();

  positions = [];

  currentPly = 0;

  currentHeaders = {};

  analysisCache.clear();

  if (els.analysisView) {
    els.analysisView.hidden =
      true;
  }

  if (els.inputView) {
    els.inputView.hidden =
      false;
  }

  clearError();

  if (els.board) {
    els.board.innerHTML =
      "";
  }

  if (els.moveList) {
    els.moveList.innerHTML =
      "";
  }
}


/* =========================================================
   NAVIGATION
   ========================================================= */

function goFirst() {
  if (
    positions.length
  ) {
    selectPly(0);
  }
}


function goPrevious() {
  if (
    positions.length
  ) {
    selectPly(
      currentPly - 1
    );
  }
}


function goNext() {
  if (
    positions.length
  ) {
    selectPly(
      currentPly + 1
    );
  }
}


function goLast() {
  if (
    positions.length
  ) {
    selectPly(
      positions.length - 1
    );
  }
    }

/* =========================================================
   PART 3 — POSITION SNAPSHOT / 7 IMBALANCES
   ========================================================= */


/* =========================================================
   POSITION SNAPSHOT
   ========================================================= */

function createPositionSnapshot(
  fen
) {
  const chess =
    new Chess(fen);

  const turn =
    chess.turn();

  const board =
    chess.board();

  const material =
    analyzeMaterial(
      chess
    );

  const minorPieces =
    analyzeMinorPieces(
      chess
    );

  const pawnStructure =
    analyzePawnStructure(
      chess
    );

  const space =
    analyzeSpace(
      chess
    );

  const files =
    analyzeFiles(
      chess
    );

  const keySquares =
    analyzeKeySquares(
      chess
    );

  const development =
    analyzeDevelopment(
      chess
    );

  const initiative =
    analyzeInitiative(
      chess
    );

  const kingSafety =
    analyzeKingSafety(
      chess
    );

  const battlefield =
    chooseBattlefield(
      chess,
      {
        material,
        minorPieces,
        pawnStructure,
        space,
        files,
        keySquares,
        development,
        initiative,
        kingSafety
      }
    );

  const dominant =
    findDominantImbalance(
      {
        material,
        minorPieces,
        pawnStructure,
        space,
        files,
        keySquares,
        development,
        initiative,
        kingSafety,
        battlefield
      }
    );

  return {
    fen,

    turn,

    moveNumber:
      chess.moveNumber(),

    phase:
      getGamePhase(
        chess
      ),

    material,

    minorPieces,

    pawnStructure,

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
   MATERIAL
   ========================================================= */

const PIECE_VALUES =
  {
    p: 1,
    n: 3.2,
    b: 3.3,
    r: 5,
    q: 9,
    k: 0
  };


function analyzeMaterial(
  chess
) {
  const result = {
    white: {
      counts: {
        p: 0,
        n: 0,
        b: 0,
        r: 0,
        q: 0
      },

      total: 0
    },

    black: {
      counts: {
        p: 0,
        n: 0,
        b: 0,
        r: 0,
        q: 0
      },

      total: 0
    }
  };

  const board =
    chess.board();

  board.forEach(
    row => {
      row.forEach(
        piece => {
          if (
            !piece ||
            piece.type === "k"
          ) {
            return;
          }

          const side =
            piece.color === "w"
              ? result.white
              : result.black;

          side.counts[
            piece.type
          ]++;

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
      result.white.total.toFixed(
        1
      )
    );

  result.black.total =
    Number(
      result.black.total.toFixed(
        1
      )
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

function getGamePhase(
  chess
) {
  const moveNumber =
    chess.moveNumber();

  const material =
    analyzeMaterial(
      chess
    );

  const pieces =
    Object.values(
      material.white.counts
    ).reduce(
      (a, b) => a + b,
      0
    ) +
    Object.values(
      material.black.counts
    ).reduce(
      (a, b) => a + b,
      0
    );

  if (
    moveNumber <= 10
  ) {
    return "opening";
  }

  if (
    moveNumber <= 25 &&
    pieces >= 12
  ) {
    return "middlegame";
  }

  return "endgame";
}


/* =========================================================
   BOARD HELPERS
   ========================================================= */

function getBoardPiece(
  chess,
  square
) {
  const file =
    square.charCodeAt(0) -
    97;

  const rank =
    Number(
      square[1]
    );

  if (
    file < 0 ||
    file > 7 ||
    rank < 1 ||
    rank > 8
  ) {
    return null;
  }

  return chess.get(
    square
  );
}


function getAllPieces(
  chess,
  color = null
) {
  const pieces = [];

  const board =
    chess.board();

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
      const piece =
        board[row][col];

      if (!piece) {
        continue;
      }

      if (
        color &&
        piece.color !== color
      ) {
        continue;
      }

      const square =
        String.fromCharCode(
          97 + col
        ) +
        String(
          8 - row
        );

      pieces.push({
        ...piece,
        square
      });
    }
  }

  return pieces;
}


function getPiecesOfType(
  chess,
  color,
  type
) {
  return getAllPieces(
    chess,
    color
  ).filter(
    piece =>
      piece.type === type
  );
}


/* =========================================================
   SAFE MOVE HELPERS
   ========================================================= */

/*
 * chess.js의 moves()는 기본적으로
 * 현재 차례의 기물만 움직인다.
 *
 * 따라서 상대편 기물의 활동성을 계산할 때는
 * 해당 색을 차례로 바꾼 임시 포지션을 만든다.
 */

function createChessForColor(
  chess,
  color
) {
  const parts =
    chess.fen().split(" ");

  parts[1] =
    color;

  /*
   * en-passant / castling 등의 정보는
   * 활동성 평가에서는 보존한다.
   */
  return new Chess(
    parts.join(" ")
  );
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

    return testChess.moves({
      square,
      verbose: true
    });
  } catch {
    return [];
  }
}


/* =========================================================
   ATTACK HELPERS
   ========================================================= */

function getAttackers(
  chess,
  square,
  color
) {
  const attackers = [];

  const pieces =
    getAllPieces(
      chess,
      color
    );

  for (
    const piece of pieces
  ) {
    const moves =
      getLegalMovesForPiece(
        chess,
        piece.square,
        color
      );

    const attacks =
      moves.some(
        move =>
          move.to === square
      );

    if (attacks) {
      attackers.push(
        piece
      );
    }
  }

  return attackers;
}


function getPawnDefenders(
  chess,
  square,
  color
) {
  return getAttackers(
    chess,
    square,
    color
  ).filter(
    piece =>
      piece.type === "p"
  );
}


/* =========================================================
   1. SUPERIOR MINOR PIECE
   ========================================================= */

function analyzeMinorPiece(
  chess,
  piece
) {
  const moves =
    getLegalMovesForPiece(
      chess,
      piece.square,
      piece.color
    );

  const destinations =
    moves.map(
      move =>
        move.to
    );

  const captures =
    moves.filter(
      move =>
        Boolean(
          move.captured
        )
    );

  let activity =
    clamp(
      moves.length / 10,
      0,
      1
    );

  /*
   * 중앙 접근성
   */
  const centerSquares =
    [
      "c3",
      "c4",
      "c5",
      "c6",
      "d3",
      "d4",
      "d5",
      "d6",
      "e3",
      "e4",
      "e5",
      "e6",
      "f3",
      "f4",
      "f5",
      "f6"
    ];

  const centerAccess =
    destinations.filter(
      square =>
        centerSquares.includes(
          square
        )
    ).length;

  /*
   * 상대 진영 접근성
   */
  const enemyRank =
    piece.color === "w"
      ? 5
      : 4;

  const advanced =
    destinations.filter(
      square =>
        (
          piece.color === "w"
            ? Number(
                square[1]
              ) >= enemyRank
            : Number(
                square[1]
              ) <= enemyRank
        )
    ).length;

  /*
   * 실제 목표물 접근
   */
  const enemyPieces =
    getAllPieces(
      chess,
      piece.color === "w"
        ? "b"
        : "w"
    );

  let targetAccess =
    0;

  for (
    const enemy of enemyPieces
  ) {
    if (
      destinations.includes(
        enemy.square
      )
    ) {
      targetAccess++;
    }
  }

  /*
   * 안전한 이동칸의 비율
   */
  let safeMoves =
    0;

  for (
    const move of moves
  ) {
    const enemyAttackers =
      getAttackers(
        chess,
        move.to,
        piece.color === "w"
          ? "b"
          : "w"
      );

    if (
      enemyAttackers.length ===
      0
    ) {
      safeMoves++;
    }
  }

  const safeMobility =
    moves.length
      ? safeMoves /
        moves.length
      : 0;

  const activityScore =
    clamp(
      activity * 0.45 +
        safeMobility * 0.25 +
        clamp(
          centerAccess / 4,
          0,
          1
        ) *
          0.15 +
        clamp(
          advanced / 3,
          0,
          1
        ) *
          0.15,
      0,
      1
    );

  return {
    square:
      piece.square,

    type:
      piece.type,

    color:
      piece.color,

    mobility:
      moves.length,

    safeMobility,

    centerAccess,

    advancedAccess:
      advanced,

    targetAccess,

    captures:
      captures.length,

    activityScore
  };
}


function analyzeMinorPieces(
  chess
) {
  const result = {
    white: [],
    black: []
  };

  for (
    const color of [
      "w",
      "b"
    ]
  ) {
    const pieces =
      getAllPieces(
        chess,
        color
      ).filter(
        piece =>
          piece.type === "b" ||
          piece.type === "n"
      );

    result[
      color === "w"
        ? "white"
        : "black"
    ] =
      pieces.map(
        piece =>
          analyzeMinorPiece(
            chess,
            piece
          )
      );
  }

  /*
   * Bishop pair
   */
  result.whiteBishopPair =
    result.white.filter(
      piece =>
        piece.type === "b"
    ).length >= 2;

  result.blackBishopPair =
    result.black.filter(
      piece =>
        piece.type === "b"
    ).length >= 2;

  /*
   * 상대 비교
   */
  const whiteAverage =
    result.white.length
      ? result.white.reduce(
          (sum, piece) =>
            sum +
            piece.activityScore,
          0
        ) /
        result.white.length
      : 0;

  const blackAverage =
    result.black.length
      ? result.black.reduce(
          (sum, piece) =>
            sum +
            piece.activityScore,
          0
        ) /
        result.black.length
      : 0;

  result.activityDifference =
    Number(
      (
        whiteAverage -
        blackAverage
      ).toFixed(2)
    );

  result.whiteAverage =
    Number(
      whiteAverage.toFixed(
        2
      )
    );

  result.blackAverage =
    Number(
      blackAverage.toFixed(
        2
      )
    );

  return result;
}


/* =========================================================
   2. PAWN STRUCTURE
   ========================================================= */

function getPawnData(
  chess,
  color
) {
  const pawns =
    getPiecesOfType(
      chess,
      color,
      "p"
    );

  const enemy =
    color === "w"
      ? "b"
      : "w";

  const result =
    pawns.map(
      pawn => {
        const file =
          pawn.square[0];

        const rank =
          Number(
            pawn.square[1]
          );

        const sameFile =
          pawns.filter(
            other =>
              other.square[0] ===
              file
          );

        const isolated =
          pawns.every(
            other =>
              Math.abs(
                other.square.charCodeAt(0) -
                  file.charCodeAt(0)
              ) > 1
          );

        const doubled =
          sameFile.length >
          1;

        const defenders =
          getPawnDefenders(
            chess,
            pawn.square,
            color
          );

        /*
         * 통과폰:
         * 앞쪽과 양 옆 파일에
         * 상대 폰이 없어야 한다.
         */
        const pawnDirection =
          color === "w"
            ? 1
            : -1;

        let passed =
          true;

        const pawnFiles = [
          String.fromCharCode(
            file.charCodeAt(0) - 1
          ),
          file,
          String.fromCharCode(
            file.charCodeAt(0) + 1
          )
        ];

        const enemyPawns =
          getPiecesOfType(
            chess,
            enemy,
            "p"
          );

        for (
          const enemyPawn of
            enemyPawns
        ) {
          const enemyFile =
            enemyPawn.square[0];

          const enemyRank =
            Number(
              enemyPawn.square[1]
            );

          if (
            !pawnFiles.includes(
              enemyFile
            )
          ) {
            continue;
          }

          if (
            color === "w" &&
            enemyRank >
              rank
          ) {
            passed =
              false;
          }

          if (
            color === "b" &&
            enemyRank <
              rank
          ) {
            passed =
              false;
          }
        }

        return {
          square:
            pawn.square,

          file,

          rank,

          isolated,

          doubled,

          passed,

          protectedPassed:
            passed &&
            defenders.length >
              0,

          defenders:
            defenders.map(
              piece =>
                piece.square
            )
        };
      }
    );

  const isolatedCount =
    result.filter(
      pawn =>
        pawn.isolated
    ).length;

  const doubledCount =
    result.filter(
      pawn =>
        pawn.doubled
    ).length;

  const passedCount =
    result.filter(
      pawn =>
        pawn.passed
    ).length;

  const protectedPassedCount =
    result.filter(
      pawn =>
        pawn.protectedPassed
    ).length;

  return {
    pawns: result,

    isolatedCount,

    doubledCount,

    passedCount,

    protectedPassedCount
  };
}


function analyzePawnStructure(
  chess
) {
  const white =
    getPawnData(
      chess,
      "w"
    );

  const black =
    getPawnData(
      chess,
      "b"
    );

  /*
   * 구조적 특징과
   * 실제 약점은 구분한다.
   *
   * 여기서는 아직
   * 최종 약점 판정을 하지 않는다.
   */
  return {
    white,
    black,

    structuralFacts: [
      white.isolatedCount >
        0
        ? "white_isolated_pawn"
        : null,

      white.doubledCount >
        0
        ? "white_doubled_pawn"
        : null,

      black.isolatedCount >
        0
        ? "black_isolated_pawn"
        : null,

      black.doubledCount >
        0
        ? "black_doubled_pawn"
        : null,

      white.passedCount >
        0
        ? "white_passed_pawn"
        : null,

      black.passedCount >
        0
        ? "black_passed_pawn"
        : null
    ].filter(Boolean)
  };
}


/* =========================================================
   3. SPACE
   ========================================================= */

function analyzeSpace(
  chess
) {
  const result = {
    white: 0,
    black: 0
  };

  /*
   * 단순히 전진한 폰의 수가 아니라
   * 폰이 실제로 지배하는 영역을 계산한다.
   */
  for (
    const color of [
      "w",
      "b"
    ]
  ) {
    const pawns =
      getPiecesOfType(
        chess,
        color,
        "p"
      );

    let score = 0;

    for (
      const pawn of pawns
    ) {
      const rank =
        Number(
          pawn.square[1]
        );

      /*
       * 상대 진영에 가까울수록
       * 공간 영향력을 조금 높인다.
       */
      const advance =
        color === "w"
          ? rank - 2
          : 7 - rank;

      score +=
        clamp(
          advance / 5,
          0,
          1
        );
    }

    result[
      color === "w"
        ? "white"
        : "black"
    ] =
      Number(
        score.toFixed(2)
      );
  }

  result.difference =
    Number(
      (
        result.white -
        result.black
      ).toFixed(2)
    );

  return result;
}


/* =========================================================
   4. KEY FILES
   ========================================================= */

function analyzeFiles(
  chess
) {
  const files = [];

  for (
    let i = 0;
    i < 8;
    i++
  ) {
    const file =
      String.fromCharCode(
        97 + i
      );

    const whitePawns =
      getPiecesOfType(
        chess,
        "w",
        "p"
      ).filter(
        pawn =>
          pawn.square[0] ===
          file
      );

    const blackPawns =
      getPiecesOfType(
        chess,
        "b",
        "p"
      ).filter(
        pawn =>
          pawn.square[0] ===
          file
      );

    const whiteRooks =
      getPiecesOfType(
        chess,
        "w",
        "r"
      ).filter(
        rook =>
          rook.square[0] ===
          file
      );

    const blackRooks =
      getPiecesOfType(
        chess,
        "b",
        "r"
      ).filter(
        rook =>
          rook.square[0] ===
          file
      );

    let type =
      "closed";

    if (
      whitePawns.length === 0 &&
      blackPawns.length === 0
    ) {
      type =
        "open";
    } else if (
      whitePawns.length === 0 ||
      blackPawns.length === 0
    ) {
      type =
        "semi-open";
    }

    files.push({
      file,

      type,

      whitePawns:
        whitePawns.length,

      blackPawns:
        blackPawns.length,

      whiteRooks:
        whiteRooks.length,

      blackRooks:
        blackRooks.length,

      rookAccess:
        whiteRooks.length +
        blackRooks.length
    });
  }

  return files;
}


/* =========================================================
   5. KEY SQUARES
   ========================================================= */

function analyzeKeySquares(
  chess
) {
  const candidates = [];

  const files =
    "abcdefgh";

  for (
    const file of files
  ) {
    for (
      let rank = 3;
      rank <= 6;
      rank++
    ) {
      const square =
        `${file}${rank}`;

      if (
        getBoardPiece(
          chess,
          square
        )
      ) {
        continue;
      }

      const whiteAttackers =
        getAttackers(
          chess,
          square,
          "w"
        );

      const blackAttackers =
        getAttackers(
          chess,
          square,
          "b"
        );

      if (
        whiteAttackers.length +
          blackAttackers.length ===
        0
      ) {
        continue;
      }

      candidates.push({
        square,

        whiteControl:
          whiteAttackers.length,

        blackControl:
          blackAttackers.length,

        controlDifference:
          whiteAttackers.length -
          blackAttackers.length
      });
    }
  }

  candidates.sort(
    (a, b) =>
      Math.abs(
        b.controlDifference
      ) -
      Math.abs(
        a.controlDifference
      )
  );

  return candidates.slice(
    0,
    8
  );
}


/* =========================================================
   6. DEVELOPMENT
   ========================================================= */

function analyzeDevelopment(
  chess
) {
  const result = {
    white: {},
    black: {}
  };

  for (
    const color of [
      "w",
      "b"
    ]
  ) {
    const pieces =
      getAllPieces(
        chess,
        color
      );

    const minors =
      pieces.filter(
        piece =>
          piece.type === "b" ||
          piece.type === "n"
      );

    const developed =
      minors.filter(
        piece => {
          const startSquares =
            color === "w"
              ? [
                  "b1",
                  "c1",
                  "f1",
                  "g1"
                ]
              : [
                  "b8",
                  "c8",
                  "f8",
                  "g8"
                ];

          return !startSquares.includes(
            piece.square
          );
        }
      );

    const rooks =
      pieces.filter(
        piece =>
          piece.type === "r"
      );

    const queen =
      pieces.filter(
        piece =>
          piece.type === "q"
      );

    result[
      color === "w"
        ? "white"
        : "black"
    ] = {
      minorPieces:
        minors.length,

      developedMinors:
        developed.length,

      rooksConnected:
        rooks.length === 2 &&
        !rooks.some(
          rook =>
            rook.square[1] ===
            (
              color === "w"
                ? "1"
                : "8"
            )
        ),

      queenDeveloped:
        queen.length === 1 &&
        ![
          "d1",
          "d8"
        ].includes(
          queen[0].square
        )
    };
  }

  result.difference =
    result.white
      .developedMinors -
    result.black
      .developedMinors;

  return result;
}


/* =========================================================
   7. INITIATIVE
   ========================================================= */

function analyzeInitiative(
  chess
) {
  const result = {
    white: 0,
    black: 0
  };

  for (
    const color of [
      "w",
      "b"
    ]
  ) {
    const enemy =
      color === "w"
        ? "b"
        : "w";

    const pieces =
      getAllPieces(
        chess,
        color
      );

    let score = 0;

    /*
     * 상대 킹에 대한 직접적인 공격
     */
    const enemyKing =
      getPiecesOfType(
        chess,
        enemy,
        "k"
      )[0];

    if (
      enemyKing
    ) {
      const attackers =
        getAttackers(
          chess,
          enemyKing.square,
          color
        );

      score +=
        attackers.length *
        0.25;
    }

    /*
     * 상대 기물을 공격하는 수가 많은가
     */
    for (
      const piece of pieces
    ) {
      const moves =
        getLegalMovesForPiece(
          chess,
          piece.square,
          color
        );

      const captures =
        moves.filter(
          move =>
            Boolean(
              move.captured
            )
        );

      score +=
        captures.length *
        0.08;
    }

    result[
      color === "w"
        ? "white"
        : "black"
    ] =
      clamp(
        score,
        0,
        1
      );
  }

  result.difference =
    Number(
      (
        result.white -
        result.black
      ).toFixed(2)
    );

  return result;
}


/* =========================================================
   KING SAFETY
   ========================================================= */

function analyzeKingSafety(
  chess
) {
  const result = {};

  for (
    const color of [
      "w",
      "b"
    ]
  ) {
    const king =
      getPiecesOfType(
        chess,
        color,
        "k"
      )[0];

    if (!king) {
      continue;
    }

    const enemy =
      color === "w"
        ? "b"
        : "w";

    const attackers =
      getAttackers(
        chess,
        king.square,
        enemy
      );

    /*
     * 주변 폰 보호
     */
    const kingFile =
      king.square.charCodeAt(
        0
      );

    const kingRank =
      Number(
        king.square[1]
      );

    const friendlyPawns =
      getPiecesOfType(
        chess,
        color,
        "p"
      ).filter(
        pawn => {
          const file =
            pawn.square.charCodeAt(
              0
            );

          const rank =
            Number(
              pawn.square[1]
            );

          return (
            Math.abs(
              file -
                kingFile
            ) <= 1 &&
            Math.abs(
              rank -
                kingRank
            ) <= 2
          );
        }
      );

    result[
      color === "w"
        ? "white"
        : "black"
    ] = {
      kingSquare:
        king.square,

      attackers:
        attackers.length,

      nearbyPawns:
        friendlyPawns.length,

      pressure:
        clamp(
          attackers.length *
            0.25,
          0,
          1
        )
    };
  }

  return result;
}


/* =========================================================
   BATTLEFIELD
   ========================================================= */

function chooseBattlefield(
  chess,
  data
) {
  const regions = [
    {
      name: "queenside",
      score: 0
    },
    {
      name: "center",
      score: 0
    },
    {
      name: "kingside",
      score: 0
    }
  ];

  /*
   * 폰 구조를 통해
   * 어느 쪽에서 실제 변화가 가능한지 본다.
   */
  const allPawns =
    [
      ...data.pawnStructure.white
        .pawns,

      ...data.pawnStructure.black
        .pawns
    ];

  for (
    const pawn of allPawns
  ) {
    const file =
      pawn.file;

    if (
      file <= "c"
    ) {
      regions[0].score +=
        0.15;
    } else if (
      file >= "f"
    ) {
      regions[2].score +=
        0.15;
    } else {
      regions[1].score +=
        0.15;
    }
  }

  /*
   * 열린 파일
   */
  data.files.forEach(
    fileData => {
      if (
        fileData.type ===
        "open"
      ) {
        if (
          fileData.file <=
          "c"
        ) {
          regions[0].score +=
            0.2;
        } else if (
          fileData.file >=
          "f"
        ) {
          regions[2].score +=
            0.2;
        } else {
          regions[1].score +=
            0.2;
        }
      }
    }
  );

  /*
   * 킹 주변의 압박
   */
  if (
    data.kingSafety.white
      ?.pressure >
    0.2
  ) {
    regions[2].score +=
      0.3;
  }

  if (
    data.kingSafety.black
      ?.pressure >
    0.2
  ) {
    regions[2].score +=
      0.3;
  }

  regions.forEach(
    region => {
      region.score =
        Number(
          clamp(
            region.score,
            0,
            1
          ).toFixed(2)
        );
    }
  );

  regions.sort(
    (a, b) =>
      b.score -
      a.score
  );

  return regions;
}


/* =========================================================
   DOMINANT IMBALANCE
   ========================================================= */

function findDominantImbalance(
  data
) {
  const candidates = [];

  const material =
    data.material;

  if (
    Math.abs(
      material.difference
    ) >= 1
  ) {
    candidates.push({
      type: "material",
      score:
        clamp(
          Math.abs(
            material.difference
          ) / 5,
          0,
          1
        ),

      reason:
        "물질 차이가 존재합니다."
    });
  }

  if (
    Math.abs(
      data.minorPieces
        .activityDifference
    ) >= 0.15
  ) {
    candidates.push({
      type:
        "superior_minor_piece",

      score:
        clamp(
          Math.abs(
            data.minorPieces
              .activityDifference
          ),
          0,
          1
        ),

      reason:
        "기물 활동성 차이가 존재합니다."
    });
  }

  if (
    data.pawnStructure
      .structuralFacts.length
  ) {
    candidates.push({
      type:
        "pawn_structure",

      score:
        clamp(
          data.pawnStructure
            .structuralFacts
            .length /
            4,
          0,
          1
        ),

      reason:
        "폰 구조상의 특징이 발견되었습니다."
    });
  }

  if (
    Math.abs(
      data.space.difference
    ) >= 0.2
  ) {
    candidates.push({
      type:
        "space",

      score:
        clamp(
          Math.abs(
            data.space.difference
          ),
          0,
          1
        ),

      reason:
        "공간 차이가 존재합니다."
    });
  }

  const openFiles =
    data.files.filter(
      file =>
        file.type ===
        "open" ||
        file.type ===
        "semi-open"
    );

  if (
    openFiles.length
  ) {
    candidates.push({
      type:
        "key_file",

      score:
        clamp(
          openFiles.length /
            4,
          0,
          1
        ),

      reason:
        "활용 가능한 열린 파일이 있습니다."
    });
  }

  if (
    Math.abs(
      data.development
        .difference
    ) >= 1
  ) {
    candidates.push({
      type:
        "development",

      score:
        clamp(
          Math.abs(
            data.development
              .difference
          ) / 3,
          0,
          1
        ),

      reason:
        "개발 속도 차이가 존재합니다."
    });
  }

  if (
    Math.abs(
      data.initiative
        .difference
    ) >= 0.2
  ) {
    candidates.push({
      type:
        "initiative",

      score:
        clamp(
          Math.abs(
            data.initiative
              .difference
          ),
          0,
          1
        ),

      reason:
        "한쪽이 상대에게 더 많은 대응을 요구하고 있습니다."
    });
  }

  if (!candidates.length) {
    return {
      type: "balanced",
      score: 0,
      reason:
        "현재 단계에서 뚜렷한 단일 우세 불균형을 찾지 못했습니다."
    };
  }

  candidates.sort(
    (a, b) =>
      b.score -
      a.score
  );

  return {
    ...candidates[0],

    alternatives:
      candidates.slice(
        1,
        4
      )
  };
}


/* =========================================================
   HUMAN EXPLANATION FOR IMBALANCES
   ========================================================= */

function imbalanceName(
  type
) {
  const names = {
    material:
      "물질",

    superior_minor_piece:
      "우세한 마이너 피스",

    pawn_structure:
      "폰 구조",

    space:
      "공간",

    key_file:
      "주요 파일",

    development:
      "전개",

    initiative:
      "주도권",

    balanced:
      "균형"
  };

  return (
    names[type] ||
    type
  );
}


function renderStrategicFactors(
  snapshot
) {
  if (
    !els.humanFactors
  ) {
    return;
  }

  const dominant =
    snapshot.dominant;

  const battlefield =
    snapshot.battlefield?.[0];

  const material =
    snapshot.material;

  let materialText =
    "물질적 균형에 가깝습니다.";

  if (
    material.difference >
    0.3
  ) {
    materialText =
      `백이 약 ${material.difference.toFixed(
        1
      )}점의 물질적 우세를 가지고 있습니다.`;
  } else if (
    material.difference <
    -0.3
  ) {
    materialText =
      `흑이 약 ${Math.abs(
        material.difference
      ).toFixed(
        1
      )}점의 물질적 우세를 가지고 있습니다.`;
  }

  const battlefieldText =
    battlefield
      ? `${
          battlefield.name ===
          "queenside"
            ? "퀸사이드"
            : battlefield.name ===
              "kingside"
            ? "킹사이드"
            : "중앙"
        } 쪽에서 계획을 찾을 단서가 가장 많습니다.`
      : "아직 특정 지역의 우세가 뚜렷하지 않습니다.";

  els.humanFactors.innerHTML = `
    <div class="factor">
      <b>물질</b>
      <span>
        ${escapeHtml(
          materialText
        )}
      </span>
    </div>

    <div class="factor">
      <b>기물 활동</b>
      <span>
        백 평균
        ${snapshot.minorPieces.whiteAverage.toFixed(
          2
        )}
        /
        흑 평균
        ${snapshot.minorPieces.blackAverage.toFixed(
          2
        )}
      </span>
    </div>

    <div class="factor">
      <b>폰 구조</b>
      <span>
        ${
          snapshot.pawnStructure
            .structuralFacts
            .length
            ? `구조적 특징 ${
                snapshot.pawnStructure
                  .structuralFacts
                  .length
              }개가 발견되었습니다.`
            : "눈에 띄는 기본 구조적 특징이 없습니다."
        }
      </span>
    </div>

    <div class="factor">
      <b>공간</b>
      <span>
        백 ${snapshot.space.white.toFixed(
          2
        )}
        /
        흑 ${snapshot.space.black.toFixed(
          2
        )}
      </span>
    </div>

    <div class="factor">
      <b>주요 불균형</b>
      <span>
        ${escapeHtml(
          imbalanceName(
            dominant.type
          )
        )}
      </span>
    </div>

    <div class="factor">
      <b>싸울 곳</b>
      <span>
        ${escapeHtml(
          battlefieldText
        )}
      </span>
    </div>
  `;
    }

/* =========================================================
   PART 4 — CONNECT / EVENTS / START
   ========================================================= */


/* =========================================================
   STRATEGIC INSIGHT
   ========================================================= */

function renderStrategicInsight(snapshot) {
  if (!els.positionInsight) {
    return;
  }

  const dominant =
    snapshot.dominant;

  const battlefield =
    snapshot.battlefield?.[0];

  let firstText =
    "현재 포지션에서 먼저 확인해야 할 뚜렷한 불균형은 아직 없습니다.";

  if (
    dominant &&
    dominant.type !== "balanced"
  ) {
    firstText =
      `먼저 볼 것은 <b>${escapeHtml(
        imbalanceName(
          dominant.type
        )
      )}</b>입니다.`;
  }

  let battlefieldText =
    "특정 지역에 계획을 고정하기보다 상대의 다음 의도를 먼저 확인하세요.";

  if (battlefield) {
    const name =
      battlefield.name === "queenside"
        ? "퀸사이드"
        : battlefield.name === "kingside"
        ? "킹사이드"
        : "중앙";

    battlefieldText =
      `<b>${name}</b> 쪽에서 실제로 활용할 수 있는 불균형을 먼저 찾아보세요.`;
  }

  const initiative =
    snapshot.initiative;

  let initiativeText =
    "양쪽의 주도권 차이가 크지 않습니다.";

  if (
    initiative.difference > 0.2
  ) {
    initiativeText =
      "백이 상대에게 대응을 요구하는 요소가 조금 더 많습니다.";
  } else if (
    initiative.difference < -0.2
  ) {
    initiativeText =
      "흑이 상대에게 대응을 요구하는 요소가 조금 더 많습니다.";
  }

  els.positionInsight.innerHTML = `
    <div class="insightBlock">
      <strong>먼저 볼 것</strong>
      <p>
        ${firstText}
      </p>
    </div>

    <div class="insightBlock">
      <strong>어디에서 싸울 것인가</strong>
      <p>
        ${battlefieldText}
      </p>
    </div>

    <div class="insightBlock">
      <strong>주도권</strong>
      <p>
        ${initiativeText}
      </p>
    </div>

    <div class="insightBlock">
      <strong>생각의 순서</strong>
      <p>
        불균형을 찾고 → 활용할 지역을 정하고 →
        원하는 포지션을 그린 다음 →
        후보 수를 계산하는 순서로 생각하세요.
      </p>
    </div>
  `;
}


/* =========================================================
   STRATEGIC SNAPSHOT CACHE
   ========================================================= */

const strategicCache =
  new Map();


function getStrategicSnapshot(fen) {
  if (
    strategicCache.has(fen)
  ) {
    return strategicCache.get(fen);
  }

  /*
   * createPositionSnapshot()은
   * FEN 문자열을 받는다.
   */
  const snapshot =
    createPositionSnapshot(
      fen
    );

  strategicCache.set(
    fen,
    snapshot
  );

  return snapshot;
}


/* =========================================================
   CONNECT BASIC POSITION → STRATEGIC ANALYSIS
   ========================================================= */

/*
 * PART 2에서 이미 존재하는
 *
 * renderBasicPositionInfo(fen)
 *
 * 를 다시 선언하지 않는다.
 *
 * 기존 화면 표시를 먼저 실행하고,
 * 그 다음 ChessSense 전략 분석을 실행한다.
 */

const basicPositionRenderer =
  renderBasicPositionInfo;

renderBasicPositionInfo =
  function (fen) {
    basicPositionRenderer(
      fen
    );

    try {
      const snapshot =
        getStrategicSnapshot(
          fen
        );

      renderStrategicFactors(
        snapshot
      );

      renderStrategicInsight(
        snapshot
      );

    } catch (error) {
      console.error(
        "Strategic analysis error:",
        error
      );

      if (
        els.positionInsight
      ) {
        els.positionInsight.innerHTML = `
          <div class="insightBlock">
            <strong>전략 분석</strong>
            <p>
              현재 포지션의 전략 분석 중
              일부 항목을 계산하지 못했습니다.
            </p>
          </div>
        `;
      }
    }
  };


/* =========================================================
   BUTTON EVENTS
   ========================================================= */

/*
 * PART 2에서 실제 동작 함수는 이미 만들어져 있다.
 *
 * 여기서는 버튼과 함수를 연결하기만 한다.
 */


/* 예제 PGN */

if (els.exampleBtn) {
  els.exampleBtn.addEventListener(
    "click",
    () => {
      els.pgnInput.value =
        EXAMPLE_PGN;

      clearError();

      setStatus(
        "예제 PGN을 불러왔습니다.",
        "ready"
      );
    }
  );
}


/* 분석 시작 */

if (els.analyzeBtn) {
  els.analyzeBtn.addEventListener(
    "click",
    async () => {
      clearError();

      els.analyzeBtn.disabled =
        true;

      try {
        const text =
          els.pgnInput.value.trim();

        if (!text) {
          showError(
            "PGN을 먼저 입력해주세요."
          );

          return;
        }

        await startGame(
          text
        );

      } catch (error) {
        console.error(
          error
        );

        showError(
          error.message ||
          "게임을 분석하지 못했습니다."
        );

      } finally {
        els.analyzeBtn.disabled =
          false;
      }
    }
  );
}


/* 입력 화면으로 돌아가기 */

if (els.backBtn) {
  els.backBtn.addEventListener(
    "click",
    () => {
      backToInput();
    }
  );
}


/* 처음 */

if (els.firstBtn) {
  els.firstBtn.addEventListener(
    "click",
    () => {
      goFirst();
    }
  );
}


/* 이전 */

if (els.prevBtn) {
  els.prevBtn.addEventListener(
    "click",
    () => {
      goPrevious();
    }
  );
}


/* 다음 */

if (els.nextBtn) {
  els.nextBtn.addEventListener(
    "click",
    () => {
      goNext();
    }
  );
}


/* 마지막 */

if (els.lastBtn) {
  els.lastBtn.addEventListener(
    "click",
    () => {
      goLast();
    }
  );
}


/* =========================================================
   INITIAL UI
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
  0
);

setStatus(
  "Stockfish 준비 중…",
  "loading"
);


/* =========================================================
   INITIAL ENGINE
   ========================================================= */

initEngine()
  .then(() => {
    setStatus(
      "Stockfish 준비 완료",
      "ready"
    );
  })
  .catch(error => {
    console.error(
      "Initial engine error:",
      error
    );

    setStatus(
      "Stockfish 준비 실패",
      "error"
    );

    showError(
      "Stockfish를 불러오지 못했습니다. 페이지를 새로고침한 뒤 다시 시도해주세요."
    );
  });


/* =========================================================
   RUNTIME ERROR LOG
   ========================================================= */

window.addEventListener(
  "error",
  event => {
    console.error(
      "Runtime error:",
      event.error
    );
  }
);

window.addEventListener(
  "unhandledrejection",
  event => {
    console.error(
      "Unhandled promise rejection:",
      event.reason
    );
  }
);
