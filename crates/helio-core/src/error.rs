//! Error type for the helio-core API.

use std::fmt;

/// Input outside the pinned validity range documented on a function.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CoreError {
    OutOfRange,
}

impl fmt::Display for CoreError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::OutOfRange => formatter.write_str("input is outside the supported range"),
        }
    }
}

impl std::error::Error for CoreError {}
