/**
 * Phase 18L — LandXML civil geometry block serializers (Surfaces,
 * StaEquation, ProfSurf, CrossSect). Pure string emitters: the caller owns
 * scaling direction and the output line buffer, so ordering stays under the
 * main serializer's control.
 *
 * Sign conventions: profile PntList2D is [station(raw chainage), elevation];
 * cross-section PntList2D is [offset, elevation] with LandXML's RIGHT-positive
 * offset (the civil adapter negates WebNet's LEFT-positive offsets). All
 * numeric values arrive in metres and are scaled here.
 */
import { formatNumber, xmlEscape } from './landxml';
import type {
  CadLandXmlCrossSection,
  CadLandXmlProfile,
  CadLandXmlStaEquation,
  CadLandXmlSurface,
} from './landxmlCadTypes';

const pntList2D = (points: readonly (readonly [number, number])[], scale: number): string =>
  points.map(([a, b]) => `${formatNumber(a * scale)} ${formatNumber(b * scale)}`).join(' ');

const surfaceAttrs = (surface: CadLandXmlSurface, scale: number): string => {
  const areaScale = scale * scale;
  return [
    'surfType="TIN"',
    surface.elevMin != null ? `elevMin="${formatNumber(surface.elevMin * scale)}"` : '',
    surface.elevMax != null ? `elevMax="${formatNumber(surface.elevMax * scale)}"` : '',
    surface.area2D != null ? `area2DSurf="${formatNumber(surface.area2D * areaScale)}"` : '',
    surface.area3D != null ? `area3DSurf="${formatNumber(surface.area3D * areaScale)}"` : '',
  ]
    .filter((part) => part !== '')
    .join(' ');
};

const requireFiniteSurface = (surface: CadLandXmlSurface): void => {
  if (surface.points.length < 3) {
    throw new Error(`LandXML CAD export: surface ${JSON.stringify(surface.name)} needs at least 3 points.`);
  }
  if (surface.faces.length === 0) {
    throw new Error(`LandXML CAD export: surface ${JSON.stringify(surface.name)} needs at least 1 face.`);
  }
  surface.points.forEach((point) => {
    if (![point.x, point.y, point.z].every(Number.isFinite)) {
      throw new Error(`LandXML CAD export: surface ${JSON.stringify(surface.name)} has non-finite point.`);
    }
  });
  surface.faces.forEach((face) => {
    if (!face.every((index) => Number.isInteger(index) && index >= 0 && index < surface.points.length)) {
      throw new Error(`LandXML CAD export: surface ${JSON.stringify(surface.name)} has an out-of-range face index.`);
    }
  });
};

/** `<Surfaces>` block: deterministic 1..N point ids in canonical vertex order. */
export const serializeSurfacesBlock = (
  lines: string[],
  surfaces: readonly CadLandXmlSurface[],
  scale: number,
): void => {
  if (surfaces.length === 0) return;
  surfaces.forEach(requireFiniteSurface);
  lines.push('  <Surfaces>');
  surfaces.forEach((surface) => {
    lines.push(`    <Surface name="${xmlEscape(surface.name)}" desc="Retained TIN">`);
    lines.push(`      <Definition ${surfaceAttrs(surface, scale)}>`);
    lines.push('        <Pnts>');
    surface.points.forEach((point, index) => {
      lines.push(
        `          <P id="${index + 1}">${formatNumber(point.y * scale)} ${formatNumber(point.x * scale)} ${formatNumber(point.z * scale)}</P>`,
      );
    });
    lines.push('        </Pnts>');
    lines.push('        <Faces>');
    surface.faces.forEach((face) => {
      lines.push(`          <F>${face[0] + 1} ${face[1] + 1} ${face[2] + 1}</F>`);
    });
    lines.push('        </Faces>');
    lines.push('      </Definition>');
    lines.push('    </Surface>');
  });
  lines.push('  </Surfaces>');
};

export const serializeStaEquations = (
  lines: string[],
  indent: string,
  equations: readonly CadLandXmlStaEquation[],
  scale: number,
): void => {
  equations.forEach((equation) => {
    if (![equation.staInternal, equation.staAhead].every(Number.isFinite)) return;
    const back = equation.staBack != null && Number.isFinite(equation.staBack)
      ? ` staBack="${formatNumber(equation.staBack * scale)}"`
      : '';
    lines.push(
      `${indent}<StaEquation staAhead="${formatNumber(equation.staAhead * scale)}" staInternal="${formatNumber(
        equation.staInternal * scale,
      )}"${back} />`,
    );
  });
};

export const serializeAlignmentProfiles = (
  lines: string[],
  indent: string,
  alignmentName: string,
  profiles: readonly CadLandXmlProfile[],
  scale: number,
): void => {
  if (profiles.length === 0) return;
  lines.push(`${indent}<Profile name="${xmlEscape(alignmentName)} Profile">`);
  profiles.forEach((profile) => {
    profile.surfaces.forEach((surface) => {
      lines.push(`${indent}  <ProfSurf name="${xmlEscape(surface.name)}">`);
      surface.segments.forEach((segment) => {
        lines.push(`${indent}    <PntList2D>${pntList2D(segment, scale)}</PntList2D>`);
      });
      lines.push(`${indent}  </ProfSurf>`);
    });
  });
  lines.push(`${indent}</Profile>`);
};

export const serializeAlignmentCrossSections = (
  lines: string[],
  indent: string,
  sections: readonly CadLandXmlCrossSection[],
  scale: number,
): void => {
  if (sections.length === 0) return;
  lines.push(`${indent}<CrossSects>`);
  sections.forEach((section) => {
    lines.push(`${indent}  <CrossSect sta="${formatNumber(section.sta * scale)}" name="${xmlEscape(section.name)}">`);
    section.surfaces.forEach((surface) => {
      lines.push(`${indent}    <CrossSectSurf name="${xmlEscape(surface.name)}">`);
      surface.segments.forEach((segment) => {
        lines.push(`${indent}      <PntList2D>${pntList2D(segment, scale)}</PntList2D>`);
      });
      lines.push(`${indent}    </CrossSectSurf>`);
    });
    lines.push(`${indent}  </CrossSect>`);
  });
  lines.push(`${indent}</CrossSects>`);
};
