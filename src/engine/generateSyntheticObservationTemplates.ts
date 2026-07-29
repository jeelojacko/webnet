import type { SyntheticCanadianNetwork } from './generateSyntheticCanadianNetwork';

export const angleTripletsForTemplate = (network: SyntheticCanadianNetwork): Array<[string, string, string]> => {
  switch (network.template) {
    case 'braced-quadrilateral':
      return [
        ['C', 'A', 'D'],
        ['D', 'C', 'B'],
        ['D', 'C', 'L'],
      ];
    case 'short-traverse':
      return [
        ['C', 'A', 'D'],
        ['D', 'C', 'B'],
        ['L', 'D', 'B'],
      ];
    case 'loop':
      return [
        ['C', 'A', 'B'],
        ['D', 'C', 'E'],
        ['E', 'D', 'B'],
      ];
    case 'mixed-3d':
      return [
        ['C', 'A', 'D'],
        ['D', 'B', 'L'],
        ['L', 'C', 'E'],
      ];
    default:
      return [];
  }
};

export const edgesForTemplate = (network: SyntheticCanadianNetwork): Array<[string, string]> => {
  switch (network.template) {
    case 'braced-quadrilateral':
      return [
        ['A', 'C'],
        ['B', 'C'],
        ['A', 'D'],
        ['B', 'D'],
        ['C', 'D'],
        ['C', 'L'],
        ['D', 'L'],
      ];
    case 'short-traverse':
      return [
        ['A', 'C'],
        ['C', 'D'],
        ['B', 'D'],
        ['A', 'D'],
        ['D', 'L'],
        ['B', 'L'],
      ];
    case 'loop':
      return [
        ['A', 'C'],
        ['C', 'D'],
        ['D', 'E'],
        ['E', 'B'],
        ['B', 'C'],
        ['D', 'L'],
        ['E', 'L'],
      ];
    case 'mixed-3d':
      return [
        ['A', 'C'],
        ['B', 'C'],
        ['E', 'C'],
        ['A', 'D'],
        ['B', 'D'],
        ['E', 'D'],
        ['C', 'D'],
        ['E', 'L'],
        ['B', 'L'],
        ['C', 'L'],
        ['D', 'L'],
      ];
    default:
      return [];
  }
};

export const directionSetConfigsForTemplate = (
  network: SyntheticCanadianNetwork,
): Array<{ occupy: string; backsight: string; targets: string[] }> => {
  switch (network.template) {
    case 'braced-quadrilateral':
      return [
        { occupy: 'C', backsight: 'A', targets: ['D', 'L'] },
        { occupy: 'D', backsight: 'B', targets: ['C', 'L'] },
      ];
    case 'short-traverse':
      return [
        { occupy: 'C', backsight: 'A', targets: ['D'] },
        { occupy: 'D', backsight: 'B', targets: ['C', 'L'] },
      ];
    case 'loop':
      return [
        { occupy: 'C', backsight: 'A', targets: ['B', 'D'] },
        { occupy: 'D', backsight: 'C', targets: ['E', 'L'] },
      ];
    case 'mixed-3d':
      return [
        { occupy: 'C', backsight: 'A', targets: ['B', 'D', 'L'] },
        { occupy: 'D', backsight: 'B', targets: ['C', 'E', 'L'] },
      ];
    default:
      return [];
  }
};
