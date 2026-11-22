// sokoban-solver: a push-optimal Sokoban solver for make.fun's "Build the
// best Sokoban solver" bounty. Plain JavaScript in a .ts file (Node 22,
// standard library only, no clock, no randomness: same input, same bytes).
//
// Levels from this generator are a one-square hallway with small rooms off
// it, one door per room; a box pushed out of a room can never come back, so
// the rooms are independent and the level's push optimum is the sum of the
// rooms' optima. The solver cuts the hallway out of the floor (its squares
// are dead: a box there reaches no goal), solves each room on its own with
// the other rooms' boxes standing as walls, and walks the player between
// rooms. Each room is solved by an A* search over pushes (not steps), so
// the first solution found is push-optimal; if a level is not a set of
// rooms, the same search runs on the whole level. Every answer is
// replay-checked before it is written.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const IN_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const DX = [0, 0, -1, 1];
const DY = [-1, 1, 0, 0];
const WALK = ['u', 'd', 'l', 'r'];
const PUSH = ['U', 'D', 'L', 'R'];
const ROOM_STATES = 900000;
const WHOLE_STATES = 1500000;

// ---- parsing (XSB) -----------------------------------------------------------

function parseLevel(text) {
  const rows = text.split('\n').filter((r) => r.length > 0);
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const wall = new Uint8Array(w * h).fill(1);
  const goal = new Uint8Array(w * h);
  const boxes = [];
  let player = -1;
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      const i = y * w + x;
      if (ch === '#') continue;
      wall[i] = 0;
      if (ch === '.' || ch === '*' || ch === '+') goal[i] = 1;
      if (ch === '$' || ch === '*') boxes.push(i);
      if (ch === '@' || ch === '+') player = i;
    }
  });
  // The outermost frame is wall whatever the text shows.
  for (let x = 0; x < w; x++) { wall[x] = 1; wall[(h - 1) * w + x] = 1; }
  for (let y = 0; y < h; y++) { wall[y * w] = 1; wall[y * w + w - 1] = 1; }
  boxes.sort((a, b) => a - b);
  return { w, h, wall, goal, boxes, player };
}

// ---- reverse-pull distances ----------------------------------------------------
// For each goal, the fewest pushes that move one box from a square onto that
// goal, ignoring the other boxes. -1 when impossible; a box on a square that
// is -1 for every goal can never reach a goal at all.

function pullDistances(w, h, solid, goals) {
  const size = w * h;
  return goals.map((g) => {
    const dist = new Int32Array(size).fill(-1);
    dist[g] = 0;
    const queue = [g];
    for (let qi = 0; qi < queue.length; qi++) {
      const b = queue[qi];
      for (let d = 0; d < 4; d++) {
        const delta = DY[d] * w + DX[d];
        const from = b - delta; // the box's square before that push
        const stand = from - delta; // the player's square for that push
        if (from < 0 || stand < 0 || from >= size || stand >= size) continue;
        if (solid[from] || solid[stand] || dist[from] >= 0) continue;
        dist[from] = dist[b] + 1;
        queue.push(from);
      }
    }
    return dist;
  });
}

// ---- player region ---------------------------------------------------------------
// Flood fill from a square around solid squares and boxes; a region is named
// by its lowest square. Each flood context owns its stamp array, so a region
// stays readable while another flood runs.

function makeFlood(w, h, solid) {
  const size = w * h;
  const seen = new Int32Array(size);
  const stack = new Int32Array(size);
  let stamp = 0;
  return {
    seen,
    flood(boxAt, from) {
      stamp++;
      let n = 0;
      let low = from;
      stack[n++] = from;
      seen[from] = stamp;
      while (n > 0) {
        const p = stack[--n];
        if (p < low) low = p;
        for (let d = 0; d < 4; d++) {
          const q = p + DY[d] * w + DX[d];
          if (q < 0 || q >= size || solid[q] || boxAt[q] || seen[q] === stamp) continue;
          seen[q] = stamp;
          stack[n++] = q;
        }
      }
      return { low, stamp };
    },
  };
}

