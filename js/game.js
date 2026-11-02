// ゲームの進行。2 つのモードをクラスで分け、保存は Progress がまとめる。
//   logic.js  … 式の意味・位置・規則(Haskell と同じ)
//   game.js   … RefuteGame / DeriveGame / Progress       ← このファイル
//   main.js   … 画面・演出・音とのつなぎ
//
// どちらのクラスも、操作は状態を更新して「起きたこと」のイベント配列を返す。
// RefuteGame は THE TEN(NumberMatch)の Game と同じ骨格。Add が SHUFFLE に、matches が unsat2 に、
// 位置の条件が 8 方向の見通し線になっている。Chain・FEVER・3 段階の Hint・Heart・GIVE UP は同じ。

import { refutePairs, unsat2, connected, collapseRows, applyRule, andE, deriveMoves, goalReachable, parse, vars } from './logic.js';

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

// 式の複雑さ(結合子の数)。難しい式を消すほど倍率が上がる
const connectives = (s) => [...s].filter((c) => '!&|>'.includes(c)).length;

/** 2 マスの位置関係と難しさ倍率。REFUTE は 8 方向の見通し線だけなので、横・縦・斜めと間の空マス。 */
export function refuteDifficulty(diffCfg, width, i, j, a, b) {
  const ri = Math.floor(i / width), ci = i % width, rj = Math.floor(j / width), cj = j % width;
  const gap = Math.max(Math.abs(rj - ri), Math.abs(cj - ci)) - 1;
  const kind = ri === rj ? (gap === 0 ? 'adjacent' : 'line') : ci === cj ? 'vertical' : 'diagonal';
  let mult = 1;
  const labels = [];
  if (kind === 'vertical') { mult = diffCfg.vertical; labels.push('VERTICAL'); }
  if (kind === 'diagonal') { mult = diffCfg.diagonal; labels.push(gap > 0 ? 'DIAGONAL SNIPE' : 'DIAGONAL'); }
  if (gap > 0) {
    mult += gap * (kind === 'diagonal' ? diffCfg.diagonalGapPerCell : diffCfg.gapPerCell);
    if (kind !== 'diagonal') labels.unshift(gap >= 3 ? 'LONG SHOT' : 'OPENED');
  }
  const cx = connectives(a) + connectives(b);
  mult += cx * diffCfg.perConnective;
  if (cx >= diffCfg.complexFrom) labels.push('COMPLEX');
  return { mult: Math.round(mult * 100) / 100, labels, kind, gap };
}

// ======================================================================
// REFUTE: 矛盾する Pair を消して Board を空にする
// ======================================================================
export class RefuteGame {
  constructor(stages, cfg, progress) {
    this.stages = stages;
    this.cfg = cfg;
    this.progress = progress;
    this.p = progress.data.refute;      // このモードの保存領域
  }
  get run() { return this.p.run; }
  get relax() { return !!this.progress.data.relax; }
  setRelax(on) { this.progress.data.relax = !!on; this.save(); }
  get stage() { return this.run?.stage ?? null; }
  get stageDef() { return this.run ? this.stages[this.run.stageIndex] : null; }
  get width() { return this.stageDef?.width ?? 6; }
  save() { this.progress.save(); }

