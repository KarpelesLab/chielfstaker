//! Fix total_reward_debt and recover stranded rewards (authority only)
//!
//! Existing pools bootstrapped `total_reward_debt` at 0 and only track
//! incremental changes since the field was added.  This means the on-chain
//! value can be off by a large constant, causing the stranded-reward formula
//! to over-estimate what is owed and recover nothing.
//!
//! This authority-only instruction accepts the correct `total_reward_debt`
//! computed off-chain, sets it, and recovers stranded SOL in one shot.

use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    msg,
    pubkey::Pubkey,
};

use crate::{
    error::StakingError,
    math::{wad_mul, WAD},
    state::StakingPool,
};

/// Fix total_reward_debt and recover stranded rewards.
///
/// Accounts:
/// 0. `[writable]` Pool account
/// 1. `[signer]` Authority
pub fn process_fix_total_reward_debt(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    new_total_reward_debt: u128,
) -> ProgramResult {
    let account_info_iter = &mut accounts.iter();

    let pool_info = next_account_info(account_info_iter)?;
    let authority_info = next_account_info(account_info_iter)?;

    // Load and validate pool
    if pool_info.owner != program_id {
        return Err(StakingError::InvalidAccountOwner.into());
    }
    let mut pool = StakingPool::try_from_slice(&pool_info.try_borrow_data()?)?;
    if !pool.is_initialized() {
        return Err(StakingError::NotInitialized.into());
    }

    // Verify pool PDA
    let (expected_pool, _) = StakingPool::derive_pda(&pool.mint, program_id);
    if *pool_info.key != expected_pool {
        return Err(StakingError::InvalidPDA.into());
    }

    // Authority checks
    if !authority_info.is_signer {
        return Err(StakingError::MissingRequiredSigner.into());
    }
    if pool.is_authority_renounced() {
        return Err(StakingError::AuthorityRenounced.into());
    }
    if pool.authority != *authority_info.key {
        return Err(StakingError::InvalidAuthority.into());
    }

    let old_debt = pool.total_reward_debt;

    // Set the corrected total_reward_debt
    pool.total_reward_debt = new_total_reward_debt;

    // Compute stranded rewards using the corrected debt
    // Same formula as the old RecoverStrandedRewards but now with correct debt
    let stranded = if pool.total_staked > 0 {
        let total_staked_wad = (pool.total_staked)
            .checked_mul(WAD)
            .ok_or(StakingError::MathOverflow)?;
        let total_max_accumulated =
            wad_mul(total_staked_wad, pool.acc_reward_per_weighted_share)?;
        let total_max_pending = total_max_accumulated.saturating_sub(new_total_reward_debt);

        let active_owed_lamports = (total_max_pending / WAD) as u64;
        let total_owed_lamports = active_owed_lamports.saturating_add(pool.total_residual_unpaid);

        pool.last_synced_lamports.saturating_sub(total_owed_lamports)
    } else {
        0
    };

    if stranded > 0 {
        pool.last_synced_lamports = pool.last_synced_lamports.saturating_sub(stranded);
    }

    // Save pool state
    let mut pool_data = pool_info.try_borrow_mut_data()?;
    pool.serialize(&mut &mut pool_data[..])?;

    msg!(
        "FixTotalRewardDebt: old_debt={}, new_debt={}, recovered={} lamports (last_synced={})",
        old_debt,
        new_total_reward_debt,
        stranded,
        pool.last_synced_lamports
    );

    Ok(())
}
