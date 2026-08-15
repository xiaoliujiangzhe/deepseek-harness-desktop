/**
 * Package-owned invariant companion for the vision fallback service.
 *
 * The service owns no independent event relationship: settings registration
 * validates the stored route before `selection()` can observe it, and every
 * generated description is appended through `Session.append`, whose owning
 * package asserts the log invariants.
 *
 * @module @deepseek-ai/dsh-llm-vision-fallback/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-llm-vision-fallback'

/** Cordis companion plugin name. */
export const name = 'llm-vision-fallback-invariant'
/** Services required before the companion can register. */
export const inject = ['invariants']

/** No runtime invariant: settings validation and the session log own the mutable-value relationships. */
const install: InvariantInstaller = () => {}

/**
 * Register the intentionally empty invariant contribution.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
