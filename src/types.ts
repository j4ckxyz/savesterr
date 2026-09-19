// Shapes of the JSON Songsterr serves. Reverse-engineered from the site; only
// the fields the renderer uses are typed.

export interface TrackMeta {
  instrumentId: number;
  instrument: string;
  name: string;
  title?: string;
  tuning?: number[];
  hash: string;
  partId: number;
  isVocalTrack?: boolean;
  isEmpty?: boolean;
}

export interface SongMeta {
  songId: number;
  revisionId: number;
  artist: string;
  title: string;
  image: string;
  tracks: TrackMeta[];
}

export interface Bend {
  tone: number;
  points: { position: number; tone: number }[];
}

export interface Note {
  string: number;
  fret?: number;
  rest?: boolean;
  tie?: boolean;
  dead?: boolean;
  ghost?: boolean;
  hp?: boolean;
  slide?: "legato" | "shift" | "below" | "above" | "upwards" | "downwards";
  bend?: Bend;
  harmonic?: string;
  harmonicFret?: number;
  leftHandVibrato?: "slight" | "wide";
  staccato?: boolean;
  accentuated?: number;
}

export interface Beat {
  notes: Note[];
  duration: [number, number];
  type: number;
  dots?: number;
  rest?: boolean;
  beamStart?: boolean;
  beamStop?: boolean;
  tuplet?: number;
  tupletStart?: boolean;
  tupletStop?: boolean;
  palmMute?: boolean;
  letRing?: boolean;
  graceNote?: "onBeat" | "beforeBeat";
  tapping?: boolean;
  pickStroke?: "up" | "down";
  chord?: { text: string };
  text?: { text: string } | string;
  velocity?: string;
  tremoloPicking?: unknown;
}

export interface Voice {
  beats: Beat[];
  rest?: boolean;
}

export interface Measure {
  voices: Voice[];
  signature?: [number, number];
  marker?: { text: string };
  rest?: boolean;
  repeatStart?: boolean;
  repeat?: number;
  alternateEnding?: number[];
  doubleBarline?: boolean;
}

export interface Track {
  name: string;
  instrument: string;
  strings: number;
  frets: number;
  tuning?: number[];
  capo?: number;
  measures: Measure[];
  automations?: { tempo?: { measure: number; bpm: number }[] };
}
