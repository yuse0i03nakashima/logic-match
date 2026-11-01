-- | 乱数(線形合同法)。ライブラリを使わず自分で書く。
--   同じシードからは必ず同じ列ができるので、面を「シード」だけで再現できる。
--   シードを引数と返り値で手渡しする書き方は、State モナド(第12章)が隠してくれるもの。
module Logic.Random
  ( Seed
  , nextSeed
  , randInt
  , pick
  , pickWeighted
  , shuffle
  , chance
  ) where

type Seed = Int

-- | 線形合同法。2^31 で折り返す古典的なパラメータ(Number Match と同じ)。
nextSeed :: Seed -> Seed
nextSeed s = (1103515245 * s + 12345) `mod` 2147483648

-- | 0 以上 n 未満の整数を 1 つ。上位ビットを使うと偏りが小さい。
--   返り値は (値, 次のシード)。
randInt :: Seed -> Int -> (Int, Seed)
randInt s n = ((s' `div` 65536) `mod` max 1 n, s')
  where s' = nextSeed s

-- | リストから 1 つ選ぶ(空リストは呼び出し側で避ける)。
pick :: Seed -> [a] -> (a, Seed)
pick s xs = (xs !! k, s')
  where (k, s') = randInt s (length xs)

-- | 重み付きで 1 つ選ぶ。(重み, 値) のリスト。重みの合計が 0 なら先頭。
pickWeighted :: Seed -> [(Int, a)] -> (a, Seed)
pickWeighted s wxs = (go k wxs, s')
  where
    total   = sum (map fst wxs)
    (k, s') = randInt s total
    go _ [(_, x)]           = x
    go r ((w, x) : rest)
      | r < w              = x
      | otherwise          = go (r - w) rest
    go _ []                 = error "pickWeighted: empty"

-- | 並べ替え。1 つ選んで取り除く、を繰り返す。(第5章 再帰)
shuffle :: Seed -> [a] -> ([a], Seed)
shuffle s [] = ([], s)
shuffle s xs = (x : rest, s'')
  where
    (k, s')     = randInt s (length xs)
    x           = xs !! k
    others      = take k xs ++ drop (k + 1) xs
    (rest, s'') = shuffle s' others

-- | 百分率 pct の確率で True。
chance :: Seed -> Int -> (Bool, Seed)
chance s pct = (k < pct, s')
  where (k, s') = randInt s 100
