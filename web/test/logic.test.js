// Haskell が書き出したベクタ(vectors-logic.json)と logic.js の結果が一致するか。
// 実行: node --test web/test/*.test.js   (リポジトリのルートで)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parse, show, pretty, sat, unsat2, connected, applyRule, andE, collapseRows, isSubformula } from '../js/logic.js';

const here = dirname(fileURLToPath(import.meta.url));
const V = JSON.parse(readFileSync(join(here, 'vectors-logic.json'), 'utf8'));

test('parse と show は往復する', () => {
  for (const s of ['p', 'F', '!p', '&pq', '|p!q', '>p!q', '!&pq', '>&pqr', '&p|qr', '!!p']) assert.equal(show(parse(s)), s);
});

test('pretty: 括弧の規則', () => {
  assert.equal(pretty('>p!q'), 'p→¬q');
  assert.equal(pretty('>&pqr'), '(p∧q)→r');
  assert.equal(pretty('&p|qr'), 'p∧(q∨r)');
  assert.equal(pretty('!>pq'), '¬(p→q)');
  assert.equal(pretty('!!p'), '¬¬p');
  assert.equal(pretty('F'), '⊥');
});

test('sat / unsat2: 基本', () => {
  assert.equal(sat(['p']), true);
  assert.equal(sat(['p', '!p']), false);
  assert.equal(unsat2('>pq', '&p!q'), true);
  assert.equal(unsat2('p', 'q'), false);
  assert.equal(unsat2('F', 'p'), true);
  assert.equal(unsat2('&p!p', 'q'), true);
});

test('connected: 同じ行で間が空、間に式があれば不可', () => {
  const w = 6;
  const cells = ['p', '', '', 'q', '', 'r', '!p', '', '', '', '', '', '', '', 'q', '', '', ''];
  assert.equal(connected(cells, w, 0, 3), true);    // 間が空
  assert.equal(connected(cells, w, 3, 5), true);    // 間(4)が空
  assert.equal(connected(cells, w, 0, 5), false);   // 間に q がある
  assert.equal(connected(cells, w, 0, 0), false);
});

test('connected: 行またぎは false', () => {
  const w = 6;
  const cells = ['', '', '', '', '', 'p', 'q', '', '', '', '', '', '', '', '', '', '', ''];
  assert.equal(connected(cells, w, 5, 6), false);   // 右端と次の行の左端
  assert.equal(connected(cells, w, 5, 11), true);   // 縦
  const diag = ['p', '', '', '', '', '', '', '', '', '', '', '', '', '', 'q', '', '', ''];
  assert.equal(connected(diag, w, 0, 14), true);    // (0,0) と (2,2)
});

test('collapseRows / isSubformula / andE', () => {
  assert.deepEqual(collapseRows(['', '', 'p', 'q'], 2), ['p', 'q']);
  assert.equal(isSubformula('&pq', '>&pqr'), true);
  assert.equal(isSubformula('&qp', '>&pqr'), false);
  assert.deepEqual(andE(['&pq', '', 'r'], 0), ['p', 'q', 'r']);
  assert.equal(andE(['&pq', 'r'], 0), null);
  assert.equal(andE(['p', ''], 0), null);
});

test('applyRule: 規則', () => {
  assert.deepEqual(applyRule('q', 'p', '>pq'), { rule: 'MP', result: 'q' });
  assert.deepEqual(applyRule('q', '>pq', 'p'), { rule: 'MP', result: 'q' });
  assert.deepEqual(applyRule('!p', '!q', '>pq'), { rule: 'MT', result: '!p' });
  assert.deepEqual(applyRule('q', '!p', '|pq'), { rule: 'DS', result: 'q' });
  assert.deepEqual(applyRule('p', '!q', '|pq'), { rule: 'DS', result: 'p' });
  assert.deepEqual(applyRule('&pq', 'p', 'q'), { rule: 'ANDI', result: '&pq' });
  assert.deepEqual(applyRule('&qp', 'p', 'q'), { rule: 'ANDI', result: '&qp' });
  assert.equal(applyRule('r', 'p', 'q'), null);
  assert.deepEqual(applyRule('F', 'p', '!p'), { rule: 'BOT', result: 'F' });
  assert.equal(applyRule('q', 'p', '!p'), null);
});

test(`vectors-logic.json: pretty ${V.pretty.length} 件`, () => {
  for (const v of V.pretty) assert.equal(pretty(v.prefix), v.pretty, v.prefix);
});
test(`vectors-logic.json: unsat2 ${V.unsat2.length} 件`, () => {
  for (const v of V.unsat2) assert.equal(unsat2(v.a, v.b), v.unsat, `${v.a} , ${v.b}`);
});
test(`vectors-logic.json: connected ${V.connected.length} 件`, () => {
  for (const v of V.connected) assert.equal(connected(v.cells, v.width, v.i, v.j), v.connected, `${v.i}-${v.j}`);
});
test(`vectors-logic.json: derive ${V.derive.length} 件`, () => {
  for (const v of V.derive) {
    const r = applyRule(v.goal, v.x, v.y);
    assert.equal(r ? r.result : null, v.result, `${v.goal}: ${v.x} , ${v.y}`);
    assert.equal(r ? r.rule : null, v.rule, `${v.goal}: ${v.x} , ${v.y}`);
  }
});
test(`vectors-logic.json: andE ${V.andE.length} 件`, () => {
  for (const v of V.andE) assert.deepEqual(andE(v.cells, v.i), v.result, JSON.stringify(v.cells));
});
