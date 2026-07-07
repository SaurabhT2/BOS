/**
 * Real-time Generation Progress Component
 * Display in: page.tsx when generation is running
 * 
 * Usage:
 * <GenerationProgressDisplay 
 *   topic="Carousel for governance"
 *   userStyle={userStyle}
 *   engineMode="premium"
 *   onComplete={(result) => handleResult(result)}
 * />
 */

'use client'

import  { useEffect, useState } from 'react'
import { Zap, Check, AlertCircle } from 'lucide-react'

export interface GenerationProgress {
  stage: 'queued' | 'analyzing' | 'extracting' | 'generating' | 'composing' | 'complete' | 'error'
  progress: number
  message: string
  currentStep?: string
  estimatedTimeRemaining?: number
  result?: any
  error?: string
}

interface GenerationProgressDisplayProps {
  topic: string
  userStyle: Record<string, any>
  engineMode: 'free' | 'premium'
  tone: string
  onComplete: (result: any) => void
  onError: (error: string) => void
}

export function GenerationProgressDisplay({
  topic,
  userStyle,
  engineMode,
  tone,
  onComplete,
  onError,
}: GenerationProgressDisplayProps) {
  const [progress, setProgress] = useState<GenerationProgress>({
    stage: 'queued',
    progress: 0,
    message: 'Initializing...',
  })
  const [isConnected, setIsConnected] = useState(false)

  useEffect(() => {
    const params = new URLSearchParams({
      topic,
      userStyle: JSON.stringify(userStyle),
      engineMode,
      tone,
    })

    const eventSource = new EventSource(`/api/generate-with-progress?${params.toString()}`)

    eventSource.onopen = () => {
      setIsConnected(true)
    }

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data) as GenerationProgress
      setProgress(data)

      if (data.stage === 'complete') {
        eventSource.close()
        onComplete(data.result)
      } else if (data.stage === 'error') {
        eventSource.close()
        onError(data.error || 'Generation failed')
      }
    }

    eventSource.onerror = () => {
      setIsConnected(false)
      eventSource.close()
      onError('Connection lost')
    }

    return () => {
      eventSource.close()
    }
  }, [topic, userStyle, engineMode, tone, onComplete, onError])

  const getStageColor = (stage: string): string => {
    const colors: Record<string, string> = {
      queued: 'text-gray-500',
      analyzing: 'text-blue-500',
      extracting: 'text-cyan-500',
      generating: 'text-purple-500',
      composing: 'text-green-500',
      complete: 'text-green-600',
      error: 'text-red-500',
    }
    return colors[stage] || 'text-gray-500'
  }

  const getProgressBarColor = (stage: string): string => {
    const colors: Record<string, string> = {
      queued: 'bg-gray-500',
      analyzing: 'bg-blue-500',
      extracting: 'bg-cyan-500',
      generating: 'bg-purple-500',
      composing: 'bg-green-500',
      complete: 'bg-green-600',
      error: 'bg-red-500',
    }
    return colors[stage] || 'bg-gray-500'
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 backdrop-blur-sm">
      <div className="bg-[#0d2346] border border-white/10 rounded-3xl p-8 max-w-md w-full mx-4 shadow-2xl">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          {progress.stage === 'error' ? (
            <AlertCircle size={24} className="text-red-500" />
          ) : progress.stage === 'complete' ? (
            <Check size={24} className="text-green-600" />
          ) : (
            <Zap size={24} className={`${getStageColor(progress.stage)} animate-pulse`} />
          )}
          <h3 className="text-lg font-semibold text-white">{progress.message}</h3>
        </div>

        {/* Current Step */}
        {progress.currentStep && (
          <p className="text-sm text-gray-400 mb-4">
            Currently: <span className="text-cyan-300">{progress.currentStep}</span>
          </p>
        )}

        {/* Progress Bar */}
        <div className="mb-6">
          <div className="flex justify-between items-center mb-2">
            <span className="text-xs text-gray-500">Progress</span>
            <span className="text-xs text-gray-400">{progress.progress}%</span>
          </div>
          <div className="w-full bg-gray-800 rounded-full h-2 overflow-hidden">
            <div
              className={`h-full transition-all duration-300 ${getProgressBarColor(progress.stage)}`}
              style={{ width: `${progress.progress}%` }}
            />
          </div>
        </div>

        {/* Estimated Time */}
        {progress.estimatedTimeRemaining && progress.estimatedTimeRemaining > 0 && (
          <p className="text-xs text-gray-500 text-center mb-4">
            Estimated time remaining: <span className="text-cyan-400">{progress.estimatedTimeRemaining}s</span>
          </p>
        )}

        {/* Stage Indicators */}
        <div className="space-y-2 mb-6">
          {(['queued', 'analyzing', 'extracting', 'generating', 'composing', 'complete'] as const).map((stage) => {
            const isActive = progress.stage === stage || (progress.progress === 100 && stage !== ('error' as string))
            const isComplete = (
              (stage === 'queued' && ['analyzing', 'extracting', 'generating', 'composing', 'complete'].includes(progress.stage)) ||
              (stage === 'analyzing' && ['extracting', 'generating', 'composing', 'complete'].includes(progress.stage)) ||
              (stage === 'extracting' && ['generating', 'composing', 'complete'].includes(progress.stage)) ||
              (stage === 'generating' && ['composing', 'complete'].includes(progress.stage)) ||
              (stage === 'composing' && progress.stage === 'complete')
            )

            const labels: Record<string, string> = {
              queued: 'Queued',
              analyzing: 'Analyzing Brand',
              extracting: 'Extracting Signals',
              generating: 'Generating Text',
              composing: 'Composing Images',
              complete: 'Complete',
            }

            return (
              <div key={stage} className="flex items-center gap-3">
                <div
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold ${
                    isComplete
                      ? 'bg-green-600 text-white'
                      : isActive
                        ? 'bg-cyan-500 text-white animate-pulse'
                        : 'bg-gray-700 text-gray-400'
                  }`}
                >
                  {isComplete ? '✓' : isActive ? '→' : '·'}
                </div>
                <span
                  className={`text-sm ${
                    isComplete ? 'text-green-400' : isActive ? 'text-cyan-300 font-semibold' : 'text-gray-600'
                  }`}
                >
                  {labels[stage]}
                </span>
              </div>
            )
          })}
        </div>

        {/* Error Display */}
        {progress.stage === 'error' && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 mb-4">
            <p className="text-sm text-red-400">{progress.error}</p>
          </div>
        )}

        {/* Connection Status */}
        {!isConnected && progress.stage !== 'complete' && (
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 mb-4">
            <p className="text-sm text-amber-400">
              {progress.stage === 'error' ? 'Connection lost' : 'Reconnecting...'}
            </p>
          </div>
        )}

        {/* Footer */}
        <div className="text-xs text-gray-500 text-center">
          {progress.stage === 'complete'
            ? 'Ready to download or share'
            : progress.stage === 'error'
              ? 'Please try again'
              : `${engineMode === 'premium' ? '🚀 Premium Claude' : '⚡ Local Ollama'} · ${tone}`}
        </div>
      </div>
    </div>
  )
}

/**
 * Hook to manage generation progress state
 * Usage: const { progress, start, error } = useGenerationProgress()
 */
export function useGenerationProgress() {
  const [progress, setProgress] = useState<GenerationProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<any>(null)

  const start = (topic: string, userStyle: Record<string, any>, engineMode: 'free' | 'premium', tone: string) => {
    setProgress({ stage: 'queued', progress: 0, message: 'Starting...' })
    setError(null)
    setResult(null)
  }

  const handleComplete = (completedResult: any) => {
    setResult(completedResult)
  }

  const handleError = (errorMsg: string) => {
    setError(errorMsg)
  }

  return {
    progress,
    error,
    result,
    start,
    handleComplete,
    handleError,
    reset: () => {
      setProgress(null)
      setError(null)
      setResult(null)
    },
  }
}


