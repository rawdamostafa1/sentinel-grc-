/**
 * W7 - Risk Register and Heatmap (Rawda).
 * 5x5 heatmap, register table, risk detail with trend chart, and the acceptance workflow.
 * Data comes from the GRC API through the /grc proxy (see api/grc.ts).
 */
import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import {
  acceptRisk,
  fetchHeatmap,
  fetchRiskHistory,
  fetchRisks,
  recalculateRisks,
  setRiskStatus,
  type Band,
  type GrcRisk,
  type HeatBasis,
  type HeatCell,
  type Heatmap,
  type RiskHistoryPoint,
  type RiskStatus,
} from '../api/grc'
import { useAuth } from '../auth/AuthContext'
import { DataTable, type Column } from '../components/DataTable'
import { DetailDrawer } from '../components/DetailDrawer'
import { KpiTile } from '../components/KpiTile'
import { PageHeader } from '../components/PageHeader'
import { SeverityBadge } from '../components/SeverityBadge'

const LEVELS = [1, 2, 3, 4, 5]
const BAND_RGB: Record<Band, string> = {
  Low: '59, 130, 246',
  Medium: '234, 179, 8',
  High: '249, 115, 22',
  Critical: '239, 68, 68',
}
const STATUS_LABEL: Record<RiskStatus, string> = {
  open: 'Open',
  in_treatment: 'In treatment',
  accepted: 'Accepted',
  closed: 'Closed',
}

const card: CSSProperties = {
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border)',
  borderRadius: 14,
  padding: 16,
}
const field: CSSProperties = {
  background: 'var(--bg-panel)',
  border: '1px solid var(--border)',
  borderRadius: 10,
  color: 'var(--text)',
  padding: '8px 12px',
  width: '100%',
  boxSizing: 'border-box',
}
const button: CSSProperties = {
  background: 'var(--bg-panel)',
  border: '1px solid var(--border)',
  borderRadius: 10,
  color: 'var(--text)',
  padding: '8px 14px',
  cursor: 'pointer',
}

// ---------- helpers ----------
function fmtDate(value: string | null): string {
  if (!value) return '—'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString()
}

/** The API sends UTC times without a timezone marker; add one so the browser reads them as UTC. */
function asUtc(value: string): string {
  return /Z$|[+-]\d\d:?\d\d$/.test(value) ? value : `${value}Z`
}

function fmtDateTime(value: string | null): string {
  if (!value) return '—'
  const d = new Date(asUtc(value))
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString()
}

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
}

function tomorrowISO(): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return d.toISOString().slice(0, 10)
}