  multiplierFor(chain) { const c = this.cfg.chain; return Math.min(c.max, 1 + c.step * chain); }
  get multiplier() { return this.multiplierFor(this.stage?.chain ?? 0); }
  get heat() { return (this.multiplier - 1) / (this.cfg.chain.max - 1); }
  get isStuck() { return !!this.stage && refutePairs(this.stage.board, this.width).length === 0; }
  get inFever() { return !!this.stage?.fever; }
  get hintTier() {
    const h = this.cfg.hint, m = this.multiplier;
    if (this.inFever || m >= h.scopeFrom) return 'scope';
    if (m >= h.flashFrom) return 'flash';
    return 'hint';
  }
  feverRatio(now) {
    const f = this.stage?.fever;
    return f ? Math.max(0, Math.min(1, (f.until - now) / this.cfg.fever.durationMs)) : 0;
  }
  gaugeRatio(now) {
    const st = this.stage, c = this.cfg.chain;
    if (!st || st.chain <= 0 || st.lastRemoveAt === null) return 0;
    if (st.fever || this.relax) return 1;
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
    this.p.run = { stageIndex, score: 0, lives: this.cfg.lives.start, stage: null, maxChain: 0 };
    return this.startStage();
  }
  startStage() {
    const def = this.stageDef;
    const attempt = this.p.attempts[def.stage] ?? 0;
    const variant = def.boards[attempt % def.boards.length];
    this.run.stage = {
      board: variant.cells.slice(),
      shufflesLeft: def.shuffles, shufflesUsed: 0,
      hintsLeft: this.cfg.hint.perStage, hintsUsed: 0,
      chain: 0, stageScore: 0, selected: null,
      hintPair: null, flashUntil: null, scope: null,
      lastRemoveAt: null, decayed: 0, fever: null, status: 'play', maxChain: 0,
    };
    this.save();
    return [{ type: 'stageStart', stage: def.stage, stageIndex: this.run.stageIndex }];
  }
  resume(now) {
    const st = this.stage;
    if (!st || st.status !== 'play') return;
    if (st.fever) st.fever.until = now + this.cfg.fever.durationMs * 0.5;
    st.lastRemoveAt = st.chain > 0 ? now : null;
    st.decayed = 0; st.flashUntil = null;
    this.save();
  }

