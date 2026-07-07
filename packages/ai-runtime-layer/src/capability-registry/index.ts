/**
 * CapabilityRegistry — Phase 2
 * Maps capability IDs to ordered lists of CapabilityDescriptors.
 * Sorts by health_score desc, latency_p50_ms asc.
 * Applies RoutingHint constraints during resolution.
 */
import type {
  CapabilityDescriptor,
  CapabilityId,
  ICapabilityRegistry,
  RoutingHint,
} from "@brandos/contracts";

export class CapabilityRegistry implements ICapabilityRegistry {
  private readonly store = new Map<CapabilityId, CapabilityDescriptor[]>();

  register(descriptor: CapabilityDescriptor): void {
    const existing = this.store.get(descriptor.id) ?? [];
    // Deduplicate by provider+id
    const filtered = existing.filter(
      (d) => !(d.provider === descriptor.provider && d.id === descriptor.id)
    );
    this.store.set(descriptor.id, [...filtered, descriptor]);
  }

  resolve(id: CapabilityId, hint?: RoutingHint): CapabilityDescriptor | null {
    const candidates = this.store.get(id) ?? [];
    if (candidates.length === 0) return null;

    // Apply routing hint constraints
    const filtered = candidates.filter((c) => {
      if (hint?.min_quality_ceiling !== undefined && c.health_score < hint.min_quality_ceiling)
        return false;
      if (hint?.max_cost_usd !== undefined && c.cost_per_1k_tokens > hint.max_cost_usd)
        return false;
      if (hint?.max_latency_ms !== undefined && c.latency_p50_ms > hint.max_latency_ms)
        return false;
      return true;
    });

    // Sort: health_score desc, latency asc
    const pool = (filtered.length > 0 ? filtered : candidates).sort(
      (a, b) => b.health_score - a.health_score || a.latency_p50_ms - b.latency_p50_ms
    );

    return pool[0] ?? null;
  }

  resolveAll(id: CapabilityId): CapabilityDescriptor[] {
    return [...(this.store.get(id) ?? [])];
  }

  health(): Record<CapabilityId, number> {
    const result: Partial<Record<CapabilityId, number>> = {};
    for (const [id, descs] of this.store) {
      const avg = descs.reduce((s, d) => s + d.health_score, 0) / descs.length;
      result[id] = Math.round(avg);
    }
    return result as Record<CapabilityId, number>;
  }

  snapshot(): CapabilityDescriptor[] {
    return [...this.store.values()].flat();
  }
}


