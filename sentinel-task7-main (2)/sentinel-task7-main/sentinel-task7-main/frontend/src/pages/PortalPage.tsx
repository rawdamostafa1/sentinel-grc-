import { useEffect, useState, type CSSProperties } from 'react'
import { apiFetch } from '../api/client'
import { PageHeader } from '../components/PageHeader'
import type { StatsOverview } from '../types'

// W8: Client Portal. Everything about risk comes from ONE call to the GRC service:
//   GET /grc/portal/summary   (the Vite proxy sends /grc/* to the GRC API on port 8001)
// The alert counts and active protections still come from the platform API, as before.

interface Posture { score: number; label: string; active_risks: number; average_residual: number }
interface TopRisk {
  risk_id: string
  title: string
  band: string | null
  status: string
  due_date: string | null
  assets: string[]
}
interface IncidentSummary {
  window_days: number
  total: number
  open: number
  by_severity: Record<string, number>
  handled_autonomously_percent: number | null
}
interface Compliance { percent: number | null; frameworks: Record<string, number | null>; as_of: string | null }
interface AutoAction { when: string | null; description: string; undone: boolean }
interface ReportLink { title: string; created_at: string | null; url: string | null }
interface PortalSummary {
  generated_at: string
  posture: Posture | null
  top_risks: TopRisk[]
  incidents: IncidentSummary
  compliance: Compliance
  automatic_actions: AutoAction[]
  reports: ReportLink[]
  notes: string[]
}

const REFRESH_MS = 60_000

const LABEL_COLOR: Record<string, string> = {
  Good: 'var(--success)',
  Fair: 'var(--medium)',
  'Needs attention': 'var(--high)',
  'At risk': 'var(--critical)',
}
const LABEL_TEXT: Record<string, string> = {
  Good: 'Your risks are well under control.',
  Fair: 'Most risks are under control. A few still need attention.',
  'Needs attention': 'Several important risks are still open and need attention.',
  'At risk': 'Serious risks are open right now and need action.',
}
const BAND_COLOR: Record<string, string> = {
  Low: 'var(--low)',
  Medium: 'var(--medium)',
  High: 'var(--high)',
  Critical: 'var(--critical)',
}
const SEVERITIES = ['Critical', 'High', 'Medium', 'Low'] as const
const FRAMEWORK_NAME: Record<string, string> = {
  'NIST_CSF_2.0': 'NIST CSF 2.0',
  ISO27001_2022: 'ISO 27001:2022',
  CIS_V8_1: 'CIS Controls v8.1',
  OWASP_TOP10_2025: 'OWASP Top 10 (2025)',
}

function frameworkName(key: string): string {
  return FRAMEWORK_NAME[key] ?? key.replace(/_/g, ' ')
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString()
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleDateString()
}

// Only plain web links and links on the GRC service are allowed (no javascript: etc.)
function reportHref(url: string | null): string | null {
  if (!url) return null
  if (url.startsWith('/')) return `/grc${url}`
  return /^https?:\/\//i.test(url) ? url : null
}

