import React from 'react';
import type { ProjectOptionsModalContext } from '../../../hooks/useProjectOptionsModalController';
import AdjustedPointsExportCard from './otherFiles/AdjustedPointsExportCard';
import AdjustedPointsTransformCard from './otherFiles/AdjustedPointsTransformCard';
import OtherFileOutputsCard from './otherFiles/OtherFileOutputsCard';
import OutputVisibilityCard from './otherFiles/OutputVisibilityCard';

type OtherFilesProjectOptionsTabProps = {
  context: ProjectOptionsModalContext;
};

const OtherFilesProjectOptionsTab: React.FC<OtherFilesProjectOptionsTabProps> = ({
  context,
}) => (
  <>
    <OtherFileOutputsCard context={context} />
    <AdjustedPointsExportCard context={context} />
    <AdjustedPointsTransformCard context={context} />
    <OutputVisibilityCard context={context} />
  </>
);

export default OtherFilesProjectOptionsTab;
