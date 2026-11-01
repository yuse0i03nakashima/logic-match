// ゲームの進行。2 つのモードをクラスで分け、保存は Progress がまとめる。
//   logic.js  … 式の意味・位置・規則(Haskell と同じ)
//   game.js   … RefuteGame / DeriveGame / Progress       ← このファイル
//   main.js   … 画面・演出・音とのつなぎ
//
// どちらのクラスも、操作は状態を更新して「起きたこと」のイベント配列を返す。

import { refutePairs, unsat2, connected, collapseRows, applyRule, andE, deriveMoves, parse } from './logic.js';

// ---------- 保存 ----------
export class Progress {
  constructor(storageKey, storage = globalThis.localStorage) {
    this.key = storageKey;
    this.storage = storage;
    this.data = {
      refute: { maxStage: 0, stars: {}, ranks: {}, attempts: {}, bestScore: 0, run: null },
      derive: { maxStage: 0, stars: {}, bestMoves: {}, current: null },
    };
    this.load();
  }
  load() {
    try {
      const raw = this.storage?.getItem(this.key);
      if (!raw) return;
      const d = JSON.parse(raw);
      if (d.refute) this.data.refute = { ...this.data.refute, ...d.refute };
      if (d.derive) this.data.derive = { ...this.data.derive, ...d.derive };
    } catch { /* 壊れていたら初期状態 */ }
  }
  save() {
    try { this.storage?.setItem(this.key, JSON.stringify(this.data)); } catch { /* 無視 */ }
  }
}

const RANKS = ['C', 'B', 'A', 'S'];

// 式の複雑さ(結合子の数)。難しい式を消すほど加点
const complexity = (s) => [...s].filter((c) => '!&|>'.includes(c)).length;

// ======================================================================
// REFUTE: 矛盾する Pair を消して Board を空にする(Number Match の骨格)
// ======================================================================
export class RefuteGame {
  constructor(stages, cfg, progress) {
    this.stages = stages;
    this.cfg = cfg;
    this.progress = progress;
    this.p = progress.data.refute;      // この モードの保存領域
  }
  get run() { return this.p.run; }
  get stage() { return this.run?.stage ?? null; }
  get stageDef() { return this.run ? this.stages[this.run.stageIndex] : null; }
  get width() { return this.stageDef?.width ?? 6; }
  save() { this.progress.save(); }

  multiplierFor(chain) { const c = this.cfg.chain; return Math.min(c.max, 1 + c.step * chain); }
  get multiplier() { return this.multiplierFor(this.stage?.chain ?? 0); }
  get heat() { return (this.multiplier - 1) / (this.cfg.chain.max - 1); }
  get isStuck() { return !!this.stage && refutePairs(this.stage.board, this.width).length === 0; }
  get inFever() { return !!this.stage?.fever; }
  feverRatio(now) {
    const f = this.stage?.fever;
    return f ? Math.max(0, Math.min(1, (f.until - now) / this.cfg.fever.durationMs)) : 0;
  }
  gaugeRatio(now) {
    const st = this.stage, c = this.cfg.chain;
    if (!st || st.chain <= 0 || st.lastRemoveAt === null) return 0;
    if (st.fever) return 1;
    const t = now - st.lastRemoveAt;
    if (t < c.decayGraceMs) return 1 - t / c.decayGraceMs;
    return 1 - ((t - c.decayGraceMs) % c.decayStepMs) / c.decayStepMs;
  }
  worldOf(i) { return Math.floor(i / this.cfg.worldSize); }
  worldStart(i) { return this.worldOf(i) * this.cfg.worldSize; }
  get unlockedWorlds() { return this.worldOf(Math.min(this.p.maxStage, this.stages.length - 1)) + 1; }
  get totalStars() { return Object.values(this.p.stars).reduce((a, b) => a + b, 0); }
  get rankCounts() {
    const out = { S: 0, A: 0, B: 0, C: 0 };
    for (const r of Object.values(this.p.ranks)) if (r in out) out[r] += 1;
    return out;
  }

