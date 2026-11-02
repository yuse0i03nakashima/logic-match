// 画面の描き直し(DOM)。「状態 → 見た目」の一方向。入力の処理は main.js。

import { pretty } from './logic.js';
import { heatColor } from './fx.js';

export class Renderer {
  constructor(root) {
    this.root = root;
    this.$ = (id) => root.querySelector('#' + id);
    this.board = this.$('board');
    this.boardWrap = this.$('board-wrap');
    this.cols = 6;
    addEventListener('resize', () => this.fitCells(this.cols));
  }

  // 列数と画面幅から 1 マスの大きさを決める。式が入るので横長
  fitCells(cols) {
    this.cols = cols;
    const gutter = 12 * 2, gap = 4 * (cols - 1);
    const avail = Math.min(innerWidth, 520) - gutter - gap;
    const w = Math.max(40, Math.min(cols <= 4 ? 96 : 68, Math.floor(avail / cols)));
    const h = Math.round(w * (cols <= 4 ? 0.72 : 0.82));
    const r = document.documentElement.style;
    r.setProperty('--cols', String(cols));
    r.setProperty('--cell-w', w + 'px');
    r.setProperty('--cell-h', h + 'px');
  }

  setHeat(heat) {
    document.documentElement.style.setProperty('--heat', heatColor(heat));
    document.documentElement.style.setProperty('--glow', heat.toFixed(2));
  }
  scoreCenter() {
    const r = this.$('hud-score').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  goalCenter() {
    const r = this.$('hud-goal-formula').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  renderBoard(cells, { selected = null, hintPair = null, hintMove = null, born = null, goalHit = null, flashPairs = null, scopeTile = null } = {}) {
    const flashSet = new Set();
    if (flashPairs) for (const [a, b] of flashPairs) { flashSet.add(a); flashSet.add(b); }
    const frag = document.createDocumentFragment();
    cells.forEach((c, p) => {
      const el = document.createElement('button');
      el.type = 'button';
      const text = c === '' ? '' : pretty(c);
      el.className = 'cell' + (c === '' ? ' empty' : ` len-${Math.min(6, Math.max(1, text.length))}`);
      el.dataset.pos = String(p);
      el.textContent = text;
      el.setAttribute('role', 'gridcell');
      if (c === '') el.tabIndex = -1;
      if (selected === p) el.classList.add('selected');
      if (hintPair && (hintPair[0] === p || hintPair[1] === p)) el.classList.add('hint');
      if (flashSet.has(p)) el.classList.add('flash');
      if (scopeTile === p) el.classList.add('scope');
      if (hintMove) { if (hintMove.i === p) el.classList.add('hint-from'); if (hintMove.j === p) el.classList.add('hint-to'); }
      if (born === p) el.classList.add('born');
      if (goalHit === p) el.classList.add('goal-hit');
      frag.appendChild(el);
    });
    this.board.replaceChildren(frag);
  }

  cellEl(pos) { return this.board.querySelector(`.cell[data-pos="${pos}"]`); }
  cellCenter(pos) {
    const el = this.cellEl(pos);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
  }
  rowRect(rowIndex) {
    const el = this.cellEl(rowIndex * this.cols);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { y: r.top, h: r.height };
  }
  selectCell(pos) {
    const el = this.cellEl(pos);
    if (!el) return;
    el.classList.remove('selected', 'squash'); void el.offsetWidth;
    el.classList.add('selected', 'squash');
  }
  markRemoving(...ps) { for (const p of ps) this.cellEl(p)?.classList.add('removing'); }
  markRowsRemoving(rowIndices) {
    for (const r of rowIndices) for (let p = r * this.cols; p < (r + 1) * this.cols; p++) this.cellEl(p)?.classList.add('removing');
  }
  shakeCell(pos) {
    const el = this.cellEl(pos);
    if (!el) return;
    el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake');
  }

  // ---------- HUD(モードで中身が変わる) ----------
  hudRefute(game, now = Date.now()) {
    const run = game.run, st = game.stage, def = game.stageDef;
    if (!run || !st || !def) return;
    this.$('hud-stage-label').textContent = `STAGE ${String(def.stage).padStart(2, '0')}`;
    this.$('hud-world-label').textContent = `refute · world ${game.worldOf(run.stageIndex) + 1}${game.relax ? ' · relax' : ''}`;
    this.$('hud-center-label').textContent = 'SCORE';
    this.$('hud-score').textContent = run.score.toLocaleString('en-US');
    this.$('hud-chain').hidden = false;
    this.$('hud-mult').textContent = `×${game.multiplier.toFixed(1)}`;
    this.$('hud-chain-fill').style.width = `${Math.round(game.heat * 100)}%`;
    this.setHeat(game.heat);
    const ratio = game.gaugeRatio(now);
    const gf = this.$('hud-gauge-fill');
    gf.style.width = `${Math.round(ratio * 100)}%`;
    gf.classList.toggle('low', ratio > 0 && ratio < 0.35 && !game.inFever);
    const fever = this.$('hud-fever');
    fever.hidden = !game.inFever;
    document.body.classList.toggle('fever', game.inFever);
    if (game.inFever) this.$('hud-fever-fill').style.width = `${Math.round(game.feverRatio(now) * 100)}%`;
    this.$('hud-goal').hidden = true;
    this.renderLives(run.lives, game.cfg.lives.max);
    // ボタン
    this.$('controls').classList.remove('four');
    this.$('btn-reset').hidden = true;
    this.renderHintButton(game);
    const btn = this.$('btn-action'), label = this.$('btn-action-label'), sub = this.$('btn-action-sub');
    if (st.shufflesLeft <= 0) {
      btn.classList.remove('ctl-primary'); btn.classList.add('ctl-danger');
      label.textContent = 'GIVE UP'; sub.textContent = 'Heart −1 · 得点は半分残る';
    } else {
      btn.classList.add('ctl-primary'); btn.classList.remove('ctl-danger');
      label.textContent = 'SHUFFLE';
      const dots = [];
      for (let k = 0; k < def.shuffles; k++) dots.push(`<span class="dot${k < st.shufflesLeft ? '' : ' off'}"></span>`);
      sub.innerHTML = `<span class="stock">${dots.join('')}</span>`;
    }
  }

  // HINT ボタン(REFUTE)。Chain 倍率で HINT / FLASH / SCOPE に変わり、残り使用回数を点で示す
  renderHintButton(game) {
    const st = game.stage, tier = game.hintTier;
    const btn = this.$('btn-hint'), label = this.$('btn-hint-label'), sub = this.$('btn-hint-sub');
    btn.classList.remove('tier-hint', 'tier-flash', 'tier-scope');
    btn.classList.add(`tier-${tier}`);
    label.textContent = tier.toUpperCase();
    if (game.inFever) { sub.textContent = `FEVER 時間 −${game.cfg.fever.hintTimeCostMs / 1000} 秒`; btn.disabled = false; return; }
    const dots = [];
    for (let k = 0; k < game.cfg.hint.perStage; k++) dots.push(`<span class="dot${k < st.hintsLeft ? '' : ' off'}"></span>`);
    sub.innerHTML = `<span class="stock">${dots.join('')}</span>`;
    btn.disabled = st.hintsLeft <= 0;
  }

  hudDerive(game) {
    const c = game.cur, def = game.stageDef;
    if (!c || !def) return;
    this.$('hud-stage-label').textContent = `STAGE ${String(def.stage).padStart(2, '0')}`;
    this.$('hud-world-label').textContent = `derive · world ${game.worldOf(c.stageIndex) + 1}`;
    this.$('hud-center-label').textContent = 'MOVES';
    this.$('hud-score').textContent = `${c.moves}`;
    this.$('hud-chain').hidden = true;
    this.$('hud-lives').innerHTML = '';
    this.$('hud-fever').hidden = true;
    document.body.classList.remove('fever');
    this.setHeat(Math.min(1, Math.max(0, (c.moves - c.par) / 4)));
    const g = this.$('hud-goal');
    g.hidden = false;
    this.$('hud-goal-formula').textContent = pretty(c.goal);
    this.$('hud-goal-moves').textContent = `par ${c.par}`;
    // ボタン: HINT / UNDO / RESET / MENU
    this.$('controls').classList.add('four');
    this.$('btn-reset').hidden = false;
    const hb = this.$('btn-hint');
    hb.classList.remove('tier-hint', 'tier-flash', 'tier-scope'); hb.disabled = false;
    this.$('btn-hint-label').textContent = 'HINT';
    this.$('btn-hint-sub').textContent = '次の 1 手を示す';
    const btn = this.$('btn-action'), label = this.$('btn-action-label'), sub = this.$('btn-action-sub');
    btn.classList.add('ctl-primary'); btn.classList.remove('ctl-danger');
    label.textContent = 'UNDO'; sub.textContent = c.history.length ? `${c.history.length} 手戻せる` : '—';
  }

  renderLives(lives, max, { lost = false, gained = false } = {}) {
    const hearts = [];
    for (let k = 0; k < max; k++) {
      let cls = 'heart' + (k < lives ? '' : ' off');
      if (lost && k === lives) cls += ' lost';
      if (gained && k === lives - 1) cls += ' gain';
      hearts.push(`<span class="${cls}">♥</span>`);
    }
    this.$('hud-lives').innerHTML = hearts.join('');
  }

  bumpScore() { const el = this.$('hud-score'); el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
  toast(text, ms = 1800) {
    const el = this.$('toast');
    el.textContent = text; el.hidden = false; el.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => el.classList.remove('show'), ms);
  }
  showOverlay(html) { const ov = this.$('overlay'); this.$('overlay-card').innerHTML = html; ov.hidden = false; return this.$('overlay-card'); }
  hideOverlay() { this.$('overlay').hidden = true; }
  animateStars(card, count) {
    card.querySelectorAll('.star').forEach((s, k) => {
      setTimeout(() => { s.classList.add('show'); if (k < count) s.classList.add('on'); }, 250 + k * 260);
    });
  }
}