// ---------- page ----------
export function RiskRegisterPage() {
  const { hasRole } = useAuth()
  const canEdit = hasRole('Admin', 'Analyst')

  const [risks, setRisks] = useState<GrcRisk[]>([])
  const [heatmap, setHeatmap] = useState<Heatmap | null>(null)
  const [basis, setBasis] = useState<HeatBasis>('inherent')
  const [cellFilter, setCellFilter] = useState<HeatCell | null>(null)
  const [statusFilter, setStatusFilter] = useState('')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const refresh = useCallback(async () => {
    try {
      const [riskList, map] = await Promise.all([fetchRisks(), fetchHeatmap(basis)])
      setRisks(riskList)
      setHeatmap(map)
      setError('')
    } catch (err) {
      setError(`${errorText(err, 'Failed to load risks')} — is the GRC API running on port 8001?`)
    } finally {
      setLoading(false)
    }
  }, [basis])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const selected = risks.find((r) => r.risk_id === selectedId) ?? null

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return risks.filter((r) => {
      if (cellFilter && !cellFilter.risk_ids.includes(r.risk_id)) return false
      if (statusFilter && r.status !== statusFilter) return false
      if (!q) return true
      return [r.risk_id, r.title, r.owner, ...r.asset_ids].join(' ').toLowerCase().includes(q)
    })
  }, [risks, cellFilter, statusFilter, search])

  function selectCell(cell: HeatCell) {
    if (cell.count === 0) return
    const same = cellFilter?.likelihood === cell.likelihood && cellFilter?.impact === cell.impact
    setCellFilter(same ? null : cell)
  }

  async function onRecalculate() {
    setBusy(true)
    setNotice('')
    try {
      const result = await recalculateRisks()
      setNotice(
        `Recalculated ${result.checked} risks from incidents and findings: ${result.changed} moved on the map` +
          (result.skipped ? ` (${result.skipped} skipped: accepted, closed or manual).` : '.'),
      )
      setCellFilter(null)
      await refresh()
    } catch (err) {
      setError(errorText(err, 'Recalculation failed'))
    } finally {
      setBusy(false)
    }
  }

  const expiredCount = risks.filter((r) => r.acceptance_expired).length

  const columns: Column<GrcRisk>[] = [
    { key: 'id', header: 'ID', render: (r) => r.risk_id },
    { key: 'title', header: 'Risk', render: (r) => <strong>{r.title}</strong> },
    { key: 'assets', header: 'Assets', render: (r) => r.asset_ids.join(', ') },
    { key: 'li', header: 'L × I', render: (r) => `${r.likelihood} × ${r.impact}` },
    {
      key: 'score',
      header: 'Inherent',
      render: (r) => <ScoreCell score={r.inherent_score} band={r.inherent_band} />,
    },
    {
      key: 'residual',
      header: 'Residual',
      render: (r) => <ScoreCell score={r.residual_score} band={r.residual_band} />,
    },
    { key: 'treatment', header: 'Treatment', render: (r) => r.treatment },
    {
      key: 'status',
      header: 'Status',
      render: (r) => (
        <span>
          {STATUS_LABEL[r.status]}
          {r.acceptance_expired ? (
            <span style={{ color: 'var(--danger)', marginLeft: 6, fontSize: 12 }}>acceptance expired</span>
          ) : null}
        </span>
      ),
    },
    { key: 'due', header: 'Due', render: (r) => fmtDate(r.due_date) },
    { key: 'owner', header: 'Owner', render: (r) => r.owner },
  ]

  return (
    <div>
      <PageHeader
        title="Risk Register"
        subtitle="Heatmap, register and acceptance workflow. The map moves when risks change."
        actions={
          canEdit ? (
            <button type="button" style={button} disabled={busy} onClick={() => void onRecalculate()}>
              {busy ? 'Recalculating...' : 'Recalculate from incidents'}
            </button>
          ) : undefined
        }
      />

      {error ? <div style={{ color: 'var(--danger)', marginBottom: 12 }}>{error}</div> : null}
      {notice ? <div style={{ color: 'var(--text-muted)', marginBottom: 12 }}>{notice}</div> : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
        <KpiTile label="Active risks" value={heatmap?.total ?? '—'} hint="open, in treatment or accepted" />
        <KpiTile label="Critical" value={heatmap?.bands.Critical ?? '—'} hint="score 17–25" />
        <KpiTile label="High" value={heatmap?.bands.High ?? '—'} hint="score 10–16" />
        <KpiTile label="Expired acceptances" value={expiredCount} hint="back on the map, need a decision" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(340px, 460px) 1fr', gap: 16, alignItems: 'start' }}>
        <section style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3 style={{ margin: 0, fontSize: 16 }}>Risk heatmap</h3>
            <select value={basis} onChange={(e) => setBasis(e.target.value as HeatBasis)} style={{ ...field, width: 'auto' }}>
              <option value="inherent">Inherent</option>
              <option value="residual">Residual</option>
            </select>
          </div>
          {heatmap ? (
            <HeatmapGrid heatmap={heatmap} selected={cellFilter} onSelect={selectCell} />
          ) : (
            <div style={{ color: 'var(--text-muted)' }}>{loading ? 'Loading heatmap...' : 'No heatmap data'}</div>
          )}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 12, fontSize: 12 }}>
            {(['Low', 'Medium', 'High', 'Critical'] as Band[]).map((band) => (
              <span key={band} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 12, height: 12, borderRadius: 3, background: `rgb(${BAND_RGB[band]})` }} />
                {band}: {heatmap?.bands[band] ?? 0}
              </span>
            ))}
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 8 }}>
            Click a cell to filter the table. Closed risks are not drawn.
          </div>
        </section>

        <section>
          <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search ID, title, owner, asset..."
              style={{ ...field, width: 'auto', minWidth: 260 }}
            />
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ ...field, width: 'auto' }}>
              <option value="">All statuses</option>
              {(Object.keys(STATUS_LABEL) as RiskStatus[]).map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
            {cellFilter ? (
              <button type="button" style={button} onClick={() => setCellFilter(null)}>
                Cell L{cellFilter.likelihood} × I{cellFilter.impact} ✕
              </button>
            ) : null}
          </div>
          {loading ? (
            <div style={{ color: 'var(--text-muted)' }}>Loading risks...</div>
          ) : (
            <DataTable
              columns={columns}
              rows={visible}
              rowKey={(r) => r.risk_id}
              onRowClick={(r) => setSelectedId(r.risk_id)}
              emptyMessage="No risks match"
            />
          )}
        </section>
      </div>

      <DetailDrawer
        open={selected !== null}
        title={selected ? `${selected.risk_id} — ${selected.title}` : ''}
        onClose={() => setSelectedId(null)}
      >
        {selected ? <RiskDetail risk={selected} canEdit={canEdit} onChanged={refresh} /> : null}
      </DetailDrawer>
    </div>
  )
}

