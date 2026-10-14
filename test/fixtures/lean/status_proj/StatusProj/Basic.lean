/-!
# Declaration status fixture

`proved_add_zero` is fully proved, `stated_sorry` uses `sorry`, and `uses_sorry` has
a complete proof that depends on `stated_sorry`.
-/

namespace StatusProj

/-- A fully proved theorem. -/
theorem proved_add_zero (n : Nat) : n + 0 = n := by
  rfl

/-- A statement whose proof is `sorry`. -/
theorem stated_sorry (n : Nat) : n * 1 = n := by
  sorry

/-- A complete proof that depends on a `sorry` theorem. -/
theorem uses_sorry (n : Nat) : n * 1 + 0 = n := by
  have h := stated_sorry n
  omega

/-- A definition. -/
def double (n : Nat) : Nat := n + n

end StatusProj
