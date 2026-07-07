export const analyticsEvents = {
  GENERATION_COMPLETED: 'generation_completed',
  GENERATION_FAILED: 'generation_failed',
}

export type AnalyticsEventPayload = {
  name: string
  properties?: Record<string, unknown>
}

export function trackEvent(
  payload: AnalyticsEventPayload | string,
  properties?: Record<string, unknown>,
) {
  try {
    if (typeof payload === 'string') {
      console.log('[analytics]', payload, properties)
      return
    }

    console.log('[analytics]', payload.name, payload.properties)
  } catch {}
}

export function trackGenerationPerformance(
  durationMs: number,
  format: string,
) {
  trackEvent({
    name: 'generation_performance',
    properties: {
      durationMs,
      format,
    },
  })
}

export function trackActivationStep(
  step: string,
  properties?: Record<string, unknown>,
) {
  trackEvent({
    name: 'activation_step',
    properties: {
      step,
      ...properties,
    },
  })
}

