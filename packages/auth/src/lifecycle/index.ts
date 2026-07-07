// ============================================================
// @brandos/auth — src/lifecycle/index.ts
//
// Barrel for the lifecycle subfolder. Kept separate from IAuth.ts's
// 13 I*Operations groups deliberately — this wraps calls to those
// existing groups rather than adding a new DB-access group of its own,
// so it doesn't have (or need) an I*Operations interface. See
// computeUserLifecycleState.ts's header comment for the architectural
// rationale.
// ============================================================

export { computeUserLifecycleState } from './computeUserLifecycleState';
