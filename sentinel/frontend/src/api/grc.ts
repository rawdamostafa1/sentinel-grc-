/**
 * GRC API client (Rawda: assets, risks, KRIs).
 * The GRC service runs on its own port (8001). Vite proxies /grc -> that service
 * (see vite.config.ts), so the browser never talks to it directly.
 */
import { apiFetch } from './client'

export interface GrcAsset {
  asset_id: string
  name: string
  type: string
  owner: string
  business_service: string
  criticality: number
  data_classification: string
  exposure: string
  environment: string
  hostnames: string[]
  ip_addresses: string[]
  description: string
  status: string
  last_seen: string | null
}

/** Incidents, findings, risks and controls come from different owners, so we read them loosely. */
export type RelatedItem = Record<string, unknown>

export interface AssetSummary {
  asset: GrcAsset
  incidents: RelatedItem[]
  findings: RelatedItem[]
  risks: RelatedItem[]
  controls: RelatedItem[]
  counts: { incidents: number; findings: number; risks: number; controls: number }
}

const BASE = '/grc'

export function fetchAssets() {
  return apiFetch<GrcAsset[]>(`${BASE}/assets`)
}

export function fetchAssetSummary(assetId: string) {
  return apiFetch<AssetSummary>(`${BASE}/assets/${encodeURIComponent(assetId)}/summary`)
}

// ---------- Risk register (W3), live risk (W4) and heatmap (W7) ----------

export type Band = 'Low' | 'Medium' | 'High' | 'Critical'
export type RiskStatus = 'open' | 'in_treatment' | 'accepted' | 'closed'
export type RiskTreatment = 'mitigate' | 'accept' | 'transfer' | 'avoid'

export interface RiskAcceptance {
  accepted_by: string
  reason: string
  expires_at: string
  accepted_at: string
}

export interface GrcRisk {
  risk_id: string
  title: string
  description: string
  asset_ids: string[]
  threat: string
  vulnerability: string
  owner: string
  likelihood: number
  impact: number
  existing_controls: string[]
  residual_likelihood: number | null
  residual_impact: number | null
  due_date: string | null
  review_date: string | null
  treatment: RiskTreatment
  status: RiskStatus
  inherent_score: number
  inherent_band: Band
  residual_score: number
  residual_band: Band
  acceptance: RiskAcceptance | null
  acceptance_expired: boolean
  base_likelihood: number | null
  live_factors: Record<string, unknown> | null
  last_recalculated: string | null
  created_at: string
  updated_at: string
}

export interface HeatCell {
  likelihood: number
  impact: number
  score: number
  band: Band
  count: number
  risk_ids: string[]
}

export type HeatBasis = 'inherent' | 'residual'

export interface Heatmap {
  basis: HeatBasis
  total: number
  cells: HeatCell[]
  bands: Record<Band, number>
}

export interface RiskHistoryPoint {
  risk_id: string
  ts: string
  likelihood: number
  impact: number
  inherent_score: number
  residual_score: number
  incident_count: number
  finding_count: number
}

export interface RecalcResult {
  checked: number
  changed: number
  skipped: number
  window_days: number
}

export function fetchRisks() {
  return apiFetch<GrcRisk[]>(`${BASE}/risks`)
}

export function fetchHeatmap(basis: HeatBasis) {
  return apiFetch<Heatmap>(`${BASE}/risks/heatmap?basis=${basis}`)
}

export function fetchRiskHistory(riskId: string) {
  return apiFetch<RiskHistoryPoint[]>(`${BASE}/risks/${encodeURIComponent(riskId)}/history`)
}

export function recalculateRisks() {
  return apiFetch<RecalcResult>(`${BASE}/risks/recalculate`, { method: 'POST' })
}

export function acceptRisk(
  riskId: string,
  body: { accepted_by: string; reason: string; expires_at: string },
) {
  return apiFetch<GrcRisk>(`${BASE}/risks/${encodeURIComponent(riskId)}/accept`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function setRiskStatus(riskId: string, status: 'open' | 'in_treatment' | 'closed') {
  return apiFetch<GrcRisk>(`${BASE}/risks/${encodeURIComponent(riskId)}`, {
    method: 'PUT',
    body: JSON.stringify({ status }),
  })
}

// ---------- Key risk indicators (W5) ----------

export interface Kri {
  key: string
  label: string
  value: number | null
  unit: string
  status: 'ok' | 'no_data'
  source: string
  note: string
}

export interface KrisResponse {
  generated_at: string
  kris: Kri[]
}

export function fetchKris() {
  return apiFetch<KrisResponse>(`${BASE}/kris`)
}
