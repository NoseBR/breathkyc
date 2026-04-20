use anchor_lang::prelude::*;

declare_id!("HuManReg1stry111111111111111111111111111");

#[program]
pub mod proof_registry {
    use super::*;

    /// Initializes the global state of the registry.
    pub fn initialize(ctx: Context<Initialize>, authority: Pubkey) -> Result<()> {
        let state = &mut ctx.accounts.state;
        state.admin = *ctx.accounts.signer.key;
        state.verification_authority = authority;
        Ok(())
    }

    /// Update the verification authority that is allowed to sign proofs.
    pub fn update_authority(ctx: Context<UpdateConfig>, new_authority: Pubkey) -> Result<()> {
        let state = &mut ctx.accounts.state;
        require_keys_eq!(state.admin, *ctx.accounts.signer.key, ErrorCode::Unauthorized);
        state.verification_authority = new_authority;
        Ok(())
    }

    /// Registers a user as human.
    /// In a production scenario, this should verify a signature from the `verification_authority`
    /// or a ZK proof provided by zkVerify.
    pub fn verify_human(
        ctx: Context<VerifyHuman>, 
        attestation_id: String,
        timestamp: i64
    ) -> Result<()> {
        let registry = &mut ctx.accounts.human_registry;
        let state = &ctx.accounts.state;

        // Ensure only the authorized verifier service can call this
        // (Simplified for this example - usually involves signature verification)
        require_keys_eq!(state.verification_authority, *ctx.accounts.signer.key, ErrorCode::Unauthorized);

        registry.user = *ctx.accounts.user.key;
        registry.is_verified = true;
        registry.attestation_id = attestation_id;
        registry.verified_at = timestamp;
        registry.bump = ctx.bumps.human_registry;

        emit!(HumanVerified {
            user: registry.user,
            attestation_id: registry.attestation_id.clone(),
        });

        Ok(())
    }

    /// Revokes a user's human status.
    pub fn revoke_human(ctx: Context<RevokeHuman>) -> Result<()> {
        let registry = &mut ctx.accounts.human_registry;
        let state = &ctx.accounts.state;

        require!(
            *ctx.accounts.signer.key == state.admin || *ctx.accounts.signer.key == state.verification_authority,
            ErrorCode::Unauthorized
        );

        registry.is_verified = false;
        
        Ok(())
    }
}

#[account]
pub struct GlobalState {
    pub admin: Pubkey,
    pub verification_authority: Pubkey,
}

#[account]
pub struct HumanAccount {
    pub user: Pubkey,
    pub is_verified: bool,
    pub attestation_id: String, // ID coming from zkVerify
    pub verified_at: i64,
    pub bump: u8,
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = signer,
        space = 8 + 32 + 32
    )]
    pub state: Account<'info, GlobalState>,
    #[account(mut)]
    pub signer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    #[account(mut)]
    pub state: Account<'info, GlobalState>,
    pub signer: Signer<'info>,
}

#[derive(Accounts)]
pub struct VerifyHuman<'info> {
    #[account(
        init_if_needed,
        payer = signer,
        space = 8 + 32 + 1 + 64 + 8 + 1,
        seeds = [b"human-proof", user.key().as_ref()],
        bump
    )]
    pub human_registry: Account<'info, HumanAccount>,
    /// CHECK: The user being verified
    pub user: UncheckedAccount<'info>,
    pub state: Account<'info, GlobalState>,
    #[account(mut)]
    pub signer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RevokeHuman<'info> {
    #[account(
        mut,
        seeds = [b"human-proof", user.key().as_ref()],
        bump = human_registry.bump
    )]
    pub human_registry: Account<'info, HumanAccount>,
    /// CHECK: The user to revoke
    pub user: UncheckedAccount<'info>,
    pub state: Account<'info, GlobalState>,
    pub signer: Signer<'info>,
}

#[event]
pub struct HumanVerified {
    pub user: Pubkey,
    pub attestation_id: String,
}

#[error_code]
pub enum ErrorCode {
    #[msg("You are not authorized to perform this action.")]
    Unauthorized,
}
