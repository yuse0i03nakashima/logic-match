// game.js の進行を、画面なしで通す検査。面データに依存しないよう、小さな Stage を手で作る。
// 実行: node --test web/test/*.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Progress, RefuteGame, DeriveGame } from '../js/game.js';
import { CONFIG } from '../js/config.js';
import { refutePairs, deriveMoves } from '../js/logic.js';

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) };
}

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
    { seed: 2, cells: ['&p!s', '', '', '', 'p', '>pq', '', '', '', '', '', '', 'r', '', '', ''].map((c) => (c === '&p!s' ? '&pr' : c)), par: 3, solution: [] },
  ] },
];

const fresh = () => {
  const progress = new Progress(CONFIG.storageKey, memoryStorage());
  return { progress, refute: new RefuteGame(refuteStages, CONFIG.refute, progress), derive: new DeriveGame(deriveStages, CONFIG.derive, progress) };
};

test('REFUTE: 選択 → 矛盾する Pair を消す → 得点と Chain', () => {
  const { refute: g } = fresh();
  g.newRun(0);
  assert.deepEqual(g.tap(0, 1000).map((e) => e.type), ['select']);
  const evs = g.tap(1, 1000);                               // p と ¬p
  assert.equal(evs[0].type, 'remove');
  assert.equal(evs[0].chain, 1);
  assert.ok(evs[0].pairPoints > 0);
  assert.equal(g.stage.board[0], ''); assert.equal(g.stage.board[1], '');
});

test('REFUTE: 同時に成り立つ 2 つは消せない(理由 satisfiable)、位置が悪いと position', () => {
  const { refute: g } = fresh();
  g.newRun(0);
  g.tap(0);                                                 // p
  const evs = g.tap(2);                                     // q(同じ行、間に !p がある → position)
  assert.equal(evs[0].type, 'invalid');
  assert.equal(evs[0].reason, 'position');
  g.stage.selected = null;
  g.tap(2);                                                 // q
  const evs2 = g.tap(3);                                    // !q → 消える
  assert.equal(evs2[0].type, 'remove');
  g.tap(0);                                                 // p
  const evs3 = g.tap(1);                                    // !p 隣 → 消える
  assert.equal(evs3[0].type, 'remove');
  g.tap(4);                                                 // >pq
  const evs4 = g.tap(6);                                    // r: 位置は… 4 と 6 は同じ行で間(5)に &p!q がある → position
  assert.equal(evs4[0].reason, 'position');
});

test('REFUTE: 全消しで Clear、行が消える', () => {
  const { refute: g } = fresh();
  g.newRun(1);                                              // p !p q !q r !r(1 行)
  g.tap(0); g.tap(1);
  g.tap(2); g.tap(3);
  const evs = g.tap(4).concat(g.tap(5));
  const rm = evs.find((e) => e.type === 'remove');
  assert.deepEqual(rm.clearedRows, [0]);
  assert.ok(evs.some((e) => e.type === 'stageClear'));
  assert.equal(g.stage.status, 'clear');
  assert.equal(g.p.stars[2], 3);
});

test('REFUTE: SHUFFLE は並べ替えて詰め直し、Pair が残っていたので Chain が途切れる', () => {
  const { refute: g } = fresh();
  g.newRun(0);
  g.tap(0); g.tap(1);
  const before = g.stage.board.filter((c) => c !== '').sort();
  const evs = g.shuffle(2000, () => 0.5);
  assert.equal(evs[0].type, 'shuffle');
  assert.equal(evs[0].stuckBefore, false);
  assert.equal(g.stage.chain, 0);
  assert.equal(g.stage.shufflesLeft, 1);
  assert.deepEqual(g.stage.board.filter((c) => c !== '').sort(), before);
  assert.equal(g.stage.board.length % 6, 0);
});

test('REFUTE: 詰みから Hint は減点、SHUFFLE 無しなら GIVE UP、気づかずの Hint は重い失敗', () => {
  const { refute: g } = fresh();
  g.newRun(0);
  g.stage.board = ['p', 'q', 'r', '', '', ''];              // 矛盾する組が無い
  g.stage.chain = 4; g.stage.stageScore = 500; g.run.score = 500;
  assert.equal(refutePairs(g.stage.board, 6).length, 0);
  const h = g.useHint();
  assert.equal(h[0].type, 'noHint'); assert.equal(h[0].blind, false);
  assert.equal(g.run.score, 500 - CONFIG.refute.score.hintWhenStuck);
  g.stage.shufflesLeft = 0;
  const gu = g.shuffle();                                   // ボタンは GIVE UP
  assert.equal(gu[0].type, 'stageFailed'); assert.equal(gu[0].reason, 'giveUp');
  assert.equal(gu[0].kept, Math.floor(400 * CONFIG.refute.score.giveUpKeepRatio));
  const { refute: g2 } = fresh();
  g2.newRun(0);
  g2.stage.board = ['p', 'q', 'r']; g2.stage.shufflesLeft = 0; g2.run.score = 1000; g2.stage.stageScore = 300;
  const bh = g2.useHint();
  assert.deepEqual(bh.map((e) => e.type), ['noHint', 'stageFailed']);
  assert.equal(bh[1].reason, 'blindHint');
  assert.equal(g2.run.score, 1000 - 300 - CONFIG.refute.score.blindHintPenalty);
});

