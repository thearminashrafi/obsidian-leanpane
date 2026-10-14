namespace StatusProj

/-- A tactic proof of several lines, used for goal-view tests. -/
theorem and_swap (p q : Prop) (hp : p) (hq : q) : q ∧ p := by
  constructor
  · exact hq
  · exact hp

theorem add_comm_three (a b c : Nat) : a + b + c = c + b + a := by
  induction a with
  | zero =>
    simp
    omega
  | succ n ih =>
    omega

end StatusProj
