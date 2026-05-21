export default function Loading() {
  return (
    <div className="p-4 sm:p-6 space-y-4 animate-pulse">
      <div className="flex items-center justify-between gap-3 pb-4 border-b border-white/[0.06]">
        <div className="h-8 w-48 bg-white/[0.04] rounded" />
        <div className="flex items-center gap-2">
          <div className="h-8 w-20 bg-white/[0.04] rounded" />
          <div className="h-8 w-24 bg-white/[0.04] rounded" />
          <div className="h-8 w-14 bg-white/[0.04] rounded" />
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="h-[420px] bg-white/[0.03] rounded-2xl" />
        <div className="h-[420px] bg-white/[0.03] rounded-2xl" />
      </div>
      <div className="h-[320px] bg-white/[0.03] rounded-2xl" />
      <div className="h-[260px] bg-white/[0.03] rounded-2xl" />
    </div>
  )
}
