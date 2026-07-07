/**
 * @brandos/presentation-layer — types/controlPlane.ts
 *
 * ControlPlaneData: the shape of control_plane metadata attached to
 * generation responses. Consumed by ControlPlanePanel and apps/web studio page.
 *
 * Note: ActivityEntry, OverrideMode, IntentAnalysis, RoutingHint are in
 * @brandos/contracts and imported directly where needed.
 */

export interface ControlPlaneData {
  original_score?: number
  final_score?: number
  fixes_applied?: string[]
  flags_remaining?: string[]
  retries?: number
  routing?: import('@brandos/contracts').RoutingHint
  intent?: import('@brandos/contracts').IntentAnalysis
  override_mode?: import('@brandos/contracts').OverrideMode
  activity_log?: import('@brandos/contracts').ActivityEntry[]
}


