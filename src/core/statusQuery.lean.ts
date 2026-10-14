// Static Lean program run as `lake env lean --run <file> status|list <Mods,> <args...>` (see src/core/statusQuery.ts).
// Verified against Lean 4.25.1. It imports the project's modules at runtime (importModules), so the file itself never changes.
// No backticks or "${" may appear in it (it lives in a TS template literal).
export const STATUS_QUERY_LEAN = String.raw`import Lean
open Lean Meta Elab

/-! LeanPane declaration query. Usage:
  lean --run query.lean status <Mod1,Mod2,...> <Name>...
  lean --run query.lean list   <Mod1,Mod2,...> <prefix-or-"">
Prints one JSON object per line on stdout. -/

def kindOf : ConstantInfo → String
  | .axiomInfo _ => "axiom"
  | .defnInfo _ => "def"
  | .thmInfo _ => "theorem"
  | .opaqueInfo _ => "opaque"
  | .quotInfo _ => "quot"
  | .inductInfo _ => "inductive"
  | .ctorInfo _ => "constructor"
  | .recInfo _ => "recursor"

def moduleOf (env : Environment) (n : Name) : Option Name :=
  match env.getModuleIdxFor? n with
  | some idx => env.header.moduleNames[idx.toNat]?
  | none => none

def lineOf (n : Name) : CoreM (Option Nat) := do
  let r ← findDeclarationRanges? n
  return r.map (·.range.pos.line)

def truncate (s : String) (max : Nat := 400) : String :=
  if s.length ≤ max then s else (s.take max) ++ "…"

def statusOne (name : String) : CoreM Json := do
  let env ← getEnv
  let n := name.toName
  match env.find? n with
  | none => return Json.mkObj [("name", name), ("exists", false)]
  | some ci =>
    let ownSorry := ci.type.hasSorry || (ci.value?.map (·.hasSorry) |>.getD false)
    let axs ← collectAxioms n
    let anySorry := axs.contains (Name.mkSimple "sorryAx")
    let ty ← try
        let f ← (ppExpr ci.type).run'
        pure (truncate (Format.pretty f 100))
      catch _ => pure ""
    let line ← lineOf n
    return Json.mkObj [
      ("name", name), ("exists", true),
      ("module", (moduleOf env n).map toString |>.getD ""),
      ("line", match line with | some l => (l : Json) | none => Json.null),
      ("kind", kindOf ci), ("type", ty),
      ("ownSorry", ownSorry), ("anySorry", anySorry)]

def listDecls (mods : Array Name) (pre : String) : CoreM (Array Json) := do
  let env ← getEnv
  let mut out : Array Json := #[]
  for (n, ci) in env.constants.map₁.toList do
    unless n.isInternal || isPrivateName n || n.isInaccessibleUserName || (isAuxRecursor env n) || (isNoConfusion env n) do
      let some m := moduleOf env n | continue
      unless mods.contains m do continue
      let s := n.toString
      unless pre.isEmpty || pre.isPrefixOf s do continue
      let line ← lineOf n
      out := out.push <| Json.mkObj [("name", s), ("module", toString m), ("kind", kindOf ci),
        ("line", match line with | some l => (l : Json) | none => Json.null)]
  return out

unsafe def main (args : List String) : IO UInt32 := do
  enableInitializersExecution
  initSearchPath (← findSysroot)
  match args with
  | mode :: mods :: rest =>
    let modNames := (mods.splitOn ",").filter (· ≠ "") |>.map String.toName
    let imports := modNames.toArray.map fun m => ({ module := m } : Import)
    let env ← try importModules imports {} 0 (loadExts := true)
      catch e => do IO.eprintln s!"import failed: {e}"; IO.Process.exit 3
    let ctx : Core.Context := { fileName := "<leanpane>", fileMap := default, maxHeartbeats := 0 }
    match mode with
    | "status" =>
      for nm in rest do
        let j ← try
            let (j, _) ← (statusOne nm).toIO ctx { env }
            pure j
          catch e => pure (Json.mkObj [("name", nm), ("exists", true), ("error", toString e)])
        IO.println j.compress
      return 0
    | "list" =>
      let pre := rest.headD ""
      let (arr, _) ← (listDecls (modNames.toArray) pre).toIO ctx { env }
      for j in arr do IO.println j.compress
      return 0
    | _ => IO.eprintln s!"unknown mode {mode}"; return 2
  | _ => IO.eprintln "usage: query status|list Mods names..."; return 2
`;
