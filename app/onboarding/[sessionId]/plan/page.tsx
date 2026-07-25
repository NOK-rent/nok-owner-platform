'use client'

import { useState, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { useDropzone } from 'react-dropzone'

export default function PlanUploadPage() {
  const router = useRouter()
  const params = useParams()
  const sessionId = params.sessionId as string

  const [file, setFile] = useState<File | null>(null)
  const [status, setStatus] = useState<'idle' | 'uploading' | 'analyzing' | 'done' | 'error'>('idle')
  const [analysisResult, setAnalysisResult] = useState<{
    spaces: Array<{ name: string; area_m2: number | null }>
    bedrooms: number
    bathrooms: number
  } | null>(null)
  const [error, setError] = useState('')

  const onDrop = useCallback((accepted: File[]) => {
    if (accepted[0]) setFile(accepted[0])
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/pdf': ['.pdf'] },
    maxFiles: 1,
    maxSize: 20 * 1024 * 1024,
  })

  const handleUpload = async () => {
    if (!file) return
    setStatus('uploading')
    setError('')

    const formData = new FormData()
    formData.append('file', file)
    formData.append('session_id', sessionId)

    try {
      setStatus('analyzing')
      const res = await fetch('/api/onboarding/analyze-plan', {
        method: 'POST',
        body: formData,
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? 'Error analizando el plano')
      }

      const data = await res.json()
      setAnalysisResult(data.analysis)
      setStatus('done')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado')
      setStatus('error')
    }
  }

  const handleContinue = () => {
    router.push(`/onboarding/${sessionId}/chat`)
  }

  const handleSkip = () => {
    router.push(`/onboarding/${sessionId}/chat`)
  }

  return (
    <div className="min-h-screen bg-[#F0EFED]">
      <div className="border-b border-gray-100 px-6 py-4 flex items-center justify-between">
        <span className="text-xl font-bold tracking-widest">NOK</span>
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <span className="w-6 h-6 rounded-full bg-gray-900 text-white flex items-center justify-center font-bold">1</span>
          <span className="text-gray-900 font-medium">Plano</span>
          <span className="w-4 h-px bg-gray-200" />
          <span className="w-6 h-6 rounded-full bg-gray-100 text-gray-400 flex items-center justify-center font-bold">2</span>
          <span>Chat</span>
          <span className="w-4 h-px bg-gray-200" />
          <span className="w-6 h-6 rounded-full bg-gray-100 text-gray-400 flex items-center justify-center font-bold">3</span>
          <span>Catálogo</span>
          <span className="w-4 h-px bg-gray-200" />
          <span className="w-6 h-6 rounded-full bg-gray-100 text-gray-400 flex items-center justify-center font-bold">4</span>
          <span>Cotización</span>
        </div>
      </div>

      <div className="max-w-xl mx-auto px-6 py-12">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Sube el plano de tu apartamento</h1>
          <p className="text-gray-500">
            La IA analiza el plano y extrae las dimensiones de cada espacio automáticamente.
            Así te damos recomendaciones exactas de tamaños.
          </p>
        </div>

        {status === 'done' && analysisResult ? (
          <div className="space-y-6">
            <div className="bg-green-50 border border-green-200 rounded-xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <span className="text-green-600 text-lg">✅</span>
                <h2 className="font-semibold text-green-900">Plano analizado correctamente</h2>
              </div>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="bg-white rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold text-gray-900">{analysisResult.bedrooms}</div>
                  <div className="text-xs text-gray-500 mt-1">Habitación{analysisResult.bedrooms !== 1 ? 'es' : ''}</div>
                </div>
                <div className="bg-white rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold text-gray-900">{analysisResult.bathrooms}</div>
                  <div className="text-xs text-gray-500 mt-1">Baño{analysisResult.bathrooms !== 1 ? 's' : ''}</div>
                </div>
              </div>
              <div className="space-y-1">
                {analysisResult.spaces.map((space, i) => (
                  <div key={i} className="flex justify-between text-sm py-1 border-b border-green-100 last:border-0">
                    <span className="text-gray-700">{space.name}</span>
                    <span className="text-gray-500 font-medium">
                      {space.area_m2 ? `${space.area_m2} m²` : 'sin dimensiones'}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <button
              onClick={handleContinue}
              className="w-full bg-gray-900 text-white py-4 rounded-xl font-semibold text-sm hover:bg-gray-700 transition-colors"
            >
              Continuar al chat →
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            <div
              {...getRootProps()}
              className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all ${
                isDragActive
                  ? 'border-gray-900 bg-gray-50'
                  : file
                  ? 'border-green-400 bg-green-50'
                  : 'border-gray-200 hover:border-gray-400'
              }`}
            >
              <input {...getInputProps()} />
              {file ? (
                <div>
                  <div className="text-4xl mb-3">📄</div>
                  <p className="font-medium text-gray-900">{file.name}</p>
                  <p className="text-sm text-gray-400 mt-1">{(file.size / 1024).toFixed(0)} KB</p>
                  <p className="text-xs text-green-600 mt-2">Archivo listo para analizar</p>
                </div>
              ) : (
                <div>
                  <div className="text-4xl mb-3">📐</div>
                  <p className="font-medium text-gray-700">Arrastra el PDF aquí</p>
                  <p className="text-sm text-gray-400 mt-1">o haz clic para seleccionar</p>
                  <p className="text-xs text-gray-300 mt-3">PDF · Máximo 20 MB</p>
                </div>
              )}
            </div>

            {error && (
              <p className="text-sm text-red-600 bg-red-50 px-4 py-3 rounded-lg">{error}</p>
            )}

            {(status === 'uploading' || status === 'analyzing') && (
              <div className="text-center py-4">
                <div className="inline-flex items-center gap-3 text-gray-600">
                  <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  <span className="text-sm font-medium">
                    {status === 'uploading' ? 'Subiendo archivo...' : 'Claude está leyendo el plano...'}
                  </span>
                </div>
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={handleUpload}
                disabled={!file || status === 'uploading' || status === 'analyzing'}
                className="flex-1 bg-gray-900 text-white py-4 rounded-xl font-semibold text-sm hover:bg-gray-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Analizar plano
              </button>
              <button
                onClick={handleSkip}
                className="px-6 py-4 border border-gray-200 rounded-xl text-sm text-gray-500 hover:border-gray-400 transition-colors"
              >
                Omitir
              </button>
            </div>

            <p className="text-xs text-center text-gray-400">
              Si no tienes el plano, puedes omitir este paso y describir el apartamento en el chat.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