  newRun(stageIndex = 0) {
    this.p.run = { stageIndex, score: 0, lives: this.cfg.lives.start, stage: null };
    return this.startStage();
  }
  startStage() {
    const def = this.stageDef;
    const attempt = this.p.attempts[def.stage] ?? 0;
    const variant = def.boards[attempt % def.boards.length];
    this.run.stage = {
      board: variant.cells.slice(),
      shufflesLeft: def.shuffles,
      shufflesUsed: 0,
      chain: 0, stageScore: 0, selected: null, hintPair: null,
      lastRemoveAt: null, decayed: 0, fever: null, status: 'play',
    };
    this.save();
    return [{ type: 'stageStart', stage: def.stage, stageIndex: this.run.stageIndex }];
  }
  resume(now) {
    const st = this.stage;
    if (!st || st.status !== 'play') return;
    if (st.fever) st.fever.until = now + this.cfg.fever.durationMs * 0.5;
    st.lastRemoveAt = st.chain > 0 ? now : null;
    st.decayed = 0;
    this.save();
  }

  tick(now) {
    const st = this.stage, cfg = this.cfg;
    if (!st || st.status !== 'play') return [];
    const events = [];
    if (st.fever && now >= st.fever.until) {
      st.fever = null;
      st.chain = Math.floor(st.chain * cfg.fever.endChainRatio);
      st.lastRemoveAt = st.chain > 0 ? now : null;
      st.decayed = 0;
      events.push({ type: 'feverEnd', chain: st.chain, mult: this.multiplier });
    }
    if (!st.fever && st.chain > 0 && st.lastRemoveAt !== null) {
      const t = now - st.lastRemoveAt - cfg.chain.decayGraceMs;
      if (t > 0) {
        const steps = Math.floor(t / cfg.chain.decayStepMs) + 1 - st.decayed;
        if (steps > 0) {
          st.chain = Math.max(0, st.chain - steps);
          st.decayed += steps;
          events.push({ type: 'chainDecay', chain: st.chain, mult: this.multiplier, heat: this.heat });
          if (st.chain === 0) st.lastRemoveAt = null;
        }
      }
    }
    if (events.length) this.save();
    return events;
  }

  tap(pos, now = Date.now()) {
    const st = this.stage;
    if (!st || st.status !== 'play') return [];
    const b = st.board;
    if (b[pos] === '') {
      if (st.selected === null) return [];
      const prev = st.selected; st.selected = null;
      return [{ type: 'deselect', pos: prev }];
    }
    if (st.selected === null) { st.selected = pos; return [{ type: 'select', pos }]; }
    if (st.selected === pos) { st.selected = null; return [{ type: 'deselect', pos }]; }
    const i = Math.min(st.selected, pos), j = Math.max(st.selected, pos);
    if (connected(b, this.width, i, j) && unsat2(b[i], b[j])) return this.remove(i, j, now);
    const prev = st.selected; st.selected = pos;
    // なぜ消せないかを伝える(位置か、意味か)
    const reason = !connected(b, this.width, i, j) ? 'position' : 'satisfiable';
    return [{ type: 'invalid', from: prev, to: pos, reason }, { type: 'select', pos }];
  }

  remove(i, j, now) {
    const st = this.stage, b = st.board, cfg = this.cfg, w = this.width;
    const before = b.map((c, p) => (p === i || p === j ? '' : c));
    const clearedRows = [];
    for (let r = 0; r * w < before.length; r++) {
      if (before.slice(r * w, (r + 1) * w).every((c) => c === '')) clearedRows.push(r);
    }
    const after = collapseRows(before, w);

    // 道の種類と間の空マス
    const ri = Math.floor(i / w), ci = i % w, rj = Math.floor(j / w), cj = j % w;
    const gap = Math.max(Math.abs(rj - ri), Math.abs(cj - ci)) - 1;
    const kind = ri === rj ? 'line' : ci === cj ? 'vertical' : 'diagonal';
    let bonus = gap * cfg.score.gapPerCell;
    const labels = [];
    if (gap > 0) labels.push(gap >= 3 ? 'LONG SHOT' : 'OPENED');
    if (kind === 'diagonal') { bonus += cfg.score.diagonal; labels.push('DIAGONAL'); }
    if (kind === 'vertical') bonus += cfg.score.vertical;
    const cx = complexity(b[i]) + complexity(b[j]);
    if (cx >= 3) { bonus += cx * cfg.score.complexity; labels.push('COMPLEX'); } else bonus += cx * cfg.score.complexity;

    const elapsed = st.lastRemoveAt === null ? Infinity : now - st.lastRemoveAt;
    const speed = elapsed < cfg.speed.fastMs ? { tier: 'fast', mult: cfg.speed.fastMult }
      : elapsed < cfg.speed.quickMs ? { tier: 'quick', mult: cfg.speed.quickMult } : { tier: null, mult: 1 };
    st.lastRemoveAt = now; st.decayed = 0;
    st.chain += 1;
    const mult = this.multiplier;
    const feverMult = st.fever ? cfg.fever.pointMult : 1;
    const pairPoints = Math.round((cfg.score.pairBase + bonus) * mult * speed.mult * feverMult);
    const rowPoints = Math.round(cfg.score.rowClear * clearedRows.length ** 2 * mult * feverMult);
    const points = pairPoints + rowPoints;
    st.stageScore += points; this.run.score += points;
    st.selected = null; st.hintPair = null; st.board = after;

    const events = [{
      type: 'remove', i, j, a: b[i], b: b[j], points, pairPoints, rowPoints, chain: st.chain, mult, heat: this.heat,
      clearedRows, board: after, labels, speed: speed.tier, fever: !!st.fever,
    }];
    if (!st.fever && mult >= cfg.chain.max) {
      st.fever = { until: now + cfg.fever.durationMs };
      events.push({ type: 'feverStart', durationMs: cfg.fever.durationMs });
    }
    if (after.every((c) => c === '')) events.push(...this.stageClear());
    this.save();
    return events;
  }

