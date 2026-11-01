-- | REFUTE モード: 2 枚のタイルが矛盾する(同時に真にできない)なら消える。
--   組の判定・ソルバ(深さ優先探索)・面の生成。
--   ソルバは Number Match の Solver と同じ構造(訪問済み集合とノード予算)。
module Logic.Refute
  ( width
  , Move
  , StageSpec(..)
  , stageSpec
  , vocabGroups
  , vocabulary
  , validPairs
  , validPairsWith
  , applyMove
  , replay
  , solve
  , noIsolated
  , randomBoard
  , Found(..)
  , findBoard
  ) where

import qualified Data.Map as Map
import qualified Data.Sequence as Seq
import qualified Data.Set as Set
import Data.List (sortOn)
import Logic.Prop
import Logic.Grid
import Logic.Random

-- | REFUTE のボードの幅。
width :: Int
width = 6

-- | 1 手 = 消す 2 マスの位置 (i < j)。
type Move = (Pos, Pos)

-- | ステージの設定。
data StageSpec = StageSpec
  { specStage    :: Int               -- ^ ステージ番号(1 始まり)
  , specRows     :: Int               -- ^ 行数(タイル数 = 行数 × 幅)
  , specShuffles :: Int               -- ^ SHUFFLE の回数
  , specGroups   :: [(Int, [Prop])]   -- ^ 語彙。(重み, 式の候補) のグループ
  }

-- | ステージ番号 → 設定(SPEC 3.1 の表)。
stageSpec :: Int -> StageSpec
stageSpec n = StageSpec n rowsN shuffles (vocabGroups n)
  where
    rowsN
      | n <= 10   = 3
      | n <= 20   = 4
      | otherwise = 5
    shuffles
      | n <= 15   = 2
      | otherwise = 1

-- | ステージごとの語彙。重み付きのグループに分けておき、
--   「リテラル」「深さ 1」「深さ 2」が偏りすぎないように選ぶ。
--   トートロジーと矛盾式は除く(矛盾式は何とでも消えてしまう)。
vocabGroups :: Int -> [(Int, [Prop])]
vocabGroups n
  | n <= 5    = [(1, literals "pqr")]
  | n <= 10   = [ (3, literals "pq")
                , (4, depth1 [And, Or] "pq")
                , (2, map Not (depth1 [And, Or] "pq")) ]
  | n <= 15   = [ (3, literals "pq")
                , (4, depth1 allOps "pq")
                , (2, map Not (depth1 allOps "pq")) ]
  | otherwise = [ (3, literals "pqr")
                , (3, depth1 allOps "pqr")
                , (2, map Not (depth1 allOps "pqr"))
                , (3, depth2 "pqr") ]

-- | 語彙を 1 本のリストにしたもの(テストや相手探しに使う)。
vocabulary :: StageSpec -> [Prop]
vocabulary = concatMap snd . specGroups

allOps :: [Prop -> Prop -> Prop]
allOps = [And, Or, Imp]

-- | リテラル: 変数とその否定。
literals :: [Char] -> [Prop]
literals vs = concat [[Var v, Not (Var v)] | v <- vs]

-- | リテラルの変数。
varOf :: Prop -> Char
varOf (Var v)       = v
varOf (Not (Var v)) = v
varOf _             = '?'

-- | 深さ 1: 異なる変数のリテラル 2 つを結合子でつないだもの(&p!q など)。
depth1 :: [Prop -> Prop -> Prop] -> [Char] -> [Prop]
depth1 ops vs = healthy
  [op a b | op <- ops, a <- literals vs, b <- literals vs, varOf a /= varOf b]

-- | 深さ 2: 1 つの変数のリテラルと、残り 2 変数の深さ 1 の式をつないだもの(>&pqr など)。
depth2 :: [Char] -> [Prop]
depth2 vs = healthy
  [ f
  | v <- vs
  , lit <- literals [v]
  , inner <- depth1 allOps (filter (/= v) vs)
  , op <- allOps
  , f <- [op lit inner, op inner lit]
  ]

-- | トートロジーと矛盾式を除く。
healthy :: [Prop] -> [Prop]
healthy = filter (\f -> not (tautology f) && not (contradiction f))

-- | いま消せる組の一覧(i < j): つながっていて、かつ unsat2。
--   (第4章 リスト内包表記: 2 重の生成器とガード)
validPairs :: Board -> [Move]
validPairs = validPairsWith unsat2

