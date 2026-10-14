namespace A

namespace B
theorem thm : True := trivial
theorem Foo.bar : True := trivial
end B

section Helpers
variable (n : Nat)
def inner := n + 1
end Helpers

structure Pt where
  x : Nat
  y : Nat

inductive Color where
  | red | green

instance : Inhabited Color := ⟨.red⟩

theorem _root_.top_level : True := trivial

end A

def rootDecl := 0