// ---------- heatmap ----------
function HeatmapGrid({
  heatmap,
  selected,
  onSelect,
}: {
  heatmap: Heatmap
  selected: HeatCell | null
  onSelect: (cell: HeatCell) => void
}) {
  const byKey = useMemo(() => {
    const map = new Map<string, HeatCell>()
    heatmap.cells.forEach((c) => map.set(`${c.likelihood}-${c.impact}`, c))
    return map
  }, [heatmap])

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '24px 28px repeat(5, 1fr)', gap: 4, alignItems: 'stretch' }}>
      <div
        style={{
          gridRow: '1 / span 5',
          writingMode: 'vertical-rl',
          transform: 'rotate(180deg)',
          textAlign: 'center',
          color: 'var(--text-muted)',
          fontSize: 12,
        }}
      >
        Likelihood
      </div>
      {[...LEVELS].reverse().map((likelihood) => (
        <HeatRow key={likelihood} likelihood={likelihood} byKey={byKey} selected={selected} onSelect={onSelect} />
      ))}
      <div />
      <div />
      {LEVELS.map((impact) => (
        <div key={impact} style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
          {impact}
        </div>
      ))}
      <div />
      <div />
      <div style={{ gridColumn: '3 / span 5', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
        Impact
      </div>
    </div>
  )
}

function HeatRow({
  likelihood,
  byKey,
  selected,
  onSelect,
}: {
  likelihood: number
  byKey: Map<string, HeatCell>
  selected: HeatCell | null
  onSelect: (cell: HeatCell) => void
}) {
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
        {likelihood}
      </div>
      {LEVELS.map((impact) => {
        const cell = byKey.get(`${likelihood}-${impact}`)
        if (!cell) return <div key={impact} />
        const isSelected = selected?.likelihood === likelihood && selected?.impact === impact
        return (
          <button
            key={impact}
            type="button"
            onClick={() => onSelect(cell)}
            title={
              cell.count
                ? `${cell.band} (${cell.score}): ${cell.risk_ids.join(', ')}`
                : `${cell.band} (${cell.score}): no risks`
            }
            style={{
              height: 64,
              borderRadius: 8,
              cursor: cell.count ? 'pointer' : 'default',
              background: `rgba(${BAND_RGB[cell.band]}, ${cell.count ? 0.6 : 0.14})`,
              border: isSelected ? '2px solid var(--text)' : '1px solid var(--border)',
              color: 'var(--text)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 2,
              overflow: 'hidden',
            }}
          >
            <span style={{ fontSize: 20, fontWeight: 700 }}>{cell.count || ''}</span>
            {cell.count ? (
              <span style={{ fontSize: 10, lineHeight: 1.2 }}>
                {cell.risk_ids.slice(0, 2).join(' ')}
                {cell.risk_ids.length > 2 ? ` +${cell.risk_ids.length - 2}` : ''}
              </span>
            ) : null}
          </button>
        )
      })}
    </>
  )
}

