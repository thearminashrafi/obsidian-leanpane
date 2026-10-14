import StatusProj.Basic

namespace StatusProj

/-- Deliberate type error; this module is not part of the default build. -/
theorem broken_type : (1 : Nat) = "one" := by
  rfl

end StatusProj
