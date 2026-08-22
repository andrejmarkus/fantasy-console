#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VmFault {
    MemoryOutOfBounds(usize),
    LuaError,
    /// `_update`/`_draw` ran past the per-frame instruction budget — almost
    /// always an infinite loop. Distinct from `LuaError` so a host can tell
    /// "your script has a bug" apart from "your script never yields".
    ExecutionBudgetExceeded,
}