function ScoreCell({ score, band }: { score: number; band: Band }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <strong>{score}</strong>
      <SeverityBadge severity={band} />
    </span>
  )
}

// ---------- detail drawer ----------
function RiskDetail({
  risk,
  canEdit,
  onChanged,
}: {
  risk: GrcRisk
  canEdit: boolean
  onChanged: () => Promise<void>
}) {
  const [history, setHistory] = useState<RiskHistoryPoint[] | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [acceptedBy, setAcceptedBy] = useState('')
  const [reason, setReason] = useState('')
  const [expiresOn, setExpiresOn] = useState('')

  const riskId = risk.risk_id
  const updatedAt = risk.updated_at

  useEffect(() => {
    let cancelled = false
    fetchRiskHistory(riskId)
      .then((points) => {
        if (!cancelled) setHistory(points)
      })
      .catch(() => {
        if (!cancelled) setHistory([])
      })
    return () => {
      cancelled = true
    }
  }, [riskId, updatedAt])

  const chartData = (history ?? []).map((p) => ({
    label: new Date(asUtc(p.ts)).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }),
    Inherent: p.inherent_score,
    Residual: p.residual_score,
  }))

  async function submitAcceptance() {
    setMessage('')
    if (!acceptedBy.trim() || !reason.trim() || !expiresOn) {
      setMessage('Owner, reason and an expiry date are all required.')
      return
    }
    if (expiresOn <= new Date().toISOString().slice(0, 10)) {
      setMessage('The expiry date must be in the future.')
      return
    }
    setBusy(true)
    try {
      await acceptRisk(riskId, {
        accepted_by: acceptedBy.trim(),
        reason: reason.trim(),
        expires_at: `${expiresOn}T23:59:59Z`,
      })
      setAcceptedBy('')
      setReason('')
      setExpiresOn('')
      setMessage('Risk accepted.')
      await onChanged()
    } catch (err) {
      setMessage(errorText(err, 'Could not accept the risk'))
    } finally {
      setBusy(false)
    }
  }

  async function changeStatus(status: 'open' | 'in_treatment' | 'closed') {
    setBusy(true)
    setMessage('')
    try {
      await setRiskStatus(riskId, status)
      await onChanged()
    } catch (err) {
      setMessage(errorText(err, 'Could not change the status'))
    } finally {
      setBusy(false)
    }
  }

  const live = risk.live_factors as { incident_count?: number; finding_count?: number } | null

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <section style={card}>
        <div style={{ display: 'flex', gap: 16, marginBottom: 10, flexWrap: 'wrap' }}>
          <div>
            <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>Inherent</div>
            <ScoreCell score={risk.inherent_score} band={risk.inherent_band} />
          </div>
          <div>
            <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>Residual</div>
            <ScoreCell score={risk.residual_score} band={risk.residual_band} />
          </div>
        </div>
        <Row k="Assets" v={risk.asset_ids.join(', ')} />
        <Row k="Owner" v={risk.owner} />
        <Row k="Threat" v={risk.threat || '—'} />
        <Row k="Vulnerability" v={risk.vulnerability || '—'} />
        <Row k="Likelihood × Impact" v={`${risk.likelihood} × ${risk.impact}`} />
        <Row k="Treatment" v={risk.treatment} />
        <Row k="Status" v={STATUS_LABEL[risk.status]} />
        <Row k="Due date" v={fmtDate(risk.due_date)} />
        <Row k="Review date" v={fmtDate(risk.review_date)} />
        <Row k="Existing controls" v={risk.existing_controls.join(', ') || '—'} />
        <Row k="Last recalculated" v={fmtDateTime(risk.last_recalculated)} />
        {live ? (
          <Row k="Live evidence" v={`${live.incident_count ?? 0} incidents, ${live.finding_count ?? 0} findings`} />
        ) : null}
        {risk.description ? (
          <p style={{ color: 'var(--text-muted)', margin: '8px 0 0', fontSize: 13 }}>{risk.description}</p>
        ) : null}
      </section>

      <section style={card}>
        <h3 style={{ margin: '0 0 8px', fontSize: 15 }}>Risk trend</h3>
        {history === null ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading history...</div>
        ) : chartData.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            No history yet. Each recalculation from incidents saves a point here.
          </div>
        ) : (
          <div style={{ height: 200 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 0, left: -16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis domain={[0, 25]} ticks={[0, 5, 10, 17, 25]} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="Inherent" stroke="#ef4444" strokeWidth={2} dot />
                <Line type="monotone" dataKey="Residual" stroke="#3b82f6" strokeWidth={2} dot />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <section style={card}>
        <h3 style={{ margin: '0 0 8px', fontSize: 15 }}>Acceptance</h3>

        {risk.acceptance_expired ? (
          <Notice color="var(--danger)">
            The previous acceptance expired{risk.acceptance ? ` on ${fmtDate(risk.acceptance.expires_at)}` : ''}. The
            risk is back on the map and needs a new decision.
          </Notice>
        ) : null}

        {risk.status === 'accepted' && risk.acceptance ? (
          <>
            <Row k="Accepted by" v={risk.acceptance.accepted_by} />
            <Row k="Reason" v={risk.acceptance.reason} />
            <Row k="Accepted on" v={fmtDateTime(risk.acceptance.accepted_at)} />
            <Row k="Expires" v={fmtDate(risk.acceptance.expires_at)} />
            <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 6 }}>
              When the expiry date passes the risk returns to Open automatically.
            </div>
          </>
        ) : canEdit && risk.status !== 'closed' ? (
          <div style={{ display: 'grid', gap: 8 }}>
            <input
              style={field}
              placeholder="Accepted by (owner)"
              value={acceptedBy}
              onChange={(e) => setAcceptedBy(e.target.value)}
            />
            <textarea
              style={{ ...field, minHeight: 64, resize: 'vertical' }}
              placeholder="Reason for accepting this risk"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Acceptance expires on
              <input
                type="date"
                style={{ ...field, marginTop: 4 }}
                min={tomorrowISO()}
                value={expiresOn}
                onChange={(e) => setExpiresOn(e.target.value)}
              />
            </label>
            <button type="button" style={button} disabled={busy} onClick={() => void submitAcceptance()}>
              Accept risk
            </button>
          </div>
        ) : (
          <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            {risk.status === 'closed' ? 'Closed risks cannot be accepted.' : 'Only Admin and Analyst can accept risks.'}
          </div>
        )}
        {message ? <div style={{ marginTop: 8, fontSize: 13, color: 'var(--text-muted)' }}>{message}</div> : null}
      </section>

      {canEdit && risk.status !== 'accepted' ? (
        <section style={card}>
          <h3 style={{ margin: '0 0 8px', fontSize: 15 }}>Status</h3>
          <select
            style={field}
            disabled={busy}
            value={risk.status}
            onChange={(e) => void changeStatus(e.target.value as 'open' | 'in_treatment' | 'closed')}
          >
            <option value="open">Open</option>
            <option value="in_treatment">In treatment</option>
            <option value="closed">Closed</option>
          </select>
        </section>
      ) : null}
    </div>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '4px 0', fontSize: 14 }}>
      <span style={{ color: 'var(--text-muted)' }}>{k}</span>
      <span style={{ textAlign: 'right' }}>{v}</span>
    </div>
  )
}

function Notice({ color, children }: { color: string; children: ReactNode }) {
  return (
    <div
      style={{
        border: `1px solid ${color}`,
        color,
        borderRadius: 10,
        padding: '8px 12px',
        fontSize: 13,
        marginBottom: 10,
      }}
    >
      {children}
    </div>
  )
}
