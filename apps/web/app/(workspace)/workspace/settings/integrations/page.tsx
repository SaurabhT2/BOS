'use client'

/**
 * /workspace/settings/integrations — Export Integrations (Canva, Figma)
 *
 * Priority 4 — Canva Export. Connect/disconnect UI for OAuth-based export
 * destinations. Built generically over a small ProviderCard component so
 * Priority 5 (Figma Export) plugs in by adding one more entry to
 * INTEGRATION_PROVIDERS + its own /api/integrations/figma/* routes —
 * no new page, no new layout.
 *
 * Reads ?canva=connected|error&canva_error=... from the OAuth callback
 * redirect (see /api/integrations/canva/callback) to show a one-time
 * status banner after the round trip completes.
 */

import * as React from 'react'
import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, Loader2, CheckCircle, XCircle, Link2, Unlink, AlertTriangle } from 'lucide-react'

interface IntegrationStatus {
  configured: boolean
  connected: boolean
  connected_at: string | null
  expires_at: string | null
  scopes: string[]
}

interface IntegrationProviderDef {
  id: 'canva' | 'figma'
  label: string
  description: string
  statusEndpoint: string
  connectEndpoint: string
  accentClass: string
}

interface IntegrationProviderDef {
  id: 'canva' | 'figma'
  label: string
  description: string
  statusEndpoint: string
  connectEndpoint: string
  accentClass: string
  /** Canva: OAuth connect/disconnect. Figma: no account link — plugin handoff instead. */
  flowKind: 'oauth' | 'plugin-handoff'
}

const INTEGRATION_PROVIDERS: Array<IntegrationProviderDef & { available: boolean }> = [
  {
    id: 'canva',
    label: 'Canva',
    description: 'Send any generated carousel, deck, or report into Canva as an editable design.',
    statusEndpoint: '/api/integrations/canva/status',
    connectEndpoint: '/api/integrations/canva/connect',
    accentClass: 'text-cyan-300 border-cyan-500/30 bg-cyan-500/5',
    flowKind: 'oauth',
    available: true,
  },
  {
    id: 'figma',
    label: 'Figma',
    description: 'Push generated artifacts into Figma using the BrandOS plugin — no account connection needed.',
    statusEndpoint: '/api/integrations/figma/status',
    connectEndpoint: '/api/integrations/figma/handoff',
    accentClass: 'text-purple-300 border-purple-500/30 bg-purple-500/5',
    flowKind: 'plugin-handoff',
    available: true,
  },
]

