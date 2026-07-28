export default function ExpertReportsPage() {
  return (
    <div className="space-y-8">
      <section>
        <p className="mb-3 text-xs font-mono uppercase tracking-[0.2em] text-primary/70">
          Expert Portal
        </p>
        <h1 className="font-headline text-3xl font-extrabold text-on-surface">Отчёты</h1>
        <p className="mt-2 text-sm text-on-surface-variant">
          Архив аналитических отчётов эксперта
        </p>
      </section>

      <div
        role="status"
        className="flex items-start gap-3 rounded-2xl border border-tertiary-container/25 bg-tertiary-container/5 px-4 py-3"
      >
        <span className="material-symbols-outlined mt-0.5 text-lg text-tertiary-container">
          construction
        </span>
        <div>
          <p className="text-sm font-medium text-on-surface">Раздел ещё не подключён к архиву</p>
          <p className="mt-1 text-xs text-on-surface-variant">
            Загрузка и скачивание отключены, чтобы не создавать впечатление выполненной операции.
          </p>
        </div>
      </div>

      <div
        aria-disabled="true"
        className="rounded-2xl border-2 border-dashed border-white/[0.08] p-8 text-center opacity-70"
      >
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-surface-container">
          <span className="material-symbols-outlined text-2xl text-on-surface-variant">
            upload_off
          </span>
        </div>
        <p className="mb-1 text-sm font-medium text-on-surface">Загрузка файлов недоступна</p>
        <p className="text-xs text-on-surface-variant">
          Здесь появится форма после подключения постоянного хранилища.
        </p>
      </div>

      <section className="rounded-2xl border border-white/[0.04] bg-surface-container-low p-8 text-center">
        <span className="material-symbols-outlined mb-3 block text-4xl text-on-surface-variant/20">
          folder_off
        </span>
        <h2 className="text-sm font-medium text-on-surface">Архив не загружен</h2>
        <p className="mt-1 text-xs text-on-surface-variant">
          Демо-отчёты не отображаются как реальные документы.
        </p>
      </section>
    </div>
  )
}