  // SHUFFLE: 残りのタイルを並べ替えて、幅 width の格子に詰め直す
  shuffle(now = Date.now(), rand = Math.random) {
    const st = this.stage, cfg = this.cfg;
    if (!st || st.status !== 'play') return [];
    if (st.shufflesLeft <= 0) return this.giveUp();
    const stuck = this.isStuck;
    const tiles = st.board.filter((c) => c !== '');
    for (let k = tiles.length - 1; k > 0; k--) { const m = Math.floor(rand() * (k + 1)); [tiles[k], tiles[m]] = [tiles[m], tiles[k]]; }
    const w = this.width;
    const len = Math.ceil(tiles.length / w) * w;
    st.board = tiles.concat(Array(len - tiles.length).fill(''));
    st.shufflesLeft -= 1; st.shufflesUsed += 1;
    const chainBefore = st.chain;
    st.chain = stuck ? Math.floor(st.chain * cfg.stuck.shuffleKeepRatio) : 0;
    st.selected = null; st.hintPair = null;
    st.lastRemoveAt = st.chain > 0 ? now : null; st.decayed = 0;
    this.save();
    return [{ type: 'shuffle', board: st.board, stuckBefore: stuck, chainBefore, chainAfter: st.chain,
              multBefore: this.multiplierFor(chainBefore), multAfter: this.multiplier, shufflesLeft: st.shufflesLeft }];
  }

  useHint() {
    const st = this.stage, cfg = this.cfg;
    if (!st || st.status !== 'play') return [];
    const pairs = refutePairs(st.board, this.width);
    const brokeChain = st.chain > 0;
    st.chain = 0; st.selected = null; st.lastRemoveAt = null; st.decayed = 0;
    if (pairs.length === 0) {
      if (st.shufflesLeft <= 0) {
        const extra = Math.max(0, Math.min(this.run.score - st.stageScore, cfg.score.blindHintPenalty));
        this.run.score -= extra;
        const events = [{ type: 'noHint', penalty: st.stageScore + extra, brokeChain, blind: true }];
        events.push(...this.stageFailed('blindHint', 0));
        this.save();
        return events;
      }
      const penalty = Math.min(st.stageScore, cfg.score.hintWhenStuck);
      st.stageScore -= penalty; this.run.score -= penalty;
      this.save();
      return [{ type: 'noHint', penalty, brokeChain, blind: false, shufflesLeft: st.shufflesLeft }];
    }
    st.hintPair = pairs[Math.floor(Math.random() * pairs.length)];
    this.save();
    return [{ type: 'hint', pair: st.hintPair, brokeChain }];
  }

  giveUp() {
    const st = this.stage;
    if (!st || st.status !== 'play') return [];
    return this.stageFailed('giveUp', this.cfg.score.giveUpKeepRatio);
  }

  rankFor(stageScore) {
    const r = this.cfg.rank, def = this.stageDef;
    const ratio = stageScore / (def.boards[0].cells.length * r.perCell);
    return ratio >= r.S ? 'S' : ratio >= r.A ? 'A' : ratio >= r.B ? 'B' : 'C';
  }

