/**
 * Build-time feature flags.
 *
 * SHOW_MARK_TAKEN — the guild-coordination "Mark taken" action on a flip route (design
 * 1c) is built and ready, but must NOT ship visible this version. Flip to true once the
 * shared guild-claim backend lands. Gating here (not deletion) keeps it one flip away.
 */
export const SHOW_MARK_TAKEN = false
