# MOVES

the board, the fen, the notation, and the chooser.

---

#### THE BOARD

`get_board` answers with eight strings, one per rank.

```json
[
  "R  QK  R",
  " BPP  PP",
  "PPNBPN  ",
  "     P  ",
  "  pp    ",
  "p   p  p",
  " p  npp ",
  "r bqkbnr"
]
```

**row 0 is RANK 1** — white's back rank — and row 7 is rank 8, black's.

the piece letters:

| letter | piece | colour |
| --- | --- | --- |
| `K` | king | white |
| `Q` | queen | white |
| `R` | rook | white |
| `B` | bishop | white |
| `N` | knight | white |
| `P` | pawn | white |
| `k` | king | black |
| `q` | queen | black |
| `r` | rook | black |
| `b` | bishop | black |
| `n` | knight | black |
| `p` | pawn | black |
| space | empty | — |

the tool box's docs and the upstream agent skill both say "row 0 is
rank 8". **they are wrong.** the live contract and the protocol pawns
api agree with each other, and they say rank 1. the live behaviour
wins.

`render_board` answers the same position with unicode pieces and the
chessboard squares, which is what a human reads.

---

#### THE FEN

`chess.js` needs a position as a FEN, and a FEN carries six fields:
the placement, the side to move, the castling rights, the en-passant
square and the two clocks.

**the api's fen is the source.** the protocol pawns api's
`GET /game/{game_id}/moves` answers with the FEN of every position in
the game, and the last one is the current position.

```sh
curl -s "https://api.protocol-pawns.com/game/%5B206540279%2C%22kcameau.near%22%2C%22crans.near%22%5D/moves"
```

```json
[
  {
    "move_number": 9,
    "color": "Black",
    "move_notation": "e7 to e6",
    "fen": "r1bqkbnr/1p2npp1/p3p2p/2pp4/5P2/PPNBPN2/1BPP2PP/R2QK2R b - - 0 9",
    "outcome": null
  }
]
```

**why the castling rights have to come from the api.** the contract
keeps them as STATE. a king or a rook that has moved loses its rights
even if it comes back to its home square, so the rights cannot be
derived from the board.

so when the api is not reachable, the skill falls back to a
board-derived FEN, and that fallback derives the rights from the
board. **it is right only in a game where nothing has moved off its
home square.** a wrong castling right costs a castling opportunity,
and a wrong castling move is rejected by the contract.

the fallback answers `fen_source: "board"` and the api answers
`fen_source: "api"`, so the caller always knows which one it got.

---

#### THE NOTATION

the contract wants **coordinate notation**, not san.

| form | example |
| --- | --- |
| compact | `"e2e4"` |
| separated | `"e2 e4"` |
| explicit | `"e2 to e4"` |
| kingside castle | `"O-O"` |
| queenside castle | `"O-O-O"` |
| promotion | `"e7 to e8 Q"` |

**`"Nf3"` and `"Qxe4"` FAIL.** a san move is rejected by the contract,
and a rejected call is a failed transaction that still costs gas.

three forms need more than the two squares:

- a **castling move** is `O-O` or `O-O-O`, because the king moves two
  squares and the two squares alone would not say which side
- a **promotion** names the piece, because the contract cannot guess it

everything else is the two squares joined.

---

#### THE CHOOSER

**`chess.js`.** it is the only option that guarantees a legal move, and
an illegal move is a failed transaction that still costs gas. the
model is not a chess engine.

the chooser is a shallow search: every legal move is tried, the
position is evaluated, and the best is taken.

**the evaluation is from white's point of view, and it is flipped for
black.** without that flip the chooser plays black as if it were
white — it looks for the move that leaves the position best for
WHITE, which for black means the worst possible move. the first
version had the bug, and a test caught it.

the piece values are the usual ones — pawn 100, knight 320, bishop
330, rook 500, queen 900 — plus a little for a pawn in the centre.

the search is shallow on purpose. a deeper search would be better
chess, and it would cost far more time per move, and the point of
this skill is a playing agent rather than a strong one.

**the same position always gives the same move.** a tie is broken
towards the move that comes first, so the choice is stable between
runs.

---

#### THE TESTS

the chooser is tested against known positions, because it is the one
piece of this skill that can burn gas silently.

```sh
bun test
```

the tests cover:

- the starting board becomes the starting FEN
- a **live game's board** becomes the api's FEN for it. this is the
  test that catches a reversed board — the starting position is
  symmetric and hides the mistake, and a real position does not
- the castling rights come off the board
- the notation for a plain move, both castles and a promotion
- the opening position has twenty legal moves
- a position in check has only the moves that answer it
- a checkmate has no legal moves
- the chooser takes a free queen, and a free pawn
- the chooser **never returns an illegal move**, across six positions
- the chooser **plays black as black**

---

#### THE GAS

the gas follows the opponent, and it is read from the game every time.

| opponent | gas |
| --- | --- |
| `Easy` ai | 50 Tgas |
| `Medium` ai | 150 Tgas |
| `Hard` ai | 250 Tgas |
| `VeryHard` ai | 400 Tgas |
| a human | 150 Tgas |

**against the ai, the ai replies inside the same transaction.** so an
ai game is one call per turn, not two.

---

#### THE GAME ID

a game is identified by a tuple of three values:

```json
[206540279, "kcameau.near", "crans.near"]
```

- the first value is the block height the game was created at
- the second is the white player, always an account id
- the third is the black player, or `null` for a game against the ai

the api takes the game id as the **json-stringified tuple**,
percent-encoded into the path:

```sh
curl -s "https://api.protocol-pawns.com/game/%5B206540279%2C%22kcameau.near%22%2C%22crans.near%22%5D"
```

=====================
<br/>
copyright 2026 by sleet.near
