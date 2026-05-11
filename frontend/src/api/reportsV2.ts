import { api } from "./client";

// Profitability Reports
export interface JobProfitability {
  job_id: number;
  job_title: string;
  customer_name: string;
  status: string;
  labor_cost: number;
  parts_cost: number;
  travel_cost: number;
  other_cost: number;
  total_cost: number;
  revenue: number;
  profit: number;
  profit_margin: number;
  completed_at: string | null;
}

export interface ProfitabilitySummary {
  total_revenue: number;
  total_costs: number;
  total_profit: number;
  average_margin: number;
  jobs_analyzed: number;
  profitable_jobs: number;
  unprofitable_jobs: number;
}

// Productivity Reports
export interface ProductivityMetrics {
  technician_id: number;
  technician_name: string;
  jobs_completed: number;
  jobs_in_progress: number;
  total_labor_hours: number;
  average_job_duration: number;
  parts_installed: number;
  revenue_generated: number;
}

export interface ProductivitySummary {
  total_jobs_completed: number;
  total_labor_hours: number;
  average_job_duration: number;
  top_technicians: ProductivityMetrics[];
}

// Valuation Reports
export interface InventoryValuation {
  part_id: number;
  part_name: string;
  sku: string;
  quantity_on_hand: number;
  unit_cost: number;
  total_value: number;
  category: string;
  location: string;
}

// Store Manager Reports - Stock Usage
export interface StockUsage {
  part_id: number;
  part_name: string;
  sku: string;
  category: string;
  total_used: number;
  total_value: number;
  usage_count: number;
}

export interface FrequentlyUsedItem {
  part_id: number;
  part_name: string;
  sku: string;
  category: string;
  usage_count: number;
  total_quantity: number;
  average_per_use: number;
}

export interface StockUsageByTechnician {
  technician_id: number;
  technician_name: string;
  total_transactions: number;
  total_parts_used: number;
  total_value: number;
  parts_list: {
    part_id: number;
    part_name: string;
    sku: string;
    quantity: number;
    value: number;
  }[];
}

export interface IssuanceKpis {
  total_issue_transactions: number;
  total_issue_quantity: number;
  total_issue_value: number;
  avg_issue_value: number;
  pending_returns: number;
  return_approval_rate_percent: number;
}

export interface TechnicianZoneCoverage {
  technician_id: number;
  technician_name: string;
  zone_count: number;
  regions: string[];
  stations: string[];
}

// API Functions for Store Manager Reports
export async function getStockUsageReport(
  startDate?: string,
  endDate?: string,
  limit: number = 50
): Promise<StockUsage[]> {
  const params = new URLSearchParams();
  if (startDate) params.append("start_date", startDate);
  if (endDate) params.append("end_date", endDate);
  params.append("limit", limit.toString());
  return (await api.get<StockUsage[]>(`/api/reports/store-manager/stock-usage?${params}`)).data;
}

export async function getFrequentlyUsedItems(
  startDate?: string,
  endDate?: string,
  limit: number = 20
): Promise<FrequentlyUsedItem[]> {
  const params = new URLSearchParams();
  if (startDate) params.append("start_date", startDate);
  if (endDate) params.append("end_date", endDate);
  params.append("limit", limit.toString());
  return (await api.get<FrequentlyUsedItem[]>(`/api/reports/store-manager/frequently-used?${params}`)).data;
}

export async function getStockUsageByTechnician(
  startDate?: string,
  endDate?: string
): Promise<StockUsageByTechnician[]> {
  const params = new URLSearchParams();
  if (startDate) params.append("start_date", startDate);
  if (endDate) params.append("end_date", endDate);
  return (await api.get<StockUsageByTechnician[]>(`/api/reports/store-manager/usage-by-technician?${params}`)).data;
}

export async function getIssuanceKpis(
  startDate?: string,
  endDate?: string
): Promise<IssuanceKpis> {
  const params = new URLSearchParams();
  if (startDate) params.append("start_date", startDate);
  if (endDate) params.append("end_date", endDate);
  return (await api.get<IssuanceKpis>(`/api/reports/store-manager/issuance-kpis?${params}`)).data;
}

export async function getTechnicianZoneCoverage(): Promise<TechnicianZoneCoverage[]> {
  return (await api.get<TechnicianZoneCoverage[]>("/api/reports/store-manager/technician-zones")).data;
}

// Technician Personal Reports
export interface TechnicianMyUsage {
  technician_id: number;
  technician_name: string;
  total_transactions: number;
  total_parts_used: number;
  total_value: number;
  parts_list: {
    part_id: number;
    part_name: string;
    sku: string;
    quantity: number;
    value: number;
  }[];
}

