# Chess mode

A second game on the same map: two sides, chess pieces, one device. Built as a
separate engine (`packages/shared/src/chess`) so the rules of the building game
and the rules of chess never share a branch.

**This is the mode the link opens** (`DEFAULT_SETTINGS.mode = 'chess'`): a new
visitor lands on the board, not on an empty city. The building game is one click
away in the panel, and a room invite (`?room=CODE`) still forces the city game,
because rooms are built for it.

Tests: `parseSettings` takes the mode default from `DEFAULT_SETTINGS` rather than
hard-coding a second answer that could drift from it.

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
- The long vectors are capped: a rook, a bishop and a queen travel at most **seven
  squares** in one direction. On a 44-cell continent an unlimited rook is a sniper.
- A pawn **walks one or two squares in a straight line, in any of the four
  directions, at any time** — the two-square step is not a privilege of the
  starting square. It never jumps: both squares have to be free and dry. It
  **captures one square on the diagonals**, so it still moves one way and fights
  another. It promotes to a queen on reaching the enemy's camp, and a pawn
  recruited into a tower walks exactly like this from its first turn.
- A turn is **one action**: move a piece, or spend it on a building instead.
  - *Tower* — 50 coins, on a dry empty cell next to the king. It blocks movement
    for both sides and can be taken by landing on it.
  - *Rocket* — 500 coins, on a dry empty cell next to the king, like a tower. It
    blocks movement and can be taken. It is drawn procedurally (`render/rocket.ts`):
    a concrete pad, a launch table on rails, and one large missile — body, warhead
    band, nose cone, four fins, a service gantry — painted in the side's own colours
    and scaled to 3.2 units, the tallest thing on the board. **Instead of a move** it fires for **200
    coins a shot**, hit or miss — the rockets leave the tube either way. Pick a cell
    within **seven** cells of the base, and it shells the **3x3 zone** around it.
    Firing is **two taps**: the first shows the zone and what stands in it, the
    second on the same cell fires. A shot costs 200 coins and can kill your own
    pieces, so it should not be one stray tap away — on a phone there is no hover to
    preview it with.
    **Every target in the zone rolls for itself** — pieces, towers and rocket bases,
    its own side's included: a shot can take several at once, and a rocket does not
    check uniforms or construction, so shelling a cell next to your own knight can
    cost you the knight, and a base shelled next to your own tower can cost you the
    tower. A rocket that
    kills its own king loses the game, and a shot that takes both kings loses it for
    the shooter. The odds depend on where a piece stands: **50 % dead centre, 20 %
    on the other eight cells**, each rolled separately. The dice are a hash of the
    position (seed, round, side, base, zone, piece), never stored, so a replay or a
    save makes the same shot.
  - *Pawn* — 250 coins, recruited **into one of your own towers**. It steps out on
    later turns and walks like any other pawn.
    Your own pieces cannot enter your tower, but an enemy landing on the tower
    takes the tower and the pawn inside it together: a garrison is sheltered, not
    safe. Both actions sit on a bar over the board, visible for the whole game.
- Coins: 20 to start, then **+5 per side per round plus 10 for every tower that
  side still holds**. A tower pays for itself in five rounds, which makes holding
  ground worth as much as taking it — and a tower the sea has drowned stops
  paying, so income has to move uphill with the army.
- Taking the enemy king wins. So does the enemy king drowning.

## The tide

The sea is a **clock with a curve**: it takes a growing share of the land each
round and covers the last cell on round **200**. The share starts at nothing and
accelerates (`floodExponent = 2`), so the opening and the middlegame are not a
countdown and the last fifty rounds are a race.

Measured on the real 800 map:

| round | sea    | land left |
|-------|--------|-----------|
| 0     | 0 m    | 100 %     |
| 20    | 20 m   | 99 %      |
| 50    | 71 m   | 94 %      |
| 100   | 199 m  | 75 %      |
| 140   | 398 m  | 51 %      |
| 160   | 552 m  | 36 %      |
| 180   | 925 m  | 19 %      |
| 190   | 1306 m | 10 %      |
| 195   | 1922 m | 5 %       |
| 200   | 5200 m | 0 %       |

Why a share of the land and not a fixed number of metres: a linear ramp that
reaches 5200 m at round 200 still drowns half the board by move sixteen, because
the terrain is not evenly distributed — most of it sits below 600 m. Taking a
share of the land keeps the clock honest: the water is where the land is, not
where the metres are.

Tuning knobs, all in `BALANCE.chess`: `fullFloodRound`, `floodExponent`,
`campMinElevation`, `campLat`, `campLon`, `startCoins`, `coinsPerRound`,
`towerCost`, `pawnCost`, `towerIncome`, `rocketCost`, `rocketShotCost`,
`rocketRange`, `rocketCentreChance`, `rocketRingChance`, and `SLIDE_LIMIT` in
`chess/moves.ts` for the long vectors.

## The camera

Every applied action hands the turn over, and the view glides to the king of the side
that now has it — 750 ms, smoothstep, the same viewing direction, so the board never
spins. A drag on the camera cancels the glide: the player's hands always win. The flat
view has no camera, so it does nothing there.

## Saving

The game is saved after every applied action, on tab hide and on unload, under
`eurasia.chess` in `localStorage` — the same envelope discipline as the city: a
version inside the file, structural validation on the way in, and no guessing.

- a corrupt file starts a new game and says so; a file from a newer version is
  refused rather than half-read
- pieces off the board, two pieces on one cell, or a side without a king are
  treated as corruption, not repaired
- a tower with a pawn inside it is legal, because that is what recruiting does;
  the piece count is capped at 64 rather than at the opening 32
- rocket bases are optional in the file: saves written before they existed load as
  games with none, rather than as corrupt
- a decided game is a result, not something to resume: it starts fresh
- the sea level is **not** trusted from the file. It is derived from the round,
  so a save made before a balance change still loads onto a board whose water is
  where the rules now put it
- Start over clears the save and deals a new game

## What this version does not do

- No check, checkmate or stalemate: the king is a piece you can take, like in the
  earliest form of the game.
- No castling, and no en passant: a pawn that has just opened two squares cannot
  be taken in passing.
- No legal-move highlighting: click a piece, then a destination; an illegal one
  is refused with a message.
- No cross-device resume: the save is local to the browser.
- Hot-seat only. Rooms run the building game.
