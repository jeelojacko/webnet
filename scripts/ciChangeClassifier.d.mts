export interface ChangeClassification {
  numericalRequired: boolean;
  reason: string;
  changedFileCount: number;
}

export function classifyChangedFiles(_files: string[]): ChangeClassification;
