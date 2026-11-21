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

White camps in **Europe** and marches east; black camps in the **north-east of
Asia** and marches west, so the pawns always walk toward each other.

The bands live in `BALANCE.chess.campLat` and `campLon`: white 46–64°N / −10–40°E,
black 51–69°N / 130–145°E. Inside its band the engine picks the 2x8 patch with the
most high ground, then the highest sum, so the camp lands on hills where the
terrain offers them. Ground down to 40 m is allowed — a pawn on a coastal lowland
is a pawn that drowns first, which is the mode working as intended.

If a band leaves no 2x8 patch at all, the army falls back to the nearest high
ground, back rank behind.

## Rules

- Each side fields 16 pieces: king, queen, 2 rooks, 2 bishops, 2 knights, 8 pawns.
- Every piece moves by chess rules. Additions from the map: water is a wall, the
  map edge is the board edge, and a tower is a capturable obstacle.
- Pawns march east for the white side and west for the black side. They capture
  diagonally only, open with **two squares from their starting cell** (if both
  are free and dry), and promote to queens on reaching the enemy's camp.
- A turn is **one action**: move a piece, or — with the king — build a tower on a
  dry empty cell next to it (10 coins; 20 to start, +5 per side per round).
- Towers block movement for both sides and can be taken by landing on them.
- Taking the enemy king wins. So does the enemy king drowning.

## The tide

The sea rises **8 m per full round** (both sides having moved once).

Measured on the real 800 map:

| round | sea    | land left |
|-------|--------|-----------|
| 5     | 40 m   | 97 %      |
| 10    | 80 m   | 93 %      |
| 20    | 160 m  | 80 %      |
| 30    | 240 m  | 70 %      |
| 50    | 400 m  | 51 %      |
| 75    | 600 m  | 32 %      |
| 125   | 1000 m | 17 %      |

Why 8 m: at 25 m the coast was gone before the opening was over, and at 1 day/s
in the building game the whole map drowned in a minute and a half. At 8 m a game
of 20–40 rounds (40–80 moves) only loses a fifth of the board to the water — the
tide is a pressure, not a countdown — while a long game still grinds down to the
highlands.

Tuning knobs, all in `BALANCE.chess`: `metresPerRound`, `campMinElevation`,
`campLat`, `campLon`, `startCoins`, `coinsPerRound`, `towerCost`.

## What this version does not do

- No check, checkmate or stalemate: the king is a piece you can take, like in the
  earliest form of the game.
- No castling, and no en passant: a pawn that has just opened two squares cannot
  be taken in passing.
- No legal-move highlighting: click a piece, then a destination; an illegal one
  is refused with a message.
- The chess game is not saved yet. A reload starts a fresh game; the mode itself
  is remembered in the settings.
- Hot-seat only. Rooms run the building game.
