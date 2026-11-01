// 命題論理の式と、その意味(generator/src/Logic/Prop.hs・Grid.hs・Derive.hs の移植)。
// 正本は Haskell 側。関数名と意味をそろえ、web/test/logic.test.js でベクタとの一致を確かめる。
//
// 式は prefix 記法の文字列で持ち回る(docs/SPEC.md 1.1)。
//   p q r … 変数   F … ⊥   !X … ¬X   &XY … X∧Y   |XY … X∨Y   >XY … X→Y
// 構文木が要るときだけ parse して { type, ... } にする。

// ---------- 構文 ----------

/** prefix 文字列 → 構文木。残りの文字列も返す(再帰下降)。 */
function parseAt(s, k) {
  const c = s[k];
  if (c === undefined) throw new Error(`式が途中で終わっている: ${s}`);
  if (c === 'p' || c === 'q' || c === 'r') return [{ type: 'var', name: c }, k + 1];
  if (c === 'F') return [{ type: 'bot' }, k + 1];
  if (c === '!') { const [a, k2] = parseAt(s, k + 1); return [{ type: 'not', a }, k2]; }
  if (c === '&' || c === '|' || c === '>') {
    const [a, k2] = parseAt(s, k + 1);
    const [b, k3] = parseAt(s, k2);
    return [{ type: c === '&' ? 'and' : c === '|' ? 'or' : 'imp', a, b }, k3];
  }
  throw new Error(`知らない記号 ${c} in ${s}`);
}

export function parse(s) {
  const [t, k] = parseAt(s, 0);
  if (k !== s.length) throw new Error(`余りがある: ${s}`);
  return t;
}

/** 構文木 → prefix 文字列。 */
export function show(t) {
  switch (t.type) {
    case 'var': return t.name;
    case 'bot': return 'F';
    case 'not': return '!' + show(t.a);
    case 'and': return '&' + show(t.a) + show(t.b);
    case 'or': return '|' + show(t.a) + show(t.b);
    case 'imp': return '>' + show(t.a) + show(t.b);
    default: throw new Error('unknown node');
  }
}

const OPS = { and: '∧', or: '∨', imp: '→' };
const isBinary = (t) => t.type === 'and' || t.type === 'or' || t.type === 'imp';

/** 表示用(SPEC 1.2)。2 項の中の 2 項だけ括弧で囲む。 */
export function pretty(s) {
  const go = (t) => {
    switch (t.type) {
      case 'var': return t.name;
      case 'bot': return '⊥';
      case 'not': return '¬' + (isBinary(t.a) ? `(${go(t.a)})` : go(t.a));
      default: {
        const wrap = (u) => (isBinary(u) ? `(${go(u)})` : go(u));
        return wrap(t.a) + OPS[t.type] + wrap(t.b);
      }
    }
  };
  return go(typeof s === 'string' ? parse(s) : s);
}

/** 式に現れる変数(重複なし、p q r の順)。 */
export function vars(s) {
  const set = new Set();
  for (const c of s) if (c === 'p' || c === 'q' || c === 'r') set.add(c);
  return ['p', 'q', 'r'].filter((v) => set.has(v));
}

// ---------- 意味 ----------

/** 割り当て env({p:true,...}) のもとで式を評価する。 */
export function evaluate(t, env) {
  switch (t.type) {
    case 'var': return !!env[t.name];
    case 'bot': return false;
    case 'not': return !evaluate(t.a, env);
    case 'and': return evaluate(t.a, env) && evaluate(t.b, env);
    case 'or': return evaluate(t.a, env) || evaluate(t.b, env);
    case 'imp': return !evaluate(t.a, env) || evaluate(t.b, env);
    default: throw new Error('unknown node');
  }
}

/** 式の集合を同時に真にする割り当てがあるか(変数の全組み合わせを試す)。 */
export function sat(formulas) {
  const trees = formulas.map((f) => (typeof f === 'string' ? parse(f) : f));
  const vs = vars(formulas.map((f) => (typeof f === 'string' ? f : show(f))).join(''));
  const n = vs.length;
  for (let bits = 0; bits < 1 << n; bits++) {
    const env = {};
    vs.forEach((v, k) => { env[v] = !!(bits & (1 << k)); });
    if (trees.every((t) => evaluate(t, env))) return true;
  }
  return false;
}

/** 2 つの式が同時に真にできない(= 合わせると矛盾する)か。REFUTE の「消せる組」。 */
export function unsat2(a, b) {
  return !sat([a, b]);
}

// ---------- 位置 ----------

/**
 * 添字 i と j がつながっているか(SPEC 2)。同じ行・列・正確な斜めの直線上で、間がすべて空。
 * 行の右端と次の行の左端はつながらない。
 */
export function connected(cells, width, i, j) {
  if (i === j) return false;
  const ri = Math.floor(i / width), ci = i % width;
  const rj = Math.floor(j / width), cj = j % width;
  const dr = rj - ri, dc = cj - ci;
  if (!(dr === 0 || dc === 0 || Math.abs(dr) === Math.abs(dc))) return false;
  const sr = Math.sign(dr), sc = Math.sign(dc);
  let r = ri + sr, c = ci + sc;
  while (r !== rj || c !== cj) {
    if (cells[r * width + c] !== '') return false;
    r += sr; c += sc;
  }
  return true;
}

