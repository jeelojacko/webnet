import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import App from '../src/App';

describe('Project Options modal layout', () => {
  it('renders the condensed adjustment layout with level-loop preset controls', () => {
    const html = renderToStaticMarkup(
      <App initialSettingsModalOpen={true} initialOptionsTab="adjustment" />,
    );

    expect(html).toContain('Project Options');
    expect(html).toContain('Solver Configuration');
    expect(html).toContain('Geodetic Framework');
    expect(html).toContain('Leveling / Weighting');
    expect(html).toContain('Convergence Limit');
    expect(html).toContain('Level Loop Preset');
    expect(html).toContain('Saved Custom Presets');
    expect(html).toContain('Add Current');
  });

  it('renders the condensed instrument layout with labels left and inputs right', () => {
    const html = renderToStaticMarkup(
      <App initialSettingsModalOpen={true} initialOptionsTab="instrument" />,
    );

    expect(html).toContain('Instrument Selection');
    expect(html).toContain('Horizontal Precision');
    expect(html).toContain('Vertical Precision');
    expect(html).toContain('Instrument Description');
    expect(html).toContain('Distance Constant');
    expect(html).toContain('Centering Vertical');
  });

  it('renders the condensed general layout with reduction controls grouped in cards', () => {
    const html = renderToStaticMarkup(
      <App initialSettingsModalOpen={true} initialOptionsTab="general" />,
    );

    expect(html).toContain('Local / Grid Reduction');
    expect(html).toContain('Map Mode');
    expect(html).toContain('Map Scale Factor');
    expect(html).toContain('Normalize Mixed Face Data');
    expect(html).toContain('Vertical Reduction');
    expect(html).toContain('Curvature / Refraction');
    expect(html).toContain('Vertical Reduction Mode');
  });

  it('renders the gps layout without the removed condensed-pane helper sentence', () => {
    const html = renderToStaticMarkup(
      <App initialSettingsModalOpen={true} initialOptionsTab="gps" />,
    );

    expect(html).toContain('Coordinate System (Canada-First)');
    expect(html).toContain('Coord System Mode');
    expect(html).toContain('CRS Catalog Group');
    expect(html).toContain('CRS (Grid Mode)');
    expect(html).toContain('Average Geoid Height');
    expect(html).toContain('Show Params');
    expect(html).toContain('Observation Input Mode (.MEASURED / .GRID)');
    expect(html).toContain('Advanced CRS/GPS/Height');
    expect(html).toContain('GPS Loop Check');
    expect(html).toContain('Geoid/Grid Model');
    expect(html).not.toContain(
      'The GPS pane is intentionally condensed: labels stay on the left, controls stay on the right, and disable rules mirror the parser defaults already in the engine.',
    );
  });

  it('renders real Other Files controls instead of the placeholder panel', () => {
    const html = renderToStaticMarkup(
      <App initialSettingsModalOpen={true} initialOptionsTab="other-files" />,
    );

    expect(html).toContain('Other File Outputs');
    expect(html).toContain('Project Files');
    expect(html).toContain('Open Project');
    expect(html).toContain('Save Project');
    expect(html).toContain('Adjusted Points Export');
    expect(html).toContain('Adjusted Points Preset');
    expect(html).toContain('Adjusted Points Delimiter');
    expect(html).toContain('Export Format');
    expect(html).toContain('Output Extension');
    expect(html).toContain('Output Visibility');
    expect(html).toContain('Show Lost Stations in Output');
    expect(html).not.toContain('Future Option A');
    expect(html).not.toContain('Not implemented');
  });

  it('renders the condensed modeling layout with TS correlation and robust controls', () => {
    const html = renderToStaticMarkup(
      <App initialSettingsModalOpen={true} initialOptionsTab="modeling" />,
    );

    expect(html).toContain('TS Correlation');
    expect(html).toContain('Enable Correlation');
    expect(html).toContain('Correlation Scope');
    expect(html).toContain('Correlation ρ');
    expect(html).toContain('Robust Model');
    expect(html).toContain('Robust Mode');
    expect(html).toContain('Robust k');
  });
});
