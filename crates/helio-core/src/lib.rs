//! helio-core — shared Rust→WASM physics + scoring crate
//!
//! This crate implements the frozen API surface defined in
//! `contracts/wasm-api/helio_core_api.rs`. All functions are verified against
//! the golden vectors in `contracts/fixtures/vectors/`.
//!
//! # WASM target
//! Build with `wasm-pack build --target web` for browser consumption.
//! # Unit conventions (everywhere, no exceptions)
//! - time:        unix seconds UTC (f64)
//! - angles:      degrees (f64)
//! - distance:    km
//! - speed:       km/s
//! - B-field:     nT, GSM frame
//! - density:     particles/cm³

pub mod constants;
pub mod delay;
pub mod dbm;
pub mod coupling;
pub mod astronomy;
pub mod golook;
pub mod error;

/// Thin `#[wasm_bindgen]` marshalling surface. Compiled only for the wasm32
/// target so native builds + golden-vector tests verify the pure functions
/// untouched; the built `.wasm` is verified separately from TS.
#[cfg(target_arch = "wasm32")]
pub mod wasm;

// Re-export the public API matching contracts/wasm-api/helio_core_api.rs
pub use constants::{AU_KM, SUN_RADIUS_KM};
pub use error::CoreError;
pub use delay::l1_delay_seconds;
pub use dbm::{DbmParams, CmeState, dbm_step, dbm_arrival, cone_contains_earth};
pub use coupling::{newell_coupling, dst_step, kp_to_g};
pub use astronomy::{SkyState, sky_state};
pub use golook::{GoLookInputs, GoLookScore, Verdict, Limiter, go_look, darkness_factor};
