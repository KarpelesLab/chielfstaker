//! Structured binary log events emitted via sol_log_data

use solana_program::{log::sol_log_data, pubkey::Pubkey};

/// sha256("event:RewardPayout")[..8]
pub const REWARD_PAYOUT_DISCRIMINATOR: [u8; 8] = [0x9b, 0x22, 0x27, 0xc0, 0x5f, 0x1b, 0x8e, 0x4d];

#[repr(u8)]
pub enum RewardPayoutType {
    Claim = 0,
    Unstake = 1,
    AutoClaimStake = 2,
}

/// Emit a structured RewardPayout event (81 bytes).
///
/// Layout: 8 discriminator + 32 pool + 32 user + 8 amount + 1 type
pub fn emit_reward_payout(
    pool: &Pubkey,
    user: &Pubkey,
    amount_lamports: u64,
    payout_type: RewardPayoutType,
) {
    let mut data = [0u8; 81];
    data[..8].copy_from_slice(&REWARD_PAYOUT_DISCRIMINATOR);
    data[8..40].copy_from_slice(pool.as_ref());
    data[40..72].copy_from_slice(user.as_ref());
    data[72..80].copy_from_slice(&amount_lamports.to_le_bytes());
    data[80] = payout_type as u8;
    sol_log_data(&[&data]);
}