export function PortalPage() {
  const [summary, setSummary] = useState<PortalSummary | null>(null)
  const [stats, setStats] = useState<StatsOverview | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true

    const load = () => {
      apiFetch<PortalSummary>('/grc/portal/summary')
        .then((data) => {
          if (!active) return
          setSummary(data)
          setError('')
        })
        .catch((err) => {
          if (active) setError(err instanceof Error ? err.message : 'Failed to load')
        })
      // optional: the platform numbers (alerts, protections); the page works without them
      apiFetch<StatsOverview>('/api/stats/overview')
        .then((data) => {
          if (active) setStats(data)
        })
        .catch(() => undefined)
    }

    load()
    const timer = window.setInterval(load, REFRESH_MS)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [])

  return (
    <div>
      <PageHeader
        title="Client Portal"
        subtitle="Plain-language posture view for Skyline (read-only)"
      />

      {error ? (
        <div style={{ ...card, borderColor: 'var(--danger)', color: 'var(--danger)', marginBottom: 16 }}>
          Could not load the portal data ({error}). Check that the GRC service is running.
        </div>
      ) : null}
      {!summary && !error ? (
        <div style={{ color: 'var(--text-muted)' }}>Loading portal...</div>
      ) : null}

      {summary ? (
        <div style={{ display: 'grid', gap: 16, maxWidth: 1100 }}>
          <PostureCard summary={summary} stats={stats} />

          <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))' }}>
            <TopRisksCard risks={summary.top_risks} />
            <IncidentsCard incidents={summary.incidents} />
            <ComplianceCard compliance={summary.compliance} />
            <ActionsCard actions={summary.automatic_actions} />
            <ReportsCard reports={summary.reports} />
          </div>

          {summary.notes.length > 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.6 }}>
              {summary.notes.map((note) => (
                <div key={note}>{note}</div>
              ))}
            </div>
          ) : null}
          <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>
            Updated {formatDateTime(summary.generated_at)}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function PostureCard({ summary, stats }: { summary: PortalSummary; stats: StatsOverview | null }) {
  const { posture, incidents } = summary
  const color = posture ? (LABEL_COLOR[posture.label] ?? 'var(--accent)') : 'var(--text-muted)'
  const handled = stats?.autonomous_percent ?? incidents.handled_autonomously_percent

  return (
    <section style={{ ...card, display: 'flex', gap: 28, flexWrap: 'wrap', alignItems: 'center' }}>
      <div style={{ minWidth: 150 }}>
        <div style={muted}>Security posture</div>
        {posture ? (
          <>
            <div style={{ fontSize: 52, fontWeight: 700, lineHeight: 1.1, color }}>
              {posture.score}
              <span style={{ fontSize: 20, color: 'var(--text-muted)' }}> / 100</span>
            </div>
            <span style={{ ...pill, color, borderColor: color }}>{posture.label}</span>
          </>
        ) : (
          <div style={{ fontSize: 20, marginTop: 8 }}>Not scored yet</div>
        )}
      </div>

      <div style={{ flex: 1, minWidth: 260, lineHeight: 1.7 }}>
        <p style={{ margin: 0 }}>
          {posture
            ? (LABEL_TEXT[posture.label] ?? '')
            : 'There are no active risks recorded yet, so a score cannot be calculated.'}
          {posture ? ` This is based on ${posture.active_risks} active risks.` : ''}
        </p>
        <p style={{ margin: '8px 0 0', color: 'var(--text-muted)' }}>
          Sentinel is actively monitoring your web application.
          {stats ? (
            <>
              {' '}In the last 24 hours there were <strong>{stats.alerts_24h}</strong> alerts
              {stats.active_blocks !== undefined ? (
                <>, with <strong>{stats.active_blocks}</strong> active protections in place</>
              ) : null}
              .
            </>
          ) : null}
          {handled !== null && handled !== undefined ? (
            <>
              {' '}About <strong>{handled}%</strong> of incidents were handled automatically.
            </>
          ) : null}
        </p>
      </div>
    </section>
  )
}

