//! Error type for the helio-core API.

/// Input outside the pinned validity range documented on a function.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CoreError {
    OutOfRange,
}
