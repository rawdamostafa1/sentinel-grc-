/**
 * W8: Client Portal (Rawda). Read-only, plain language, for the customer (Skyline).
 * Data: GET /portal/summary on the GRC service. The service never sends IP addresses or raw payloads,
 * and a part whose owner has not delivered data yet comes back empty with a note (nothing is invented).
 */
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { fetchPortalSummary, type Band, type PortalSummary, type PostureLabel } from '../api/grc'
import { KpiTile } from '../components/KpiTile'
import { PageHeader } from '../components/PageHeader'

const BAND_COLOR: Record<Band, string> = {
  Critical: 'var(--critical)', High: 'var(--high)', Medium: 'var(--medium)', Low: 'var(--low)',
}
const BANDS: Band[] = ['Critical', 'High', 'Medium', 'Low']

const POSTURE_COLOR: Record<PostureLabel, string> = {
  Good: 'var(--success)', Fair: 'var(--medium)', 'Needs attention': 'var(--high)', 'At risk': 'var(--critical)',
}
const POSTURE_TEXT: Record<PostureLabel, string> = {
  Good: 'Your most serious risks are under control.',
  Fair: 'Some risks are still open. We are working through them, starting with the most serious.',
  'Needs attention': 'Several important risks are open and need to be treated soon.',
  'At risk': 'Serious risks are open and need action now.',
}
const FRAMEWORK_NAMES: Record<string, string> = {
  'NIST_CSF_2.0': 'NIST Cybersecurity Framework 2.0',
  CIS_V8_1: 'CIS Controls v8',
  ISO27001_2022: 'ISO/IEC 27001:2022',
  OWASP_TOP10_2025: 'OWASP Top 10',
}
const PERIODS = [7, 30, 90]

const card: CSSProperties = {
  background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 14, padding: 18,
}
const muted: CSSProperties = { color: 'var(--text-muted)', fontSize: 14, lineHeight: 1.6 }

function tint(color: string, percent: number): string {
  return `color-mix(in srgb, ${color} ${percent}%, transparent)`
}

function formatDate(value: string | null, withTime = false): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return withTime ? date.toLocaleString() : date.toLocaleDateString()
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={card}>
      <h3 style={{ margin: '0 0 12px', fontSize: 17 }}>{title}</h3>
      {children}
    </section>
  )
}

function Empty({ text }: { text: string }) {
  return <div style={muted}>{text}</div>
}

function BandChip({ band }: { band: Band }) {
  return (
    <span style={{
      display: 'inline-block', padding: '2px 10px', borderRadius: 999, fontSize: 12, fontWeight: 600,
      color: BAND_COLOR[band], background: tint(BAND_COLOR[band], 15), border: `1px solid ${tint(BAND_COLOR[band], 40)}`,
    }}>
      {band}
    </span>
  )
}

function PostureRing({ score, color }: { score: number; color: string }) {
  const radius = 54
  const circumference = 2 * Math.PI * radius
  return (
    <svg width="140" height="140" viewBox="0 0 140 140" role="img" aria-label={`Security posture ${score} out of 100`}>
      <circle cx="70" cy="70" r={radius} fill="none" stroke="var(--border)" strokeWidth="12" />
      <circle
        cx="70" cy="70" r={radius} fill="none" stroke={color} strokeWidth="12" strokeLinecap="round"
        strokeDasharray={`${(score / 100) * circumference} ${circumference}`} transform="rotate(-90 70 70)"
      />
      <text x="70" y="68" textAnchor="middle" fontSize="34" fontWeight="700" fill="var(--text)">{score}</text>
      <text x="70" y="90" textAnchor="middle" fontSize="12" fill="var(--text-muted)">out of 100</text>
    </svg>
  )
}

function ProgressBar({ percent, color }: { percent: number; color: string }) {
  return (
    <div style={{ height: 10, borderRadius: 999, background: 'var(--bg-panel)', overflow: 'hidden' }}>
      <div style={{ width: `${Math.max(0, Math.min(100, percent))}%`, height: '100%', background: color }} />
    </div>
  )
}

export function PortalPage() {
  const [days, setDays] = useState(30)
  const [result, setResult] = useState<{ days: number; data: PortalSummary } | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    fetchPortalSummary(days)
      .then((data) => { if (alive) { setResult({ days, data }); setError('') } })
      .catch((err) => { if (alive) setError(err instanceof Error ? err.message : 'Failed to load') })
    return () => { alive = false }
  }, [days])

  const data = result?.data ?? null
  const updating = !error && (!result || result.days !== days)

  return (
    <div>
      <PageHeader
        title="Client Portal"
        subtitle="Your security at a glance, in plain language. This page is read-only."
        actions={
          <label style={{ ...muted, display: 'flex', alignItems: 'center', gap: 8 }}>
            Period
            <select
              value={days} onChange={(e) => setDays(Number(e.target.value))}
              style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-panel)', color: 'var(--text)' }}
            >
              {PERIODS.map((p) => <option key={p} value={p}>Last {p} days</option>)}
            </select>
          </label>
        }
      />

      {error ? (
        <div style={{ ...card, color: 'var(--danger)', marginBottom: 16 }}>
          We could not load your security summary right now. Please try again in a few minutes.
          <div style={{ ...muted, marginTop: 6 }}>Details: {error}</div>
        </div>
      ) : null}
      {updating ? <div style={{ ...muted, marginBottom: 12 }}>Loading your summary...</div> : null}

      {data ? <PortalBody data={data} /> : null}
    </div>
  )
}

