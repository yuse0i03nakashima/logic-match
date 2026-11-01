// game.js の進行を、画面なしで通す検査。面データに依存しないよう、小さな Stage を手で作る。
// 実行: node --test web/test/*.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Progress, RefuteGame, DeriveGame, refuteDifficulty } from '../js/game.js';
import { CONFIG } from '../js/config.js';
import { refutePairs, deriveMoves } from '../js/logic.js';

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) };
}
const R = CONFIG.refute;

// REFUTE: 幅 6、2 行。各タイルに矛盾する相手がいる
const refuteStages = [
  { stage: 1, width: 6, shuffles: 2, boards: [
    { seed: 1, cells: ['p', '!p', 'q', '!q', '>pq', '&p!q', 'r', '!r', '|pq', '&!p!q', 'F', 'p'], initialMoves: 5, solutionLength: 6 },
  ] },
  { stage: 2, width: 6, shuffles: 1, boards: [
    { seed: 2, cells: ['p', '!p', 'q', '!q', 'r', '!r'], initialMoves: 3, solutionLength: 3 },
  ] },
];
// DERIVE: 幅 4、16 マス
const deriveStages = [
  { stage: 1, width: 4, height: 4, goal: 'q', boards: [
    { seed: 1, cells: ['p', '', '', '>pq', '', '', '', '', '', '', '', '', '', '', '', ''], par: 1, solution: [['MP', 0, 3]] },
  ] },
  { stage: 2, width: 4, height: 4, goal: '&qr', boards: [
    { seed: 2, cells: ['&pr', '', '', '', 'p', '>pq', '', '', '', '', '', '', 'r', '', '', ''], par: 3, solution: [] },
  ] },
];

const fresh = () => {
  const progress = new Progress(CONFIG.storageKey, memoryStorage());
  return { progress, refute: new RefuteGame(refuteStages, R, progress), derive: new DeriveGame(deriveStages, CONFIG.derive, progress) };
};

test('refuteDifficulty: 位置と式の複雑さが倍率になる', () => {
  const d = R.difficulty;
  assert.equal(refuteDifficulty(d, 6, 0, 1, 'p', '!p').mult, Math.round((1 + 1 * d.perConnective) * 100) / 100);
  const v = refuteDifficulty(d, 6, 0, 6, 'p', 'q');
  assert.equal(v.kind, 'vertical'); assert.equal(v.mult, d.vertical);
  const dg = refuteDifficulty(d, 6, 0, 14, '>pq', '&p!q');          // (0,0)-(2,2) 斜め、間 1、結合子 3
  assert.equal(dg.kind, 'diagonal'); assert.equal(dg.gap, 1);
  assert.equal(dg.mult, Math.round((d.diagonal + d.diagonalGapPerCell + 3 * d.perConnective) * 100) / 100);
  assert.ok(dg.labels.includes('DIAGONAL SNIPE') && dg.labels.includes('COMPLEX'));
});

test('REFUTE: 選択 → 矛盾する Pair を消す → 得点 = 基礎点 × 難しさ × Chain、Chain +1', () => {
  const { refute: g } = fresh();
  g.newRun(0);
  assert.deepEqual(g.tap(0, 1000).map((e) => e.type), ['select']);
  const evs = g.tap(1, 1000);                               // p と ¬p
  assert.equal(evs[0].type, 'remove');
  assert.equal(evs[0].chain, 1);
  assert.equal(evs[0].mult, 1 + R.chain.step);
  assert.equal(evs[0].pairPoints, Math.round(R.score.pairBase * evs[0].diffMult * (1 + R.chain.step)));
  assert.equal(g.stage.board[0], ''); assert.equal(g.stage.board[1], '');
});

test('REFUTE: 同時に成り立つ 2 つは消せない、位置が悪いと position', () => {
  const { refute: g } = fresh();
  g.newRun(0);
  g.tap(0);
  const evs = g.tap(2);                                     // p と q: 間に !p → position
  assert.equal(evs[0].type, 'invalid'); assert.equal(evs[0].reason, 'position');
  g.stage.selected = null;
  g.stage.board = ['p', 'q', '', '', '', ''];
  g.tap(0);
  const sat = g.tap(1);
  assert.equal(sat[0].reason, 'satisfiable');
});

test('REFUTE: 全消しで Clear、行が消える、Hint 温存 Bonus', () => {
  const { refute: g } = fresh();
  g.newRun(1);
  g.tap(0); g.tap(1); g.tap(2); g.tap(3);
  const evs = g.tap(4).concat(g.tap(5));
  const rm = evs.find((e) => e.type === 'remove');
  assert.deepEqual(rm.clearedRows, [0]);
  const clear = evs.find((e) => e.type === 'stageClear');
  assert.ok(clear);
  assert.equal(clear.hintBonus, R.hint.perStage * R.score.hintSaved);
  assert.equal(g.p.stars[2], 3);
});