  stageClear() {
    const st = this.stage, def = this.stageDef, cfg = this.cfg;
    const perfect = st.shufflesUsed === 0;
    const stars = perfect ? 3 : st.shufflesUsed === 1 ? 2 : 1;
    const clearBonus = cfg.score.stageClear;
    const perfectBonus = perfect ? cfg.score.perfect : 0;
    const savedBonus = st.shufflesLeft * cfg.score.shuffleSaved;
    const lifeGain = perfect && this.run.lives < cfg.lives.max ? cfg.lives.perfectRecover : 0;
    this.run.lives = Math.min(cfg.lives.max, this.run.lives + lifeGain);
    const bonusTotal = clearBonus + perfectBonus + savedBonus;
    this.run.score += bonusTotal; st.stageScore += bonusTotal;
    st.fever = null; st.status = 'clear';
    const rank = this.rankFor(st.stageScore);
    this.p.stars[def.stage] = Math.max(this.p.stars[def.stage] ?? 0, stars);
    const prev = this.p.ranks[def.stage];
    if (!prev || RANKS.indexOf(rank) > RANKS.indexOf(prev)) this.p.ranks[def.stage] = rank;
    this.p.maxStage = Math.max(this.p.maxStage, this.run.stageIndex + 1);
    this.p.bestScore = Math.max(this.p.bestScore, this.run.score);
    this.save();
    return [{ type: 'stageClear', stage: def.stage, stars, rank, perfect, clearBonus, perfectBonus, savedBonus, lifeGain,
              stageScore: st.stageScore, playScore: st.stageScore - bonusTotal, score: this.run.score,
              shufflesUsed: st.shufflesUsed, shufflesLeft: st.shufflesLeft, isLast: this.run.stageIndex + 1 >= this.stages.length }];
  }
  nextStage() {
    if (!this.run || this.stage.status !== 'clear') return [];
    if (this.run.stageIndex + 1 >= this.stages.length) { this.stage.status = 'complete'; this.save(); return [{ type: 'complete', score: this.run.score, best: this.p.bestScore }]; }
    this.run.stageIndex += 1;
    return this.startStage();
  }
  stageFailed(reason, keepRatio = 0) {
    const st = this.stage, def = this.stageDef;
    this.run.lives -= 1;
    const kept = Math.floor(st.stageScore * keepRatio), lost = st.stageScore - kept;
    this.run.score -= lost;
    this.p.attempts[def.stage] = (this.p.attempts[def.stage] ?? 0) + 1;
    st.stageScore = 0; st.fever = null;
    if (this.run.lives <= 0) {
      st.status = 'runOver';
      this.p.bestScore = Math.max(this.p.bestScore, this.run.score);
      this.save();
      return [{ type: 'runOver', reason, score: this.run.score, best: this.p.bestScore, lost, kept, resumeStage: this.worldStart(this.run.stageIndex), stage: def.stage }];
    }
    st.status = 'failed';
    this.save();
    return [{ type: 'stageFailed', reason, lives: this.run.lives, lost, kept, stage: def.stage }];
  }
  retryStage() { return (this.run && this.stage.status === 'failed') ? this.startStage() : []; }
  restartFromWorld() { return this.newRun(this.run ? this.worldStart(this.run.stageIndex) : 0); }
  abandonRun() { this.p.run = null; this.save(); }
}

// ======================================================================
// DERIVE: 推論規則で合体させて Goal を作る
// ======================================================================
export class DeriveGame {
  constructor(stages, cfg, progress) {
    this.stages = stages;
    this.cfg = cfg;
    this.progress = progress;
    this.p = progress.data.derive;
  }
  get cur() { return this.p.current; }
  get stageDef() { return this.cur ? this.stages[this.cur.stageIndex] : null; }
  get width() { return this.stageDef?.width ?? 4; }
  save() { this.progress.save(); }
  worldOf(i) { return Math.floor(i / this.cfg.worldSize); }
  get unlockedWorlds() { return this.worldOf(Math.min(this.p.maxStage, this.stages.length - 1)) + 1; }
  get totalStars() { return Object.values(this.p.stars).reduce((a, b) => a + b, 0); }

  start(stageIndex, boardIndex = null) {
    const def = this.stages[stageIndex];
    const k = boardIndex ?? Math.floor(Math.random() * def.boards.length);
    const v = def.boards[k];
    this.p.current = {
      stageIndex, boardIndex: k, goal: def.goal, par: v.par,
      cells: v.cells.slice(), initial: v.cells.slice(),
      moves: 0, hints: 0, history: [], selected: null, hintMove: null, status: 'play',
    };
    this.save();
    return [{ type: 'stageStart', stage: def.stage, stageIndex, goal: def.goal, par: v.par }];
  }

