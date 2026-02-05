//! Instruction handlers for the staking program

pub mod initialize;
pub mod stake;
pub mod unstake;
pub mod claim;
pub mod deposit;
pub mod sync;
pub mod sync_rewards;

pub use initialize::*;
pub use stake::*;
pub use unstake::*;
pub use claim::*;
pub use deposit::*;
pub use sync::*;
pub use sync_rewards::*;