// Shortest walk from `from` to `to` in lowercase LURD, boxes as obstacles;
// null when `to` cannot be reached.
function walkPath(w, h, solid, boxAt, from, to) {
  if (from === to) return '';
  const size = w * h;
  const prev = new Int32Array(size).fill(-1);
  const letter = new Array(size);
  const queue = [from];
  prev[from] = from;
  for (let qi = 0; qi < queue.length; qi++) {
    const p = queue[qi];
    if (p === to) break;
    for (let d = 0; d < 4; d++) {
      const q = p + DY[d] * w + DX[d];
      if (q < 0 || q >= size || solid[q] || boxAt[q] || prev[q] !== -1) continue;
      prev[q] = p;
      letter[q] = WALK[d];
      queue.push(q);
    }
  }
  if (prev[to] === -1) return null;
  let s = '';
  for (let p = to; p !== from; p = prev[p]) s = letter[p] + s;
  return s;
}

// ---- the push search ---------------------------------------------------------------
// A* over pushes on one board. `solid` holds the walls plus any boxes kept
// fixed (the other rooms' boxes). States are the sorted box squares plus the
// lowest square of the player's reachable region; a state's player square is
// where the player stands after the push that made it (the pushed box's old
// square). Pruning: dead squares, frozen 2x2 blocks, a transposition table.
// The estimate sums each box's own fewest pushes to any goal, so it never
// overestimates and the first solution found is push-optimal. Returns
// {pushes, moves}, or null when the state cap is hit or no solution exists.

