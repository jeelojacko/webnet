import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import InputPane from '../src/components/InputPane';

describe('InputPane OPUS import notice', () => {
  it('renders the OPUS import banner when an imported report is loaded', () => {
    const html = renderToStaticMarkup(
      <InputPane
        input={'P TEST 1 2 3'}
        onChange={() => {}}
        importNotice={{
          title: 'Imported OPUS report',
          detailLines: [
            'Station ALPHA123 converted to P control input from opus_sample.txt.',
            'Reference frame: ITRF2020(EPOCH:2023.5000). Covariance: corrEN=0.1250.',
          ],
        }}
        onClearImportNotice={() => {}}
      />,
    );

    expect(html).toContain('Imported OPUS report');
    expect(html).toContain('Station ALPHA123 converted to P control input from opus_sample.txt.');
    expect(html).toContain('Covariance: corrEN=0.1250.');
    expect(html).toContain('Dismiss');
  });
});