-- | 組の判定関数を差し替えられる版(ソルバは表を引く速い判定を渡す)。
validPairsWith :: (Prop -> Prop -> Bool) -> Board -> [Move]
validPairsWith clash b =
  [ (i, j)
  | (i, a) <- tiles b
  , (j, c) <- visibleFrom sq i
  , clash a c
  ]
  where sq = Seq.fromList b

-- | 位置 i から見える(間が全部空の)最初のタイルを、読み順で後ろ向きの 4 方向
--   (右、下、左下、右下)について集める。i < j の組はこの 4 方向で尽きるので、
--   全部の j について connected を調べるより速い。結果は connected と一致する。
visibleFrom :: Seq.Seq Cell -> Pos -> [(Pos, Prop)]
visibleFrom sq i = concatMap walk [(0, 1), (1, 0), (1, -1), (1, 1)]
  where
    n        = Seq.length sq
    (ri, ci) = i `divMod` width
    walk (dr, dc) = go (ri + dr) (ci + dc)
      where
        go r c
          | c < 0 || c >= width || p >= n = []
          | otherwise = case Seq.index sq p of
              Tile f -> [(p, f)]
              Empty  -> go (r + dr) (c + dc)
          where p = r * width + c

-- | 2 マスを空にし、空になった行を取り除く。
applyMove :: Move -> Board -> Board
applyMove (i, j) b =
  collapseRows width [if p == i || p == j then Empty else c | (p, c) <- zip [0 ..] b]

-- | 手順をボードに順に適用する(検証用)。(第6章 高階関数: foldl)
replay :: Board -> [Move] -> Board
replay = foldl (flip applyMove)

-- | 一度調べたボードの集合。同じ状態を二度調べない。
type Visited = Set.Set Board

