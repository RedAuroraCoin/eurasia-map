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
- A pawn **walks one square in any of the four directions** and **captures one
  square on the diagonals** — it moves one way and fights another, as a pawn
  always has. Its opening two-square step is forward only (east for white, west
  for black) and only from its starting cell. It promotes to a queen on reaching
  the enemy's camp.
- A turn is **one action**: move a piece, or — with the king — build a tower on a
  dry empty cell next to it (10 coins; 20 to start, +5 per side per round).
- Towers block movement for both sides and can be taken by landing on them.
- Taking the enemy king wins. So does the enemy king drowning.

## The tide

The sea is a **clock**: it takes an equal share of the land every round and
covers the last cell on round **100**. A game cannot outlast it.

Measured on the real 800 map:

| round | sea    | land left |
|-------|--------|-----------|
| 0     | 0 m    | 100 %     |
| 10    | 96 m   | 90 %      |
| 20    | 161 m  | 80 %      |
| 30    | 235 m  | 70 %      |
| 40    | 309 m  | 60 %      |
| 50    | 402 m  | 50 %      |
| 60    | 491 m  | 40 %      |
| 70    | 655 m  | 30 %      |
| 80    | 884 m  | 20 %      |
| 90    | 1301 m | 10 %      |
| 100   | 5200 m | 0 %       |

Why a share of the land and not a fixed number of metres: a linear ramp that
reaches 5200 m at round 100 rises 52 m a round, which drowns half the board by
move eight and all but the plateau by move twenty-four. The game would be over
long before the 40-45 moves it is supposed to last. Taking an equal share keeps
the opening intact and makes the tide a steady pressure that ends exactly on
time.

Tuning knobs, all in `BALANCE.chess`: `fullFloodRound`, `campMinElevation`,
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
