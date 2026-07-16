import { useMemo } from 'react';
import type { CadSnapConstructionContext } from '../engine/cad/cadTypes';
import type { CadSnapPreferences } from '../hooks/surveyCad/useSurveyCadSnapping';

interface UseSurveyCadCommandDisplayOptions {
  activeCommandKey: string | null;
  reverseDirectionModifier: boolean;
  snapConstructionContext: CadSnapConstructionContext;
  snapPreferences: CadSnapPreferences;
  statusText: string;
}

export const useSurveyCadCommandDisplay = ({
  activeCommandKey,
  reverseDirectionModifier,
  snapConstructionContext,
  snapPreferences,
  statusText,
}: UseSurveyCadCommandDisplayOptions) => {
  const commandInputPlaceholder = useMemo(() => {
    if (!activeCommandKey) return 'Choose a command, then click or type in the drawing window';
    if (activeCommandKey === 'POINT') return 'Click in model space or type x,y / LABEL=x,y';
    if (activeCommandKey === 'COGO_POINT') return 'Click base/target or type @azimuth,distance';
    if (activeCommandKey === 'TRAVERSE') return 'Click start / next point or type bearing-distance';
    if (activeCommandKey === 'BATCH_COGO') return 'Use batch COGO panel for pasted deed rows';
    if (activeCommandKey === 'MULTI_INVERSE') return 'Click point sequence or type x,y / bearing-distance';
    if (activeCommandKey === 'AREA') return 'Click point sequence or type x,y / bearing-distance, then Enter to close';
    if (activeCommandKey === 'TURNED_POINT') return 'Pick occupy/backsight, then type Langle,distance or Rangle,distance';
    if (activeCommandKey === 'DEFLECT_POINT') return 'Type Langle,distance or Rangle,distance from selected line';
    if (activeCommandKey === 'POINT_ALONG_LINE') return 'Type distance or percent like 25 or 50% from selected line';
    if (activeCommandKey === 'EXTEND_LINE') return 'Type extension distance from selected line end';
    if (activeCommandKey === 'OFFSET_POINT') return 'Type Loffset,along or Roffset,along from selected line';
    if (activeCommandKey === 'ALIGNMENT_OFFSET_CREATE') return 'Type offset or NAME=offset from selected alignment';
    if (activeCommandKey === 'ALIGNMENT_STATION_EQUATION') return 'Type backStation,aheadStation from selected alignment';
    if (activeCommandKey === 'ALIGNMENT_OFFSET_POINT') return 'Type station,offset or LABEL=station,offset from selected alignment';
    if (activeCommandKey === 'ALIGNMENT_INTERVAL_POINTS') return 'Type interval or start,end,interval from selected alignment';
    if (activeCommandKey === 'CURVE_SOLVER') return 'Type param1,param2,value1,value2 like radius,delta,200,60';
    if (activeCommandKey === 'RADIAL_BEARING') return 'Type PC, PT, or MID from selected arc';
    if (activeCommandKey === 'POINT_ON_CURVE') return 'Type ARC,distance or CHORD,distance from selected arc start';
    if (activeCommandKey === 'SUBDIVIDE_CURVE') return 'Type EQUAL,count or ARC/CHORD interval for selected arc';
    if (activeCommandKey === 'OFFSET_CURVE') return 'Type Ldistance or Rdistance from selected arc';
    if (activeCommandKey === 'PI_CURVE') return 'Pick PI/back tangent, then type Lradius,delta or Rradius,delta';
    if (activeCommandKey === 'CHORD_BEARING_CURVE') return 'Pick start, then type bearing,chord,radius,L|R';
    if (activeCommandKey === 'REVERSE_CURVE') return 'Type Lradius,delta or Rradius,delta from selected arc';
    if (activeCommandKey === 'COMPOUND_CURVE') return 'Type Lradius,delta or Rradius,delta from selected arc';
    if (activeCommandKey === 'BEARING_BEARING_INTX') return 'Pick two points, then type bearing1;bearing2';
    if (activeCommandKey === 'BEARING_DISTANCE_INTX') return 'Pick bearing point and center, then type bearing;distance';
    if (activeCommandKey === 'DISTANCE_DISTANCE_INTX') return 'Pick two centers, then type distance1,distance2';
    if (activeCommandKey === 'LINE_CIRCLE_INTX') return 'Select a line, pick a center point, then type radius';
    if (activeCommandKey === 'PERP_INTX') return 'Select a line, then pick the external point';
    if (activeCommandKey === 'OFFSET_INTX') return 'Select two lines, then type Loff1,Roff2';
    if (activeCommandKey === 'SKEW_INTX') return 'Select a line, pick a source point, then type Langle or Rangle';
    if (activeCommandKey === 'EXTEND') return 'Click entity to extend, then click boundary. Enter/Esc ends extend';
    if (activeCommandKey === 'TRIM') return 'Click first entity, then click side to trim on second entity. Enter/Esc ends trim';
    if (activeCommandKey === 'FILLET') return 'Type radius, then click two entities near the corner. Enter/Esc ends fillet';
    if (activeCommandKey?.startsWith('ARC_') || activeCommandKey === 'CONTINUE_CURVE') {
      return 'Pick arc points, then enter the required value. Hold Ctrl to reverse direction';
    }
    if (activeCommandKey === 'TANGENT_CURVE') return 'Click tangent points or type radius';
    if (activeCommandKey === 'PASTE') return 'Click insertion point or type x,y / bearing-distance';
    return 'Click in model space or type x,y / bearing-distance';
  }, [activeCommandKey]);
  const commandStatusText = useMemo(
    () => (statusText.startsWith('Ready.') ? '' : statusText),
    [statusText],
  );
  const commandModifierHint = useMemo(() => {
    if (
      activeCommandKey == null ||
      ![
        'ARC_SCE',
        'ARC_CSE',
        'ARC_SCA',
        'ARC_CSA',
        'ARC_SCL',
        'ARC_CSL',
        'ARC_SEA',
        'ARC_SED',
        'ARC_SER',
        'CONTINUE_CURVE',
      ].includes(activeCommandKey)
    ) {
      return '';
    }
    return reverseDirectionModifier ? 'Ctrl Held: Flip Arc' : 'Ctrl = Flip Arc';
  }, [activeCommandKey, reverseDirectionModifier]);
  const constructionHint = useMemo(() => {
    if (!snapConstructionContext.active || !snapConstructionContext.basePoint) return '';
    const enabledConstructionKinds = [
      snapPreferences.extension ? 'Ext' : null,
      snapPreferences.perpendicular ? 'Perp' : null,
      snapPreferences.parallel ? 'Par' : null,
      snapPreferences['apparent-intersection'] ? 'App' : null,
      snapPreferences.tangent ? 'Tan' : null,
    ].filter((value): value is string => value != null);
    if (enabledConstructionKinds.length === 0) return '';
    return `Base ${snapConstructionContext.basePoint.x.toFixed(3)},${snapConstructionContext.basePoint.y.toFixed(3)}: Construction snaps live (${enabledConstructionKinds.join('/')})`;
  }, [snapConstructionContext, snapPreferences]);

  return {
    commandInputPlaceholder,
    commandModifierHint,
    commandStatusText,
    constructionHint,
  };
};