function PortalBody({ data }: { data: PortalSummary }) {
  const { posture, incidents, compliance } = data
  const maxSeverity = Math.max(1, ...BANDS.map((b) => incidents.by_severity[b] ?? 0))
  const frameworks = Object.entries(compliance.frameworks)

  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 1100 }}>
      <Section title="Your security posture">
        {posture ? (
          <div style={{ display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
            <PostureRing score={posture.score} color={POSTURE_COLOR[posture.label]} />
            <div style={{ flex: 1, minWidth: 260 }}>
              <div style={{ fontSize: 24, fontWeight: 700, color: POSTURE_COLOR[posture.label] }}>{posture.label}</div>
              <p style={{ ...muted, margin: '6px 0 0' }}>
                {POSTURE_TEXT[posture.label]} We are tracking <strong>{posture.active_risks}</strong> active
                {posture.active_risks === 1 ? ' risk' : ' risks'}. A higher score is better.
              </p>
            </div>
          </div>
        ) : (
          <Empty text="No risks have been recorded yet, so there is no posture score to show." />
        )}
      </Section>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
        <KpiTile label="Attacks detected" value={incidents.total} hint={`Last ${incidents.window_days} days`} />
        <KpiTile label="Still being handled" value={incidents.open} hint="Open incidents" />
        <KpiTile
          label="Handled automatically"
          value={incidents.handled_autonomously_percent === null ? 'Not available' : `${incidents.handled_autonomously_percent}%`}
          hint="Without waiting for a person"
        />
        <KpiTile
          label="Compliance"
          value={compliance.percent === null ? 'Not available' : `${compliance.percent}%`}
          hint={compliance.as_of ? `As of ${formatDate(compliance.as_of)}` : 'Not calculated yet'}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16 }}>
        <Section title="Attacks by seriousness">
          {incidents.total === 0 ? (
            <Empty text={`No attacks were detected in the last ${incidents.window_days} days.`} />
          ) : (
            <div style={{ display: 'grid', gap: 10 }}>
              {BANDS.map((band) => {
                const count = incidents.by_severity[band] ?? 0
                return (
                  <div key={band} style={{ display: 'grid', gridTemplateColumns: '80px 1fr 32px', gap: 10, alignItems: 'center' }}>
                    <span style={muted}>{band}</span>
                    <ProgressBar percent={(count / maxSeverity) * 100} color={BAND_COLOR[band]} />
                    <strong style={{ textAlign: 'right' }}>{count}</strong>
                  </div>
                )
              })}
            </div>
          )}
        </Section>

        <Section title="Compliance">
          {frameworks.length === 0 ? (
            <Empty text="Compliance has not been calculated yet." />
          ) : (
            <div style={{ display: 'grid', gap: 12 }}>
              {frameworks.map(([key, percent]) => (
                <div key={key}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 14 }}>
                    <span>{FRAMEWORK_NAMES[key] ?? key.replace(/_/g, ' ')}</span>
                    <strong>{percent === null ? '-' : `${percent}%`}</strong>
                  </div>
                  <ProgressBar percent={percent ?? 0} color="var(--accent)" />
                </div>
              ))}
              <div style={muted}>The percentage is the share of security controls that are in place.</div>
            </div>
          )}
        </Section>
      </div>

      <Section title="Your most important risks">
        {data.top_risks.length === 0 ? (
          <Empty text="No open risks to show." />
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {data.top_risks.map((risk) => (
              <div key={risk.risk_id} style={{
                display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap',
                padding: '10px 12px', borderRadius: 10, background: 'var(--bg-panel)',
              }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{risk.title}</div>
                  <div style={muted}>
                    {risk.assets.length ? `Affects: ${risk.assets.join(', ')}` : ''}
                    {risk.due_date ? ` · Fix planned by ${formatDate(risk.due_date)}` : ''}
                    {risk.status === 'accepted' ? ' · Accepted for now' : ''}
                  </div>
                </div>
                <BandChip band={risk.band} />
              </div>
            ))}
          </div>
        )}
      </Section>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16 }}>
        <Section title="What we did for you automatically">
          {data.automatic_actions.length === 0 ? (
            <Empty text="No automatic protective actions have been recorded yet." />
          ) : (
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 10 }}>
              {data.automatic_actions.map((action, index) => (
                <li key={index} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 14 }}>
                  <span>
                    {action.description}
                    {action.undone ? <span style={{ ...muted, marginLeft: 8 }}>(later reversed)</span> : null}
                  </span>
                  <span style={{ ...muted, whiteSpace: 'nowrap' }}>{formatDate(action.when, true)}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Reports">
          {data.reports.length === 0 ? (
            <Empty text="No reports are available yet." />
          ) : (
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 10 }}>
              {data.reports.map((report, index) => (
                <li key={index} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 14 }}>
                  <span>
                    {report.title}
                    {report.created_at ? <span style={{ ...muted, marginLeft: 8 }}>{formatDate(report.created_at)}</span> : null}
                  </span>
                  {report.url ? (
                    <a href={report.url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>Download</a>
                  ) : (
                    <span style={muted}>Not ready</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <div style={{ ...muted, fontSize: 12 }}>Updated {formatDate(data.generated_at, true)}</div>
    </div>
  )
}