function TopRisksCard({ risks }: { risks: TopRisk[] }) {
  return (
    <section style={card}>
      <h3 style={heading}>Top risks</h3>
      {risks.length === 0 ? (
        <Empty text="No active risks are recorded." />
      ) : (
        <ul style={list}>
          {risks.map((risk) => {
            const color = BAND_COLOR[risk.band ?? ''] ?? 'var(--text-muted)'
            return (
              <li key={risk.risk_id} style={row}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{risk.title}</div>
                  <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                    {risk.assets.length > 0 ? risk.assets.join(', ') : 'No asset linked'}
                    {risk.due_date ? ` · to be handled by ${formatDate(risk.due_date)}` : ''}
                  </div>
                </div>
                {risk.band ? <span style={{ ...pill, color, borderColor: color }}>{risk.band}</span> : null}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function IncidentsCard({ incidents }: { incidents: IncidentSummary }) {
  return (
    <section style={card}>
      <h3 style={heading}>Incidents, last {incidents.window_days} days</h3>
      <div style={{ display: 'flex', gap: 28, marginBottom: 12 }}>
        <Figure value={incidents.total} label="real attacks" />
        <Figure value={incidents.open} label="still open" />
        {incidents.handled_autonomously_percent !== null ? (
          <Figure value={`${incidents.handled_autonomously_percent}%`} label="handled automatically" />
        ) : null}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
        {SEVERITIES.map((severity) => (
          <div key={severity} style={{ ...tile, borderColor: BAND_COLOR[severity] }}>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{incidents.by_severity[severity] ?? 0}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{severity}</div>
          </div>
        ))}
      </div>
      <div style={{ ...muted, marginTop: 10, fontSize: 12 }}>
        Tests you authorised and false alarms are not counted.
      </div>
    </section>
  )
}

function ComplianceCard({ compliance }: { compliance: Compliance }) {
  const frameworks = Object.entries(compliance.frameworks)
  return (
    <section style={card}>
      <h3 style={heading}>Compliance</h3>
      {compliance.percent === null ? (
        <Empty text="Compliance has not been calculated yet." />
      ) : (
        <>
          <div style={{ fontSize: 40, fontWeight: 700, lineHeight: 1.1 }}>{compliance.percent}%</div>
          <div style={{ ...muted, marginBottom: 12 }}>
            average across {frameworks.length} frameworks{compliance.as_of ? `, as of ${formatDate(compliance.as_of)}` : ''}
          </div>
          <div style={{ display: 'grid', gap: 10 }}>
            {frameworks.map(([name, percent]) => (
              <div key={name}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                  <span>{frameworkName(name)}</span>
                  <span style={{ color: 'var(--text-muted)' }}>{percent === null ? '-' : `${percent}%`}</span>
                </div>
                <div style={barTrack}>
                  <div style={{ ...barFill, width: `${Math.max(0, Math.min(100, percent ?? 0))}%` }} />
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  )
}

function ActionsCard({ actions }: { actions: AutoAction[] }) {
  return (
    <section style={card}>
      <h3 style={heading}>Protective actions taken automatically</h3>
      {actions.length === 0 ? (
        <Empty text="No automatic actions have been taken yet." />
      ) : (
        <ul style={list}>
          {actions.map((action, index) => (
            <li key={`${action.when ?? 'x'}-${index}`} style={row}>
              <div style={{ flex: 1 }}>
                <div>{action.description}</div>
                <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>{formatDateTime(action.when)}</div>
              </div>
              {action.undone ? <span style={{ ...pill, color: 'var(--text-muted)' }}>Reversed</span> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function ReportsCard({ reports }: { reports: ReportLink[] }) {
  return (
    <section style={card}>
      <h3 style={heading}>Reports</h3>
      {reports.length === 0 ? (
        <Empty text="No reports have been generated yet." />
      ) : (
        <ul style={list}>
          {reports.map((report, index) => {
            const href = reportHref(report.url)
            return (
              <li key={`${report.title}-${index}`} style={row}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>{report.title}</div>
                  <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>{formatDateTime(report.created_at)}</div>
                </div>
                {href ? (
                  <a href={href} download style={{ ...pill, color: 'var(--accent)', borderColor: 'var(--accent)' }}>
                    Download
                  </a>
                ) : (
                  <span style={{ ...pill, color: 'var(--text-muted)' }}>Not available</span>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function Figure({ value, label }: { value: number | string; label: string }) {
  return (
    <div>
      <div style={{ fontSize: 28, fontWeight: 700, lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{label}</div>
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return <div style={{ color: 'var(--text-muted)' }}>{text}</div>
}

const card: CSSProperties = {
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border)',
  borderRadius: 14,
  padding: 18,
}
const heading: CSSProperties = { margin: '0 0 12px', fontSize: 16 }
const muted: CSSProperties = { color: 'var(--text-muted)', fontSize: 13 }
const list: CSSProperties = { listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 10 }
const row: CSSProperties = { display: 'flex', alignItems: 'center', gap: 12 }
const pill: CSSProperties = {
  display: 'inline-block',
  padding: '2px 10px',
  borderRadius: 999,
  border: '1px solid var(--border)',
  fontSize: 12,
  fontWeight: 600,
  whiteSpace: 'nowrap',
}
const tile: CSSProperties = {
  border: '1px solid var(--border)',
  borderTopWidth: 3,
  borderRadius: 10,
  padding: '8px 10px',
  background: 'var(--bg-panel)',
}
const barTrack: CSSProperties = { height: 8, borderRadius: 999, background: 'var(--bg-panel)', overflow: 'hidden' }
const barFill: CSSProperties = { height: '100%', borderRadius: 999, background: 'var(--accent)' }
