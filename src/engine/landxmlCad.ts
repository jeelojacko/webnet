/**
 * Phase 13C §§31-48 / Phase 18L — CAD geometry → LandXML 1.2 public API.
 *
 * This module is a stable barrel: the serializer (landxmlCadSerialize.ts),
 * the project adapter (landxmlCadProject.ts), shared types
 * (landxmlCadTypes.ts), and the civil source adapter (landxmlCivilSource.ts)
 * live in focused files. Import paths for existing callers are unchanged.
 *
 * Units: 'm' → Metric/meter; 'ft' → Imperial/foot (INTERNATIONAL foot,
 * 0.3048 m exactly); 'usft' → Imperial/USSurveyFoot (1200/3937 m).
 * Parcels are geometric data only — no legal inference is encoded.
 *
 * Error ellipses (§37) are NOT_APPLICABLE in LandXML: confidence-ellipse
 * semantics have no LandXML 1.2 representation, so requesting them emits a
 * warning per id and no geometry — never a silent drop, never faked as a
 * parcel ring or alignment.
 */
export * from './landxmlCadTypes';
export {
  buildLandXmlFromCadGeometry,
  buildLandXmlFromCadGeometryWithResult,
} from './landxmlCadSerialize';
export {
  buildLandXmlProjectExportWithResult,
  type CadLandXmlProjectExportResult,
} from './landxmlCadProject';
export {
  buildCadLandXmlCivilGeometry,
  type CadLandXmlCivilClass,
  type CadLandXmlCivilDisposition,
  type CadLandXmlCivilEntry,
  type CadLandXmlCivilResult,
  type CadLandXmlCivilSources,
} from './landxmlCivilSource';