-- | budget ノード以内で全消し手順を探す(深さ優先探索)。
--   unsat2 の判定はボードに現れる式の組ごとに 1 回だけ計算して表にしておく。
solve :: Int -> Board -> Maybe [Move]
solve budget b0 = result
  where
    (result, _, _) = search budget b0 Set.empty
    distinct = Set.toList (Set.fromList (map snd (tiles b0)))
    table    = Map.fromList [((a, c), unsat2 a c) | a <- distinct, c <- distinct]
    clash a c = Map.findWithDefault False (a, c) table

    -- 返り値は (見つけた手順, 残り予算, 調べた状態)。予算と訪問済み集合を手渡しする。
    search :: Int -> Board -> Visited -> (Maybe [Move], Int, Visited)
    search bud b seen
      | isCleared b         = (Just [], bud, seen)
      | bud <= 0            = (Nothing, 0, seen)
      | Set.member b seen   = (Nothing, bud, seen)
      | deadEnd b           = (Nothing, bud, Set.insert b seen)
      | otherwise           = tryMoves (bud - 1) (Set.insert b seen) (orderMoves b (validPairsWith clash b))
      where
        tryMoves bud' s []       = (Nothing, bud', s)
        tryMoves bud' s (m : ms) =
          case search bud' (applyMove m b) s of
            (Just rest, bud'', s') -> (Just (m : rest), bud'', s')
            (Nothing,   bud'', s') -> tryMoves bud'' s' ms

    -- 枝刈り: どのタイルにも「いつか消し合える相手」が必要。
    -- 相手は unsat で、同じ行・同じ列か、|列の差| <= |行の差| の位置にあること。
    -- 行の縮約で行の差は縮むが列の差は変わらないので、|列の差| > |行の差| の 2 枚は
    -- 二度と斜めに並ばず、同じ行・列にもならない。
    deadEnd b = any (\(i, f) -> not (any (\(j, g) -> i /= j && clash f g && mayMeet i j) ts)) ts
      where
        ts = tiles b
        mayMeet i j = dr == 0 || dc == 0 || abs dc <= abs dr
          where
            dr = j `div` width - i `div` width
            dc = j `mod` width - i `mod` width

-- | 手の並べ替え(枝刈りの要)。行が消える手を先に、次にボードの上のほうの手を先に。
--   (第6章 高階関数: sortOn)
orderMoves :: Board -> [Move] -> [Move]
orderMoves b = sortOn key
  where key (i, j) = (length (applyMove (i, j) b), i, j)

-- | 孤立タイルがないか: どのタイルにも、ボード上のどこかに unsat になる相手がいる。
noIsolated :: Board -> Bool
noIsolated b = all hasPartner (zip [0 :: Int ..] ps)
  where
    ps = map snd (tiles b)
    hasPartner (i, a) = any (\(j, c) -> i /= j && unsat2 a c) (zip [0 ..] ps)

-- | シードからボードを作る。
--   1. そのボードで使う式を語彙から少数(subset)選ぶ。同じ式が何度も出るので相手が複数でき、
--      遊ぶ側も式を覚えやすい。
--   2. 消す手順を逆向きにたどって置く: 空の格子に、「間のマスがまだ空いている 2 マス」を選び、
--      unsat になる 2 枚を置く。逆順に並べれば、先に置いた組ほど後で消すことになり、
--      消すときに間が空いている(行の縮約を無視すれば)。これで全消しの筋道がほぼ保証される。
--   最後の 2 マスがつながらないなどで詰まったら、seed + 1 でやり直す
--   (findBoard の再挑戦は nextSeed の列を進むので、同じボードを何度も引かないように別の列を使う)。
--   タイル数は偶数で、どのタイルにも必ず相手がいる。
randomBoard :: Seed -> StageSpec -> Board
randomBoard seed spec =
  case place s1 (replicate n Empty) (n `div` 2) of
    Just b  -> b
    Nothing -> randomBoard (seed + 1) spec
  where
    n            = specRows spec * width
    groups       = specGroups spec
    subsetSize   = min (length (vocabulary spec)) (specRows spec * 2 + 2)
    (subset, s1) = drawSubset seed subsetSize []

    -- 重み付きで式を引き、重複を除いて m 個そろえる
    drawSubset :: Seed -> Int -> [Prop] -> ([Prop], Seed)
    drawSubset s 0 acc = (acc, s)
    drawSubset s m acc =
      let (grp, s') = pickWeighted s groups
          (a, s'')  = pick s' grp
      in if a `elem` acc then drawSubset s'' m acc else drawSubset s'' (m - 1) (a : acc)

    -- 読み順で最初の空マス i と、同じ行・列で間が空いている空マス j を選び、unsat の 2 枚を置く。
    -- k 組ぶん繰り返す。i を左上から埋めていくので、最後に残る 2 マスが取り残されにくい。
    place :: Seed -> Board -> Int -> Maybe Board
    place _ b 0 = Just b
    place s b k =
      case [i | (i, Empty) <- zip [0 ..] b] of
        []       -> Nothing
        (i : _)  ->
          case [j | (j, Empty) <- zip [0 ..] b, j > i, sameLine i j, connected width b i j] of
            []    -> Nothing
            cands ->
              let (j, s2)      = pick s cands
                  ((a, c), s3) = formulaPair s2
                  (flipIt, s4) = chance s3 50
                  (x, y)       = if flipIt then (c, a) else (a, c)
              in place s4 [if p == i then Tile x else if p == j then Tile y else cell | (p, cell) <- zip [0 ..] b] (k - 1)

    -- 同じ行か同じ列か。斜めは行の縮約で崩れることがあるので、筋道には使わない
    -- (遊ぶ側と探索は斜めも使ってよい)。
    sameLine i j = i `div` width == j `div` width || i `mod` width == j `mod` width

    -- A は subset から。相手 B は subset の中に unsat の式があればそこから、
    -- なければ語彙全体から(重み付き)。相手がどこにもなければ A を引き直す。
    formulaPair :: Seed -> ((Prop, Prop), Seed)
    formulaPair s =
      let (a, s1')      = pick s subset
          inSubset      = filter (unsat2 a) subset
          partnerGroups = [(w, qs) | (w, g) <- groups, let qs = filter (unsat2 a) g, not (null qs)]
      in case (inSubset, partnerGroups) of
           ([], []) -> formulaPair s1'
           ([], _)  -> let (pg, s3) = pickWeighted s1' partnerGroups
                           (c, s4)  = pick s3 pg
                       in ((a, c), s4)
           _        -> let (c, s3) = pick s1' inSubset
                       in ((a, c), s3)

-- | 採用したボード。
data Found = Found
  { fSeed     :: Seed
  , fBoard    :: Board
  , fMoves    :: Int      -- ^ 初手で消せる組の数
  , fSolution :: [Move]
  }

-- | シードを順に試し、条件を満たすボードを見つける:
--   孤立タイルなし、初手の組が 4 以上、SHUFFLE なしで全消しできる。
findBoard :: Int -> StageSpec -> Seed -> Found
findBoard budget spec seed
  | noIsolated b, moves >= 4, Just sol <- solve budget b = Found seed b moves sol
  | otherwise = findBoard budget spec (nextSeed seed)
  where
    b     = randomBoard seed spec
    moves = length (validPairs b)
