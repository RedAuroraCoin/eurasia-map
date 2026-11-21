# Chess mode

A second game on the same map: two sides, chess pieces, one device. Built as a
separate engine (`packages/shared/src/chess`) so the rules of the building game
and the rules of chess never share a branch.

## The board

One size only: the **800-cell map**. The size control is hidden in this mode, and
the building game's own map is restored when you switch back — playing chess does
not change which board you build on.

## The opening position

A chess rank, not a scatter: eight files along the north-south axis, two ranks
along the march axis.

```
        north
   R N B Q K B N R     back rank
   p p p p p p p p     pawns, one column east
        south
```

White camps in the west and marches east; black mirrors it in the east and
marches west. Black tries to take the same eight files as white, so the queens
and kings face each other; if the coast does not allow it, it takes the first
block that fits. A camp is only placed where all sixteen cells are dry land at
or above 250 m.

## Rules

- Each side fields 16 pieces: king, queen, 2 rooks, 2 bishops, 2 knights, 8 pawns.
- Every piece moves by chess rules. Additions from the map: water is a wall, the
  map edge is the board edge, and a tower is a capturable obstacle.
- Pawns march east for the west side and west for the east side. They capture
  diagonally only, and promote to queens on reaching the enemy's camp.
- A turn is **one action**: move a piece, or — with the king — build a tower on a
  dry empty cell next to it (10 coins; 20 to start, +5 per side per round).
- Towers block movement for both sides and can be taken by landing on them.
- Taking the enemy king wins. So does the enemy king drowning.

## The tide

The sea rises **10 m per full round** (both sides having moved once).

Measured on the real 800 map:

| round | sea    | land left |
|-------|--------|-----------|
| 4     | 40 m   | 97 %      |
| 10    | 100 m  | 90 %      |
| 17    | 170 m  | 79 %      |
| 25    | 250 m  | 69 %      |
| 40    | 400 m  | 51 %      |
| 60    | 600 m  | 32 %      |
| 100   | 1000 m | 17 %      |

Why 10 m: at 25 m the coast was gone before the opening was over, and at 1 day/s
in the building game the whole map drowned in a minute and a half. At 10 m a game
of 20–40 rounds (40–80 moves) spends the tide on the lowlands and still finishes
with most of the board above water; a long game grinds down to the highlands.

Tuning knobs, all in `BALANCE.chess`: `metresPerRound`, `campMinElevation`,
`campLat`, `campLon`, `startCoins`, `coinsPerRound`, `towerCost`.

## What this version does not do

- No check, checkmate or stalemate: the king is a piece you can take, like in the
  earliest form of the game.
- No castling, en passant, or two-step pawn opening.
- No legal-move highlighting: click a piece, then a destination; an illegal one
  is refused with a message.
- The chess game is not saved yet. A reload starts a fresh game; the mode itself
  is remembered in the settings.
- Hot-seat only. Rooms run the building game.
