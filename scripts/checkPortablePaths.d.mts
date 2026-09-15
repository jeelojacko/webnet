export interface PortablePathViolation {
  path: string;
  reason: string;
}

export function validatePortablePaths(_paths: string[]): PortablePathViolation[];
