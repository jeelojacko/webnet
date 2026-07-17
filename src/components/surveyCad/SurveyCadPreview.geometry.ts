import { useMemo } from 'react';
import type { CadBounds, CadDisplayPrimitive } from '../../engine/cad/cadTypes';
import { cadSignedSweepDeg } from '../../engine/cad/cadGeometry';
import {
  SURVEY_CAD_PREVIEW_HEIGHT,
  SURVEY_CAD_PREVIEW_PADDING,
  SURVEY_CAD_PREVIEW_WIDTH,
} from './SurveyCadPreview.constants';
import type { ProjectPoint, ScreenBox, SurveyCadViewport } from './SurveyCadPreview.types';

export const normalizePreviewBounds = (bounds: CadBounds | null): CadBounds => {
  if (!bounds) {
    return { minX: -10, minY: -10, maxX: 10, maxY: 10 };
  }
  const width = Math.max(bounds.maxX - bounds.minX, 1);
  const height = Math.max(bounds.maxY - bounds.minY, 1);
  return {
    minX: bounds.minX - width * 0.08,
    minY: bounds.minY - height * 0.08,
    maxX: bounds.maxX + width * 0.08,
    maxY: bounds.maxY + height * 0.08,
  };
};

export const useProjector = (bounds: CadBounds | null, viewport: SurveyCadViewport) =>
  useMemo(() => {
    const normalized = normalizePreviewBounds(bounds);
    const width = normalized.maxX - normalized.minX;
    const height = normalized.maxY - normalized.minY;
    const baseScale = Math.min(
      (SURVEY_CAD_PREVIEW_WIDTH - SURVEY_CAD_PREVIEW_PADDING * 2) / width,
      (SURVEY_CAD_PREVIEW_HEIGHT - SURVEY_CAD_PREVIEW_PADDING * 2) / height,
    );
    const project = (x: number, y: number) => ({
      x: SURVEY_CAD_PREVIEW_PADDING + (x - normalized.minX) * baseScale * viewport.zoom + viewport.panX,
      y:
        SURVEY_CAD_PREVIEW_HEIGHT -
        SURVEY_CAD_PREVIEW_PADDING -
        (y - normalized.minY) * baseScale * viewport.zoom +
        viewport.panY,
    });
    return {
      baseScale,
      scale: baseScale * viewport.zoom,
      normalized,
      project,
      unproject: (viewX: number, viewY: number) => ({
        x:
          normalized.minX +
          (viewX - SURVEY_CAD_PREVIEW_PADDING - viewport.panX) / (baseScale * viewport.zoom),
        y:
          normalized.minY +
          (SURVEY_CAD_PREVIEW_HEIGHT - SURVEY_CAD_PREVIEW_PADDING - viewY + viewport.panY) /
            (baseScale * viewport.zoom),
      }),
    };
  }, [bounds, viewport]);

export const visibleWorldBoundsFromViewport = (
  unproject: (_viewX: number, _viewY: number) => { x: number; y: number },
): CadBounds => {
  const topLeft = unproject(0, 0);
  const topRight = unproject(SURVEY_CAD_PREVIEW_WIDTH, 0);
  const bottomLeft = unproject(0, SURVEY_CAD_PREVIEW_HEIGHT);
  const bottomRight = unproject(SURVEY_CAD_PREVIEW_WIDTH, SURVEY_CAD_PREVIEW_HEIGHT);
  return {
    minX: Math.min(topLeft.x, topRight.x, bottomLeft.x, bottomRight.x),
    minY: Math.min(topLeft.y, topRight.y, bottomLeft.y, bottomRight.y),
    maxX: Math.max(topLeft.x, topRight.x, bottomLeft.x, bottomRight.x),
    maxY: Math.max(topLeft.y, topRight.y, bottomLeft.y, bottomRight.y),
  };
};

