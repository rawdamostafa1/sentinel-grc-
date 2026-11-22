import { useEffect, useState } from 'react'
import { fetchKris, type Kri } from '../api/grc'
import { KpiTile } from '../components/KpiTile'
import { PageHeader } from '../components/PageHeader'

// Key risk indicators. One call: GET /grc/kris (the Vite proxy sends /grc/* to the GRC service).
// A number that has no data yet says "No data" and why, nothing is invented.

function show(k: Kri) {
  return k.value === null || k.value === undefined ? 'No data' : `${k.value} ${k.unit}`.trim()
}

export function KriPage() {
  const [kris, setKris] = useState<Kri[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    const load = () => {
      fetchKris()
        .then((data) => {
          if (!active) return
          setKris(data.kris)
          setError('')
        })
        .catch((err) => {
          if (active) setError(err instanceof Error ? err.message : 'Failed to load')
        })
        .finally(() => active && setLoading(false))
    }
    load()
    const timer = window.setInterval(load, 30000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [])

  return (
    <div>
      <PageHeader
        title="Key risk indicators"
        subtitle="Early-warning numbers taken from the risk register, findings, incidents and policies."
      />
      {error ? (
        <div style={{ color: 'var(--text-muted)' }}>
          The GRC service is not reachable ({error}). Start it on port 8001 and this page will fill in.
        </div>
      ) : loading ? (
        <div style={{ color: 'var(--text-muted)' }}>Loading…</div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
            gap: 14,
          }}
        >
          {kris.map((k) => (
            <KpiTile key={k.key} label={k.label} value={show(k)} hint={k.note || k.source} />
          ))}
        </div>
      )}
    </div>
  )
}
