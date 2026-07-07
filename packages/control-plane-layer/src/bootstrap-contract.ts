/**
 * @brandos/control-plane-layer — bootstrap-contract.ts
 *
 * RETIRED — V2 migration.
 *
 * bootstrapContractAssembler() formerly populated a getContractAssembler()
 * singleton with CPL-side contributors (RuntimeContributor, ArtifactContributor,
 * ISkillContributor). That singleton was never read by the orchestrator, which
 * exclusively uses ContractAssemblerFactory.create() per-request.
 *
 * The CPL contributors/index.ts file remains for reference but is no longer
 * registered or executed.
 *
 * This file is kept as a no-op so any external import site doesn't break.
 * Remove entirely once all call sites have been updated.
 */

let _bootstrapped = false

/** @deprecated No-op. ContractAssemblerFactory.create() handles per-request registration. */
export function bootstrapContractAssembler(): void {
  if (_bootstrapped) return
  _bootstrapped = true
  console.info(
    '[BrandOS] bootstrapContractAssembler() called — no-op (V2: ContractAssemblerFactory.create() is the active path)'
  )
}

/** Reset for testing. */
export function _resetContractAssemblerForTesting(): void {
  _bootstrapped = false
}
