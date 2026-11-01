-- | DERIVE モード: 2 枚のタイルに推論規則を当てて結論のタイルに合体させ、Goal の式を作る。
--   規則の判定・1 手の適用・幅優先探索(最短手数 par)・面の生成。
module Logic.Derive
  ( width
  , height
  , Rule(..)
  , ruleName
  , derive
  , andE
  , Move(..)
  , legalMoves
  , applyMove
  , reaches
  , replay
  , bfs
  , reachableStates
  , deadEndFree
  , trapCount
  , DStage(..)
  , dstageSpec
  , Derivation(..)
  , buildDerivation
  , DBoard(..)
  , findStage
  ) where

import qualified Data.Set as Set
import Logic.Prop
import Logic.Grid
import Logic.Random

-- | DERIVE のボードは 4 × 4 で固定。
width, height :: Int
width  = 4
height = 4

-- | 推論規則。(第7章: 列挙型。Enum と Bounded で全部の規則を列挙できる)
data Rule = MP | MT | DS | ANDI | BOT | ANDE
  deriving (Eq, Ord, Show, Enum, Bounded)

-- | JSON に書く規則名。
ruleName :: Rule -> String
ruleName = show

-- | 2 枚の規則。goal のもとで、先にタップした x とあとにタップした y から結論を出す。
--   X と Y の順序は問わない。複数当てはまるときは表の上(MP > MT > DS > ∧I > ⊥)を優先。
--   一致は構文上の完全一致(!!p と p は別物)。
derive :: Prop -> Prop -> Prop -> Maybe (Rule, Prop)
derive goal x y = firstJust [both mp, both mt, both ds, andI, both bot]
  where
    -- x, y の両方の順序で試す
    both f = case f x y of
      Nothing -> f y x
      r       -> r

    -- MP: A と A→B から B
    mp a (Imp a' b) | a == a' = Just (MP, b)
    mp _ _ = Nothing

    -- MT: ¬B と A→B から ¬A
    mt (Not b) (Imp a b') | b == b' = Just (MT, Not a)
    mt _ _ = Nothing

    -- DS: ¬A と A∨B から B、¬B と A∨B から A
    ds (Not a) (Or l r)
      | a == l = Just (DS, r)
      | a == r = Just (DS, l)
    ds _ _ = Nothing

    -- ∧I: A∧B または B∧A が Goal の部分式のときだけ。Goal に現れる側の順序で。
    andI
      | And x y `elem` subs = Just (ANDI, And x y)
      | And y x `elem` subs = Just (ANDI, And y x)
      | otherwise           = Nothing
    subs = subformulas goal

    -- ⊥: A と ¬A から ⊥。Goal が ⊥ のときだけ。
    bot a (Not a') | goal == Bot && a == a' = Just (BOT, Bot)
    bot _ _ = Nothing

firstJust :: [Maybe a] -> Maybe a
firstJust ms = case [x | Just x <- ms] of
  (x : _) -> Just x
  []      -> Nothing

-- | ∧E: 位置 i の A∧B を、i に A、読み順で最初の空マスに B として分ける。
--   空マスがなければ、または i が ∧ でなければ Nothing。
andE :: Board -> Pos -> Maybe Board
andE b i = case cellAt b i of
  Tile (And a c) -> case [k | (k, Empty) <- zip [0 ..] b] of
    (k : _) -> Just (setCell k (Tile c) (setCell i (Tile a) b))
    []      -> Nothing
  _ -> Nothing

setCell :: Pos -> Cell -> Board -> Board
setCell k c b = [if p == k then c else x | (p, x) <- zip [0 ..] b]

-- | 1 手。2 枚の規則は (規則, i, j)。1 枚の規則 ∧E は i = j。
data Move = Move Rule Pos Pos
  deriving (Eq, Ord, Show)

-- | いま打てる手と、その結果のボード。順序は読み順で決まる(BFS の結果を一意にする)。
legalMoves :: Prop -> Board -> [(Move, Board)]
legalMoves goal b =
  [ (Move r i j, setCell j (Tile res) (setCell i Empty b))
  | (i, x) <- ts
  , (j, y) <- ts
  , i /= j
  , connected width b i j
  , Just (r, res) <- [derive goal x y]
  ] ++
  [ (Move ANDE i i, b')
  | (i, And _ _) <- ts
  , Just b' <- [andE b i]
  ]
  where ts = tiles b

-- | 1 手を検証しながら適用する(検証・再生用)。規則名が合わなければ Nothing。
applyMove :: Prop -> Move -> Board -> Maybe Board
applyMove goal m b = case [b' | (m', b') <- legalMoves goal b, m' == m] of
  (b' : _) -> Just b'
  []       -> Nothing

-- | Clear か: いずれかのタイルが Goal と一致。
reaches :: Prop -> Board -> Bool
reaches goal b = any ((== goal) . snd) (tiles b)

-- | 手順を順に適用する(検証用)。途中で不正な手があれば Nothing。
--   (第12章: Maybe を foldl で連鎖させる)
replay :: Prop -> Board -> [Move] -> Maybe Board
replay goal = foldl step . Just
  where
    step acc m = acc >>= applyMove goal m

-- | 幅優先探索で Goal への最短手順を求める。maxDepth 手以内に届かなければ Nothing。
--   状態 = ボードの 16 要素。訪問済みは Data.Set で記憶する(Number Match の Solver と同じ)。
bfs :: Int -> Prop -> Board -> Maybe [Move]
bfs maxDepth goal b0
  | reaches goal b0 = Just []
  | otherwise       = go 0 (Set.singleton b0) [(b0, [])]
  where
    -- 1 段ぶん展開する。Goal に届いたらその手順(Left)、届かなければ次の段(Right)。
    go depth seen frontier
      | depth >= maxDepth || null frontier = Nothing
      | Set.size seen > nodeCap            = Nothing
      | otherwise = case expand seen [] frontier of
          Left sol             -> Just sol
          Right (seen', next)  -> go (depth + 1) seen' (reverse next)

    expand seen acc [] = Right (seen, acc)
    expand seen acc ((b, path) : rest) =
      case children seen acc (legalMoves goal b) of
        Left sol              -> Left sol
        Right (seen', acc')   -> expand seen' acc' rest
      where
        children s a [] = Right (s, a)
        children s a ((m, b') : ms)
          | reaches goal b'    = Left (reverse (m : path))
          | Set.member b' s    = children s a ms
          | otherwise          = children (Set.insert b' s) ((b', m : path) : a) ms

    nodeCap = 60000 :: Int

-- | 初期ボードから到達できる状態をすべて集める(Goal に届いた状態からは先へ進まない)。
--   ボードは 16 マス・タイル 9 枚以下なので、状態は多くても数百。上限を超えたら Nothing。
reachableStates :: Int -> Prop -> Board -> Maybe (Set.Set Board)
reachableStates cap goal b0 = go (Set.singleton b0) [b0]
  where
    go seen [] = Just seen
    go seen (b : rest)
      | Set.size seen > cap = Nothing
      | reaches goal b      = go seen rest
      | otherwise =
          let kids = [b' | (_, b') <- legalMoves goal b, not (Set.member b' seen)]
          in go (foldr Set.insert seen kids) (rest ++ kids)

-- | 行き止まりが無いか: 到達できるどの状態からも Goal に届く。
--   「生きている状態」を Goal の状態から逆向きに広げ、全状態が生きていれば True。
--   (不動点の計算。生きている集合が増えなくなるまで繰り返す)
deadEndFree :: Prop -> Board -> Bool
deadEndFree goal b0 = case reachableStates 3000 goal b0 of
  Nothing  -> False
  Just all' ->
    let states = Set.toList all'
        live0  = Set.fromList [b | b <- states, reaches goal b]
        step live = Set.fromList [b | b <- states, reaches goal b || any (`Set.member` live) (map snd (legalMoves goal b))]
        fix live = let live' = step live in if live' == live then live else fix live'
    in Set.size (fix live0) == length states

-- | 初手のうち、Goal に届かなくなる手の数(後半ステージの難しさの目安)。
trapCount :: Prop -> Board -> Int
trapCount goal b0 = length [() | (_, b') <- legalMoves goal b0, bfs 8 goal b' == Nothing]

-- | DERIVE のステージ設定。
data DStage = DStage
  { dStage   :: Int
  , dRules   :: [Rule]     -- ^ 導出を作るときに使ってよい規則
  , dVars    :: [Char]
  , dParLo   :: Int        -- ^ par の範囲
  , dParHi   :: Int
  , dBotGoal :: Bool       -- ^ Goal を ⊥ にする面か
  }

-- | ステージ番号 → 設定(SPEC 4.2 の表)。⊥ を Goal にするのは Stage 17 と 19。
dstageSpec :: Int -> DStage
dstageSpec n
  | n <= 5    = DStage n [MP] "pq" 2 3 False
  | n <= 10   = DStage n [MP, MT, DS] "pq" 3 4 False
  | n <= 15   = DStage n [MP, MT, DS, ANDE, ANDI] (if n <= 12 then "pq" else "pqr") 3 5 False
  | otherwise = DStage n [minBound .. maxBound] "pqr" 4 6 (odd n)

-- | 前向きに作った導出。葉(前提)と Goal。
data Derivation = Derivation
  { dLeaves :: [Prop]
  , dGoal   :: Prop
  , dSteps  :: Int        -- ^ 導出そのものの手数(∧E を含む)
  }

literalsOf :: [Char] -> [Prop]
literalsOf vs = concat [[Var v, Not (Var v)] | v <- vs]

varOf :: Prop -> Char
varOf (Var v)       = v
varOf (Not (Var v)) = v
varOf _             = '?'

isNegVar :: Prop -> Bool
isNegVar (Not (Var _)) = True
isNegVar _             = False

-- | 導出を 1 本の鎖として作る: 現在の結論 C と新しい前提 P に規則を当て、次の結論を得る。
--   * MP: C と C→B から B。    * MT: ¬B と A→B から ¬A。   * DS: ¬A と A∨B から B。
--   * ∧I は最後の 1 手だけ(結論が Goal の部分式でないと使えないため)。
--   * ⊥ は Goal を ⊥ にする面の最後の 1 手。
--   * ∧E: 前提 P を P∧X の形で置き、まず分ける手を 1 手ぶん数える。
--   手数は par の範囲から選ぶ。Goal が前提と一致したら Nothing(呼び出し側で次のシードへ)。
buildDerivation :: DStage -> Seed -> Maybe (Derivation, Seed)
buildDerivation spec s0 = chain used0 c0 [leaf0] s3
  where
    lits        = literalsOf (dVars spec)
    (k, s1)     = randInt s0 (dParHi spec - dParLo spec + 1)
    total       = dParLo spec + k
    (c0, s2)    = pick s1 lits
    (leaf0, used0, s3) = wrap c0 0 s2

    canUse r = r `elem` dRules spec
    reserve  = if dBotGoal spec then 1 else 0

    -- 前提 P を P∧X に包む(∧E を使わせる)。残り手数が足りるときだけ、4 割の確率で。
    wrap :: Prop -> Int -> Seed -> (Prop, Int, Seed)
    wrap p used s
      | canUse ANDE && total - used >= 2 + reserve && doWrap =
          let (x, s')       = pick sw (filter ((/= varOf p) . varOf) lits)
              (flipIt, s'') = chance s' 50
          in (if flipIt then And x p else And p x, used + 1, s'')
      | otherwise = (p, used, sw)
      where
        (doWrap, sw) = chance s 40

    -- 残り手数がなくなったら Goal を確定する。
    chain :: Int -> Prop -> [Prop] -> Seed -> Maybe (Derivation, Seed)
    chain used c leaves s
      | used >= total =
          if c `elem` leaves || any (containsGoal c) leaves
            then Nothing
            else Just (Derivation (reverse leaves) c total, s)
      | dBotGoal spec && used == total - 1 =
          -- 最後の 1 手は ⊥: C と ¬C(C が ¬A なら A)
          let p = case c of
                    Not a -> a
                    _     -> Not c
          in chain (used + 1) Bot (p : leaves) s
      | otherwise =
          let options = [MP]
                     ++ [MT | canUse MT, isNegVar c]
                     ++ [DS | canUse DS, isNegVar c]
                     ++ [ANDI | canUse ANDI, used == total - 1, not (dBotGoal spec)]
              (r, s1') = pick s options
              others   = filter ((/= varOf c) . varOf) lits
          in case (r, c) of
               (MP, _) ->
                 let (b, s2')        = pick s1' others
                     (p, used', s3') = wrap (Imp c b) (used + 1) s2'
                 in chain used' b (p : leaves) s3'
               (MT, Not v) ->
                 let (a, s2')        = pick s1' (filter positive others)
                     (p, used', s3') = wrap (Imp a v) (used + 1) s2'
                 in chain used' (Not a) (p : leaves) s3'
               (DS, Not v) ->
                 let (b, s2')        = pick s1' others
                     (flipIt, s3')   = chance s2' 50
                     disj            = if flipIt then Or b v else Or v b
                     (p, used', s4') = wrap disj (used + 1) s3'
                 in chain used' b (p : leaves) s4'
               (ANDI, _) ->
                 let (b, s2')      = pick s1' others
                     (flipIt, s3') = chance s2' 50
                     conj          = if flipIt then And b c else And c b
                 in chain (used + 1) conj (b : leaves) s3'
               _ -> Nothing

    positive (Var _) = True
    positive _       = False

    -- 包んだ前提 P∧X の中に Goal がそのまま入っていると ∧E 1 手で終わってしまう
    containsGoal g (And a b) = a == g || b == g
    containsGoal _ _         = False

-- | 採用したボード。
data DBoard = DBoard
  { bSeed     :: Seed
  , bCells    :: Board
  , bPar      :: Int
  , bSolution :: [Move]
  }

-- | 邪魔タイルの候補: リテラル、異なる変数のリテラルどうしの → ∨(∧E 以降は ∧ も)。
distractorVocab :: DStage -> [Prop]
distractorVocab spec =
  lits ++ [op a b | op <- ops, a <- lits, b <- lits, varOf a /= varOf b]
  where
    lits = literalsOf (dVars spec)
    ops  = [Imp, Or] ++ [And | ANDE `elem` dRules spec]

-- | 邪魔タイルとして置けるか: Goal と一致せず、いまのタイルのどれとも 1 手で Goal を作らない。
distractorOk :: Prop -> [Prop] -> Prop -> Bool
distractorOk goal present d =
  d /= goal
    && not (oneStep d)
    && all (\t -> fmap snd (derive goal d t) /= Just goal) present
  where
    oneStep (And a b) = a == goal || b == goal
    oneStep _         = False

-- | 葉と邪魔タイルを 4×4 に置き、BFS で par を求める。範囲に入らなければ Nothing。
placeBoard :: DStage -> Derivation -> Seed -> Maybe DBoard
placeBoard spec d seed
  | nLeaves > 9 || dMin > dMax = Nothing
  | otherwise = case bfs 8 goal board of
      Just sol
        | length sol >= dParLo spec && length sol <= dParHi spec && safeEnough ->
            Just (DBoard seed board (length sol) sol)
      _ -> Nothing
  where
    goal     = dGoal d
    leaves   = dLeaves d
    -- Stage 1〜10 は行き止まりの無い面だけ(どの順で進めても Goal に届く)。
    -- Stage 11 以降は行き止まりを許すが、初手の半分以上が罠になる面は採らない。
    safeEnough
      | dStage spec <= 10 = deadEndFree goal board
      | otherwise         = 2 * trapCount goal board < length (legalMoves goal board)
    nLeaves  = length leaves
    dMin     = max 0 (5 - nLeaves)
    dMax     = min 3 (9 - nLeaves)
    (nd, s1) = randInt seed (dMax - dMin + 1)
    (ds, s2) = distractors (dMin + nd) leaves s1
    (positions, _) = shuffle s2 [0 .. width * height - 1]
    placed   = zip positions (leaves ++ ds)
    board    = [maybe Empty Tile (lookup p placed) | p <- [0 .. width * height - 1]]

    distractors :: Int -> [Prop] -> Seed -> ([Prop], Seed)
    distractors 0 _ s = ([], s)
    distractors n present s =
      case filter (distractorOk goal present) (distractorVocab spec) of
        []    -> ([], s)
        cands -> let (x, s')     = pick s cands
                     (rest, s'') = distractors (n - 1) (x : present) s'
                 in (x : rest, s'')

-- | 1 ステージ = 1 本の導出(同じ Goal)を 3 枚のボードに配置したもの。
--   導出を作り、3 枚とも配置に成功するまでシードを進める。
findStage :: DStage -> Seed -> (Derivation, [DBoard])
findStage spec seed =
  case buildDerivation spec seed of
    Just (d, s') | Just boards <- allBoards d s' 0 -> (d, boards)
    _ -> findStage spec (nextSeed seed)
  where
    variantCount = 3 :: Int
    allBoards d s k
      | k >= variantCount = Just []
      | otherwise = do
          (b, s') <- tryPlace d s (30 :: Int)
          rest    <- allBoards d s' (k + 1)
          return (b : rest)
    tryPlace :: Derivation -> Seed -> Int -> Maybe (DBoard, Seed)
    tryPlace _ _ 0 = Nothing
    tryPlace d s n = case placeBoard spec d s of
      Just b  -> Just (b, nextSeed s)
      Nothing -> tryPlace d (nextSeed s) (n - 1)
