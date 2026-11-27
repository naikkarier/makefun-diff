// Fast drop-in for makefun-diff 1.0.0: returns exactly the same patch as the
// reference, faster. Strategy: intern every line to a small integer id, run
// Myers's greedy search over Int32Arrays with a full V trace (the same
// selection rule and tie-break as the reference, deletion wins ties, no edge
// pruning, no move past either end), backtrack to the exact edit script, then
// format the patch exactly like the reference does.

const KEEP = 0;
const DEL = 1;
const INS = 2;
const CONTEXT = 3;
const FORMAT = 'makefun-diff/1';
// A V value no real path holds: x positions lie in [-1, N), so a huge positive
// fails both boundary checks (pv + 1 < N, pv - k < M) on its own, and no
// explicit defined-ness test is needed.
const SENT = 1e9;

/** A text's lines, each with its "\n" (the last one without, when the text does not end in one). */
function tokenize(text) {
  if (text === '') return [];
  const parts = text.split('\n');
  const n = parts.length;
  const lines = new Array(n);
  let count = 0;
  for (let i = 0; i < n - 1; i++) lines[count++] = parts[i] + '\n';
  if (parts[n - 1] !== '') lines[count++] = parts[n - 1];
  lines.length = count;
  return lines;
}

/** Intern the lines of both texts to integer ids (equal strings share an id). */
function intern(aLines, bLines) {
  const map = new Map();
  const idA = new Int32Array(aLines.length);
  const idB = new Int32Array(bLines.length);
  let next = 0;
  for (let i = 0; i < aLines.length; i++) {
    const s = aLines[i];
    let id = map.get(s);
    if (id === undefined) {
      id = next++;
      map.set(s, id);
    }
    idA[i] = id;
  }
  for (let i = 0; i < bLines.length; i++) {
    const s = bLines[i];
    let id = map.get(s);
    if (id === undefined) {
      id = next++;
      map.set(s, id);
    }
    idB[i] = id;
  }
  return { idA, idB };
}

/**
 * The edit-script runs of a into b, as [{ kind, count }] in order, replicating
 * the reference's editRuns exactly (same greedy search, same tie-break).
 * a, b are Int32Array line ids for the middle region (prefix/suffix stripped).
 */
