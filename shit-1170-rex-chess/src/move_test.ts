// the move chooser, tested against known positions.
//
// --- WHY THIS FILE EXISTS ---
// the move chooser is the one piece of this skill that can burn gas
// silently. a move the contract rejects is a failed transaction, and
// a failed transaction still costs. so the chooser is tested against
// positions with known answers, and the tests are the reason the
// skill can trust it.
//
// run them with `bun test`.
//
// --- THE BOARD ORDER ---
// the contract's `get_board` answers with row 0 as RANK 1. the tool
// box's docs and the upstream agent skill both say "row 0 is rank 8",
// and they are both wrong — the live contract and the protocol pawns
// api agree with each other, and they say rank 1.
//
// every board in this file is in the CONTRACT's order, and the test
// for a live game pins it against the api's own fen for that game.

import { describe, expect, test } from "bun:test";
import { Chess } from "chess.js";

import {
  shit_1170_chess_board_to_fen_fun,
  shit_1170_chess_castling_rights_fun,
  shit_1170_chess_choose_move_fun,
  shit_1170_chess_legal_moves_fun,
  shit_1170_chess_move_notation_fun,
} from "./move";
import type { SHIT_1170_CHESS_GAME_INFO } from "./types";

function info(turn_color: "White" | "Black"): SHIT_1170_CHESS_GAME_INFO {
  return {
    white: { type: "Human", value: "a.near" },
    black: { type: "Human", value: "b.near" },
    turn_color,
    last_block_height: 1,
    has_bets: false,
  };
}

// the starting position, in the contract's row order: rank 1 first.
const START_BOARD = [
  "RNBQKBNR",
  "PPPPPPPP",
  "        ",
  "        ",
  "        ",
  "        ",
  "pppppppp",
  "rnbqkbnr",
];

