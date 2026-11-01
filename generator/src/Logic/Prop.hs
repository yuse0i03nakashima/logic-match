-- | 命題論理の式。型・読み取り(prefix 記法)・表示(infix)・真理値・充足可能性。
--   web/js/logic.js はこのファイルの移植で、同じ関数名・同じ意味を保つ。
--   (第7章 「型と型クラスの宣言」の data Prop と、第8章「トートロジー検査器」が土台)
module Logic.Prop
  ( Prop(..)
  , parse
  , parsePrefix
  , toPrefix
  , pretty
  , isBinary
  , Subst
  , eval
  , vars
  , bools
  , substs
  , sat
  , unsat2
  , tautology
  , contradiction
  , subformulas
  , size
  ) where

import Data.List (nub)

-- | 命題論理の式。変数は 'p' 'q' 'r'、Bot は ⊥。
--   (第7章: 再帰的なデータ型。Hutton の Prop に Or と Bot を足したもの)
data Prop
  = Var Char
  | Bot
  | Not Prop
  | And Prop Prop
  | Or  Prop Prop
  | Imp Prop Prop
  deriving (Eq, Ord, Show)

-- | prefix 記法を 1 文字ずつ読む。読めた式と残りの文字列を返す。
--   読めなければ Nothing。(第12章 Maybe モナドの do 記法で「失敗の伝播」を書く)
parsePrefix :: String -> Maybe (Prop, String)
parsePrefix ('F' : rest) = Just (Bot, rest)
parsePrefix (c : rest)
  | c `elem` "pqr" = Just (Var c, rest)
parsePrefix ('!' : rest) = do
  (a, rest') <- parsePrefix rest
  return (Not a, rest')
parsePrefix (c : rest)
  | c `elem` "&|>" = do
      (a, rest1) <- parsePrefix rest
      (b, rest2) <- parsePrefix rest1
      return (binary c a b, rest2)
  where
    binary '&' = And
    binary '|' = Or
    binary _   = Imp
parsePrefix _ = Nothing

-- | 文字列全体がちょうど 1 つの式であるときだけ Just。
parse :: String -> Maybe Prop
parse s = case parsePrefix s of
  Just (p, "") -> Just p
  _            -> Nothing

-- | 式 → prefix 記法。parse の逆(parse (toPrefix p) == Just p)。
toPrefix :: Prop -> String
toPrefix (Var c)   = [c]
toPrefix Bot       = "F"
toPrefix (Not a)   = '!' : toPrefix a
toPrefix (And a b) = '&' : toPrefix a ++ toPrefix b
toPrefix (Or  a b) = '|' : toPrefix a ++ toPrefix b
toPrefix (Imp a b) = '>' : toPrefix a ++ toPrefix b

-- | 2 項の式か(括弧を付ける判断に使う)。
isBinary :: Prop -> Bool
isBinary (And _ _) = True
isBinary (Or  _ _) = True
isBinary (Imp _ _) = True
isBinary _         = False

-- | 画面に出す infix の文字列。
--   * 変数と ⊥ はそのまま。
--   * ¬X: X が 2 項なら括弧、それ以外は括弧なし。
--   * X op Y: 2 項のオペランドだけ括弧で囲む。結合の省略はしない。
pretty :: Prop -> String
pretty (Var c)   = [c]
pretty Bot       = "⊥"
pretty (Not a)   = "¬" ++ operand a
pretty (And a b) = operand a ++ "∧" ++ operand b
pretty (Or  a b) = operand a ++ "∨" ++ operand b
pretty (Imp a b) = operand a ++ "→" ++ operand b

-- | オペランドの表示。2 項の式だけ括弧で囲む。
operand :: Prop -> String
operand a
  | isBinary a = "(" ++ pretty a ++ ")"
  | otherwise  = pretty a

-- | 真理値割り当て。(第8章: 連想リスト Assoc)
type Subst = [(Char, Bool)]

-- | 割り当てのもとで式を評価する。(第8章 eval と同じ形。→ は「¬A ∨ B」)
eval :: Subst -> Prop -> Bool
eval s (Var c)   = maybe False id (lookup c s)
eval _ Bot       = False
eval s (Not a)   = not (eval s a)
eval s (And a b) = eval s a && eval s b
eval s (Or  a b) = eval s a || eval s b
eval s (Imp a b) = eval s a <= eval s b

-- | 式に現れる変数(重複あり)。(第8章 vars)
vars :: Prop -> [Char]
vars (Var c)   = [c]
vars Bot       = []
vars (Not a)   = vars a
vars (And a b) = vars a ++ vars b
vars (Or  a b) = vars a ++ vars b
vars (Imp a b) = vars a ++ vars b

-- | 長さ n の真偽の列を全部。(第8章 bools: 再帰で 2^n 本)
bools :: Int -> [[Bool]]
bools 0 = [[]]
bools n = map (False :) bss ++ map (True :) bss
  where bss = bools (n - 1)

-- | 式の集合に現れる変数すべてへの割り当てを全部。(第8章 substs)
substs :: [Prop] -> [Subst]
substs ps = map (zip vs) (bools (length vs))
  where vs = nub (concatMap vars ps)

-- | 式の集合を同時に真にする割り当てがあるか(総当たり)。
sat :: [Prop] -> Bool
sat ps = any (\s -> all (eval s) ps) (substs ps)

-- | 2 つの式を同時に真にできないか。REFUTE で「消せる組」の条件。
unsat2 :: Prop -> Prop -> Bool
unsat2 a b = not (sat [a, b])

-- | トートロジー(第8章 isTaut)。語彙から除くために使う。
tautology :: Prop -> Bool
tautology p = all (\s -> eval s p) (substs [p])

-- | 矛盾(どの割り当てでも偽)。
contradiction :: Prop -> Bool
contradiction p = not (sat [p])

-- | 部分式の一覧(自分自身を含む)。∧I が使えるかの判定に使う。
subformulas :: Prop -> [Prop]
subformulas p = p : case p of
  Not a   -> subformulas a
  And a b -> subformulas a ++ subformulas b
  Or  a b -> subformulas a ++ subformulas b
  Imp a b -> subformulas a ++ subformulas b
  _       -> []

-- | 式の大きさ(結合子の数 + 1)。
size :: Prop -> Int
size = length . subformulas
