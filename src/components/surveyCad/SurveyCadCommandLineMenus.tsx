import React from 'react';

import { menuButtonClassName } from './SurveyCadCommandLine.constants';

type RunImmediate = (_action: () => void) => void;

interface MenuButtonProps {
  children: React.ReactNode;
  disabled?: boolean;
  onClose: () => void;
  onRun: () => void;
  runImmediate: RunImmediate;
}

interface MenuContainerProps {
  children: React.ReactNode;
  dataAttr: string;
}

const MenuButton: React.FC<MenuButtonProps> = ({
  children,
  disabled,
  onClose,
  onRun,
  runImmediate,
}) => (
  <button
    type="button"
    className={menuButtonClassName}
    onClick={() => {
      onClose();
      runImmediate(onRun);
    }}
    disabled={disabled}
  >
    {children}
  </button>
);

const MenuContainer: React.FC<MenuContainerProps> = ({ children, dataAttr }) => (
  <div
    className="absolute left-0 top-full z-20 mt-1 grid min-w-56 gap-1 rounded border border-slate-700 bg-slate-950/95 p-2 shadow-xl"
    {...{ [dataAttr]: true }}
  >
    {children}
  </div>
);

export const SurveyCadArcMenu: React.FC<{
  canContinueCurve: boolean;
  onClose: () => void;
  onStartArc3Point: () => void;
  onStartArcCenterStartAngle: () => void;
  onStartArcCenterStartChord: () => void;
  onStartArcCenterStartEnd: () => void;
  onStartArcStartCenterAngle: () => void;
  onStartArcStartCenterChord: () => void;
  onStartArcStartCenterEnd: () => void;
  onStartArcStartEndAngle: () => void;
  onStartArcStartEndDirection: () => void;
  onStartArcStartEndRadius: () => void;
  onStartContinueCurve: () => void;
  onStartTangentCurve: () => void;
  runImmediate: RunImmediate;
}> = (props) => (
  <MenuContainer dataAttr="data-survey-cad-arc-menu">
    <MenuButton onClose={props.onClose} onRun={props.onStartArc3Point} runImmediate={props.runImmediate}>3 Point</MenuButton>
    <MenuButton onClose={props.onClose} onRun={props.onStartArcStartCenterEnd} runImmediate={props.runImmediate}>Start Center End</MenuButton>
    <MenuButton onClose={props.onClose} onRun={props.onStartArcStartCenterAngle} runImmediate={props.runImmediate}>Start Center Angle</MenuButton>
    <MenuButton onClose={props.onClose} onRun={props.onStartArcStartCenterChord} runImmediate={props.runImmediate}>Start Center Length</MenuButton>
    <MenuButton onClose={props.onClose} onRun={props.onStartArcStartEndAngle} runImmediate={props.runImmediate}>Start End Angle</MenuButton>
    <MenuButton onClose={props.onClose} onRun={props.onStartArcStartEndDirection} runImmediate={props.runImmediate}>Start End Direction</MenuButton>
    <MenuButton onClose={props.onClose} onRun={props.onStartArcStartEndRadius} runImmediate={props.runImmediate}>Start End Radius</MenuButton>
    <MenuButton onClose={props.onClose} onRun={props.onStartArcCenterStartEnd} runImmediate={props.runImmediate}>Center Start End</MenuButton>
    <MenuButton onClose={props.onClose} onRun={props.onStartArcCenterStartAngle} runImmediate={props.runImmediate}>Center Start Angle</MenuButton>
    <MenuButton onClose={props.onClose} onRun={props.onStartArcCenterStartChord} runImmediate={props.runImmediate}>Center Start Length</MenuButton>
    <MenuButton onClose={props.onClose} onRun={props.onStartTangentCurve} runImmediate={props.runImmediate}>Tangent Curve</MenuButton>
    <MenuButton disabled={!props.canContinueCurve} onClose={props.onClose} onRun={props.onStartContinueCurve} runImmediate={props.runImmediate}>Continue Curve</MenuButton>
  </MenuContainer>
);

