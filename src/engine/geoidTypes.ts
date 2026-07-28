import type { GeoidSourceFormat } from '../types';

export interface GeoidGridModel {
  id: string;
  name: string;
  source: string;
  rows: number;
  cols: number;
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
  dLat: number;
  dLon: number;
  values: number[][];
}

export interface GeoidGridLoadOptions {
  modelId?: string;
  sourceFormat?: GeoidSourceFormat;
  sourcePath?: string;
  sourceData?: ArrayBuffer | Uint8Array | null;
}

export interface GeoidGridLoadResult {
  model: GeoidGridModel | null;
  fromCache: boolean;
  warning?: string;
  resolvedFormat: GeoidSourceFormat;
  fallbackUsed: boolean;
}
