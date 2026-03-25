export function SystemHealth() {
  const services = [
    { name: 'API Gateway', status: 'online', latency: '24ms' },
    { name: 'GRI Engine', status: 'online', latency: '142ms' },
    { name: 'Data Pipeline', status: 'online', latency: '87ms' },
    { name: 'Report Service', status: 'degraded', latency: '324ms' },
    { name: 'Notifications', status: 'online', latency: '12ms' },
  ]

  return (
    <div className="bg-surface-container-low rounded-xl px-5 py-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="status-dot-online" />
          <span className="text-[11px] font-mono text-primary uppercase tracking-widest">System Status</span>
        </div>
        <span className="text-[10px] font-mono text-on-surface-variant">All services operational</span>
      </div>
      <div className="flex flex-wrap gap-3">
        {services.map((svc) => (
          <div key={svc.name} className="flex items-center gap-2 bg-surface-container rounded-lg px-3 py-1.5">
            <span className={svc.status === 'online' ? 'status-dot-online' : 'status-dot-warning'} />
            <span className="text-xs text-on-surface-variant">{svc.name}</span>
            <span className="text-[10px] font-mono text-on-surface-variant/50">{svc.latency}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