function myersRuns(a, b) {
  const N = a.length;
  const M = b.length;
  if (N === 0 && M === 0) return [];
  const maxD = N + M;
  const Vs = [];
  // d = 0: diagonal 0, snake from (-1, -1).
  let x = -1;
  while (x + 1 < N && x + 1 < M && a[x + 1] === b[x + 1]) x++;
  const V0 = new Int32Array(1);
  V0[0] = x;
  Vs.push(V0);
  if (x + 1 >= N && x + 1 >= M) {
    return x >= 0 ? [{ kind: KEEP, count: x + 1 }] : [];
  }
  let D = -1;
  let endK = 0;
  for (let d = 1; d <= maxD; d++) {
    const V = new Int32Array(2 * d + 1);
    const Vp = Vs[d - 1];
    let done = false;
    // Edge k = -d: a deletion is impossible (diagonal k - 1 is out of range),
    // so only the insertion from Vp[0] (diagonal -(d - 1)) can reach it.
    {
      const k = -d;
      const pv = Vp[0];
      if (pv - k < M) {
        let xx = pv;
        let y = xx - k;
        while (xx + 1 < N && y + 1 < M && a[xx + 1] === b[y + 1]) {
          xx++;
          y++;
        }
        V[0] = xx;
        if (xx + 1 >= N && y + 1 >= M) {
          D = d;
          endK = k;
          done = true;
        }
      } else {
        V[0] = SENT;
      }
    }
    if (!done) {
      // Interior k = -d + 2 .. d - 2: both predecessor diagonals are in range,
      // so no index bounds checks are needed; a SENT predecessor fails its
      // boundary check on its own. -2 marks an unusable candidate (x >= -1).
      let vi = 2;
      let iDel = 0;
      let iIns = 2;
      for (let k = -d + 2; k <= d - 2; k += 2, vi += 2, iDel += 2, iIns += 2) {
        const pvDel = Vp[iDel];
        const pvIns = Vp[iIns];
        const xDel = pvDel + 1 < N ? pvDel + 1 : -2;
        const xIns = pvIns - k < M ? pvIns : -2;
        if (xDel === -2 && xIns === -2) {
          V[vi] = SENT;
          continue;
        }
        let xx = xDel >= xIns ? xDel : xIns;
        let y = xx - k;
        while (xx + 1 < N && y + 1 < M && a[xx + 1] === b[y + 1]) {
          xx++;
          y++;
        }
        V[vi] = xx;
        if (xx + 1 >= N && y + 1 >= M) {
          D = d;
          endK = k;
          done = true;
          break;
        }
      }
    }
    if (!done) {
      // Edge k = d: an insertion is impossible (diagonal k + 1 is out of
      // range), so only the deletion from Vp[2d - 2] (diagonal d - 1) can.
      const k = d;
      const pv = Vp[2 * d - 2];
      if (pv + 1 < N) {
        let xx = pv + 1;
        let y = xx - k;
        while (xx + 1 < N && y + 1 < M && a[xx + 1] === b[y + 1]) {
          xx++;
          y++;
        }
        V[2 * d] = xx;
        if (xx + 1 >= N && y + 1 >= M) {
          D = d;
          endK = k;
          done = true;
        }
      } else {
        V[2 * d] = SENT;
      }
    }
    Vs.push(V);
    if (done) break;
  }
  if (D === -1) throw new Error('makefun-diff: the search ended without reaching both ends');

  // Backtrack from (N-1, M-1) on diagonal endK at depth D.
  const rev = [];
  let cx = N - 1;
  let k = endK;
  for (let d = D; d >= 1; d--) {
    const Vp = Vs[d - 1];
    const vpLen = Vp.length;
    const base = d - 1;
    const iDel = k - 1 + base;
    const iIns = k + 1 + base;
    let xDel = SENT;
    let xIns = SENT;
    let canDel = false;
    let canIns = false;
    if (iDel >= 0 && iDel < vpLen) {
      const pv = Vp[iDel];
      if (pv + 1 < N) {
        canDel = true;
        xDel = pv + 1;
      }
    }
    if (iIns >= 0 && iIns < vpLen) {
      const pv = Vp[iIns];
      if (pv - k < M) {
        canIns = true;
        xIns = pv;
      }
    }
    const isDel = canDel && (!canIns || xDel >= xIns);
    const xEdit = isDel ? xDel : xIns;
    const keep = cx - xEdit;
    if (keep > 0) rev.push({ kind: KEEP, count: keep });
    rev.push({ kind: isDel ? DEL : INS, count: 1 });
    if (isDel) {
      cx = Vp[iDel];
      k = k - 1;
    } else {
      cx = Vp[iIns];
      k = k + 1;
    }
  }
  // d = 0: the initial snake from (-1, -1) to (V0[0], V0[0]).
  const first = Vs[0][0] + 1;
  if (first > 0) rev.push({ kind: KEEP, count: first });
  // Reverse to forward order, merging adjacent runs of the same kind.
  const runs = [];
  for (let i = rev.length - 1; i >= 0; i--) {
    const r = rev[i];
    const last = runs.length > 0 ? runs[runs.length - 1] : undefined;
    if (last !== undefined && last.kind === r.kind) last.count += r.count;
    else runs.push({ kind: r.kind, count: r.count });
  }
  return runs;
}

/** A line as the patch writes it: its op, the line, a newline, and "%" on a line of its own when it had none. */
function written(op, line) {
  return line.endsWith('\n') ? op + line : op + line + '\n%\n';
}