function searchPushes(board, solid, boxes0, player0, cap) {
  const { w, h, goal } = board;
  const size = w * h;
  const goals = [];
  for (let i = 0; i < size; i++) if (goal[i] && !solid[i]) goals.push(i);
  const dists = pullDistances(w, h, solid, goals);
  const minDist = new Int32Array(size).fill(-1);
  for (let i = 0; i < size; i++) {
    for (const dist of dists) {
      if (dist[i] >= 0 && (minDist[i] < 0 || dist[i] < minDist[i])) minDist[i] = dist[i];
    }
  }
  const estimate = (boxes) => {
    let sum = 0;
    for (const b of boxes) {
      if (minDist[b] < 0) return -1;
      sum += minDist[b];
    }
    return sum;
  };
  if (estimate(boxes0) < 0) return null;

  const floodA = makeFlood(w, h, solid);
  const floodB = makeFlood(w, h, solid);
  const boxAt = new Uint8Array(size);
  const keyOf = (boxes, low) => String.fromCharCode(low, ...boxes);
  const solved = (boxes) => boxes.every((b) => goal[b]);

  // A frozen 2x2: four squares of solid-or-box with a box off its goal.
  const frozen = (t) => {
    const tx = t % w;
    const ty = (t / w) | 0;
    for (let oy = -1; oy <= 0; oy++) {
      for (let ox = -1; ox <= 0; ox++) {
        const ax = tx + ox;
        const ay = ty + oy;
        if (ax < 0 || ay < 0 || ax + 1 >= w || ay + 1 >= h) continue;
        const cells = [ay * w + ax, ay * w + ax + 1, (ay + 1) * w + ax, (ay + 1) * w + ax + 1];
        let blocked = true;
        let offGoal = false;
        for (const c of cells) {
          if (!solid[c] && !boxAt[c]) { blocked = false; break; }
          if (boxAt[c] && !goal[c]) offGoal = true;
        }
        if (blocked && offGoal) return true;
      }
    }
    return false;
  };

  const stBoxes = [boxes0.slice()];
  const stPlayer = [player0];
  const stLow = [0];
  const stParent = [-1];
  const stFrom = [-1];
  const stDir = [-1];
  const stG = [0];
  const best = new Map();
  for (const b of boxes0) boxAt[b] = 1;
  stLow[0] = floodA.flood(boxAt, player0).low;
  best.set(keyOf(boxes0, stLow[0]), 0);
  for (const b of boxes0) boxAt[b] = 0;

  // Binary heap of state indexes on (g + estimate, then deeper g first).
  const heap = [0];
  const before = (a, b) => {
    const fa = stG[a] + estimate(stBoxes[a]);
    const fb = stG[b] + estimate(stBoxes[b]);
    return fa !== fb ? fa < fb : stG[a] !== stG[b] ? stG[a] > stG[b] : a < b;
  };
  const heapPush = (s) => {
    heap.push(s);
    for (let i = heap.length - 1; i > 0;) {
      const p = (i - 1) >> 1;
      if (!before(heap[i], heap[p])) break;
      [heap[i], heap[p]] = [heap[p], heap[i]];
      i = p;
    }
  };
  const heapPop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length > 0) {
      heap[0] = last;
      for (let i = 0;;) {
        let c = 2 * i + 1;
        if (c >= heap.length) break;
        if (c + 1 < heap.length && before(heap[c + 1], heap[c])) c++;
        if (!before(heap[c], heap[i])) break;
        [heap[i], heap[c]] = [heap[c], heap[i]];
        i = c;
      }
    }
    return top;
  };

  let found = solved(boxes0) ? 0 : -1;
  while (found < 0 && heap.length > 0) {
    const s = heapPop();
    const boxes = stBoxes[s];
    if (best.get(keyOf(boxes, stLow[s])) !== s) continue; // superseded record
    if (solved(boxes)) { found = s; break; }
    for (const b of boxes) boxAt[b] = 1;
    const reg = floodA.flood(boxAt, stPlayer[s]);
    const inRegion = (q) => floodA.seen[q] === reg.stamp;
    for (let bi = 0; bi < boxes.length; bi++) {
      const b = boxes[bi];
      for (let d = 0; d < 4; d++) {
        const delta = DY[d] * w + DX[d];
        const t = b + delta;
        if (!inRegion(b - delta) || solid[t] || boxAt[t] || minDist[t] < 0) continue;
        boxAt[b] = 0;
        boxAt[t] = 1;
        const dead = frozen(t);
        let low = -1;
        if (!dead) low = floodB.flood(boxAt, b).low;
        boxAt[t] = 0;
        boxAt[b] = 1;
        if (dead) continue;
        const next = boxes.slice();
        next[bi] = t;
        next.sort((a, b2) => a - b2);
        if (estimate(next) < 0) continue;
        const g = stG[s] + 1;
        const key = keyOf(next, low);
        const known = best.get(key);
        if (known !== undefined && stG[known] <= g) continue;
        if (stBoxes.length >= cap) { for (const x of boxes) boxAt[x] = 0; return null; }
        const idx = stBoxes.length;
        stBoxes.push(next);
        stPlayer.push(b);
        stLow.push(low);
        stParent.push(s);
        stFrom.push(b);
        stDir.push(d);
        stG.push(g);
        best.set(key, idx);
        heapPush(idx);
      }
    }
    for (const b of boxes) boxAt[b] = 0;
  }
  if (found < 0) return null;

  // Rebuild the moves: walk to each push's stance, then push.
  const chain = [];
  for (let s = found; s > 0; s = stParent[s]) chain.push(s);
  chain.reverse();
  let moves = '';
  let player = player0;
  const cur = boxes0.slice();
  for (const s of chain) {
    const from = stFrom[s];
    const d = stDir[s];
    const delta = DY[d] * w + DX[d];
    for (const b of cur) boxAt[b] = 1;
    const walked = walkPath(w, h, solid, boxAt, player, from - delta);
    for (const b of cur) boxAt[b] = 0;
    if (walked === null) return null;
    moves += walked + PUSH[d];
    cur[cur.indexOf(from)] = from + delta;
    cur.sort((a, b) => a - b);
    player = from;
  }
  return { pushes: chain.length, moves };
}

// ---- rooms -------------------------------------------------------------------------
// Cut the dead squares of the player's row (the hallway) out of the floor;
// each part left that holds boxes is a room. Null when the level is not a
// clean set of rooms: a box in the hallway, a goal outside every part, or a
// part whose boxes and goals disagree.

