import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from './client';
import { DealRecord, DealInputs } from '../math/types';

export interface CreateProjectPayload {
  title: string;
  assetType?: 'single-family' | 'multi-unit' | 'commercial' | 'storage';
  location?: string;
  notes?: string;
  inputs: DealInputs;
}

export interface CreateProjectResponse {
  success: boolean;
  project: DealRecord;
  pitchDeck?: any;
  error?: string;
}

export interface MonteCarloHistogramBin {
  label: string;
  binStart: number;
  binEnd: number;
  count: number;
  isTail?: boolean;
}

export interface MonteCarloResult {
  runs: number;
  meanIrr: number;
  medianIrr: number;
  stdDev: number;
  minIrr: number;
  maxIrr: number;
  p10Irr: number;
  p25Irr: number;
  p50Irr: number;
  p75Irr: number;
  p90Irr: number;
  probabilityPositive: number;
  var95: number;
  downsideRiskProbability: number;
  histogramBins: MonteCarloHistogramBin[];
  underwritingAssumptions?: {
    baseIrr: number;
    baseGrowth: number;
    baseVacancy: number;
    baseApprec: number;
    baseExitCap: number;
  };
}

export interface MonteCarloOptions {
  runs?: number;
  rentGrowthVolPct?: number;
  vacancyVolPct?: number;
  exitCapSpreadBps?: number;
  apprecVolPct?: number;
}

export interface ScenarioDiffItem {
  key: string;
  label: string;
  oldValue: number | null;
  newValue: number | null;
  delta: number;
  isCurrency: boolean;
  isPct: boolean;
  suffix?: string;
}

export interface ScenarioRunRecord {
  id: string;
  deal_id: string;
  run_number: number;
  inputs: DealInputs;
  metrics: Record<string, any>;
  diff_from_previous?: ScenarioDiffItem[];
  created_at: string;
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    apikey: SUPABASE_ANON_KEY,
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

/**
 * Invoke the `create-project` Edge Function.
 * Validates deal parameters, runs initial pro-forma & risk audit, and inserts record into Supabase.
 */
export async function invokeCreateProject(payload: CreateProjectPayload): Promise<CreateProjectResponse> {
  const headers = await getAuthHeaders();
  const url = `${SUPABASE_URL}/functions/v1/create-project`;

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.error || `HTTP ${res.status}: Failed to create project`);
  }

  const data = await res.json();
  return data;
}

/**
 * Invoke the `simulate-monte-carlo` Edge Function.
 * Executes 1,000-run stochastic simulation with Gaussian volatility curves and returns adaptive histogram.
 */
export async function invokeSimulateMonteCarlo(
  inputs: DealInputs,
  assetType = 'single-family',
  options?: MonteCarloOptions,
): Promise<MonteCarloResult> {
  const headers = await getAuthHeaders();
  const url = `${SUPABASE_URL}/functions/v1/simulate-monte-carlo`;

  const body = {
    inputs,
    assetType,
    runs: options?.runs ?? 1000,
    rentGrowthVolPct: options?.rentGrowthVolPct,
    vacancyVolPct: options?.vacancyVolPct,
    exitCapSpreadBps: options?.exitCapSpreadBps,
    apprecVolPct: options?.apprecVolPct,
  };

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.error || `HTTP ${res.status}: Monte Carlo simulation failed`);
  }

  const data = await res.json();
  return data;
}

/**
 * Invoke `manage-scenarios` Edge Function to fetch parameter run history and metric impact diffs.
 */
export async function fetchScenarioHistory(dealId: string): Promise<ScenarioRunRecord[]> {
  const headers = await getAuthHeaders();
  const url = `${SUPABASE_URL}/functions/v1/manage-scenarios?dealId=${encodeURIComponent(dealId)}`;

  const res = await fetch(url, {
    method: 'GET',
    headers,
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.error || `HTTP ${res.status}: Failed to load scenario history`);
  }

  const data = await res.json();
  return data.runs || [];
}