  tick(now) {
    const st = this.stage, cfg = this.cfg;
    if (!st || st.status !== 'play') return [];
    const events = [];
    if (st.flashUntil !== null && now >= st.flashUntil) { st.flashUntil = null; events.push({ type: 'flashEnd' }); }
    if (st.fever && now >= st.fever.until) {
      st.fever = null;
      st.chain = Math.floor(st.chain * cfg.fever.endChainRatio);
      st.lastRemoveAt = st.chain > 0 ? now : null;
      st.decayed = 0;
      events.push({ type: 'feverEnd', chain: st.chain, mult: this.multiplier });
    }
    if (!st.fever && !this.relax && st.chain > 0 && st.lastRemoveAt !== null) {
      const t = now - st.lastRemoveAt - cfg.chain.decayGraceMs;
      if (t > 0) {
        const steps = Math.floor(t / cfg.chain.decayStepMs) + 1 - st.decayed;
        if (steps > 0) {
          st.chain = Math.max(0, st.chain - steps);
          st.decayed += steps;
          events.push({ type: 'chainDecay', chain: st.chain, mult: this.multiplier, heat: this.heat });
          if (st.chain === 0) {
            st.lastRemoveAt = null;
            if (st.scope) { st.scope = null; events.push({ type: 'scopeEnd', reason: 'decay' }); }
          }
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
    const reason = !connected(b, this.width, i, j) ? 'position' : 'satisfiable';
    const events = [{ type: 'invalid', from: prev, to: pos, reason }, { type: 'select', pos }];
    if (st.scope && (st.scope.tile === i || st.scope.tile === j)) events.push(...this.scopeMiss());
    return events;
  }

  scopeMiss() {
    const st = this.stage, h = this.cfg.hint;
    st.scope.misses += 1;
    const before = st.chain;
    if (st.scope.misses === 1) {
      st.chain = Math.max(0, st.chain - h.scopeMissChain);
      this.save();
      return [{ type: 'scopeMiss', misses: 1, from: before, chain: st.chain, mult: this.multiplier }];
    }
    st.chain = Math.floor(st.chain * h.scopeBreakRatio);
    st.scope = null;
    this.save();
    return [{ type: 'scopeMiss', misses: 2, from: before, chain: st.chain, mult: this.multiplier }, { type: 'scopeEnd', reason: 'miss' }];
  }

  remove(i, j, now) {
    const st = this.stage, b = st.board, cfg = this.cfg, w = this.width;
    const before = b.map((c, p) => (p === i || p === j ? '' : c));
    const clearedRows = [];
    for (let r = 0; r * w < before.length; r++) {
      if (before.slice(r * w, (r + 1) * w).every((c) => c === '')) clearedRows.push(r);
    }
    const after = collapseRows(before, w);
    const events = [];

    const hinted = !!st.hintPair && st.hintPair[0] === i && st.hintPair[1] === j;
    let scoped = false, scopeBroken = false;
    if (st.scope) {
      if (st.scope.tile === i || st.scope.tile === j) scoped = true;
      else { scopeBroken = true; st.chain = Math.floor(st.chain * cfg.hint.scopeBreakRatio); }
      st.scope = null;
    }
    st.hintPair = null;

    const diff = refuteDifficulty(cfg.difficulty, w, i, j, b[i], b[j]);
    const elapsed = st.lastRemoveAt === null ? Infinity : now - st.lastRemoveAt;
    const speed = scoped || this.relax ? { tier: null, mult: 1 }
      : elapsed < cfg.speed.fastMs ? { tier: 'fast', mult: cfg.speed.fastMult }
        : elapsed < cfg.speed.quickMs ? { tier: 'quick', mult: cfg.speed.quickMult } : { tier: null, mult: 1 };
    st.lastRemoveAt = now; st.decayed = 0;
    const assisted = hinted || scoped;
    if (!assisted) st.chain += 1;
    st.maxChain = Math.max(st.maxChain ?? 0, st.chain);
    this.run.maxChain = Math.max(this.run.maxChain ?? 0, st.chain);
    const mult = this.multiplier;
    const feverMult = st.fever ? cfg.fever.pointMult : 1;
    const hintedRatio = hinted ? cfg.score.hintedPairRatio : 1;
    const pairPoints = Math.round(cfg.score.pairBase * diff.mult * mult * speed.mult * feverMult * hintedRatio);
    const rowPoints = Math.round(cfg.score.rowClear * clearedRows.length ** 2 * mult * feverMult);
    // VAR CLEAR: この 1 手で、ある変数を含む式が Board から消え切った
    const leftVars = new Set(vars(after.join('')));
    const varsCleared = vars(b[i] + b[j]).filter((v) => !leftVars.has(v));
    const varPoints = Math.round(cfg.score.varClear * varsCleared.length * mult * feverMult);
    const points = pairPoints + rowPoints + varPoints;
    st.stageScore += points; this.run.score += points;
    st.selected = null; st.board = after;

    const labels = [...diff.labels];
    if (scoped) labels.push('SCOPE');
    if (hinted) labels.push('HINTED');
    events.push({
      type: 'remove', i, j, a: b[i], b: b[j], points, pairPoints, rowPoints, varPoints, varsCleared, chain: st.chain, mult, heat: this.heat,
      clearedRows, board: after, labels, diffMult: diff.mult, speed: speed.tier, speedMult: speed.mult, fever: !!st.fever,
      hinted, scoped, scopeBroken,
    });
    if (scopeBroken) events.push({ type: 'scopeEnd', reason: 'ignored', chain: st.chain, mult: this.multiplier });
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
    st.selected = null; st.hintPair = null; st.scope = null; st.flashUntil = null;
    st.lastRemoveAt = st.chain > 0 ? now : null; st.decayed = 0;
    this.save();
    return [{ type: 'shuffle', board: st.board, stuckBefore: stuck, chainBefore, chainAfter: st.chain,
              multBefore: this.multiplierFor(chainBefore), multAfter: this.multiplier, shufflesLeft: st.shufflesLeft }];
  }

  payHint() {
    const st = this.stage, cfg = this.cfg;
    if (st.fever) { st.fever.until -= cfg.fever.hintTimeCostMs; st.hintsUsed += 1; return true; }
    if (st.hintsLeft <= 0) return false;
    st.hintsLeft -= 1; st.hintsUsed += 1;
    return true;
  }

  useHint(now = Date.now()) {
    const st = this.stage, cfg = this.cfg, h = cfg.hint;
    if (!st || st.status !== 'play') return [];
    const tier = this.hintTier;
    const pairs = refutePairs(st.board, this.width);
    st.selected = null;
    if (pairs.length === 0) {
      if (st.shufflesLeft <= 0) {
        const extra = Math.max(0, Math.min(this.run.score - st.stageScore, cfg.score.blindHintPenalty));
        this.run.score -= extra;
        const events = [{ type: 'noHint', penalty: st.stageScore + extra, blind: true, tier }];
        events.push(...this.stageFailed('blindHint', 0));
        this.save();
        return events;
      }
      if (!this.payHint()) return [{ type: 'noHints', tier }];
      const before = st.chain;
      st.chain = Math.floor(st.chain * h.stuckKeepRatio);
      st.scope = null; st.hintPair = null;
      const penalty = Math.min(st.stageScore, cfg.score.hintWhenStuck);
      st.stageScore -= penalty; this.run.score -= penalty;
      this.save();
      return [{ type: 'noHint', penalty, blind: false, tier, from: before, chain: st.chain, mult: this.multiplier, shufflesLeft: st.shufflesLeft, hintsLeft: st.hintsLeft }];
    }
    if (!this.payHint()) return [{ type: 'noHints', tier }];
    if (tier === 'hint') {
      st.hintPair = pairs[Math.floor(Math.random() * pairs.length)];
      this.save();
      return [{ type: 'hint', tier, pair: st.hintPair, hintsLeft: st.hintsLeft }];
    }
    if (tier === 'flash') {
      st.flashUntil = now + h.flashMs;
      if (st.chain > 0) { st.lastRemoveAt = now - cfg.chain.decayGraceMs * (1 - h.flashGaugeRatio); st.decayed = 0; }
      this.save();
      return [{ type: 'flash', tier, pairs, until: st.flashUntil, hintsLeft: st.hintsLeft }];
    }
    const count = new Map();
    for (const [a, c] of pairs) { count.set(a, (count.get(a) ?? 0) + 1); count.set(c, (count.get(c) ?? 0) + 1); }
    const tiles = [...count.entries()].sort((x, y) => x[1] - y[1]);
    const tile = tiles[Math.floor(Math.random() * Math.min(3, tiles.length))][0];
    st.scope = { tile, misses: 0 };
    this.save();
    return [{ type: 'scope', tier, tile, remaining: pairs.length, hintsLeft: st.hintsLeft, fever: !!st.fever }];
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
    const hintBonus = st.hintsLeft * cfg.score.hintSaved;
    const lifeGain = perfect && this.run.lives < cfg.lives.max ? cfg.lives.perfectRecover : 0;
    this.run.lives = Math.min(cfg.lives.max, this.run.lives + lifeGain);
    const bonusTotal = clearBonus + perfectBonus + savedBonus + hintBonus;
    this.run.score += bonusTotal; st.stageScore += bonusTotal;
    st.fever = null; st.scope = null; st.flashUntil = null; st.status = 'clear';
    const rank = this.rankFor(st.stageScore);
    this.p.stars[def.stage] = Math.max(this.p.stars[def.stage] ?? 0, stars);
    const prev = this.p.ranks[def.stage];
    if (!prev || RANKS.indexOf(rank) > RANKS.indexOf(prev)) this.p.ranks[def.stage] = rank;
    this.p.maxStage = Math.max(this.p.maxStage, this.run.stageIndex + 1);
    this.p.bestScore = Math.max(this.p.bestScore, this.run.score);
    this.save();
    return [{ type: 'stageClear', stage: def.stage, stars, rank, perfect, clearBonus, perfectBonus, savedBonus, hintBonus, lifeGain,
              stageScore: st.stageScore, playScore: st.stageScore - bonusTotal, score: this.run.score,
              shufflesUsed: st.shufflesUsed, shufflesLeft: st.shufflesLeft, hintsLeft: st.hintsLeft,
              maxMult: this.multiplierFor(st.maxChain ?? 0), runMaxMult: this.multiplierFor(this.run.maxChain ?? 0),
              isLast: this.run.stageIndex + 1 >= this.stages.length }];
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
    st.stageScore = 0; st.fever = null; st.scope = null; st.flashUntil = null;
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
    else if (deriveMoves(c.cells, this.width, c.goal).length === 0) events.push({ type: 'deadEnd', reason: 'noMoves' });
    else if (!goalReachable(c.cells, this.width, c.goal)) events.push({ type: 'deadEnd', reason: 'unreachable' });
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