/** 幅 width の行に切り分ける。 */
export function rows(cells, width) {
  const out = [];
  for (let p = 0; p < cells.length; p += width) out.push(cells.slice(p, p + width));
  return out;
}

/** 全部空の行を取り除く(REFUTE)。 */
export function collapseRows(cells, width) {
  return rows(cells, width).filter((row) => !row.every((c) => c === '')).flat();
}

// ---------- DERIVE の規則(SPEC 4.1) ----------

/** s が t の部分式か(t 自身を含む)。 */
export function isSubformula(s, t) {
  const target = parse(s);
  const walk = (u) => {
    if (show(u) === show(target)) return true;
    if (u.type === 'not') return walk(u.a);
    if (isBinary(u)) return walk(u.a) || walk(u.b);
    return false;
  };
  return walk(typeof t === 'string' ? parse(t) : t);
}

/**
 * 2 枚の規則。x と y(prefix 文字列)に当てはまる規則と結論を返す。順序は問わない。
 * 返り値: { rule: 'MP'|'MT'|'DS'|'ANDI'|'BOT', result } か null。
 */
export function applyRule(goal, x, y) {
  const tx = parse(x), ty = parse(y);
  const tryOrdered = (a, ta, b, tb) => {
    // MP: A, A→B ⊢ B
    if (tb.type === 'imp' && show(tb.a) === a) return { rule: 'MP', result: show(tb.b) };
    // MT: ¬B, A→B ⊢ ¬A
    if (tb.type === 'imp' && ta.type === 'not' && show(ta.a) === show(tb.b)) return { rule: 'MT', result: '!' + show(tb.a) };
    // DS: ¬A, A∨B ⊢ B / ¬B, A∨B ⊢ A
    if (tb.type === 'or' && ta.type === 'not') {
      if (show(ta.a) === show(tb.a)) return { rule: 'DS', result: show(tb.b) };
      if (show(ta.a) === show(tb.b)) return { rule: 'DS', result: show(tb.a) };
    }
    return null;
  };
  const r = tryOrdered(x, tx, y, ty) ?? tryOrdered(y, ty, x, tx);
  if (r) return r;
  // ∧I: A, B ⊢ A∧B(Goal の部分式のときだけ。Goal に現れる順序で)
  if (isSubformula('&' + x + y, goal)) return { rule: 'ANDI', result: '&' + x + y };
  if (isSubformula('&' + y + x, goal)) return { rule: 'ANDI', result: '&' + y + x };
  // ⊥: A, ¬A ⊢ ⊥(Goal が ⊥ のときだけ)
  if (goal === 'F' && (y === '!' + x || x === '!' + y)) return { rule: 'BOT', result: 'F' };
  return null;
}

/**
 * ∧E: 位置 i の A∧B を A と B に分ける。A はその場、B は読み順で最初の空マス。
 * 空マスが無い、または A∧B でなければ null。
 */
export function andE(cells, i) {
  const t = parse(cells[i]);
  if (t.type !== 'and') return null;
  const empty = cells.indexOf('');
  if (empty < 0) return null;
  const out = cells.slice();
  out[i] = show(t.a);
  out[empty] = show(t.b);
  return out;
}

/** REFUTE: いま消せる組の一覧 [[i, j], ...]。 */
export function refutePairs(cells, width) {
  const out = [];
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] === '') continue;
    for (let j = i + 1; j < cells.length; j++) {
      if (cells[j] === '') continue;
      if (connected(cells, width, i, j) && unsat2(cells[i], cells[j])) out.push([i, j]);
    }
  }
  return out;
}

/** 1 手を適用した結果の Board(deriveMoves が返す手に対して)。 */
export function applyMove(cells, move) {
  if (move.rule === 'ANDE') return andE(cells, move.i);
  const out = cells.slice();
  out[move.j] = move.result;
  out[move.i] = '';
  return out;
}

/**
 * いまの Board から Goal に届く手順があるか(幅優先探索、maxDepth 手まで)。
 * 行き止まりに入ったことをプレイヤーに知らせるために使う。
 */
export function goalReachable(cells, width, goal, maxDepth = 8) {
  if (cells.includes(goal)) return true;
  const seen = new Set([cells.join('|')]);
  let frontier = [cells];
  for (let depth = 0; depth < maxDepth && frontier.length; depth++) {
    const next = [];
    for (const c of frontier) {
      for (const m of deriveMoves(c, width, goal)) {
        const n = applyMove(c, m);
        if (n.includes(goal)) return true;
        const key = n.join('|');
        if (!seen.has(key)) { seen.add(key); next.push(n); }
      }
    }
    frontier = next;
  }
  return false;
}

/** DERIVE: いま使える手の一覧 [{rule, i, j, result}]。 */
export function deriveMoves(cells, width, goal) {
  const out = [];
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] === '') continue;
    if (andE(cells, i)) out.push({ rule: 'ANDE', i, j: i, result: null });
    for (let j = 0; j < cells.length; j++) {
      if (j === i || cells[j] === '') continue;
      if (!connected(cells, width, i, j)) continue;
      const r = applyRule(goal, cells[i], cells[j]);
      if (r) out.push({ rule: r.rule, i, j, result: r.result });
    }
  }
  return out;
}
