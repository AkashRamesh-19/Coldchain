export const researchDataset: {
  readonly id: string;
  readonly revision: string;
  readonly file: string;
  readonly sha256: string;
  readonly rows: number;
  readonly columns: number;
  readonly shipments: readonly string[];
  readonly probes: readonly string[];
};

export type ResearchRow = Record<string, unknown> & {
  _id: string;
  shipment_id: string;
  Time: string;
  dataset_revision: string;
};

export function normalizeCell(value: unknown): unknown;
export function buildResearchDocuments(headers: string[], rows: unknown[][]): ResearchRow[];
export function upsertResearchDocuments(collection: { bulkWrite(operations: unknown[], options: { ordered: boolean }): Promise<unknown> }, documents: ResearchRow[]): Promise<void>;
export function summarizeResearchRows(rows: ResearchRow[]): {
  rowCount: number;
  shipmentCounts: Record<string, number>;
  meanTMean: number | null;
  riskLevelCounts: Record<string, number>;
  missingRiskLevelCount: number;
  missingProbeCounts: Record<string, number>;
  next120R2: { positive: number; negative: number; missing: number };
  timeRange: { start: string; end: string } | null;
};
