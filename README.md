# Fast makefun-diff

[![make.fun · diff-speed-01-run-20261126](https://make.fun/badge/diff-speed-01-run-20261126.svg)](https://make.fun/bounty/diff-speed-01-run-20261126?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)
[![make.fun rank](https://make.fun/badge/diff-speed-01-run-20261126/naikkarier/makefun-diff/rank.svg)](https://make.fun/bounty/diff-speed-01-run-20261126)
[![make.fun reward](https://make.fun/badge/diff-speed-01-run-20261126/naikkarier/makefun-diff/reward.svg)](https://make.fun/bounty/diff-speed-01-run-20261126)

A faster drop-in for makefun-diff 1.0.0, built for the make.fun bounty
"Diff two texts faster, 27 November 2026". It returns byte-for-byte the
same patch as the reference on every case, and runs about 3.7x faster on
the practice set (about 2.1x end to end including the driver).

## Speed

Measured locally (Node v24, median of repeated runs, CPU time) on the
kit's 4 practice cases, about 21,000-32,000 lines per text:

| case | this entry | makefun-diff 1.0.0 | speedup |
|------|-----------|-------------------|---------|
| g-0001 | 114 ms | 392 ms | 3.4x |
| g-0002 | 100 ms | 360 ms | 3.6x |
| g-0003 | 83 ms | 307 ms | 3.7x |
| g-0004 | 86 ms | 364 ms | 4.3x |

End to end through the driver (including Node start-up and reading and
writing the JSON files) the whole practice set takes about 0.84 s of CPU
here, against about 1.79 s for the reference driver.

## How it works

- Tokenize each text into lines the same way the reference does (a line
  ends after every `\n`; a last line with no `\n` is still a line), then
  intern every line to a small integer id, so equal strings share an id
  and the search compares integers instead of strings.
- Run Myers's greedy search over `Int32Array`s with a full V trace,
  keeping the reference's exact selection rule and tie-break (a deletion
  wins when it reaches as far as an insertion), never pruning an edge
  diagonal and never moving past either text's end. The first path to
  reach both ends is the script.
- Backtrack through the V trace to the exact edit script, then format
  the patch exactly like the reference: the same header line, the same
  hunks with 3 lines of context, deletions before insertions, and the
  `%` marker after a line that had no trailing newline.

Two small speed tricks keep the hot loop tight: a V value of 1e9 stands
for "no path", which is larger than any real x position, so it fails
both boundary checks on its own and no explicit defined-ness test is
needed; and the two edge diagonals (k = -d and k = d) are handled apart
from the interior, so the interior loop needs no index bounds checks.

## Files

- `solve.js` - the diff itself; `run(input)` returns the reference's
  patch for `{ old, new }`.
- `main.ts` - the driver the harness runs; it reads the cases, answers
  each one alone with `run()`, and writes the answers.

## Local check

Against the kit's practice set the output matches the reference and the
published expected answers on all 4 cases, and it also matches the
reference on 527 extra fuzz cases (random texts, edge cases, and cases
from the kit's own generator with different seeds).