/** make.fun's own patch of input.old into input.new, exactly as makefun-diff 1.0.0 writes it. */
export function diffPatch(input) {
  if (input === null || typeof input !== 'object' || typeof input.old !== 'string' || typeof input.new !== 'string') {
    throw new TypeError('makefun-diff: the input is { old, new }, two strings');
  }
  const a = tokenize(input.old);
  const b = tokenize(input.new);
  const n = a.length;
  const m = b.length;
  const { idA, idB } = intern(a, b);
  // The common prefix, then the common suffix of what is left.
  let prefix = 0;
  while (prefix < n && prefix < m && idA[prefix] === idB[prefix]) prefix++;
  let suffix = 0;
  while (suffix < n - prefix && suffix < m - prefix && idA[n - 1 - suffix] === idB[m - 1 - suffix]) suffix++;
  const runs = [];
  if (prefix > 0) runs.push({ kind: KEEP, count: prefix });
  const mid = myersRuns(idA.subarray(prefix, n - suffix), idB.subarray(prefix, m - suffix));
  for (const r of mid) {
    const last = runs.length > 0 ? runs[runs.length - 1] : undefined;
    if (last !== undefined && last.kind === r.kind) last.count += r.count;
    else runs.push({ kind: r.kind, count: r.count });
  }
  if (suffix > 0) {
    const last = runs.length > 0 ? runs[runs.length - 1] : undefined;
    if (last !== undefined && last.kind === KEEP) last.count += suffix;
    else runs.push({ kind: KEEP, count: suffix });
  }

  // The change runs: each a stretch of deletions and insertions between two kept lines, at old line o and new line p.
  const changes = [];
  let o = 0;
  let p = 0;
  let deleted = 0;
  let inserted = 0;
  for (const r of runs) {
    if (r.kind === KEEP) {
      o += r.count;
      p += r.count;
      continue;
    }
    let c = changes.length > 0 ? changes[changes.length - 1] : undefined;
    if (c === undefined || c.o + c.dels !== o || c.p + c.ins !== p) {
      c = { o, p, dels: 0, ins: 0 };
      changes.push(c);
    }
    if (r.kind === DEL) {
      c.dels += r.count;
      o += r.count;
      deleted += r.count;
    } else {
      c.ins += r.count;
      p += r.count;
      inserted += r.count;
    }
  }

  // The hunks: change runs at most 2 * CONTEXT kept lines apart share one.
  const hunks = [];
  for (const c of changes) {
    const h = hunks.length > 0 ? hunks[hunks.length - 1] : undefined;
    const prev = h !== undefined ? h[h.length - 1] : undefined;
    if (prev !== undefined && c.o - (prev.o + prev.dels) <= 2 * CONTEXT) h.push(c);
    else hunks.push([c]);
  }
  const out = [FORMAT + ' old=' + n + ' new=' + m + ' hunks=' + hunks.length + ' deleted=' + deleted + ' inserted=' + inserted + '\n'];
  for (const h of hunks) {
    const first = h[0];
    const last = h[h.length - 1];
    const oldStart = Math.max(0, first.o - CONTEXT);
    const newStart = first.p - (first.o - oldStart);
    const after = Math.min(CONTEXT, n - (last.o + last.dels));
    const oldEnd = last.o + last.dels + after;
    const newEnd = last.p + last.ins + after;
    out.push('@ ' + (oldStart + 1) + ' ' + (oldEnd - oldStart) + ' ' + (newStart + 1) + ' ' + (newEnd - newStart) + '\n');
    let at = oldStart;
    for (const c of h) {
      for (; at < c.o; at++) out.push(written('=', a[at]));
      for (let i = 0; i < c.dels; i++) out.push(written('-', a[c.o + i]));
      for (let i = 0; i < c.ins; i++) out.push(written('+', b[c.p + i]));
      at = c.o + c.dels;
    }
    for (; at < oldEnd; at++) out.push(written('=', a[at]));
  }
  return out.join('');
}

/** makefun-diff 1.0.0's answer for one case's input. */
export function run(input) {
  return diffPatch(input);
}