  tap(pos) {
    const c = this.cur;
    if (!c || c.status !== 'play') return [];
    const cells = c.cells;
    if (cells[pos] === '') {
      if (c.selected === null) return [];
      const prev = c.selected; c.selected = null;
      return [{ type: 'deselect', pos: prev }];
    }
    if (c.selected === null) { c.selected = pos; return [{ type: 'select', pos }]; }
    if (c.selected === pos) {
      // 同じタイルを 2 回: ∧E
      const next = andE(cells, pos);
      c.selected = null;
      if (!next) {
        const t = parse(cells[pos]);
        return [{ type: 'deselect', pos }, { type: 'invalid', from: pos, to: pos, reason: t.type === 'and' ? 'noEmpty' : 'notAnd' }];
      }
      const movedTo = next.findIndex((v, k) => v !== cells[k] && k !== pos);
      return this.commit({ rule: 'ANDE', i: pos, j: pos, result: next[pos], movedTo, before: cells, after: next });
    }
    const i = c.selected, j = pos;
    if (!connected(cells, this.width, i, j)) {
      c.selected = pos;
      return [{ type: 'invalid', from: i, to: j, reason: 'position' }, { type: 'select', pos }];
    }
    const r = applyRule(c.goal, cells[i], cells[j]);
    if (!r) {
      c.selected = pos;
      return [{ type: 'invalid', from: i, to: j, reason: 'noRule' }, { type: 'select', pos }];
    }
    const after = cells.slice();
    after[j] = r.result; after[i] = '';
    return this.commit({ rule: r.rule, i, j, result: r.result, before: cells, after });
  }

  commit(move) {
    const c = this.cur;
    c.history.push(c.cells);
    c.cells = move.after;
    c.moves += 1;
    c.selected = null; c.hintMove = null;
    const events = [{ type: 'move', ...move, moves: c.moves, par: c.par, goal: c.goal }];
    if (c.cells.includes(c.goal)) events.push(...this.clear());
    else if (deriveMoves(c.cells, this.width, c.goal).length === 0) events.push({ type: 'deadEnd' });
    this.save();
    return events;
  }

  undo() {
    const c = this.cur;
    if (!c || c.status !== 'play' || c.history.length === 0) return [{ type: 'noUndo' }];
    c.cells = c.history.pop();
    c.selected = null; c.hintMove = null;
    this.save();
    return [{ type: 'undo', board: c.cells, moves: c.moves }];
  }
  reset() {
    const c = this.cur;
    if (!c || c.status !== 'play') return [];
    c.history = []; c.cells = c.initial.slice(); c.selected = null; c.hintMove = null;
    this.save();
    return [{ type: 'reset', board: c.cells }];
  }
  useHint() {
    const c = this.cur;
    if (!c || c.status !== 'play') return [];
    const moves = deriveMoves(c.cells, this.width, c.goal);
    if (moves.length === 0) return [{ type: 'noHint' }];
    // Goal に近づく手を優先: 結論が Goal の部分式になる手、なければ任意
    const good = moves.filter((m) => m.result && (m.result === c.goal || c.goal.includes(m.result)));
    c.hintMove = (good.length ? good : moves)[0];
    c.hints += 1; c.selected = null;
    this.save();
    return [{ type: 'hint', move: c.hintMove }];
  }

  clear() {
    const c = this.cur, def = this.stageDef, s = this.cfg.stars;
    c.status = 'clear';
    const over = c.moves - c.par;
    const stars = over <= s.perfectExtra ? 3 : over <= s.goodExtra ? 2 : 1;
    const score = Math.max(0, this.cfg.score.base - Math.max(0, over) * this.cfg.score.perMoveOver - c.hints * this.cfg.score.hintCost);
    this.p.stars[def.stage] = Math.max(this.p.stars[def.stage] ?? 0, stars);
    this.p.bestMoves[def.stage] = Math.min(this.p.bestMoves[def.stage] ?? Infinity, c.moves);
    this.p.maxStage = Math.max(this.p.maxStage, c.stageIndex + 1);
    this.save();
    return [{ type: 'stageClear', stage: def.stage, stars, moves: c.moves, par: c.par, hints: c.hints, score, isLast: c.stageIndex + 1 >= this.stages.length }];
  }
  nextStage() {
    const c = this.cur;
    if (!c || c.status !== 'clear') return [];
    if (c.stageIndex + 1 >= this.stages.length) { c.status = 'complete'; this.save(); return [{ type: 'complete' }]; }
    return this.start(c.stageIndex + 1);
  }
  abandon() { this.p.current = null; this.save(); }
}
