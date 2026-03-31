'use client'

import { useState } from 'react'
import { useDropzone } from 'react-dropzone'
import { Card, CardHeader, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Upload, CheckCircle2, Loader2, AlertCircle } from 'lucide-react'
import { runPointADiagnostic } from '@/app/actions/diagnostics'
import { cn } from '@/lib/utils'

interface DocumentUploadProps {
  clientId: string
  onComplete?: (result: any) => void
}

export function DocumentUpload({ clientId, onComplete }: DocumentUploadProps) {
  const [status, setStatus] = useState<'idle' | 'uploading' | 'analyzing' | 'complete' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)

  const onDrop = async (acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) return

    const file = acceptedFiles[0]
    setFileName(file.name)
    setStatus('uploading')
    setError(null)

    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('clientId', clientId)

      setStatus('analyzing')
      const result = await runPointADiagnostic(formData)
      
      setStatus('complete')
      onComplete?.(result)
    } catch (err: any) {
      setError(err.message || 'Analysis failed')
      setStatus('error')
    }
  }

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    multiple: false,
    accept: {
      'application/pdf': ['.pdf'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'text/plain': ['.txt'],
    }
  })

  return (
    <Card className="w-full">
      <CardHeader 
        title="Загрузка документов для анализа"
        description="Загрузите бизнес-план, финансовый отчет или презентацию для автоматической диагностики Точки А."
      />
      <CardContent>
        <div
          {...getRootProps()}
          className={cn(
            "border-2 border-dashed rounded-lg p-8 text-center transition-all duration-200 cursor-pointer",
            isDragActive ? "border-primary bg-primary/5 scale-[1.01]" : "border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/50",
            (status === 'analyzing' || status === 'uploading') && "opacity-80 pointer-events-none"
          )}
        >
          <input {...getInputProps()} />
          
          <div className="flex flex-col items-center gap-3">
            {status === 'idle' && (
              <>
                <div className="p-4 bg-primary/10 rounded-full mb-2">
                  <Upload className="w-8 h-8 text-primary" />
                </div>
                <div className="space-y-1">
                  <p className="font-semibold text-lg">Перетащите файл или кликните</p>
                  <p className="text-sm text-muted-foreground">PDF, Word, Excel до 10MB</p>
                </div>
              </>
            )}

            {(status === 'uploading' || status === 'analyzing') && (
              <>
                <div className="relative">
                  <Loader2 className="w-12 h-12 animate-spin text-primary" />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-2 h-2 bg-primary rounded-full" />
                  </div>
                </div>
                <div className="space-y-1">
                  <p className="font-semibold text-lg">
                    {status === 'uploading' ? 'Загрузка файла...' : 'Анализ через Claude 3.5 Sonnet...'}
                  </p>
                  <p className="text-sm text-muted-foreground animate-pulse">{fileName}</p>
                </div>
              </>
            )}

            {status === 'complete' && (
              <>
                <div className="p-4 bg-green-100 rounded-full mb-2 animate-in zoom-in duration-300">
                  <CheckCircle2 className="w-10 h-10 text-green-600" />
                </div>
                <div className="space-y-1">
                  <p className="font-semibold text-xl text-green-700">Диагностика завершена!</p>
                  <p className="text-sm text-muted-foreground">Отчет GRI успешно сформирован и сохранен.</p>
                </div>
                <Button variant="outline" className="mt-4" onClick={(e) => {
                  e.stopPropagation();
                  setStatus('idle');
                  setFileName(null);
                }}>
                  Загрузить еще
                </Button>
              </>
            )}

            {status === 'error' && (
              <>
                <div className="p-4 bg-red-100 rounded-full mb-2">
                  <AlertCircle className="w-10 h-10 text-red-600" />
                </div>
                <div className="space-y-1">
                  <p className="font-semibold text-xl text-red-600">Ошибка анализа</p>
                  <p className="text-sm text-muted-foreground max-w-xs">{error}</p>
                </div>
                <Button variant="outline" className="mt-4" onClick={(e) => {
                  e.stopPropagation();
                  setStatus('idle');
                }}>
                  Попробовать снова
                </Button>
              </>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
