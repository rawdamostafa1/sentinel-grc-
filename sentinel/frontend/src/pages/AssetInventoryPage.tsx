import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import {
  Background,
  Controls,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { fetchAssets, fetchAssetSummary, type AssetSummary, type GrcAsset, type RelatedItem } from '../api/grc'
import { DataTable, type Column } from '../components/DataTable'
import { DetailDrawer } from '../components/DetailDrawer'
import { KpiTile } from '../components/KpiTile'
import { PageHeader } from '../components/PageHeader'
import { SeverityBadge } from '../components/SeverityBadge'
import type { Severity } from '../types'

type View = 'table' | 'map'
type Kind = 'incidents' | 'findings' | 'risks' | 'controls'

const KINDS: Kind[] = ['incidents', 'findings', 'risks', 'controls']
const KIND_LABEL: Record<Kind, string> = {
  incidents: 'Incidents',
  findings: 'Findings',
  risks: 'Risks',
  controls: 'Controls',
}
const KIND_COLOR: Record<Kind, string> = {
  incidents: '#ef4444',
  findings: '#f97316',
  risks: '#a855f7',
  controls: '#06b6d4',
}
const CRITICALITY_COLOR: Record<number, string> = {
  5: 'var(--critical)',
  4: 'var(--high)',
  3: 'var(--medium)',
  2: 'var(--low)',
  1: 'var(--low)',
}

const card: CSSProperties = {
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border)',
  borderRadius: 14,
  padding: 16,
}
const input: CSSProperties = {
  background: 'var(--bg-panel)',
  border: '1px solid var(--border)',
  borderRadius: 10,
  color: 'var(--text)',
  padding: '8px 12px',
}

// ---------- small helpers ----------
function pick(item: RelatedItem, ...keys: string[]): string {
  for (const key of keys) {
    const value = item[key]
    if (typeof value === 'string' || typeof value === 'number') return String(value)
  }
  return ''
}

function toSeverity(value: unknown): Severity | null {
  const map: Record<string, Severity> = {
    critical: 'Critical',
    high: 'High',
    medium: 'Medium',
    low: 'Low',
  }
  return map[String(value ?? '').toLowerCase()] ?? null
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString()
}

function itemTitle(kind: Kind, item: RelatedItem): { id: string; text: string } {
  switch (kind) {
    case 'incidents':
      return {
        id: pick(item, 'incident_id', 'id'),
        text: [pick(item, 'title'), ...(Array.isArray(item.attack_families) ? item.attack_families : [])]
          .filter(Boolean)
          .join(' · ') || pick(item, 'src_ip'),
      }
    case 'findings':
      return { id: pick(item, 'finding_id', 'id'), text: pick(item, 'title', 'name', 'endpoint') }
    case 'risks':
      return { id: pick(item, 'risk_id', 'id'), text: pick(item, 'title') }
    case 'controls':
      return { id: pick(item, 'control_id', 'id'), text: pick(item, 'title', 'name', 'description') }
  }
}

function itemSeverity(kind: Kind, item: RelatedItem): Severity | null {
  return toSeverity(kind === 'risks' ? item.inherent_band : item.severity)
}

// ---------- small components ----------
function CriticalityBadge({ value }: { value: number }) {
  const color = CRITICALITY_COLOR[value] ?? 'var(--low)'
  return (
    <span
      title={`Criticality ${value} of 5`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        fontWeight: 700,
        color,
      }}
    >
      <span style={{ display: 'inline-flex', gap: 2 }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <span
            key={n}
            style={{
              width: 6,
              height: 14,
              borderRadius: 2,
              background: n <= value ? color : 'var(--border)',
            }}
          />
        ))}
      </span>
      {value}
    </span>
  )
}

function Chip({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        background: 'var(--accent-soft)',
        color: 'var(--accent)',
        borderRadius: 999,
        padding: '2px 10px',
        fontSize: 12,
        fontWeight: 600,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 14, wordBreak: 'break-word' }}>{children}</div>
    </div>
  )
}

