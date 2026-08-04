export interface PermanentExampleProject {
  id: 'preanalysis' | 'combined' | 'combined-split';
  title: string;
  description: string;
  projectUrl: string;
}

export const PERMANENT_EXAMPLE_PROJECTS: PermanentExampleProject[] = [
  {
    id: 'preanalysis',
    title: 'Pre-analysis',
    description: 'Current startup planning project.',
    projectUrl: '/examples/preanalysis/project.wnproj',
  },
  {
    id: 'combined',
    title: 'Combined',
    description: 'Combined traverse, leveling, and GNSS project.',
    projectUrl: '/examples/combined/project.wnproj',
  },
  {
    id: 'combined-split',
    title: 'Combined (split files)',
    description: 'Combined case split into traverse, leveling, and GNSS files.',
    projectUrl: '/examples/combined-split/project.wnproj',
  },
];