test('REFUTE: SHUFFLE は並べ替えて詰め直し、Pair が残っていたので Chain が途切れる', () => {
  const { refute: g } = fresh();
  g.newRun(0);
  g.tap(0); g.tap(1);
  const before = g.stage.board.filter((c) => c !== '').sort();
  const evs = g.shuffle(2000, () => 0.5);
  assert.equal(evs[0].type, 'shuffle'); assert.equal(evs[0].stuckBefore, false);
  assert.equal(g.stage.chain, 0); assert.equal(g.stage.shufflesLeft, 1);
  assert.deepEqual(g.stage.board.filter((c) => c !== '').sort(), before);
  assert.equal(g.stage.board.length % 6, 0);
});

test('REFUTE: Hint の段階。HINT は得点半分で Chain 維持、FLASH は全 Pair とゲージ半分、SCOPE は相手探し', () => {
  const { refute: g } = fresh();
  g.newRun(0);
  assert.equal(g.hintTier, 'hint');
  const h = g.useHint(1000);
  assert.equal(h[0].type, 'hint'); assert.equal(g.stage.hintsLeft, R.hint.perStage - 1);
  const [i, j] = h[0].pair;
  const ev = g.tap(i, 1500).concat(g.tap(j, 1500)).find((e) => e.type === 'remove');
  assert.equal(ev.hinted, true); assert.equal(ev.chain, 0);
  assert.equal(ev.pairPoints, Math.round(R.score.pairBase * ev.diffMult * 1 * ev.speedMult * R.score.hintedPairRatio));
  g.stage.chain = 3; assert.equal(g.hintTier, 'flash');
  g.stage.lastRemoveAt = 2000;
  const f = g.useHint(2000);
  assert.equal(f[0].type, 'flash');
  assert.deepEqual(f[0].pairs, refutePairs(g.stage.board, 6));
  assert.ok(Math.abs(g.gaugeRatio(2000) - R.hint.flashGaugeRatio) < 0.01);
  g.stage.chain = 7; assert.equal(g.hintTier, 'scope');
  const sc = g.useHint(3000);
  assert.equal(sc[0].type, 'scope');
  assert.ok(refutePairs(g.stage.board, 6).some(([a, b]) => a === sc[0].tile || b === sc[0].tile));
  assert.equal(g.stage.hintsLeft, 0);
  assert.equal(g.useHint(3100)[0].type, 'noHints');
});

test('REFUTE: SCOPE を外すと Chain −3、使わず別を消すと半分', () => {
  const { refute: g } = fresh();
  g.newRun(0);
  g.stage.board = ['p', '!p', '', '', '', '', 'q', '!q', '', '', '', ''];
  g.stage.chain = 8;
  const sc = g.useHint(1000);
  const tile = sc[0].tile;
  const partner = tile === 0 ? 1 : tile === 1 ? 0 : tile === 6 ? 7 : 6;
  const other = [0, 1, 6, 7].find((p) => p !== tile && p !== partner && !refutePairs(g.stage.board, 6).some(([a, b]) => (a === tile && b === p) || (a === p && b === tile)));
  g.tap(tile, 1100);
  const miss = g.tap(other, 1200);
  assert.ok(miss.some((e) => e.type === 'scopeMiss' && e.misses === 1));
  assert.equal(g.stage.chain, 8 - R.hint.scopeMissChain);
  g.stage.selected = null;
  const otherPair = refutePairs(g.stage.board, 6).find(([a, b]) => a !== tile && b !== tile);
  const evs = g.tap(otherPair[0], 1300).concat(g.tap(otherPair[1], 1400));
  assert.ok(evs.some((e) => e.type === 'scopeEnd' && e.reason === 'ignored'));
  assert.equal(g.stage.chain, Math.floor((8 - R.hint.scopeMissChain) * R.hint.scopeBreakRatio) + 1);
});

test('REFUTE: Dead End の Hint は Chain 半分と減点、SHUFFLE 無しなら GIVE UP、気づかずの Hint は重い失敗', () => {
  const { refute: g } = fresh();
  g.newRun(0);
  g.stage.board = ['p', 'q', 'r', '', '', ''];
  g.stage.chain = 4; g.stage.stageScore = 500; g.run.score = 500;
  const h = g.useHint();
  assert.equal(h[0].type, 'noHint'); assert.equal(h[0].blind, false);
  assert.equal(g.stage.chain, 2);
  assert.equal(g.run.score, 500 - R.score.hintWhenStuck);
  g.stage.shufflesLeft = 0;
  const gu = g.shuffle();
  assert.equal(gu[0].type, 'stageFailed'); assert.equal(gu[0].reason, 'giveUp');
  assert.equal(gu[0].kept, Math.floor(400 * R.score.giveUpKeepRatio));
  const { refute: g2 } = fresh();
  g2.newRun(0);
  g2.stage.board = ['p', 'q', 'r']; g2.stage.shufflesLeft = 0; g2.run.score = 1000; g2.stage.stageScore = 300;
  const bh = g2.useHint();
  assert.deepEqual(bh.map((e) => e.type), ['noHint', 'stageFailed']);
  assert.equal(g2.run.score, 1000 - 300 - R.score.blindHintPenalty);
});

