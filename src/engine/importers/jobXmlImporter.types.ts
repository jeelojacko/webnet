export interface JobXmlSetupContext {
  occupyId?: string;
  backsightId?: string;
  backsightRecordRef?: string;
  hiM?: number;
  setupType?: string;
  atmosphereRef?: string;
}

export interface JobXmlBacksightContext {
  stationId?: string;
  horizontalCircleDeg?: number;
  face1HorizontalCircleDeg?: number;
  face2HorizontalCircleDeg?: number;
  bearingDeg?: number;
}

export interface JobXmlTargetContext {
  stationId?: string;
  htM?: number;
  prismConstantM?: number;
  code?: string;
}

export interface JobXmlAtmosphereContext {
  ppm?: number;
}

export type JobXmlRoundEvent = {
  index: number;
  kind: 'start' | 'end' | 'reset';
  round?: number;
};
