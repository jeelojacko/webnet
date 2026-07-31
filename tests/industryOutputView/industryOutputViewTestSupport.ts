import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import IndustryOutputView from '../../src/components/IndustryOutputView';
import type { ListingSortObservationsBy } from '../../src/listingSortObservations';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export { act, createRoot, IndustryOutputView, React, type ListingSortObservationsBy, type Root };