// ---------- the per-asset panel ----------
function RelatedList({ kind, items }: { kind: Kind; items: RelatedItem[] }) {
  if (items.length === 0) {
    return (
      <div style={{ color: 'var(--text-muted)', padding: '12px 0' }}>
        No {KIND_LABEL[kind].toLowerCase()} linked to this asset yet.
      </div>
    )
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {items.map((item, index) => {
        const { id, text } = itemTitle(kind, item)
        const severity = itemSeverity(kind, item)
        const status = pick(item, 'status')
        return (
          <div
            key={`${id}-${index}`}
            style={{
              background: 'var(--bg-panel)',
              border: '1px solid var(--border)',
              borderLeft: `3px solid ${KIND_COLOR[kind]}`,
              borderRadius: 10,
              padding: '10px 12px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
              <strong style={{ fontSize: 13 }}>{id || '(no id)'}</strong>
              {severity ? <SeverityBadge severity={severity} /> : null}
            </div>
            {text ? <div style={{ fontSize: 13, marginTop: 4 }}>{text}</div> : null}
            {status ? (
              <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 4 }}>
                Status: {status}
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

function AssetPanel({
  asset,
  summary,
  loading,
  error,
}: {
  asset: GrcAsset
  summary: AssetSummary | null
  loading: boolean
  error: string
}) {
  const [tab, setTab] = useState<'overview' | Kind>('overview')
  const tabs: Array<'overview' | Kind> = ['overview', ...KINDS]

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
        {tabs.map((name) => {
          const active = tab === name
          const count = name === 'overview' ? null : summary?.counts[name]
          return (
            <button
              key={name}
              onClick={() => setTab(name)}
              style={{
                border: '1px solid var(--border)',
                background: active ? 'var(--accent-soft)' : 'transparent',
                color: active ? 'var(--accent)' : 'var(--text-muted)',
                borderRadius: 999,
                padding: '4px 12px',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              {name === 'overview' ? 'Overview' : KIND_LABEL[name]}
              {count !== null && count !== undefined ? ` (${count})` : ''}
            </button>
          )
        })}
      </div>

      {tab === 'overview' ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <Field label="Asset ID">{asset.asset_id}</Field>
          <Field label="Type">{asset.type}</Field>
          <Field label="Owner">{asset.owner}</Field>
          <Field label="Business service">{asset.business_service}</Field>
          <Field label="Criticality">
            <CriticalityBadge value={asset.criticality} />
          </Field>
          <Field label="Data classification">{asset.data_classification}</Field>
          <Field label="Exposure">{asset.exposure}</Field>
          <Field label="Environment">{asset.environment}</Field>
          <Field label="Hostnames">
            {asset.hostnames.length ? asset.hostnames.join(', ') : '—'}
          </Field>
          <Field label="IP addresses">
            {asset.ip_addresses.length ? asset.ip_addresses.join(', ') : '—'}
          </Field>
          <Field label="Last seen">{formatDate(asset.last_seen)}</Field>
          <Field label="Status">{asset.status}</Field>
          <div style={{ gridColumn: '1 / -1' }}>
            <Field label="Description">{asset.description || '—'}</Field>
          </div>
        </div>
      ) : loading ? (
        <div style={{ color: 'var(--text-muted)' }}>Loading related items...</div>
      ) : error ? (
        <div style={{ color: 'var(--danger)' }}>{error}</div>
      ) : summary ? (
        <RelatedList kind={tab} items={summary[tab]} />
      ) : null}
    </div>
  )
}

// ---------- relationship map ----------
const MAX_PER_GROUP = 6
const ROW = 72
const GROUP_GAP = 24
const LEFT_X = 20
const CENTER_X = 400
const RIGHT_X = 780

function graphNode(
  id: string,
  kind: string,
  label: string,
  x: number,
  y: number,
  color: string,
  side: 'left' | 'center' | 'right',
): Node {
  return {
    id,
    position: { x, y },
    // left items point INTO the asset, the asset points OUT to right items
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    data: {
      label: (
        <div style={{ fontSize: 12, lineHeight: 1.3 }}>
          <div style={{ opacity: 0.7 }}>{kind}</div>
          <strong>{label}</strong>
        </div>
      ),
    },
    style: {
      background: '#121a2b',
      color: '#e8eef9',
      border: `2px solid ${color}`,
      borderRadius: 12,
      padding: 8,
      width: 180,
      ...(side === 'center' ? { fontSize: 14 } : {}),
    },
  }
}

/** Left column: what happened to the asset (incidents, findings). Right column: how we manage it (risks, controls). */
function buildGraph(summary: AssetSummary): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = []
  const edges: Edge[] = []
  const columns: Array<{ kinds: Kind[]; x: number; side: 'left' | 'right' }> = [
    { kinds: ['incidents', 'findings'], x: LEFT_X, side: 'left' },
    { kinds: ['risks', 'controls'], x: RIGHT_X, side: 'right' },
  ]
  const heights: number[] = []

  for (const column of columns) {
    let y = 0
    for (const kind of column.kinds) {
      const items = summary[kind]
      if (items.length === 0) continue
      const shown = items.slice(0, MAX_PER_GROUP)
      shown.forEach((item, index) => {
        const { id, text } = itemTitle(kind, item)
        const nodeId = `${kind}-${index}`
        nodes.push(
          graphNode(nodeId, KIND_LABEL[kind].replace(/s$/, ''), id || text || '?', column.x, y, KIND_COLOR[kind], column.side),
        )
        edges.push({
          id: `e-${nodeId}`,
          source: column.side === 'left' ? nodeId : 'asset',
          target: column.side === 'left' ? 'asset' : nodeId,
          animated: kind === 'incidents',
          markerEnd: { type: MarkerType.ArrowClosed, color: KIND_COLOR[kind] },
          style: { stroke: KIND_COLOR[kind] },
        })
        y += ROW
      })
      if (items.length > shown.length) {
        nodes.push(
          graphNode(`${kind}-more`, KIND_LABEL[kind], `+${items.length - shown.length} more`, column.x, y, '#64748b', column.side),
        )
        y += ROW
      }
      y += GROUP_GAP
    }
    heights.push(Math.max(0, y - GROUP_GAP))
  }

  const assetY = Math.max(0, (Math.max(...heights) - ROW) / 2)
  nodes.push(
    graphNode('asset', summary.asset.business_service, summary.asset.name, CENTER_X, assetY, '#22c55e', 'center'),
  )
  return { nodes, edges }
}

function RelationshipMap({ summary }: { summary: AssetSummary }) {
  const { nodes, edges } = useMemo(() => buildGraph(summary), [summary])
  return (
    <div
      style={{
        height: 620,
        borderRadius: 12,
        overflow: 'hidden',
        border: '1px solid var(--border)',
        background: 'var(--bg-panel)',
      }}
    >
      <ReactFlow
        key={summary.asset.asset_id}
        nodes={nodes}
        edges={edges}
        fitView
        proOptions={{ hideAttribution: true }}
        nodesConnectable={false}
        elementsSelectable
      >
        <Controls />
        <Background gap={18} size={1} />
      </ReactFlow>
    </div>
  )
}

// ---------- the page ----------
export function AssetInventoryPage() {
  const [assets, setAssets] = useState<GrcAsset[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [exposureFilter, setExposureFilter] = useState('all')
  const [minCriticality, setMinCriticality] = useState(1)

  const [view, setView] = useState<View>('table')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [summaryState, setSummaryState] = useState<{
    id: string
    data: AssetSummary | null
    error: string
  } | null>(null)

  useEffect(() => {
    fetchAssets()
      .then(setAssets)
      .catch((err) =>
        setError(
          err instanceof Error
            ? `${err.message}. Is the GRC API running on port 8001?`
            : 'Failed to load assets',
        ),
      )
      .finally(() => setLoading(false))
  }, [])

  const types = useMemo(() => Array.from(new Set(assets.map((a) => a.type))).sort(), [assets])
  const exposures = useMemo(() => Array.from(new Set(assets.map((a) => a.exposure))).sort(), [assets])

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return assets
      .filter((a) => typeFilter === 'all' || a.type === typeFilter)
      .filter((a) => exposureFilter === 'all' || a.exposure === exposureFilter)
      .filter((a) => a.criticality >= minCriticality)
      .filter(
        (a) =>
          !q ||
          [a.name, a.asset_id, a.owner, a.business_service, ...a.hostnames, ...a.ip_addresses]
            .join(' ')
            .toLowerCase()
            .includes(q),
      )
      .sort((a, b) => b.criticality - a.criticality || a.name.localeCompare(b.name))
  }, [assets, search, typeFilter, exposureFilter, minCriticality])

  // the map always needs an asset to draw: default to the first one in the list
  const activeId = view === 'map' ? (selectedId ?? rows[0]?.asset_id ?? null) : selectedId

  const needSummary = drawerOpen || view === 'map'
  useEffect(() => {
    if (!activeId || !needSummary) return
    let cancelled = false
    fetchAssetSummary(activeId)
      .then((data) => {
        if (!cancelled) setSummaryState({ id: activeId, data, error: '' })
      })
      .catch((err) => {
        if (!cancelled) {
          setSummaryState({
            id: activeId,
            data: null,
            error: err instanceof Error ? err.message : 'Failed to load',
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [activeId, needSummary])

  const current = summaryState && summaryState.id === activeId ? summaryState : null
  const shownSummary = current?.data ?? null
  const summaryError = current?.error ?? ''
  const summaryLoading = Boolean(activeId) && needSummary && !current
  const selectedAsset = assets.find((a) => a.asset_id === selectedId) ?? null

  const columns: Column<GrcAsset>[] = [
    {
      key: 'name',
      header: 'Asset',
      render: (a) => (
        <div>
          <strong>{a.name}</strong>
          <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>{a.asset_id}</div>
        </div>
      ),
    },
    { key: 'type', header: 'Type', render: (a) => <Chip>{a.type}</Chip> },
    { key: 'owner', header: 'Owner', render: (a) => a.owner },
    {
      key: 'criticality',
      header: 'Criticality',
      render: (a) => <CriticalityBadge value={a.criticality} />,
    },
    { key: 'data', header: 'Data', render: (a) => a.data_classification },
    { key: 'exposure', header: 'Exposure', render: (a) => a.exposure },
    { key: 'env', header: 'Env', render: (a) => a.environment },
    { key: 'seen', header: 'Last seen', render: (a) => formatDate(a.last_seen) },
  ]

  const viewButton = (name: View, label: string) => (
    <button
      onClick={() => setView(name)}
      style={{
        border: '1px solid var(--border)',
        background: view === name ? 'var(--accent-soft)' : 'transparent',
        color: view === name ? 'var(--accent)' : 'var(--text-muted)',
        borderRadius: 10,
        padding: '8px 14px',
        cursor: 'pointer',
        fontWeight: 600,
      }}
    >
      {label}
    </button>
  )

  return (
    <div>
      <PageHeader
        title="Asset Inventory"
        subtitle="What the customer owns and how much each asset matters. Click an asset to see its incidents, findings and risks."
        actions={
          <div style={{ display: 'flex', gap: 8 }}>
            {viewButton('table', 'Table')}
            {viewButton('map', 'Relationship map')}
          </div>
        }
      />

      {error ? <div style={{ color: 'var(--danger)', marginBottom: 12 }}>{error}</div> : null}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
          gap: 12,
          marginBottom: 16,
        }}
      >
        <KpiTile label="Total assets" value={assets.length} />
        <KpiTile
          label="Internet-facing"
          value={assets.filter((a) => a.exposure === 'internet-facing').length}
          hint="Reachable by attackers"
        />
        <KpiTile
          label="High value (4-5)"
          value={assets.filter((a) => a.criticality >= 4).length}
          hint="Criticality 4 or 5"
        />
        <KpiTile
          label="Confidential data"
          value={assets.filter((a) => a.data_classification === 'confidential').length}
        />
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <input
          style={{ ...input, flex: '1 1 260px', maxWidth: 360 }}
          placeholder="Search name, owner, IP"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select style={input} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="all">All types</option>
          {types.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select style={input} value={exposureFilter} onChange={(e) => setExposureFilter(e.target.value)}>
          <option value="all">All exposures</option>
          {exposures.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select style={input} value={minCriticality} onChange={(e) => setMinCriticality(Number(e.target.value))}>
          <option value={1}>Any criticality</option>
          {[2, 3, 4, 5].map((n) => (
            <option key={n} value={n}>
              Criticality {n}+
            </option>
          ))}
        </select>
        {view === 'map' ? (
          <select
            style={input}
            value={activeId ?? ''}
            onChange={(e) => setSelectedId(e.target.value || null)}
          >
            {rows.map((a) => (
              <option key={a.asset_id} value={a.asset_id}>
                Map: {a.name}
              </option>
            ))}
          </select>
        ) : null}
      </div>

      {loading ? (
        <div style={{ color: 'var(--text-muted)' }}>Loading assets...</div>
      ) : view === 'table' ? (
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(a) => a.asset_id}
          emptyMessage="No assets match these filters"
          onRowClick={(a) => {
            setSelectedId(a.asset_id)
            setDrawerOpen(true)
          }}
        />
      ) : (
        <section style={card}>
          {summaryLoading ? (
            <div style={{ color: 'var(--text-muted)' }}>Loading relationships...</div>
          ) : summaryError ? (
            <div style={{ color: 'var(--danger)' }}>{summaryError}</div>
          ) : shownSummary ? (
            <>
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 12, fontSize: 13 }}>
                {KINDS.map((kind) => (
                  <span key={kind} style={{ color: KIND_COLOR[kind], fontWeight: 600 }}>
                    {KIND_LABEL[kind]}: {shownSummary.counts[kind]}
                  </span>
                ))}
              </div>
              <RelationshipMap summary={shownSummary} />
            </>
          ) : (
            <div style={{ color: 'var(--text-muted)' }}>No asset selected.</div>
          )}
        </section>
      )}

      <DetailDrawer
        open={drawerOpen && selectedAsset !== null}
        title={selectedAsset?.name ?? ''}
        onClose={() => setDrawerOpen(false)}
      >
        {selectedAsset ? (
          <AssetPanel
            key={selectedAsset.asset_id}
            asset={selectedAsset}
            summary={shownSummary}
            loading={summaryLoading}
            error={summaryError}
          />
        ) : null}
      </DetailDrawer>
    </div>
  )
}