function ProviderCard({ provider }: { provider: IntegrationProviderDef & { available: boolean } }) {
  const [status, setStatus] = useState<IntegrationStatus | null>(null)
  const [loading, setLoading] = useState(provider.available)
  const [disconnecting, setDisconnecting] = useState(false)

  useEffect(() => {
    if (!provider.available) return
    fetchStatus()
  }, [provider.available])

  async function fetchStatus() {
    try {
      setLoading(true)
      const res = await fetch(provider.statusEndpoint)
      if (res.ok) setStatus(await res.json())
    } catch {
      /* non-critical — card just shows "not connected" */
    } finally {
      setLoading(false)
    }
  }

  async function disconnect() {
    setDisconnecting(true)
    try {
      await fetch(provider.statusEndpoint, { method: 'DELETE' })
      await fetchStatus()
    } finally {
      setDisconnecting(false)
    }
  }

  return (
    <div className={`rounded-xl border p-5 ${provider.available ? 'border-gray-800 bg-gray-900' : 'border-gray-800/60 bg-gray-900/40'}`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-gray-100">{provider.label}</span>
            {!provider.available && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-800 text-gray-500 border border-gray-700">
                Coming soon
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-1 max-w-md">{provider.description}</p>
        </div>

        {provider.available && !loading && status && provider.flowKind === 'oauth' && (
          status.connected ? (
            <div className="flex items-center gap-2 shrink-0">
              <span className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border ${provider.accentClass}`}>
                <CheckCircle className="w-3 h-3" /> Connected
              </span>
              <button
                onClick={disconnect}
                disabled={disconnecting}
                className="flex items-center gap-1 px-2.5 py-1 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 border border-gray-700 rounded-lg text-xs text-gray-400 hover:text-red-300 transition-all"
              >
                {disconnecting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Unlink className="w-3 h-3" />}
                Disconnect
              </button>
            </div>
          ) : status.configured ? (
            <a
              href={provider.connectEndpoint}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-cyan-900/40 hover:bg-cyan-900/70 border border-cyan-700/50 rounded-lg text-xs text-cyan-300 hover:text-cyan-100 transition-all shrink-0"
            >
              <Link2 className="w-3 h-3" /> Connect
            </a>
          ) : (
            <span className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border border-amber-500/30 bg-amber-500/5 text-amber-300 shrink-0">
              <AlertTriangle className="w-3 h-3" /> Not configured
            </span>
          )
        )}

        {provider.available && !loading && provider.flowKind === 'plugin-handoff' && (
          <span className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border border-purple-500/30 bg-purple-500/5 text-purple-300 shrink-0">
            <CheckCircle className="w-3 h-3" /> No setup needed
          </span>
        )}

        {provider.available && loading && (
          <Loader2 className="w-4 h-4 text-gray-500 animate-spin shrink-0" />
        )}
      </div>

      {provider.available && provider.flowKind === 'plugin-handoff' && (
        <p className="text-xs text-gray-500 mt-3">
          Figma doesn't support importing designs via API, so export works through a small Figma
          Plugin instead: from any artifact's export menu, click <span className="text-purple-300">Figma</span>{' '}
          — BrandOS will give you a one-time code. Open Figma, run "BrandOS Export" from the
          Plugins menu, and paste the code there to render the artifact onto the canvas.
        </p>
      )}

      {provider.available && status && !status.configured && (
        <p className="text-xs text-amber-400/80 mt-3">
          This server is missing Canva OAuth credentials (CANVA_CLIENT_ID / CANVA_CLIENT_SECRET).
          Ask an admin to configure them before connecting.
        </p>
      )}
      {provider.available && status?.connected && status.expires_at && (
        <p className="text-xs text-gray-600 mt-3">
          Token refreshes automatically — no action needed.
        </p>
      )}
    </div>
  )
}

export default function IntegrationsSettingsPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-cyan-400 animate-spin" />
      </div>
    }>
      <IntegrationsSettingsContent />
    </Suspense>
  )
}

function IntegrationsSettingsContent() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const canvaCallbackStatus = searchParams.get('canva') // 'connected' | 'error' | null
  const canvaCallbackError = searchParams.get('canva_error')

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="border-b border-gray-800 px-6 py-4">
        <div className="max-w-3xl mx-auto flex items-center gap-4">
          <button
            onClick={() => router.push('/workspace/settings')}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <Link2 className="w-5 h-5 text-cyan-400" />
          <div className="flex-1">
            <h1 className="text-lg font-semibold">Export Integrations</h1>
            <p className="text-xs text-gray-400">Connect external design tools to export directly into them</p>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-8 space-y-4">
        {canvaCallbackStatus === 'connected' && (
          <div className="flex items-center gap-2 rounded-lg border border-green-700/40 bg-green-900/20 px-4 py-3 text-sm text-green-300">
            <CheckCircle className="w-4 h-4" /> Canva connected successfully.
          </div>
        )}
        {canvaCallbackStatus === 'error' && (
          <div className="flex items-center gap-2 rounded-lg border border-red-700/40 bg-red-900/20 px-4 py-3 text-sm text-red-300">
            <XCircle className="w-4 h-4" />
            {canvaCallbackError ? decodeURIComponent(canvaCallbackError) : 'Failed to connect Canva.'}
          </div>
        )}

        {INTEGRATION_PROVIDERS.map(provider => (
          <ProviderCard key={provider.id} provider={provider} />
        ))}
      </div>
    </div>
  )
}
