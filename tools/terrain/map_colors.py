"""Colour ramps shared by the preview renderer.

These mirror `landColor` / `seaColor` in packages/shared/src/map/index.ts. They
are duplicated on purpose: the pipeline must run without a JS toolchain, and the
values are asserted equal by a unit test on the TypeScript side only in spirit —
if you change one, change the other.
"""

from __future__ import annotations

LAND_STOPS = [
    (0, (92, 124, 58)),
    (150, (110, 138, 62)),
    (600, (137, 141, 74)),
    (1200, (154, 127, 79)),
    (2200, (141, 131, 117)),
    (3200, (170, 168, 162)),
    (4200, (196, 195, 191)),
    (5200, (240, 240, 238)),
]

SEA_STOPS = [
    (-9000, (10, 24, 52)),
    (-5000, (14, 40, 82)),
    (-2500, (21, 62, 116)),
    (-800, (32, 91, 148)),
    (-200, (46, 118, 170)),
    (0, (78, 152, 196)),
]


def _ramp(stops, value: float) -> tuple[int, int, int]:
    if value <= stops[0][0]:
        return stops[0][1]
    for i in range(1, len(stops)):
        prev_v, prev_c = stops[i - 1]
        next_v, next_c = stops[i]
        if value <= next_v:
            span = (next_v - prev_v) or 1
            k = (value - prev_v) / span
            return tuple(round(prev_c[j] + (next_c[j] - prev_c[j]) * k) for j in range(3))  # type: ignore[return-value]
    return stops[-1][1]


def color(land: bool, elevation: int) -> tuple[int, int, int]:
    return _ramp(LAND_STOPS if land else SEA_STOPS, elevation)
