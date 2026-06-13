//! Feed adapters — each submodule owned by one Wave-1 builder.

pub mod swpc_l1;     // W1-P1a: SWPC L1 plasma/mag feed adapter
pub mod swpc_indices; // W1-P1b: SWPC indices feed adapter
pub mod ovation;     // W1-P1c: OVATION feed adapter
pub mod donki;       // W1-P1d: DONKI event adapter
pub mod goes_csm;    // W1-P1e: GOES CSM sampler stub
