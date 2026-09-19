// A small hand-made track exercising most notation features. Not real song data.
import type { SongMeta, Track } from "../src/types";

export const meta: SongMeta = {
  songId: 1,
  revisionId: 1,
  artist: "Test Artist",
  title: "Test Song",
  image: "v0-test",
  tracks: [
    { instrumentId: 30, instrument: "Distortion Guitar", name: "Lead", tuning: [64, 59, 55, 50, 45, 40], hash: "guitar_x", partId: 0 },
    { instrumentId: 33, instrument: "Electric Bass", name: "", tuning: [43, 38, 33, 28], hash: "bass_x", partId: 1 },
  ],
};

const eighth = (string: number, fret: number, extra: object = {}) => ({
  duration: [1, 8] as [number, number],
  type: 8,
  notes: [{ string, fret, ...extra }],
});

export function guitarTrack(measures = 40): Track {
  return {
    name: "Lead",
    instrument: "Distortion Guitar",
    strings: 6,
    frets: 24,
    tuning: [64, 59, 55, 50, 45, 40],
    automations: { tempo: [{ measure: 0, bpm: 120 }] },
    measures: Array.from({ length: measures }, (_, m) => ({
      signature: m === 0 ? ([4, 4] as [number, number]) : undefined,
      marker: m % 8 === 0 ? { text: `Section ${m / 8 + 1}` } : undefined,
      repeatStart: m === 4 || undefined,
      repeat: m === 7 ? 2 : undefined,
      alternateEnding: m === 7 ? [1] : undefined,
      voices: [
        {
          beats: [
            { ...eighth(2, 5, { hp: true }), beamStart: true, palmMute: true },
            { ...eighth(2, 7), palmMute: true },
            eighth(1, 8, { bend: { tone: 100, points: [{ position: 0, tone: 0 }, { position: 60, tone: 100 }] } }),
            { ...eighth(1, 10, { slide: "legato" }), beamStop: true },
            { duration: [1, 12], type: 8, tuplet: 3, beamStart: true, notes: [{ string: 0, fret: 12 }] },
            { duration: [1, 12], type: 8, tuplet: 3, notes: [{ string: 0, fret: 12, harmonic: "natural" }] },
            { duration: [1, 12], type: 8, tuplet: 3, beamStop: true, notes: [{ string: 0, fret: 15, leftHandVibrato: "wide" }] },
            { duration: [1, 4], type: 4, rest: true, notes: [{ string: 0, rest: true }] },
          ],
        },
      ],
    })),
  };
}
