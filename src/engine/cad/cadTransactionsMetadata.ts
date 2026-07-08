import type { CadEntity } from './cadTypes';

export const cloneEntityMetadata = (entity: CadEntity): Record<string, unknown> =>
  typeof entity.metadata === 'object' && entity.metadata != null ? { ...entity.metadata } : {};

export const withEntityMetadataName = <TEntity extends CadEntity>(
  entity: TEntity,
  name: string,
): TEntity => ({
  ...entity,
  metadata: {
    ...cloneEntityMetadata(entity),
    entityName: name,
  },
});