test('REFUTE: Chain ゲージは時間で減る', () => {
  const { refute: g } = fresh();
  g.newRun(0);
  g.tap(0, 1000); g.tap(1, 1000);
  g.stage.chain = 3;
  assert.equal(g.tick(1000 + CONFIG.refute.chain.decayGraceMs - 1).length, 0);
  assert.equal(g.tick(1000 + CONFIG.refute.chain.decayGraceMs + 1)[0].type, 'chainDecay');
  assert.equal(g.stage.chain, 2);
});

test('DERIVE: MP で Goal を導いて Clear、手数で Star', () => {
  const { derive: g } = fresh();
  g.start(0, 0);
  assert.deepEqual(g.tap(0).map((e) => e.type), ['select']);
  const evs = g.tap(3);                                     // p と p→q(同じ行、間が空)
  assert.equal(evs[0].type, 'move');
  assert.equal(evs[0].rule, 'MP');
  assert.equal(evs[0].result, 'q');
  assert.equal(g.cur.cells[3], 'q'); assert.equal(g.cur.cells[0], '');
  const clear = evs.find((e) => e.type === 'stageClear');
  assert.ok(clear);
  assert.equal(clear.stars, 3);
  assert.equal(g.p.stars[1], 3);
});

test('DERIVE: ∧E と ∧I、UNDO は手数を戻さない', () => {
  const { derive: g } = fresh();
  g.start(1, 0);                                            // cells: &pr, _, _, _, p, >pq, ... r at 12 ; goal &qr
  const andE = g.tap(0).concat(g.tap(0));                   // 2 回タップで分ける
  const mv = andE.find((e) => e.type === 'move');
  assert.equal(mv.rule, 'ANDE');
  assert.equal(g.cur.cells[0], 'p');
  assert.equal(g.cur.cells[1], 'r');                        // 最初の空マスへ
  assert.equal(g.cur.moves, 1);
  const u = g.undo();
  assert.equal(u[0].type, 'undo');
  assert.equal(g.cur.cells[0], '&pr');
  assert.equal(g.cur.moves, 1);                             // 手数は数えたまま
  // p(4) と p→q(5) で q を 5 に、q(5) と r(12)… 位置がつながらないので ∧I は別経路で確かめる
  g.tap(4); const mp = g.tap(5).find((e) => e.type === 'move');
  assert.equal(mp.rule, 'MP'); assert.equal(g.cur.cells[5], 'q');
  g.cur.cells = ['q', 'r', '', '', '', '', '', '', '', '', '', '', '', '', '', ''];
  const andI = g.tap(0).concat(g.tap(1)).find((e) => e.type === 'move');
  assert.equal(andI.rule, 'ANDI'); assert.equal(andI.result, '&qr');
  assert.equal(g.cur.status, 'clear');
});

test('DERIVE: 規則が無い組は invalid(noRule)、位置が悪いと position、deriveMoves が候補を返す', () => {
  const { derive: g } = fresh();
  g.start(1, 0);
  g.tap(4);                                                 // p
  const bad = g.tap(12);                                    // r: (1,0) と (3,0) は縦、間(8)は空 → 位置 OK、規則なし
  assert.equal(bad[0].type, 'invalid'); assert.equal(bad[0].reason, 'noRule');
  g.cur.selected = null;
  g.tap(0);                                                 // &pr (0,0)
  const far = g.tap(5);                                     // (1,1): 斜め、間なし → 位置 OK だが規則なし
  assert.equal(far[0].reason, 'noRule');
  g.cur.selected = null;
  g.tap(0);
  const pos = g.tap(12);                                    // (0,0) と (3,0): 縦、間に p(4) → position
  assert.equal(pos[0].reason, 'position');
  assert.ok(deriveMoves(g.cur.cells, 4, g.cur.goal).length >= 2);
});

test('保存と復元: 同じストレージから作り直すと両モードの状態が戻る', () => {
  const storage = memoryStorage();
  const p1 = new Progress(CONFIG.storageKey, storage);
  const r1 = new RefuteGame(refuteStages, CONFIG.refute, p1);
  const d1 = new DeriveGame(deriveStages, CONFIG.derive, p1);
  r1.newRun(0); r1.tap(0); r1.tap(1);
  d1.start(1, 0); d1.tap(4); d1.tap(5);
  const p2 = new Progress(CONFIG.storageKey, storage);
  const r2 = new RefuteGame(refuteStages, CONFIG.refute, p2);
  const d2 = new DeriveGame(deriveStages, CONFIG.derive, p2);
  assert.deepEqual(r2.stage.board, r1.stage.board);
  assert.deepEqual(d2.cur.cells, d1.cur.cells);
  assert.equal(d2.cur.moves, 1);
});