export const screenPointFromClientPoint = (
  rect: DOMRect,
  clientX: number,
  clientY: number,
): { rect: DOMRect; viewX: number; viewY: number } | null => {
  if (rect.width <= 0 || rect.height <= 0) return null;
  const scaleFactor = Math.min(
    rect.width / SURVEY_CAD_PREVIEW_WIDTH,
    rect.height / SURVEY_CAD_PREVIEW_HEIGHT,
  );
  const contentWidth = SURVEY_CAD_PREVIEW_WIDTH * scaleFactor;
  const contentHeight = SURVEY_CAD_PREVIEW_HEIGHT * scaleFactor;
  const offsetX = (rect.width - contentWidth) / 2;
  const offsetY = (rect.height - contentHeight) / 2;
  return {
    rect,
    viewX: (clientX - rect.left - offsetX) / scaleFactor,
    viewY: (clientY - rect.top - offsetY) / scaleFactor,
  };
};

export const textPrimitiveScreenBox = (
  primitive: Extract<CadDisplayPrimitive, { kind: 'text' }>,
  project: ProjectPoint,
): {
  x: number;
  y: number;
  width: number;
  height: number;
  displayX: number;
  displayY: number;
} => {
  const point = project(primitive.point.x, primitive.point.y);
  const lines = primitive.text.split('\n');
  const longestLine = lines.reduce(
    (current, line) => Math.max(current, line.length),
    0,
  );
  const width = Math.max(24, longestLine * primitive.fontSize * 0.55);
  const height = Math.max(primitive.fontSize, lines.length * primitive.fontSize * 1.2);
  const anchorOffset =
    primitive.textAnchor === 'middle' ? width / 2 : primitive.textAnchor === 'end' ? width : 0;
  const displayX =
    primitive.textAnchor === 'start' || primitive.textAnchor == null ? point.x + 6 : point.x;
  const displayY =
    primitive.textAnchor === 'start' || primitive.textAnchor == null ? point.y - 6 : point.y;
  return {
    x: displayX - anchorOffset,
    y: displayY - primitive.fontSize,
    width,
    height,
    displayX,
    displayY,
  };
};

export const primitiveBounds = (
  primitive: CadDisplayPrimitive,
  project: ProjectPoint,
  scale: number,
): { minX: number; minY: number; maxX: number; maxY: number } => {
  switch (primitive.kind) {
    case 'line': {
      const start = project(primitive.points[0].x, primitive.points[0].y);
      const end = project(primitive.points[1].x, primitive.points[1].y);
      return {
        minX: Math.min(start.x, end.x),
        minY: Math.min(start.y, end.y),
        maxX: Math.max(start.x, end.x),
        maxY: Math.max(start.y, end.y),
      };
    }
    case 'point': {
      const point = project(primitive.point.x, primitive.point.y);
      return {
        minX: point.x - primitive.radius - 2,
        minY: point.y - primitive.radius - 2,
        maxX: point.x + primitive.radius + 2,
        maxY: point.y + primitive.radius + 2,
      };
    }
    case 'arc': {
      const center = project(primitive.center.x, primitive.center.y);
      const radius = Math.max(primitive.radius * scale, 1.2);
      return {
        minX: center.x - radius,
        minY: center.y - radius,
        maxX: center.x + radius,
        maxY: center.y + radius,
      };
    }
    case 'text': {
      const textBox = textPrimitiveScreenBox(primitive, project);
      return {
        minX: textBox.x,
        minY: textBox.y,
        maxX: textBox.x + textBox.width,
        maxY: textBox.y + textBox.height,
      };
    }
    case 'ellipse': {
      const center = project(primitive.center.x, primitive.center.y);
      const radiusX = Math.max(primitive.semiMajor * scale, 1.2);
      const radiusY = Math.max(primitive.semiMinor * scale, 0.9);
      return {
        minX: center.x - radiusX,
        minY: center.y - radiusY,
        maxX: center.x + radiusX,
        maxY: center.y + radiusY,
      };
    }
  }
};

