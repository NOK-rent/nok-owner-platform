'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useWizard, type PhotoResult } from '@/components/apt-setup/WizardContext'
import Image from 'next/image'

const CATEGORIES = [
  { key: 'sala', label: 'Sala / Comedor', icon: '🛋️' },
  { key: 'habitacion', label: 'Habitaciones', icon: '🛏️' },
  { key: 'cocina', label: 'Cocina', icon: '🍳' },
  { key: 'lenceria', label: 'Lencería', icon: '🧹' },
]

type UploadState = {
  file: File
  preview: string
  status: 'uploading' | 'analyzing' | 'done' | 'error'
  result: PhotoResult | null
  progress: number
}

export default function PhotosPage() {
  const router = useRouter()
  const { state, updateState } = useWizard()
  const [uploads, setUploads] = useState<Record<string, UploadState[]>>({})
  const [activeCategory, setActiveCategory] = useState('sala')

  const handleFiles = useCallback(async (category: string, files: FileList | File[]) => {
    const fileArray = Array.from(files).slice(0, 5)
    const current = uploads[category] ?? []
    if (current.length + fileArray.length > 5) return

    const newUploads: UploadState[] = fileArray.map(file => ({
      file,
      preview: URL.createObjectURL(file),
      status: 'uploading' as const,
      result: null,
      progress: 0,
    }))

    setUploads(prev => ({
      ...prev,
      [category]: [...(prev[category] ?? []), ...newUploads],
    }))

    // Analyze each photo
    for (let idx = 0; idx < fileArray.length; idx++) {
      const file = fileArray[idx]
      const uploadIdx = current.length + idx

      // Set analyzing
      setUploads(prev => {
        const arr = [...(prev[category] ?? [])]
        if (arr[uploadIdx]) arr[uploadIdx] = { ...arr[uploadIdx], status: 'analyzing', progress: 50 }
        return { ...prev, [category]: arr }
      })

      try {
        const formData = new FormData()
        formData.append('file', file)
        formData.append('category', category)

        const res = await fetch('/api/apt-setup/analyze-photos', {
          method: 'POST',
          body: formData,
        })

        if (!res.ok) throw new Error('Analysis failed')

        const result = await res.json() as Omit<PhotoResult, 'photo_url' | 'file_name'>

        const photoResult: PhotoResult = {
          ...result,
          photo_url: URL.createObjectURL(file),
          file_name: file.name,
          category,
        }

        setUploads(prev => {
          const arr = [...(prev[category] ?? [])]
          if (arr[uploadIdx]) arr[uploadIdx] = { ...arr[uploadIdx], status: 'done', progress: 100, result: photoResult }
          return { ...prev, [category]: arr }
        })

        // Save to wizard state
        updateState({ photoResults: [...state.photoResults, photoResult] })
      } catch {
        setUploads(prev => {
          const arr = [...(prev[category] ?? [])]
          if (arr[uploadIdx]) arr[uploadIdx] = { ...arr[uploadIdx], status: 'error', progress: 0 }
          return { ...prev, [category]: arr }
        })
      }
    }
  }, [uploads, state.photoResults, updateState])

  const removePhoto = (category: string, idx: number) => {
    setUploads(prev => {
      const arr = [...(prev[category] ?? [])]
      const removed = arr.splice(idx, 1)[0]
      if (removed?.result) {
        updateState({
          photoResults: state.photoResults.filter(r => r.file_name !== removed.result!.file_name),
        })
      }
      return { ...prev, [category]: arr }
    })
  }

  const handleDrop = (e: React.DragEvent, category: string) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.dataTransfer.files.length > 0) {
      handleFiles(category, e.dataTransfer.files)
    }
  }

  const statusBadge = (status: PhotoResult['overall_status']) => {
    const config = {
      approved: { bg: 'bg-[#0E6845]/20', text: 'text-[#0E6845]', label: 'Aprobado' },
      needs_review: { bg: 'bg-[#D6A700]/20', text: 'text-[#D6A700]', label: 'Revisar' },
      rejected: { bg: 'bg-[#F20022]/20', text: 'text-[#F20022]', label: 'No cumple' },
    }
    const c = config[status]
    return <span className={`${c.bg} ${c.text} text-xs font-medium px-2.5 py-1 rounded-full`}>{c.label}</span>
  }

  const categoryUploads = uploads[activeCategory] ?? []
  const totalPhotos = Object.values(uploads).flat().length
  const analyzedPhotos = Object.values(uploads).flat().filter(u => u.status === 'done').length

  return (
    <div className="space-y-8">
      <div className="text-center sm:text-left">
        <p className="text-[#D6A700] text-xs font-semibold tracking-[0.2em] uppercase mb-2">Paso 2</p>
        <h1 className="font-[family-name:var(--font-secondary)] text-3xl sm:text-4xl font-light mb-2">
          Verificación con fotos
        </h1>
        <p className="text-[rgba(26,26,26,0.45)] text-sm">
          Sube fotos de cada espacio para verificar que muebles y decoración cumplan estándares NOK.
        </p>
      </div>

      {/* Category tabs */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {CATEGORIES.map(cat => {
          const catUploads = uploads[cat.key] ?? []
          const isActive = activeCategory === cat.key
          const doneCount = catUploads.filter(u => u.status === 'done').length

          return (
            <button
              key={cat.key}
              onClick={() => setActiveCategory(cat.key)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium whitespace-nowrap transition-all ${
                isActive
                  ? 'bg-[#1A1A1A] text-[#F0EFED]'
                  : 'bg-[#FFFFFF] text-[rgba(26,26,26,0.5)] hover:text-[#1A1A1A] border border-[rgba(26,26,26,0.08)]'
              }`}
            >
              <span>{cat.icon}</span>
              {cat.label}
              {doneCount > 0 && (
                <span className={`text-xs px-1.5 py-0.5 rounded-full ${isActive ? 'bg-[#F0EFED]/10 text-[#F0EFED]' : 'bg-[#D6A700]/20 text-[#D6A700]'}`}>
                  {doneCount}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Upload zone */}
      <div
        onDragOver={e => { e.preventDefault(); e.stopPropagation() }}
        onDrop={e => handleDrop(e, activeCategory)}
        className="border-2 border-dashed border-[rgba(26,26,26,0.1)] rounded-2xl p-8 text-center hover:border-[#D6A700]/40 transition-colors cursor-pointer"
        onClick={() => {
          const input = document.createElement('input')
          input.type = 'file'
          input.accept = 'image/jpeg,image/png,image/webp'
          input.multiple = true
          input.onchange = () => { if (input.files) handleFiles(activeCategory, input.files) }
          input.click()
        }}
      >
        <div className="w-12 h-12 rounded-full bg-[#FFFFFF] flex items-center justify-center mx-auto mb-3">
          <svg className="w-6 h-6 text-[rgba(26,26,26,0.3)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        </div>
        <p className="text-sm text-[rgba(26,26,26,0.5)]">
          Arrastra fotos aquí o <span className="text-[#D6A700]">selecciona archivos</span>
        </p>
        <p className="text-xs text-[rgba(26,26,26,0.2)] mt-1">
          JPG, PNG, WebP &middot; Máx 5MB &middot; Hasta 5 fotos por categoría
        </p>
      </div>

      {/* Uploaded photos grid */}
      {categoryUploads.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {categoryUploads.map((upload, idx) => (
            <div key={idx} className="bg-[#FFFFFF] border border-[rgba(26,26,26,0.08)] rounded-2xl overflow-hidden">
              {/* Image */}
              <div className="relative aspect-video bg-[#1A1A1A]">
                <Image src={upload.preview} alt={upload.file.name} fill className="object-cover" />

                {/* Remove button */}
                <button
                  onClick={() => removePhoto(activeCategory, idx)}
                  className="absolute top-2 right-2 w-7 h-7 bg-black/60 rounded-full flex items-center justify-center text-white/80 hover:bg-black/80 transition-colors text-xs"
                >
                  ✕
                </button>

                {/* Status overlay */}
                {upload.status === 'analyzing' && (
                  <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                    <div className="text-center">
                      <div className="w-8 h-8 border-2 border-[#D6A700] border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                      <p className="text-xs text-[rgba(26,26,26,0.7)]">Analizando...</p>
                    </div>
                  </div>
                )}

                {upload.status === 'uploading' && (
                  <div className="absolute bottom-0 left-0 right-0 h-1 bg-[#E5E3DF]">
                    <div className="h-full bg-[#833B0E] rounded-full transition-all" style={{ width: `${upload.progress}%` }} />
                  </div>
                )}
              </div>

              {/* Results */}
              {upload.result && (
                <div className="p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    {statusBadge(upload.result.overall_status)}
                    <div className="flex items-center gap-1.5">
                      <div className="w-16 h-1.5 bg-[#E5E3DF] rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-700"
                          style={{
                            width: `${upload.result.score}%`,
                            backgroundColor: upload.result.score >= 80 ? '#0E6845' : upload.result.score >= 50 ? '#D6A700' : '#F20022',
                          }}
                        />
                      </div>
                      <span className="text-xs text-[rgba(26,26,26,0.4)] tabular-nums">{upload.result.score}</span>
                    </div>
                  </div>

                  {upload.result.items_detected.length > 0 && (
                    <p className="text-xs text-[rgba(26,26,26,0.5)]">
                      Detectado: {upload.result.items_detected.join(', ')}
                    </p>
                  )}

                  {upload.result.issues.length > 0 && (
                    <div className="space-y-1">
                      {upload.result.issues.map((issue, j) => (
                        <p key={j} className="text-xs text-[#F20022] flex items-start gap-1.5">
                          <span className="text-[#F20022] mt-0.5">•</span>
                          {issue}
                        </p>
                      ))}
                    </div>
                  )}

                  {upload.result.recommendation && upload.result.overall_status !== 'approved' && (
                    <p className="text-xs text-[#D6A700] bg-[#D6A700]/10 px-3 py-2 rounded-lg">
                      {upload.result.recommendation}
                    </p>
                  )}
                </div>
              )}

              {upload.status === 'error' && (
                <div className="p-4">
                  <p className="text-xs text-[#F20022]">Error al analizar. Intenta de nuevo.</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Navigation */}
      <div className="flex items-center justify-between pt-4">
        <button
          onClick={() => router.push('/apt-setup/check')}
          className="text-sm text-[rgba(26,26,26,0.4)] hover:text-[#1A1A1A] transition-colors flex items-center gap-1"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Volver al check
        </button>

        <div className="flex items-center gap-4">
          {totalPhotos > 0 && (
            <span className="text-xs text-[rgba(26,26,26,0.3)]">
              {analyzedPhotos}/{totalPhotos} analizadas
            </span>
          )}
          <button
            onClick={() => {
              updateState({ photosComplete: true })
              router.push('/apt-setup/quote')
            }}
            className="px-6 py-3 bg-[#D6A700] hover:bg-[#C49800] text-[#F0EFED] rounded-xl text-sm font-semibold transition-colors"
          >
            Generar cotización
          </button>
        </div>
      </div>
    </div>
  )
}
