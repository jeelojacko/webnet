import { handleFieldGpsTopoRecord } from './parseFieldGpsTopoRecords';
import { handleFieldGpsVectorRecord } from './parseFieldGpsVectorRecords';
import { handleFieldLevelRecord } from './parseFieldLevelRecords';
import type {
  GpsCovarianceState,
  HandleFieldObservationRecordArgs,
} from './parseFieldObservationRecords.types';
import { handleFieldSideshotRecord } from './parseFieldSideshotRecords';

export type { GpsCovarianceState };

export const handleFieldObservationRecord = (
  args: HandleFieldObservationRecordArgs,
): boolean => {
  if (handleFieldSideshotRecord(args)) return true;
  if (handleFieldGpsTopoRecord(args)) return true;
  if (handleFieldGpsVectorRecord(args)) return true;
  if (handleFieldLevelRecord(args)) return true;
  return false;
};