test('REFUTE: FEVER は ×10 で始まり、Hint は時間で払う', () => {
  const { refute: g } = fresh();
  g.newRun(0);
  g.stage.board = ['p', '!p', 'q', '!q', '', ''];
  g.stage.chain = 8;
  const evs = g.tap(0, 5000).concat(g.tap(1, 5000));
  assert.ok(evs.some((e) => e.type === 'feverStart'));
  assert.equal(g.hintTier, 'scope');
  const left = g.stage.hintsLeft;
  g.useHint(5100);
  assert.equal(g.stage.hintsLeft, left);
  assert.equal(g.stage.fever.until, 5000 + R.fever.durationMs - R.fever.hintTimeCostMs);
  const end = g.tick(5000 + R.fever.durationMs);
  assert.equal(end[0].type, 'feverEnd');
});

test('REFUTE: Chain ゲージは時間で減る', () => {
  const { refute: g } = fresh();
  g.newRun(0);
  g.tap(0, 1000); g.tap(1, 1000);
  g.stage.chain = 3;
  assert.equal(g.tick(1000 + R.chain.decayGraceMs - 1).length, 0);
  assert.equal(g.tick(1000 + R.chain.decayGraceMs + 1)[0].type, 'chainDecay');
  assert.equal(g.stage.chain, 2);
});

test('DERIVE: MP で Goal を導いて Clear、手数で Star', () => {
  const { derive: g } = fresh();
  g.start(0, 0);
  g.tap(0);
  const evs = g.tap(3);
  assert.equal(evs[0].type, 'move'); assert.equal(evs[0].rule, 'MP'); assert.equal(evs[0].result, 'q');
  const clear = evs.find((e) => e.type === 'stageClear');
  assert.ok(clear); assert.equal(clear.stars, 3);
});

test('DERIVE: ∧E と ∧I、UNDO は手数を戻さない', () => {
  const { derive: g } = fresh();
  g.start(1, 0);
  const andE = g.tap(0).concat(g.tap(0));
  assert.equal(andE.find((e) => e.type === 'move').rule, 'ANDE');
  assert.equal(g.cur.cells[0], 'p'); assert.equal(g.cur.cells[1], 'r');
  g.undo();
  assert.equal(g.cur.cells[0], '&pr'); assert.equal(g.cur.moves, 1);
  g.tap(4); assert.equal(g.tap(5).find((e) => e.type === 'move').rule, 'MP');
  g.cur.cells = ['q', 'r', '', '', '', '', '', '', '', '', '', '', '', '', '', ''];
  const andI = g.tap(0).concat(g.tap(1)).find((e) => e.type === 'move');
  assert.equal(andI.rule, 'ANDI'); assert.equal(andI.result, '&qr');
  assert.equal(g.cur.status, 'clear');
});

test('DERIVE: 規則が無い組は noRule、位置が悪いと position、deriveMoves が候補を返す', () => {
  const { derive: g } = fresh();
  g.start(1, 0);
  g.tap(4);
  assert.equal(g.tap(12)[0].reason, 'noRule');
  g.cur.selected = null;
  g.tap(0);
  assert.equal(g.tap(12)[0].reason, 'position');
  assert.ok(deriveMoves(g.cur.cells, 4, g.cur.goal).length >= 2);
});

test('保存と復元: 同じストレージから作り直すと両モードの状態が戻る', () => {
  const storage = memoryStorage();
  const p1 = new Progress(CONFIG.storageKey, storage);
  const r1 = new RefuteGame(refuteStages, R, p1);
  const d1 = new DeriveGame(deriveStages, CONFIG.derive, p1);
  r1.newRun(0); r1.tap(0); r1.tap(1);
  d1.start(1, 0); d1.tap(4); d1.tap(5);
  const p2 = new Progress(CONFIG.storageKey, storage);
  const r2 = new RefuteGame(refuteStages, R, p2);
  const d2 = new DeriveGame(deriveStages, CONFIG.derive, p2);
  assert.deepEqual(r2.stage.board, r1.stage.board);
  assert.deepEqual(d2.cur.cells, d1.cur.cells);
  assert.equal(d2.cur.moves, 1);
});

test('REFUTE: VAR CLEAR は、ある変数を含む式が全部消えたとき 1 つごとに Bonus', () => {
  const { refute: g } = fresh();
  g.newRun(0);
  g.stage.board = ['p', '!p', 'q', '!q', 'r', '!r'];
  let ev = g.tap(0, 1000).concat(g.tap(1, 1000)).find((e) => e.type === 'remove');
  assert.deepEqual(ev.varsCleared, ['p']);
  assert.equal(ev.varPoints, Math.round(R.score.varClear * 1 * ev.mult));
  const { refute: g2 } = fresh();
  g2.newRun(0);
  g2.stage.board = ['p', '!p', '&pq', '!q', '', ''];
  ev = g2.tap(0).concat(g2.tap(1)).find((e) => e.type === 'remove');
  assert.deepEqual(ev.varsCleared, []);                 // p は &pq に残っている
});
