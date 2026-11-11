"""Colour ramps shared by the preview renderer.

These mirror `landColor` / `seaColor` in packages/shared/src/map/index.ts. They
are duplicated on purpose: the pipeline must run without a JS toolchain, and the
values are asserted equal by a unit test on the TypeScript side only in spirit —
if you change one, change the other.
"""

from __future__ import annotations

LAND_STOPS = [
    (0, (79, 107, 51)),
    (200, (95, 122, 58)),
    (600, (125, 138, 69)),
    (1000, (154, 139, 84)),
    (1600, (168, 132, 92)),
    (2400, (156, 138, 120)),
    (3200, (176, 170, 162)),
    (4200, (214, 211, 205)),
    (5200, (244, 244, 242)),
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