export const SurveyCadCoreCogoMenu: React.FC<{
  canUseSelectedLineCoreCogo: boolean;
  onClose: () => void;
  onStartArea: () => void;
  onStartBearingReport: () => void;
  onStartDeflectionPoint: () => void;
  onStartDistanceReport: () => void;
  onStartExtendLine: () => void;
  onStartMultiInverse: () => void;
  onStartOffsetPoint: () => void;
  onStartPointAlongLine: () => void;
  onStartTurnedPoint: () => void;
  runImmediate: RunImmediate;
}> = (props) => (
  <MenuContainer dataAttr="data-survey-cad-core-cogo-menu">
    <MenuButton onClose={props.onClose} onRun={props.onStartMultiInverse} runImmediate={props.runImmediate}>Multi Inverse</MenuButton>
    <MenuButton onClose={props.onClose} onRun={props.onStartArea} runImmediate={props.runImmediate}>Area Sequence</MenuButton>
    <MenuButton onClose={props.onClose} onRun={props.onStartBearingReport} runImmediate={props.runImmediate}>Bearing Report</MenuButton>
    <MenuButton onClose={props.onClose} onRun={props.onStartDistanceReport} runImmediate={props.runImmediate}>Distance Report</MenuButton>
    <MenuButton onClose={props.onClose} onRun={props.onStartTurnedPoint} runImmediate={props.runImmediate}>Turned Point</MenuButton>
    <MenuButton disabled={!props.canUseSelectedLineCoreCogo} onClose={props.onClose} onRun={props.onStartDeflectionPoint} runImmediate={props.runImmediate}>Deflection Point</MenuButton>
    <MenuButton disabled={!props.canUseSelectedLineCoreCogo} onClose={props.onClose} onRun={props.onStartPointAlongLine} runImmediate={props.runImmediate}>Point Along Line</MenuButton>
    <MenuButton disabled={!props.canUseSelectedLineCoreCogo} onClose={props.onClose} onRun={props.onStartExtendLine} runImmediate={props.runImmediate}>Extend Line</MenuButton>
    <MenuButton disabled={!props.canUseSelectedLineCoreCogo} onClose={props.onClose} onRun={props.onStartOffsetPoint} runImmediate={props.runImmediate}>Offset Point</MenuButton>
  </MenuContainer>
);

export const SurveyCadCurveMenu: React.FC<{
  canUseSelectedArcCurveCogo: boolean;
  onClose: () => void;
  onStartChordBearingCurve: () => void;
  onStartCompoundCurve: () => void;
  onStartCurveSolver: () => void;
  onStartOffsetCurve: () => void;
  onStartPiCurve: () => void;
  onStartPointOnCurve: () => void;
  onStartRadialBearing: () => void;
  onStartReverseCurve: () => void;
  onStartSubdivideCurve: () => void;
  runImmediate: RunImmediate;
}> = (props) => (
  <MenuContainer dataAttr="data-survey-cad-curve-menu">
    <MenuButton onClose={props.onClose} onRun={props.onStartCurveSolver} runImmediate={props.runImmediate}>Curve Calculator</MenuButton>
    <MenuButton onClose={props.onClose} onRun={props.onStartPiCurve} runImmediate={props.runImmediate}>PI Radius Delta</MenuButton>
    <MenuButton onClose={props.onClose} onRun={props.onStartChordBearingCurve} runImmediate={props.runImmediate}>Chord Bearing Curve</MenuButton>
    <MenuButton disabled={!props.canUseSelectedArcCurveCogo} onClose={props.onClose} onRun={props.onStartRadialBearing} runImmediate={props.runImmediate}>Radial Bearing</MenuButton>
    <MenuButton disabled={!props.canUseSelectedArcCurveCogo} onClose={props.onClose} onRun={props.onStartPointOnCurve} runImmediate={props.runImmediate}>Point On Curve</MenuButton>
    <MenuButton disabled={!props.canUseSelectedArcCurveCogo} onClose={props.onClose} onRun={props.onStartSubdivideCurve} runImmediate={props.runImmediate}>Subdivide Curve</MenuButton>
    <MenuButton disabled={!props.canUseSelectedArcCurveCogo} onClose={props.onClose} onRun={props.onStartOffsetCurve} runImmediate={props.runImmediate}>Offset Curve</MenuButton>
    <MenuButton disabled={!props.canUseSelectedArcCurveCogo} onClose={props.onClose} onRun={props.onStartReverseCurve} runImmediate={props.runImmediate}>Reverse Curve</MenuButton>
    <MenuButton disabled={!props.canUseSelectedArcCurveCogo} onClose={props.onClose} onRun={props.onStartCompoundCurve} runImmediate={props.runImmediate}>Compound Curve</MenuButton>
  </MenuContainer>
);

