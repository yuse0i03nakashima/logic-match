// goalReachable(Goal に届くか)と、面データの行き止まりの検査。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { goalReachable, deriveMoves, applyMove } from '../js/logic.js';

const here = dirname(fileURLToPath(import.meta.url));
const derive = JSON.parse(readFileSync(join(here, '..', 'levels', 'derive.json'), 'utf8'));

test('goalReachable: 届く Board と届かない Board', () => {
  const ok = ['p', '', '', '>pq', '', '', '', '', '', '', '', '', '', '', '', ''];
  assert.equal(goalReachable(ok, 4, 'q'), true);
  const ng = ['p', '', '', '>pr', '', '', '', '', '', '', '', '', '', '', '', ''];
  assert.equal(goalReachable(ng, 4, 'q'), false);
  assert.equal(goalReachable(['q', ''], 2, 'q'), true);   // すでに Goal がある
});

test('derive.json: Stage 1〜10 の全 Board は初手のどれを選んでも Goal に届く', () => {
  for (const s of derive.slice(0, 10)) {
    for (const b of s.boards) {
      const moves = deriveMoves(b.cells, s.width, s.goal);
      assert.ok(moves.length > 0, `stage ${s.stage}`);
      for (const m of moves) {
        assert.equal(goalReachable(applyMove(b.cells, m), s.width, s.goal), true, `stage ${s.stage} move ${m.rule} ${m.i}-${m.j}`);
      }
    }
  }
});

test('derive.json: 全 Stage の初期 Board から Goal に届き、par は solution の長さ', () => {
  for (const s of derive) {
    for (const b of s.boards) {
      assert.equal(goalReachable(b.cells, s.width, s.goal), true, `stage ${s.stage}`);
      assert.equal(b.par, b.solution.length);
    }
  }
});