function splitRooms(board) {
  const { w, h, wall, goal, boxes, player } = board;
  const size = w * h;
  const goals = [];
  for (let i = 0; i < size; i++) if (goal[i]) goals.push(i);
  const dists = pullDistances(w, h, wall, goals);
  const live = new Uint8Array(size);
  for (let i = 0; i < size; i++) live[i] = dists.some((dist) => dist[i] >= 0) ? 1 : 0;
  const row = ((player / w) | 0) * w;
  const cut = new Uint8Array(size);
  for (let x = 0; x < w; x++) if (!wall[row + x] && !live[row + x]) cut[row + x] = 1;
  if (boxes.some((b) => cut[b])) return null;
  const part = new Int32Array(size).fill(-1);
  const rooms = [];
  for (let s = 0; s < size; s++) {
    if (wall[s] || cut[s] || part[s] >= 0) continue;
    const squares = [s];
    part[s] = rooms.length;
    for (let i = 0; i < squares.length; i++) {
      for (let d = 0; d < 4; d++) {
        const q = squares[i] + DY[d] * w + DX[d];
        if (q < 0 || q >= size || wall[q] || cut[q] || part[q] >= 0) continue;
        part[q] = rooms.length;
        squares.push(q);
      }
    }
    rooms.push({ squares, boxes: [], goals: [] });
  }
  for (const b of boxes) { if (part[b] < 0) return null; rooms[part[b]].boxes.push(b); }
  for (const g of goals) { if (part[g] < 0) return null; rooms[part[g]].goals.push(g); }
  if (rooms.some((r) => r.boxes.length !== r.goals.length)) return null;
  return rooms.filter((r) => r.boxes.length > 0);
}

// ---- solving a level -----------------------------------------------------------------

function endSquare(w, from, moves) {
  let p = from;
  for (const ch of moves.toLowerCase()) p += ch === 'u' ? -w : ch === 'd' ? w : ch === 'l' ? -1 : 1;
  return p;
}

// Replay the answer exactly as the checker does; true only when every
// step is legal and every box ends on a goal.
function replaysSolved(board, moves) {
  const { w, h, wall, goal } = board;
  const box = new Uint8Array(w * h);
  for (const b of board.boxes) box[b] = 1;
  let p = board.player;
  for (const ch of moves.toLowerCase()) {
    const d = ch === 'u' ? -w : ch === 'd' ? w : ch === 'l' ? -1 : 1;
    const next = p + d;
    if (next < 0 || next >= w * h || wall[next]) return false;
    if (box[next]) {
      if (wall[next + d] || box[next + d]) return false;
      box[next] = 0;
      box[next + d] = 1;
    }
    p = next;
  }
  for (let i = 0; i < box.length; i++) if (box[i] && !goal[i]) return false;
  return true;
}

function solveLevel(text) {
  const board = parseLevel(text);
  const { wall, boxes, player } = board;
  let answer = null;

  const rooms = splitRooms(board);
  if (rooms !== null) {
    const current = rooms.map((r) => r.boxes.slice().sort((a, b) => a - b));
    let p = player;
    let moves = '';
    let ok = true;
    for (let ri = 0; ri < rooms.length; ri++) {
      const solid = wall.slice();
      for (let oj = 0; oj < rooms.length; oj++) {
        if (oj !== ri) for (const b of current[oj]) solid[b] = 1;
      }
      const solvedRoom = searchPushes(board, solid, current[ri], p, ROOM_STATES);
      if (solvedRoom === null) { ok = false; break; }
      moves += solvedRoom.moves;
      p = endSquare(board.w, p, solvedRoom.moves);
      current[ri] = rooms[ri].goals.slice().sort((a, b) => a - b);
    }
    if (ok) answer = moves;
  }
  if (answer === null) {
    const whole = searchPushes(board, wall, boxes, player, WHOLE_STATES);
    if (whole !== null) answer = whole.moves;
  }
  if (answer === null || !replaysSolved(board, answer)) return '';
  return answer;
}

// ---- main ------------------------------------------------------------------------------

for (const id of readdirSync(IN_DIR).sort()) {
  const moves = solveLevel(readFileSync(join(IN_DIR, id, 'level.txt'), 'utf8'));
  mkdirSync(join(OUT_DIR, id), { recursive: true });
  writeFileSync(join(OUT_DIR, id, 'solution.txt'), `${moves}\n`);
}
