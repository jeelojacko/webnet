import React from 'react';

import { AdjustmentCoordinateSystemCard } from './AdjustmentCoordinateSystemCard';
import { AdjustmentGeodeticFrameworkCard } from './AdjustmentGeodeticFrameworkCard';
import { AdjustmentSolverConfigurationCard } from './AdjustmentSolverConfigurationCard';
import type { AdjustmentProjectOptionsTabProps } from './AdjustmentProjectOptionsTab.types';

const AdjustmentProjectOptionsTab: React.FC<AdjustmentProjectOptionsTabProps> = ({
  context,
}) => (
  <div className="space-y-4">
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      <AdjustmentSolverConfigurationCard context={context} />
      <AdjustmentGeodeticFrameworkCard context={context} />
      <AdjustmentCoordinateSystemCard context={context} />
    </div>
  </div>
);

export default AdjustmentProjectOptionsTab;