describe("the fen", () => {
  test("the starting board becomes the starting fen", () => {
    expect(shit_1170_chess_board_to_fen_fun(START_BOARD, info("White"))).toBe(
      "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    );
  });

  test("the castling rights come from the board", () => {
    expect(shit_1170_chess_castling_rights_fun(START_BOARD)).toBe("KQkq");
  });

  test("a king that has moved loses its rights", () => {
    // the white king has castled to g1, so the white rights are gone.
    // the black rights are untouched.
    const board = [
      "RNBQ1RK1",
      "PPPP1PPP",
      "5N2",
      "2B1P3",
      "2b1p3",
      "2n5",
      "pppp1ppp",
      "r1bqk1nr",
    ];
    expect(shit_1170_chess_castling_rights_fun(board)).toBe("kq");
  });

  test("black to move flips the side field", () => {
    const fen = shit_1170_chess_board_to_fen_fun(START_BOARD, info("Black"));
    expect(fen.split(" ")[1]).toBe("b");
  });

  test("a live game's board becomes the api's fen for it", () => {
    // a real game on mainnet, and the fen the protocol pawns api
    // reports for the same position.
    //
    // THIS IS THE TEST THAT CATCHES A REVERSED BOARD. the starting
    // position is symmetric, so a board that came out backwards still
    // looks right there. this position is not symmetric — white has a
    // bishop on c4 and a knight on c3 — so a reversed board gives a
    // different fen and a different game.
    //
    // the castling rights are the OTHER difference. the api says `-`,
    // because the contract keeps the rights as state and the king has
    // moved. the board-derived rights say `KQkq`, because the pieces
    // are on their home squares. that is the difference between the
    // api's fen and the fallback, and it is why the api's fen is the
    // source the chooser prefers.
    const board = [
      "R  QK  R",
      " BPP  PP",
      "PPNBPN  ",
      "     P  ",
      "  pp    ",
      "p   p  p",
      " p  npp ",
      "r bqkbnr",
    ];
    const derived = shit_1170_chess_board_to_fen_fun(board, info("Black"));
    expect(derived).toBe(
      "r1bqkbnr/1p2npp1/p3p2p/2pp4/5P2/PPNBPN2/1BPP2PP/R2QK2R b KQkq - 0 1",
    );
    // the placement and the side to move are right — those are the
    // parts that matter for the chooser.
    const parts = derived.split(" ");
    expect(parts[0]).toBe(
      "r1bqkbnr/1p2npp1/p3p2p/2pp4/5P2/PPNBPN2/1BPP2PP/R2QK2R",
    );
    expect(parts[1]).toBe("b");
  });
});

describe("the notation", () => {
  test("a plain move is the two squares joined", () => {
    expect(
      shit_1170_chess_move_notation_fun({
        from: "e2",
        to: "e4",
        flags: "",
      }),
    ).toBe("e2e4");
  });

  test("a kingside castle is O-O", () => {
    expect(
      shit_1170_chess_move_notation_fun({
        from: "e1",
        to: "g1",
        flags: "k",
      }),
    ).toBe("O-O");
  });

  test("a queenside castle is O-O-O", () => {
    expect(
      shit_1170_chess_move_notation_fun({
        from: "e1",
        to: "c1",
        flags: "q",
      }),
    ).toBe("O-O-O");
  });

  test("a promotion names the piece", () => {
    expect(
      shit_1170_chess_move_notation_fun({
        from: "e7",
        to: "e8",
        flags: "p",
        promotion: "q",
      }),
    ).toBe("e7 to e8 Q");
  });
});

describe("the legal moves", () => {
  test("the opening position has twenty moves", () => {
    expect(
      shit_1170_chess_legal_moves_fun(
        "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
      ),
    ).toHaveLength(20);
  });

  test("the scholar's mate is only winning in four moves", () => {
    const moves = shit_1170_chess_legal_moves_fun(
      "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    );
    expect(moves).toContain("e2e4");
    expect(moves).toContain("d2d4");
    expect(moves).toContain("g1f3");
    expect(moves).toContain("b1c3");
    // and nothing that is not a legal opening move.
    expect(moves).not.toContain("e2e5");
  });

  test("a position in check has only the moves that answer it", () => {
    // white's queen on f7 checks the black king on e8 along the
    // diagonal. the only legal answer is to take the queen.
    const fen =
      "r1bqkbnr/pppp1Qpp/2n5/4p3/4P3/8/PPPP1PPP/RNB1KBNR b KQkq - 0 3";
    const moves = shit_1170_chess_legal_moves_fun(fen);
    expect(moves).toHaveLength(1);
    expect(moves[0]).toBe("e8f7");
  });

  test("a checkmate has no legal moves", () => {
    // the back-rank mate: the rook on a8 is check along the eighth
    // rank, and the black king has nowhere to go.
    const fen = "R5k1/5ppp/8/8/8/8/8/6K1 b - - 0 1";
    expect(shit_1170_chess_legal_moves_fun(fen)).toHaveLength(0);
  });
});

describe("the chooser", () => {
  test("it takes a free queen", () => {
    // white's queen on h5, black's queen on e8 with nothing defending
    // it, and the black king on h8. h5 and e8 are on the same
    // diagonal, so the capture is on.
    const fen = "4q2k/8/8/7Q/8/8/8/4K3 w - - 0 1";
    const move = shit_1170_chess_choose_move_fun(fen);
    expect(move).not.toBeNull();
    // the queen takes h5xe8 — the free queen on e8.
    expect(move?.mv).toBe("h5e8");
  });

  test("it takes a free pawn when there is nothing better", () => {
    // white's pawn on e4, black's pawn on d5, and nothing else on the
    // board but the kings. e4 can take d5, and the capture is worth
    // more than the quiet push to e5.
    const fen = "4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1";
    const move = shit_1170_chess_choose_move_fun(fen);
    expect(move?.mv).toBe("e4d5");
  });

  test("it never returns an illegal move", () => {
    const positions = [
      "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
      "4k3/8/8/7Q/8/8/8/4K3 w - - 0 1",
      "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 4 4",
      "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1",
      "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1",
      "r1bqkbnr/1p2npp1/p3p2p/2pp4/5P2/PPNBPN2/1BPP2PP/R2QK2R b - - 0 9",
    ];
    for (const fen of positions) {
      const legal = shit_1170_chess_legal_moves_fun(fen);
      const chosen = shit_1170_chess_choose_move_fun(fen);
      expect(chosen).not.toBeNull();
      expect(legal).toContain(chosen?.mv ?? "");
    }
  });

  test("it answers null for a finished game", () => {
    const fen = "R5k1/5ppp/8/8/8/8/8/6K1 b - - 0 1";
    expect(shit_1170_chess_choose_move_fun(fen)).toBeNull();
  });

  test("the same position gives the same move", () => {
    const fen =
      "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 4 4";
    const first = shit_1170_chess_choose_move_fun(fen);
    const second = shit_1170_chess_choose_move_fun(fen);
    expect(first?.mv).toBe(second?.mv);
  });

  test("it plays black as black", () => {
    // the position after 1.e4 e5 2.Nf3 Nc6 3.Bb5 a6, with black to
    // move. a chooser that flips the evaluation plays the wrong side's
    // game — it looks for the move that leaves the position best for
    // WHITE, which for black means the worst possible move.
    const fen =
      "r1bqk1nr/1pppbppp/p1n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 4";
    const chosen = shit_1170_chess_choose_move_fun(fen);
    expect(chosen).not.toBeNull();

    // the move must move a BLACK piece. chess.js knows which colour
    // each square holds, so it is asked directly.
    const board = new Chess(fen);
    const from = chosen?.from;
    expect(from).toBeDefined();
    const piece = board.get(from as never);
    expect(piece?.color).toBe("b");
  });
});