export const SurveyCadIntersectionMenu: React.FC<{
  canUseSelectedLineCoreCogo: boolean;
  canUseSelectedLinePairIntersection: boolean;
  onClose: () => void;
  onStartBearingBearingIntersection: () => void;
  onStartBearingDistanceIntersection: () => void;
  onStartDistanceDistanceIntersection: () => void;
  onStartLineCircleIntersection: () => void;
  onStartOffsetIntersection: () => void;
  onStartPerpendicularIntersection: () => void;
  onStartSkewIntersection: () => void;
  runImmediate: RunImmediate;
}> = (props) => (
  <MenuContainer dataAttr="data-survey-cad-intersection-menu">
    <MenuButton onClose={props.onClose} onRun={props.onStartBearingBearingIntersection} runImmediate={props.runImmediate}>Bearing-Bearing</MenuButton>
    <MenuButton onClose={props.onClose} onRun={props.onStartBearingDistanceIntersection} runImmediate={props.runImmediate}>Bearing-Distance</MenuButton>
    <MenuButton onClose={props.onClose} onRun={props.onStartDistanceDistanceIntersection} runImmediate={props.runImmediate}>Distance-Distance</MenuButton>
    <MenuButton disabled={!props.canUseSelectedLineCoreCogo} onClose={props.onClose} onRun={props.onStartLineCircleIntersection} runImmediate={props.runImmediate}>Line-Circle</MenuButton>
    <MenuButton disabled={!props.canUseSelectedLineCoreCogo} onClose={props.onClose} onRun={props.onStartPerpendicularIntersection} runImmediate={props.runImmediate}>Perpendicular</MenuButton>
    <MenuButton disabled={!props.canUseSelectedLinePairIntersection} onClose={props.onClose} onRun={props.onStartOffsetIntersection} runImmediate={props.runImmediate}>Offset Intersection</MenuButton>
    <MenuButton disabled={!props.canUseSelectedLineCoreCogo} onClose={props.onClose} onRun={props.onStartSkewIntersection} runImmediate={props.runImmediate}>Skew Intersection</MenuButton>
  </MenuContainer>
);

export const SurveyCadParcelMenu: React.FC<{
  canCreateParcel: boolean;
  canReportParcelDiagnostics: boolean;
  canReportParcelGap: boolean;
  canReportParcelOverlap: boolean;
  canSplitParcelByArea: boolean;
  canSplitParcelByBearing: boolean;
  canSplitParcelByLine: boolean;
  canSplitParcelBySlide: boolean;
  canSplitParcelBySwing: boolean;
  onClose: () => void;
  onCreateParcel: () => void;
  onReportParcelDiagnostics: () => void;
  onReportParcelGap: () => void;
  onReportParcelOverlap: () => void;
  onSplitParcelByLine: () => void;
  onSplitParcelBySlide: () => void;
  onSplitParcelBySwing: () => void;
  onStartParcelSplitArea: () => void;
  onStartParcelSplitBearing: () => void;
  onToggleParcelLayoutPanel: () => void;
  runImmediate: RunImmediate;
}> = (props) => (
  <MenuContainer dataAttr="data-survey-cad-parcel-menu">
    <MenuButton disabled={!props.canCreateParcel} onClose={props.onClose} onRun={props.onCreateParcel} runImmediate={props.runImmediate}>Create Parcel</MenuButton>
    <MenuButton disabled={!props.canSplitParcelByBearing} onClose={props.onClose} onRun={props.onStartParcelSplitBearing} runImmediate={props.runImmediate}>Split by Bearing</MenuButton>
    <MenuButton disabled={!props.canSplitParcelByArea} onClose={props.onClose} onRun={props.onStartParcelSplitArea} runImmediate={props.runImmediate}>Split by Area</MenuButton>
    <MenuButton disabled={!props.canSplitParcelBySlide} onClose={props.onClose} onRun={props.onSplitParcelBySlide} runImmediate={props.runImmediate}>Sliding Area Split</MenuButton>
    <MenuButton disabled={!props.canSplitParcelBySwing} onClose={props.onClose} onRun={props.onSplitParcelBySwing} runImmediate={props.runImmediate}>Hinged Area Split</MenuButton>
    <MenuButton onClose={props.onClose} onRun={props.onToggleParcelLayoutPanel} runImmediate={props.runImmediate}>Layout Tools</MenuButton>
    <MenuButton disabled={!props.canReportParcelGap} onClose={props.onClose} onRun={props.onReportParcelGap} runImmediate={props.runImmediate}>Parcel Gap</MenuButton>
    <MenuButton disabled={!props.canReportParcelDiagnostics} onClose={props.onClose} onRun={props.onReportParcelDiagnostics} runImmediate={props.runImmediate}>Parcel Check</MenuButton>
    <MenuButton disabled={!props.canReportParcelOverlap} onClose={props.onClose} onRun={props.onReportParcelOverlap} runImmediate={props.runImmediate}>Parcel Overlap</MenuButton>
    <MenuButton disabled={!props.canSplitParcelByLine} onClose={props.onClose} onRun={props.onSplitParcelByLine} runImmediate={props.runImmediate}>Split by Line</MenuButton>
  </MenuContainer>
);
