import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const IN_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const DX = [0, 0, -1, 1];
const DY = [-1, 1, 0, 0];
const WALK = ['u', 'd', 'l', 'r'];
const PUSH = ['U', 'D', 'L', 'R'];
const RST = 900000;
const WST = 1500000;
function pL(text) {
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
for (let x = 0; x < w; x++) { wall[x] = 1; wall[(h - 1) * w + x] = 1; }
for (let y = 0; y < h; y++) { wall[y * w] = 1; wall[y * w + w - 1] = 1; }
boxes.sort((a, b) => a - b);
return { w, h, wall, goal, boxes, player };
}
function pD(w, h, solid, goals) {
const size = w * h;
return goals.map((g) => {
const dist = new Int32Array(size).fill(-1);
dist[g] = 0;
const queue = [g];
for (let qi = 0; qi < queue.length; qi++) {
const b = queue[qi];
for (let d = 0; d < 4; d++) {
const delta = DY[d] * w + DX[d];
const from = b - delta;
const stand = from - delta;
if (from < 0 || stand < 0 || from >= size || stand >= size) continue;
if (solid[from] || solid[stand] || dist[from] >= 0) continue;
dist[from] = dist[b] + 1;
queue.push(from);
}
}
return dist;
});
}
function mF(w, h, solid) {
const size = w * h;
const seen = new Int32Array(size);
const stack = new Int32Array(size);
let stamp = 0;
return {
seen,
flood(bA, from) {
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
if (q < 0 || q >= size || solid[q] || bA[q] || seen[q] === stamp) continue;
seen[q] = stamp;
stack[n++] = q;
}
}
return { low, stamp };
},
};
}
function wP(w, h, solid, bA, from, to) {
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
if (q < 0 || q >= size || solid[q] || bA[q] || prev[q] !== -1) continue;
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
function sP(board, solid, boxes0, player0, cap) {
const { w, h, goal } = board;
const size = w * h;
const goals = [];
for (let i = 0; i < size; i++) if (goal[i] && !solid[i]) goals.push(i);
const dists = pD(w, h, solid, goals);
const md = new Int32Array(size).fill(-1);
for (let i = 0; i < size; i++) {
for (const dist of dists) {
if (dist[i] >= 0 && (md[i] < 0 || dist[i] < md[i])) md[i] = dist[i];
}
}
const est = (boxes) => {
let sum = 0;
for (const b of boxes) {
if (md[b] < 0) return -1;
sum += md[b];
}
return sum;
};
if (est(boxes0) < 0) return null;
const fA = mF(w, h, solid);
const fB = mF(w, h, solid);
const bA = new Uint8Array(size);
const keyOf = (boxes, low) => String.fromCharCode(low, ...boxes);
const solved = (boxes) => boxes.every((b) => goal[b]);
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
if (!solid[c] && !bA[c]) { blocked = false; break; }
if (bA[c] && !goal[c]) offGoal = true;
}
if (blocked && offGoal) return true;
}
}
return false;
};
const tB = [boxes0.slice()];
const tP = [player0];
const tL = [0];
const tPa = [-1];
const tF = [-1];
const tD = [-1];
const tG = [0];
const best = new Map();
for (const b of boxes0) bA[b] = 1;
tL[0] = fA.flood(bA, player0).low;
best.set(keyOf(boxes0, tL[0]), 0);
for (const b of boxes0) bA[b] = 0;
const heap = [0];
const cmp = (a, b) => {
const fa = tG[a] + est(tB[a]);
const fb = tG[b] + est(tB[b]);
return fa !== fb ? fa < fb : tG[a] !== tG[b] ? tG[a] > tG[b] : a < b;
};
const hP = (s) => {
heap.push(s);
for (let i = heap.length - 1; i > 0;) {
const p = (i - 1) >> 1;
if (!cmp(heap[i], heap[p])) break;
[heap[i], heap[p]] = [heap[p], heap[i]];
i = p;
}
};
const hQ = () => {
const top = heap[0];
const last = heap.pop();
if (heap.length > 0) {
heap[0] = last;
for (let i = 0;;) {
let c = 2 * i + 1;
if (c >= heap.length) break;
if (c + 1 < heap.length && cmp(heap[c + 1], heap[c])) c++;
if (!cmp(heap[c], heap[i])) break;
[heap[i], heap[c]] = [heap[c], heap[i]];
i = c;
}
}
return top;
};
let found = solved(boxes0) ? 0 : -1;
while (found < 0 && heap.length > 0) {
const s = hQ();
const boxes = tB[s];
if (best.get(keyOf(boxes, tL[s])) !== s) continue;
if (solved(boxes)) { found = s; break; }
for (const b of boxes) bA[b] = 1;
const reg = fA.flood(bA, tP[s]);
const inR = (q) => fA.seen[q] === reg.stamp;
for (let bi = 0; bi < boxes.length; bi++) {
const b = boxes[bi];
for (let d = 0; d < 4; d++) {
const delta = DY[d] * w + DX[d];
const t = b + delta;
if (!inR(b - delta) || solid[t] || bA[t] || md[t] < 0) continue;
bA[b] = 0;
bA[t] = 1;
const dead = frozen(t);
let low = -1;
if (!dead) low = fB.flood(bA, b).low;
bA[t] = 0;
bA[b] = 1;
if (dead) continue;
const next = boxes.slice();
next[bi] = t;
next.sort((a, b2) => a - b2);
if (est(next) < 0) continue;
const g = tG[s] + 1;
const key = keyOf(next, low);
const known = best.get(key);
if (known !== undefined && tG[known] <= g) continue;
if (tB.length >= cap) { for (const x of boxes) bA[x] = 0; return null; }
const idx = tB.length;
tB.push(next);
tP.push(b);
tL.push(low);
tPa.push(s);
tF.push(b);
tD.push(d);
tG.push(g);
best.set(key, idx);
hP(idx);
}
}
for (const b of boxes) bA[b] = 0;
}
if (found < 0) return null;
const chain = [];
for (let s = found; s > 0; s = tPa[s]) chain.push(s);
chain.reverse();
let moves = '';
let player = player0;
const cur = boxes0.slice();
for (const s of chain) {
const from = tF[s];
const d = tD[s];
const delta = DY[d] * w + DX[d];
for (const b of cur) bA[b] = 1;
const walked = wP(w, h, solid, bA, player, from - delta);
for (const b of cur) bA[b] = 0;
if (walked === null) return null;
moves += walked + PUSH[d];
cur[cur.indexOf(from)] = from + delta;
cur.sort((a, b) => a - b);
player = from;
}
return { pushes: chain.length, moves };
}
function sR(board) {
const { w, h, wall, goal, boxes, player } = board;
const size = w * h;
const goals = [];
for (let i = 0; i < size; i++) if (goal[i]) goals.push(i);
const dists = pD(w, h, wall, goals);
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
function eS(w, from, moves) {
let p = from;
for (const ch of moves.toLowerCase()) p += ch === 'u' ? -w : ch === 'd' ? w : ch === 'l' ? -1 : 1;
return p;
}
function rS(board, moves) {
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
function sL(text) {
const board = pL(text);
const { wall, boxes, player } = board;
let answer = null;
const rooms = sR(board);
if (rooms !== null) {
const cur = rooms.map((r) => r.boxes.slice().sort((a, b) => a - b));
let p = player;
let moves = '';
let ok = true;
for (let ri = 0; ri < rooms.length; ri++) {
const solid = wall.slice();
for (let oj = 0; oj < rooms.length; oj++) {
if (oj !== ri) for (const b of cur[oj]) solid[b] = 1;
}
const sRm = sP(board, solid, cur[ri], p, RST);
if (sRm === null) { ok = false; break; }
moves += sRm.moves;
p = eS(board.w, p, sRm.moves);
cur[ri] = rooms[ri].goals.slice().sort((a, b) => a - b);
}
if (ok) answer = moves;
}
if (answer === null) {
const whole = sP(board, wall, boxes, player, WST);
if (whole !== null) answer = whole.moves;
}
if (answer === null || !rS(board, answer)) return '';
return answer;
}
for (const id of readdirSync(IN_DIR).sort()) {
const moves = sL(readFileSync(join(IN_DIR, id, 'level.txt'), 'utf8'));
mkdirSync(join(OUT_DIR, id), { recursive: true });
writeFileSync(join(OUT_DIR, id, 'solution.txt'), `${moves}\n`);
}
