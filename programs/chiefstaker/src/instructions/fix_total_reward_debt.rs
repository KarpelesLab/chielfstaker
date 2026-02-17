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

    // Bounds check: new debt cannot exceed what was ever accumulated
    if pool.total_staked > 0 {
        let total_staked_wad = (pool.total_staked)
            .checked_mul(WAD)
            .ok_or(StakingError::MathOverflow)?;
        let total_max_accumulated =
            wad_mul(total_staked_wad, pool.acc_reward_per_weighted_share)?;
        if new_total_reward_debt > total_max_accumulated {
            msg!(
                "FixTotalRewardDebt: rejected, new_debt={} > max_accumulated={}",
                new_total_reward_debt,
                total_max_accumulated,
            );
            return Err(StakingError::RewardDebtExceedsBound.into());
        }
    }

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

#[cfg(test)]
mod tests {
    use super::*;

    /// Helper: run the bounds-check logic in isolation.
    /// Returns Ok(()) if the check passes, Err if rejected.
    fn check_bounds(
        total_staked: u128,
        acc_rps: u128,
        new_total_reward_debt: u128,
    ) -> Result<(), StakingError> {
        if total_staked > 0 {
            let total_staked_wad = total_staked
                .checked_mul(WAD)
                .ok_or(StakingError::MathOverflow)?;
            let total_max_accumulated = wad_mul(total_staked_wad, acc_rps)?;
            if new_total_reward_debt > total_max_accumulated {
                return Err(StakingError::RewardDebtExceedsBound);
            }
        }
        Ok(())
    }

    /// Helper: compute stranded rewards (mirrors on-chain formula).
    fn compute_stranded(
        total_staked: u128,
        acc_rps: u128,
        new_total_reward_debt: u128,
        total_residual_unpaid: u64,
        last_synced_lamports: u64,
    ) -> Result<u64, StakingError> {
        if total_staked == 0 {
            return Ok(0);
        }
        let total_staked_wad = total_staked
            .checked_mul(WAD)
            .ok_or(StakingError::MathOverflow)?;
        let total_max_accumulated = wad_mul(total_staked_wad, acc_rps)?;
        let total_max_pending = total_max_accumulated.saturating_sub(new_total_reward_debt);
        let active_owed_lamports = (total_max_pending / WAD) as u64;
        let total_owed_lamports = active_owed_lamports.saturating_add(total_residual_unpaid);
        Ok(last_synced_lamports.saturating_sub(total_owed_lamports))
    }

    #[test]
    fn test_bounds_check_rejects_above_max() {
        // 1000 tokens staked, acc_rps = 2 WAD  →  max_accumulated = 2000 WAD
        let total_staked = 1_000u128;
        let acc_rps = 2 * WAD;
        let max_accumulated = wad_mul(total_staked * WAD, acc_rps).unwrap();
        let above = max_accumulated + 1;
        assert_eq!(
            check_bounds(total_staked, acc_rps, above),
            Err(StakingError::RewardDebtExceedsBound),
        );
    }

    #[test]
    fn test_bounds_check_accepts_at_max() {
        let total_staked = 1_000u128;
        let acc_rps = 2 * WAD;
        let at_max = wad_mul(total_staked * WAD, acc_rps).unwrap();
        assert!(check_bounds(total_staked, acc_rps, at_max).is_ok());
    }

    #[test]
    fn test_bounds_check_accepts_below_max() {
        let total_staked = 1_000u128;
        let acc_rps = 2 * WAD;
        let max_accumulated = wad_mul(total_staked * WAD, acc_rps).unwrap();
        assert!(check_bounds(total_staked, acc_rps, max_accumulated - 1).is_ok());
        assert!(check_bounds(total_staked, acc_rps, 0).is_ok());
    }

    #[test]
    fn test_bounds_check_zero_staked_any_value() {
        // When total_staked == 0 the check is skipped — any debt is fine
        assert!(check_bounds(0, 5 * WAD, u128::MAX).is_ok());
        assert!(check_bounds(0, 0, 999_999_999).is_ok());
    }

    #[test]
    fn test_stranded_formula_correct_after_bounds() {
        // Pool: 1000 staked, acc_rps = 3 WAD, debt = 1000 WAD
        // max_accumulated = 3000 WAD, pending = 2000 WAD → 2000 lamports owed
        // last_synced = 5000 → stranded = 5000 - 2000 = 3000
        let total_staked = 1_000u128;
        let acc_rps = 3 * WAD;
        let debt = 1_000 * WAD;
        let residual = 0u64;
        let last_synced = 5_000u64;

        // Bounds check passes
        assert!(check_bounds(total_staked, acc_rps, debt).is_ok());

        let stranded = compute_stranded(total_staked, acc_rps, debt, residual, last_synced).unwrap();
        assert_eq!(stranded, 3_000);
    }

    #[test]
    fn test_bounds_prevents_inflated_stranded() {
        // If an attacker sets debt = max_accumulated + X, stranded would be
        // last_synced (all pool SOL). The bounds check prevents this.
        let total_staked = 500u128;
        let acc_rps = 4 * WAD;
        let max_acc = wad_mul(total_staked * WAD, acc_rps).unwrap();
        let inflated_debt = max_acc + 1_000 * WAD;

        // Bounds check rejects
        assert_eq!(
            check_bounds(total_staked, acc_rps, inflated_debt),
            Err(StakingError::RewardDebtExceedsBound),
        );

        // Show what would happen without the check: stranded = last_synced
        let last_synced = 10_000u64;
        let stranded =
            compute_stranded(total_staked, acc_rps, inflated_debt, 0, last_synced).unwrap();
        assert_eq!(stranded, last_synced, "without bounds, attacker drains all pool SOL");
    }
}
