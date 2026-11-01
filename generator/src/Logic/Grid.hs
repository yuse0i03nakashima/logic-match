-- | 格子(Board)の型と、位置の条件。REFUTE と DERIVE で共通。
--   Board は読み順(左→右、上→下)に並べた 1 本のリスト。幅 width は呼び出し側が渡す。
module Logic.Grid
  ( Cell(..)
  , Board
  , Pos
  , cellAt
  , isEmptyAt
  , tiles
  , tileCount
  , isCleared
  , connected
  , rows
  , collapseRows
  , fromStrings
  , toStrings
  ) where

import Logic.Prop

-- | 1 マスの状態。式のタイルが置かれているか、空か。
--   (第7章: data と deriving。Ord は訪問済み集合 Data.Set のため)
data Cell = Empty | Tile Prop
  deriving (Eq, Ord, Show)

-- | ボード面 = マスのリスト(読み順)。
type Board = [Cell]

-- | 位置 = リストの添字(0 始まり)。
type Pos = Int

-- | 添字 p のマス。範囲外なら Empty 扱い。
cellAt :: Board -> Pos -> Cell
cellAt b p
  | p < 0 || p >= length b = Empty
  | otherwise              = b !! p

isEmptyAt :: Board -> Pos -> Bool
isEmptyAt b p = cellAt b p == Empty

-- | 残っているタイルを (位置, 式) で読み順に。
--   (第4章 リスト内包表記: パターンで絞り込む)
tiles :: Board -> [(Pos, Prop)]
tiles b = [(i, p) | (i, Tile p) <- zip [0 ..] b]

tileCount :: Board -> Int
tileCount = length . tiles

-- | 全部空か。
isCleared :: Board -> Bool
isCleared = null . tiles

-- | 幅 w の格子で位置 i と j がつながっているか。
--   同じ行・同じ列・正確な斜め(行の差の絶対値 = 列の差の絶対値)のどれかで、
--   その直線上で 2 つの間のマスが全部空なら True。
--   行の右端と次の行の左端はつながらない(Number Match の行またぎは採用しない)。
connected :: Int -> Board -> Pos -> Pos -> Bool
connected w b i j
  | i == j                                   = False
  | i < 0 || j < 0 || i >= n || j >= n       = False
  | not (dr == 0 || dc == 0 || abs dr == abs dc) = False
  | otherwise                                = all (isEmptyAt b) between
  where
    n        = length b
    (ri, ci) = i `divMod` w
    (rj, cj) = j `divMod` w
    dr       = rj - ri
    dc       = cj - ci
    step     = signum dr * w + signum dc
    -- i から 1 歩ずつ進み、j の手前までの位置
    between  = takeWhile (/= j) (drop 1 (iterate (+ step) i))

-- | ボードを行(長さ w のリスト)に切り分ける。最後の行は短いことがある。
--   (第5章 再帰関数)
rows :: Int -> Board -> [[Cell]]
rows _ [] = []
rows w b  = take w b : rows w (drop w b)

-- | 全部空になった行を取り除く(REFUTE の行の縮約)。
--   (第6章 高階関数: filter と concat)
collapseRows :: Int -> Board -> Board
collapseRows w = concat . filter (not . all (== Empty)) . rows w

-- | JSON との橋渡し: prefix 記法の文字列のリスト("" は空マス)から Board を作る。
--   読めない文字列は空マス扱い。
fromStrings :: [String] -> Board
fromStrings = map toCell
  where
    toCell "" = Empty
    toCell s  = maybe Empty Tile (parse s)

toStrings :: Board -> [String]
toStrings = map fromCell
  where
    fromCell Empty    = ""
    fromCell (Tile p) = toPrefix p