export const intersectsSelectionBox = (
  primitiveBox: { minX: number; minY: number; maxX: number; maxY: number },
  selectionBox: ScreenBox,
): boolean => {
  const minX = Math.min(selectionBox.anchorX, selectionBox.currentX);
  const maxX = Math.max(selectionBox.anchorX, selectionBox.currentX);
  const minY = Math.min(selectionBox.anchorY, selectionBox.currentY);
  const maxY = Math.max(selectionBox.anchorY, selectionBox.currentY);
  const windowMode = selectionBox.currentX >= selectionBox.anchorX;
  if (windowMode) {
    return (
      primitiveBox.minX >= minX &&
      primitiveBox.maxX <= maxX &&
      primitiveBox.minY >= minY &&
      primitiveBox.maxY <= maxY
    );
  }
  return !(
    primitiveBox.maxX < minX ||
    primitiveBox.minX > maxX ||
    primitiveBox.maxY < minY ||
    primitiveBox.minY > maxY
  );
};

const normalizeSweepAngles = (
  startAngleDeg: number,
  endAngleDeg: number,
): {
  startAngleDeg: number;
  endAngleDeg: number;
  sweepDeg: number;
  largeArcFlag: 0 | 1;
  sweepFlag: 0 | 1;
} => {
  const normalizedStart = ((startAngleDeg % 360) + 360) % 360;
  const signedSweepDeg = cadSignedSweepDeg(startAngleDeg, endAngleDeg);
  const normalizedEnd = normalizedStart + signedSweepDeg;
  const sweepDeg = Math.max(0.0001, Math.abs(signedSweepDeg));
  return {
    startAngleDeg: normalizedStart,
    endAngleDeg: normalizedEnd,
    sweepDeg,
    largeArcFlag: sweepDeg > 180 ? 1 : 0,
    sweepFlag: signedSweepDeg >= 0 ? 0 : 1,
  };
};

export const arcPathFromPrimitive = (
  primitive: Extract<CadDisplayPrimitive, { kind: 'arc' }>,
  project: ProjectPoint,
  scale: number,
): string => {
  const signedSweepDeg = cadSignedSweepDeg(primitive.startAngleDeg, primitive.endAngleDeg);
  if (Math.abs(Math.abs(signedSweepDeg) - 360) <= 1e-6) {
    const center = project(primitive.center.x, primitive.center.y);
    const radius = Math.max(primitive.radius * scale, 0.001);
    const startPoint = project(primitive.center.x + primitive.radius, primitive.center.y);
    const sweepFlag = signedSweepDeg >= 0 ? 0 : 1;
    return [
      `M ${startPoint.x} ${startPoint.y}`,
      `A ${radius} ${radius} 0 1 ${sweepFlag} ${center.x - radius} ${center.y}`,
      `A ${radius} ${radius} 0 1 ${sweepFlag} ${startPoint.x} ${startPoint.y}`,
    ].join(' ');
  }
  const { startAngleDeg, endAngleDeg, largeArcFlag, sweepFlag } = normalizeSweepAngles(
    primitive.startAngleDeg,
    primitive.endAngleDeg,
  );
  const startRadians = (startAngleDeg * Math.PI) / 180;
  const endRadians = (endAngleDeg * Math.PI) / 180;
  const startPoint = project(
    primitive.center.x + Math.cos(startRadians) * primitive.radius,
    primitive.center.y + Math.sin(startRadians) * primitive.radius,
  );
  const endPoint = project(
    primitive.center.x + Math.cos(endRadians) * primitive.radius,
    primitive.center.y + Math.sin(endRadians) * primitive.radius,
  );
  const radius = Math.max(primitive.radius * scale, 0.001);
  return `M ${startPoint.x} ${startPoint.y} A ${radius} ${radius} 0 ${largeArcFlag} ${sweepFlag} ${endPoint.x} ${endPoint.y}`;
};