export interface TechnicianFrequentItem {
  part_id: number;
  part_name: string;
  sku: string;
  category: string;
  usage_count: number;
  total_quantity: number;
  average_per_use: number;
}

export async function getMyStockUsage(
  startDate?: string,
  endDate?: string
): Promise<TechnicianMyUsage> {
  const params = new URLSearchParams();
  if (startDate) params.append("start_date", startDate);
  if (endDate) params.append("end_date", endDate);
  return (await api.get<TechnicianMyUsage>(`/api/reports/technician/my-usage?${params}`)).data;
}

export async function getMyFrequentlyUsedItems(
  startDate?: string,
  endDate?: string,
  limit: number = 20
): Promise<TechnicianFrequentItem[]> {
  const params = new URLSearchParams();
  if (startDate) params.append("start_date", startDate);
  if (endDate) params.append("end_date", endDate);
  params.append("limit", limit.toString());
  return (await api.get<TechnicianFrequentItem[]>(`/api/reports/technician/frequently-used?${params}`)).data;
}

export interface ValuationSummary {
  total_inventory_value: number;
  total_parts: number;
  total_quantity: number;
  value_by_category: Record<string, number>;
  value_by_location: Record<string, number>;
}

// Custom Reports
export interface CustomReportDefinition {
  id: number;
  name: string;
  description: string;
  report_type: string;
  created_at: string;
  created_by_user_id: number;
  config: Record<string, unknown>;
}

export interface ReportFilters {
  start_date?: string;
  end_date?: string;
  customer_id?: number;
}

export const reportsV2Api = {
  // Profitability Reports
  getProfitability: async (filters: ReportFilters = {}): Promise<ProfitabilitySummary> => {
    const params = new URLSearchParams();
    if (filters.start_date) params.append("start_date", filters.start_date);
    if (filters.end_date) params.append("end_date", filters.end_date);
    if (filters.customer_id) params.append("customer_id", filters.customer_id.toString());
    const response = await api.get<ProfitabilitySummary>(`/api/reports/profitability?${params.toString()}`);
    return response.data;
  },

  getProfitabilityDetails: async (filters: ReportFilters = {}): Promise<JobProfitability[]> => {
    const params = new URLSearchParams();
    if (filters.start_date) params.append("start_date", filters.start_date);
    if (filters.end_date) params.append("end_date", filters.end_date);
    if (filters.customer_id) params.append("customer_id", filters.customer_id.toString());
    const response = await api.get<JobProfitability[]>(`/api/reports/profitability/details?${params.toString()}`);
    return response.data;
  },

  // Productivity Reports
  getProductivity: async (filters: ReportFilters = {}): Promise<ProductivitySummary> => {
    const params = new URLSearchParams();
    if (filters.start_date) params.append("start_date", filters.start_date);
    if (filters.end_date) params.append("end_date", filters.end_date);
    const response = await api.get<ProductivitySummary>(`/api/reports/productivity?${params.toString()}`);
    return response.data;
  },

  getProductivityDetails: async (filters: ReportFilters = {}): Promise<ProductivityMetrics[]> => {
    const params = new URLSearchParams();
    if (filters.start_date) params.append("start_date", filters.start_date);
    if (filters.end_date) params.append("end_date", filters.end_date);
    const response = await api.get<ProductivityMetrics[]>(`/api/reports/productivity/details?${params.toString()}`);
    return response.data;
  },

  // Valuation Reports
  getValuation: async (filters: ReportFilters = {}): Promise<ValuationSummary> => {
    const params = new URLSearchParams();
    if (filters.start_date) params.append("start_date", filters.start_date);
    if (filters.end_date) params.append("end_date", filters.end_date);
    const response = await api.get<ValuationSummary>(`/api/reports/valuation?${params.toString()}`);
    return response.data;
  },

  getValuationDetails: async (filters: ReportFilters = {}): Promise<InventoryValuation[]> => {
    const params = new URLSearchParams();
    if (filters.start_date) params.append("start_date", filters.start_date);
    if (filters.end_date) params.append("end_date", filters.end_date);
    const response = await api.get<InventoryValuation[]>(`/api/reports/valuation/details?${params.toString()}`);
    return response.data;
  },

  // Export Reports
  exportReport: async (reportType: string, format: string = "excel"): Promise<Blob> => {
    const response = await api.get(`/api/reports/${reportType}/export`, {
      params: { format },
      responseType: "blob",
    });
    return response.data;
  },
};
