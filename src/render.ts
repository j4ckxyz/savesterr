import PDFDocument from "pdfkit";
import type { Beat, Measure, Note, SongMeta, Track } from "./types";

type Doc = PDFKit.PDFDocument;

export type Paper = "a4" | "letter";
const PAPER_SIZES: Record<Paper, [number, number]> = { a4: [595.28, 841.89], letter: [612, 792] };
const MARGIN = { l: 40, r: 30, t: 36, b: 40 };

const STRING_GAP = 7.5;
const FRET_SIZE = 7.5;
const GRACE_SIZE = 5.8;
const TICKS = 3840; // per whole note
const EIGHTH = TICKS / 8;

const INK = "#111111";
const STAFF = "#8a8a8a";
const MUTED = "#6b6b6b";

// Lane heights above the staff (only reserved when a system uses them).
const LANE = { section: 15, text: 10, chord: 11, marks: 10, letRing: 9, palmMute: 9, bend: 15 };
const RHYTHM_H = 32;
const SYSTEM_GAP = 10;

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

// ─── Layout model ───────────────────────────────────────────────────────────

interface Slot {
  tick: number;
  beats: { beat: Beat; voice: number }[];
  graces: Beat[];
  lead: number; // space reserved before the note centre for grace notes
  w: number; // natural width after the note centre
  x: number; // absolute note-centre x, set when the line is justified
}

interface MeasureLayout {
  index: number;
  measure: Measure;
  slots: Slot[];
  prefix: number;
  suffix: number;
  showSig: [number, number] | null;
  natural: number;
  x: number;
  width: number;
}

interface Lanes {
  section: number;
  text: number;
  chord: number;
  marks: number;
  letRing: number;
  palmMute: number;
  bend: number;
}

interface LineLayout {
  measures: MeasureLayout[];
  lanes: Lanes;
  top: number;
  staffTop: number;
  page: number;
  height: number;
}

interface BeatPos {
  x: number;
  line: LineLayout;
  grace: boolean;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function durTicks(b: Beat): number {
  return Math.round((b.duration[0] / b.duration[1]) * TICKS);
}

function midiName(midi: number): string {
  return NOTE_NAMES[((midi % 12) + 12) % 12]!;
}

function fretLabel(n: Note): string {
  if (n.dead) return "x";
  const f = String(n.fret ?? "");
  if (n.harmonic === "natural") return `<${f}>`;
  if (n.harmonic && n.harmonicFret !== undefined) return `${f}<${n.harmonicFret}>`;
  if (n.ghost || n.tie) return `(${f})`;
  return f;
}

function bendLabel(tone: number): string {
  const q = Math.round(tone / 25);
  const whole = Math.floor(q / 4);
  const frac = ["", "1/4", "1/2", "3/4"][q % 4]!;
  if (whole === 1 && !frac) return "full";
  return [whole || "", frac].filter(Boolean).join(" ") || "0";
}

function beamLevel(b: Beat): number {
  return b.type >= 8 ? Math.round(Math.log2(b.type)) - 2 : 0;
}

/** Draw text vertically centred (by cap height) on y. */
function text(
  doc: Doc,
  s: string,
  x: number,
  y: number,
  opts: { size?: number; font?: string; align?: "left" | "center" | "right"; color?: string } = {},
): number {
  const size = opts.size ?? FRET_SIZE;
  doc.font(opts.font ?? "Helvetica").fontSize(size).fillColor(opts.color ?? INK);
  const w = doc.widthOfString(s);
  const left = opts.align === "center" ? x - w / 2 : opts.align === "right" ? x - w : x;
  doc.text(s, left, y - size * 0.368, { lineBreak: false });
  return w;
}

function measureWidth(doc: Doc, s: string, size: number, font = "Helvetica"): number {
  return doc.font(font).fontSize(size).widthOfString(s);
}

// ─── Layout ─────────────────────────────────────────────────────────────────

function layoutMeasure(doc: Doc, m: Measure, index: number, sig: [number, number], showSig: boolean): MeasureLayout {
  const slotMap = new Map<number, Slot>();
  const slotAt = (tick: number) => {
    let s = slotMap.get(tick);
    if (!s) slotMap.set(tick, (s = { tick, beats: [], graces: [], lead: 0, w: 0, x: 0 }));
    return s;
  };

  let end = Math.round((sig[0] / sig[1]) * TICKS);
  m.voices.forEach((voice, v) => {
    let t = 0;
    let pendingGraces: Beat[] = [];
    for (const beat of voice.beats) {
      if (beat.graceNote) {
        pendingGraces.push(beat);
        continue;
      }
      const slot = slotAt(t);
      slot.beats.push({ beat, voice: v });
      slot.graces.push(...pendingGraces);
      pendingGraces = [];
      t += durTicks(beat);
    }
    const restOnly = voice.beats.every((b) => b.rest);
    if (!restOnly) end = Math.max(end, t);
  });
  if (slotMap.size === 0) slotAt(0);

  const slots = [...slotMap.values()].sort((a, b) => a.tick - b.tick);
  slots.forEach((slot, i) => {
    const next = slots[i + 1]?.tick ?? end;
    const gap = Math.max(next - slot.tick, TICKS / 64);
    let minW = 11;
    for (const { beat } of slot.beats)
      for (const n of beat.notes)
        if (!n.rest) minW = Math.max(minW, measureWidth(doc, fretLabel(n), FRET_SIZE) + 6);
    slot.w = Math.max(minW, 17 * Math.sqrt(gap / EIGHTH));
    slot.lead = slot.graces.length * 10;
  });

  const prefix = 8 + (showSig ? 16 : 0) + (m.repeatStart ? 7 : 0);
  const suffix = m.repeat ? 7 : 0;
  const natural = prefix + suffix + slots.reduce((a, s) => a + s.lead + s.w, 0);
  return {
    index,
    measure: m,
    slots,
    prefix,
    suffix,
    showSig: showSig ? sig : null,
    natural,
    x: 0,
    width: 0,
  };
}

function justifyLine(measures: MeasureLayout[], isLast: boolean, contentW: number) {
  const natural = measures.reduce((a, m) => a + m.natural, 0);
  const stretchable = measures.reduce((a, m) => a + m.slots.reduce((b, s) => b + s.w, 0), 0);
  let scale = 1 + (contentW - natural) / stretchable;
  if (isLast && natural < contentW * 0.75) scale = Math.min(scale, 1.15);
  let x = MARGIN.l;
  for (const m of measures) {
    m.x = x;
    let cx = x + m.prefix;
    for (const s of m.slots) {
      cx += s.lead;
      s.x = cx;
      cx += s.w * scale;
    }
    m.width = cx + m.suffix - x;
    const only = m.slots.length === 1 ? m.slots[0]! : null;
    if (only && !only.graces.length && only.beats.every(({ beat }) => beat.rest))
      only.x = m.x + m.prefix + (m.width - m.prefix - m.suffix) / 2;
    x += m.width;
  }
}

function lanesFor(measures: MeasureLayout[], tempoAt: Map<number, number>): Lanes {
  const l: Lanes = { section: 0, text: 0, chord: 0, marks: 0, letRing: 0, palmMute: 0, bend: 0 };
  for (const ml of measures) {
    const m = ml.measure;
    if (m.marker || m.alternateEnding || tempoAt.has(ml.index)) l.section = LANE.section;
    for (const v of m.voices)
      for (const b of v.beats) {
        if (b.chord) l.chord = LANE.chord;
        if (b.text) l.text = LANE.text;
        if (b.letRing) l.letRing = LANE.letRing;
        if (b.palmMute) l.palmMute = LANE.palmMute;
        if (b.tapping || b.pickStroke || b.tremoloPicking) l.marks = LANE.marks;
        for (const n of b.notes) {
          if (n.bend) l.bend = LANE.bend;
          if (n.leftHandVibrato || n.accentuated || (n.harmonic && n.harmonic !== "natural")) l.marks = LANE.marks;
        }
      }
  }
  return l;
}

function laneTotal(l: Lanes): number {
  return l.section + l.text + l.chord + l.marks + l.letRing + l.palmMute + l.bend;
}

// ─── Drawing ────────────────────────────────────────────────────────────────

class TabRenderer {
  private beatPos = new Map<Beat, BeatPos>();
  private lines: LineLayout[] = [];
  private staffH: number;
  private tempoAt = new Map<number, number>();
  private pageW: number;
  private pageH: number;
  private contentW: number;
  /** Index of the document page this track starts on (non-zero in combined PDFs). */
  readonly firstPage: number;

  constructor(
    private doc: Doc,
    private meta: SongMeta,
    private track: Track,
    private trackTitle: string,
    paper: Paper,
  ) {
    [this.pageW, this.pageH] = PAPER_SIZES[paper];
    this.contentW = this.pageW - MARGIN.l - MARGIN.r;
    this.firstPage = doc.bufferedPageRange().start + doc.bufferedPageRange().count - 1;
    this.staffH = (track.strings - 1) * STRING_GAP;
    for (const t of track.automations?.tempo ?? []) this.tempoAt.set(t.measure, t.bpm);
  }

  render() {
    this.layout();
    this.drawHeader();
    let page = this.firstPage;
    for (const line of this.lines) {
      if (line.page !== page) {
        this.doc.addPage();
        page = line.page;
      }
      this.drawLine(line);
    }
    this.drawConnections();
  }

  /** Index of the last page this track occupies. */
  get lastPage(): number {
    return this.lines.length ? this.lines[this.lines.length - 1]!.page : this.firstPage;
  }

  private layout() {
    const { doc, track } = this;
    let sig: [number, number] = [4, 4];
    const all: MeasureLayout[] = track.measures.map((m, i) => {
      const changed = !!m.signature && (m.signature[0] !== sig[0] || m.signature[1] !== sig[1]);
      if (m.signature) sig = m.signature;
      return layoutMeasure(doc, m, i, sig, i === 0 || changed);
    });

    // Greedy line breaking.
    const groups: MeasureLayout[][] = [];
    let cur: MeasureLayout[] = [];
    let w = 0;
    for (const ml of all) {
      if (cur.length && w + ml.natural > this.contentW) {
        groups.push(cur);
        cur = [];
        w = 0;
      }
      cur.push(ml);
      w += ml.natural;
    }
    if (cur.length) groups.push(cur);

    let y = MARGIN.t + 78; // header space on the track's first page
    let page = this.firstPage;
    groups.forEach((measures, i) => {
      justifyLine(measures, i === groups.length - 1, this.contentW);
      const lanes = lanesFor(measures, this.tempoAt);
      const height = 6 + laneTotal(lanes) + this.staffH + RHYTHM_H;
      if (y + height > this.pageH - MARGIN.b) {
        page++;
        y = MARGIN.t;
      }
      const line: LineLayout = { measures, lanes, top: y, staffTop: y + 6 + laneTotal(lanes), page, height };
      this.lines.push(line);
      y += height + SYSTEM_GAP;

      for (const ml of measures)
        for (const slot of ml.slots) {
          for (const { beat } of slot.beats) this.beatPos.set(beat, { x: slot.x, line, grace: false });
          slot.graces.forEach((g, gi) =>
            this.beatPos.set(g, { x: slot.x - (slot.graces.length - gi) * 10 + 1, line, grace: true }),
          );
        }
    });
  }

  private drawHeader() {
    const { doc, meta, track } = this;
    doc.font("Helvetica-Bold").fontSize(20).fillColor(INK);
    doc.text(meta.title, MARGIN.l, MARGIN.t, { width: this.contentW, lineBreak: false, ellipsis: true });
    doc.font("Helvetica").fontSize(12).fillColor(MUTED);
    doc.text(meta.artist, MARGIN.l, MARGIN.t + 25, { lineBreak: false });

    const tuning = (track.tuning ?? []).slice().reverse().map(midiName).join(" ");
    const bpm = this.tempoAt.get(0);
    const details = [
      this.trackTitle,
      tuning && `Tuning: ${tuning}`,
      track.capo ? `Capo ${track.capo}` : "",
      bpm ? `Tempo: ${bpm} bpm` : "",
    ].filter(Boolean);
    doc.font("Helvetica").fontSize(9).fillColor(INK);
    doc.text(details.join("   ·   "), MARGIN.l, MARGIN.t + 45, { width: this.contentW, lineBreak: false });
    doc
      .moveTo(MARGIN.l, MARGIN.t + 62)
      .lineTo(this.pageW - MARGIN.r, MARGIN.t + 62)
      .lineWidth(0.5)
      .strokeColor("#cccccc")
      .stroke();
  }

  private stringY(line: LineLayout, s: number) {
    return line.staffTop + s * STRING_GAP;
  }

  private drawLine(line: LineLayout) {
    const { doc } = this;
    const first = line.measures[0]!;
    const last = line.measures[line.measures.length - 1]!;
    const x0 = first.x;
    const x1 = last.x + last.width;

    // Staff lines.
    doc.lineWidth(0.5).strokeColor(STAFF);
    for (let s = 0; s < this.track.strings; s++) {
      const y = this.stringY(line, s);
      doc.moveTo(x0, y).lineTo(x1, y).stroke();
    }

    // String names on the very first system.
    if (line === this.lines[0] && this.track.tuning)
      this.track.tuning.forEach((midi, s) =>
        text(doc, midiName(midi), x0 - 4, this.stringY(line, s), { size: 6.5, align: "right", color: MUTED }),
      );

    else text(doc, String(first.index + 1), x0 - 4, line.staffTop, { size: 6.5, align: "right", color: MUTED });

    this.barline(x0, line);
    for (const ml of line.measures) this.drawMeasure(ml, line);
    this.drawSustainLanes(line);
  }

  private barline(x: number, line: LineLayout, width = 0.7) {
    this.doc
      .lineWidth(width)
      .strokeColor(INK)
      .moveTo(x, line.staffTop)
      .lineTo(x, line.staffTop + this.staffH)
      .stroke();
  }

  private repeatDots(x: number, line: LineLayout) {
    const mid = line.staffTop + this.staffH / 2;
    this.doc.fillColor(INK);
    this.doc.circle(x, mid - STRING_GAP * 0.9, 1.3).fill();
    this.doc.circle(x, mid + STRING_GAP * 0.9, 1.3).fill();
  }

  private drawMeasure(ml: MeasureLayout, line: LineLayout) {
    const { doc, track } = this;
    const m = ml.measure;
    const end = ml.x + ml.width;
    const isFinal = ml.index === track.measures.length - 1;

    // Barlines & repeats.
    if (m.repeatStart) {
      doc.rect(ml.x, line.staffTop, 2, this.staffH).fill(INK);
      this.barline(ml.x + 3.5, line, 0.6);
      this.repeatDots(ml.x + 6.3, line);
    }
    if (m.repeat) {
      this.repeatDots(end - 6.3, line);
      this.barline(end - 3.5, line, 0.6);
      doc.rect(end - 2, line.staffTop, 2, this.staffH).fill(INK);
      text(doc, `x${m.repeat}`, end - 1, line.staffTop - 5, { size: 7, font: "Helvetica-Bold", align: "right" });
    } else if (isFinal) {
      this.barline(end - 3.5, line, 0.6);
      doc.rect(end - 2, line.staffTop, 2, this.staffH).fill(INK);
    } else if (m.doubleBarline) {
      this.barline(end - 2.5, line, 0.6);
      this.barline(end, line, 0.6);
    } else {
      this.barline(end, line);
    }

    // Time signature.
    if (ml.showSig) {
      const sx = ml.x + (m.repeatStart ? 7 : 0) + 12;
      const mid = line.staffTop + this.staffH / 2;
      const off = Math.min(this.staffH / 4, 8);
      for (const [v, y] of [
        [ml.showSig[0], mid - off],
        [ml.showSig[1], mid + off],
      ] as const) {
        doc.rect(sx - 6, y - 6, 12, 12).fill("white");
        text(doc, String(v), sx, y, { size: 13, font: "Helvetica-Bold", align: "center" });
      }
    }

    this.drawSectionLane(ml, line);

    // Notes, chord names, marks and bends.
    for (const slot of ml.slots) {
      for (const { beat } of slot.beats) {
        this.drawBeatNotes(beat, slot.x, line, false);
        const sounding = slot.beats.some(({ beat: b }) => b.notes.some((n) => !n.rest));
        if (beat.rest && !sounding && beat === slot.beats[0]!.beat) this.drawRest(beat, slot.x, line);
        this.drawBeatAbove(beat, slot, line);
      }
      slot.graces.forEach((g) => this.drawBeatNotes(g, this.beatPos.get(g)!.x, line, true));
    }

    this.drawRhythm(ml, line);
  }

  private drawSectionLane(ml: MeasureLayout, line: LineLayout) {
    const { doc } = this;
    const m = ml.measure;
    if (!line.lanes.section) return;
    const y = line.top + LANE.section / 2 + 2;
    let x = ml.x + 2;

    if (m.alternateEnding) {
      const prev = this.track.measures[ml.index - 1]?.alternateEnding;
      const next = this.track.measures[ml.index + 1]?.alternateEnding;
      const same = (a?: number[]) => !!a && a.join() === m.alternateEnding!.join();
      const top = line.top + 3;
      const bottom = line.top + LANE.section;
      doc.lineWidth(0.7).strokeColor(INK);
      if (!same(prev) || ml === line.measures[0]) {
        doc.moveTo(ml.x + 1, bottom).lineTo(ml.x + 1, top).stroke();
        if (!same(prev)) text(doc, m.alternateEnding.map((n) => `${n}.`).join(" "), ml.x + 4, top + 5, { size: 7.5 });
      }
      doc.moveTo(ml.x + 1, top).lineTo(ml.x + ml.width - 2, top).stroke();
      if (!same(next)) doc.moveTo(ml.x + ml.width - 2, top).lineTo(ml.x + ml.width - 2, bottom).stroke();
      x += 22;
    }

    if (m.marker?.text) {
      const w = measureWidth(doc, m.marker.text, 8, "Helvetica-Bold");
      doc.roundedRect(x - 2, y - 5.5, w + 5, 11, 2).fill("#e9e9e9");
      text(doc, m.marker.text, x + 0.5, y, { size: 8, font: "Helvetica-Bold" });
      x += w + 10;
    }

    const bpm = this.tempoAt.get(ml.index);
    if (bpm !== undefined) {
      // Quarter-note glyph + "= bpm".
      doc.fillColor(INK).ellipse(x + 2, y + 2.2, 2.3, 1.6).fill();
      doc.lineWidth(0.7).strokeColor(INK).moveTo(x + 4.1, y + 2).lineTo(x + 4.1, y - 5.5).stroke();
      text(doc, `= ${bpm}`, x + 7, y, { size: 7.5 });
    }
  }

  private drawBeatNotes(beat: Beat, x: number, line: LineLayout, grace: boolean) {
    const { doc } = this;
    const size = grace ? GRACE_SIZE : FRET_SIZE;
    for (const n of beat.notes) {
      if (n.rest) continue;
      const y = this.stringY(line, n.string);
      const label = fretLabel(n);
      const w = measureWidth(doc, label, size);
      doc.rect(x - w / 2 - 1, y - size * 0.45, w + 2, size * 0.9).fill("white");
      text(doc, label, x, y, { size, align: "center", color: n.tie ? MUTED : INK });
    }
  }

  private drawRest(beat: Beat, x: number, line: LineLayout) {
    const { doc } = this;
    const mid = line.staffTop + this.staffH / 2;
    const lineA = line.staffTop + Math.floor((this.track.strings - 1) / 2) * STRING_GAP;
    doc.fillColor(INK).strokeColor(INK);
    if (beat.type <= 1) {
      doc.rect(x - 3.5, lineA, 7, 3).fill();
    } else if (beat.type === 2) {
      doc.rect(x - 3.5, lineA - 3, 7, 3).fill();
    } else if (beat.type === 4) {
      doc.rect(x - 3, mid - 8, 6, 16).fill("white");
      doc
        .lineWidth(1.3)
        .strokeColor(INK)
        .moveTo(x - 1.5, mid - 7)
        .lineTo(x + 2, mid - 3)
        .lineTo(x - 1.5, mid + 0.5)
        .lineTo(x + 2, mid + 4)
        .quadraticCurveTo(x - 3.5, mid + 2.5, x, mid + 7)
        .stroke();
    } else {
      const flags = beamLevel(beat);
      const h = 7 + flags * 3;
      doc.rect(x - 3.5, mid - 6, 7.5, h + 2).fill("white");
      doc
        .lineWidth(0.9)
        .strokeColor(INK)
        .moveTo(x + 2.5, mid - 5)
        .lineTo(x - 0.5, mid - 5 + h)
        .stroke();
      for (let k = 0; k < flags; k++) {
        const fy = mid - 3.5 + k * 3;
        const sx = x + 2.5 - (k * 3 * 3) / h;
        doc.fillColor(INK).circle(x - 1.8 - (k * 3 * 3) / h, fy, 1.2).fill();
        doc.moveTo(x - 1.8 - (k * 3 * 3) / h, fy + 0.6).quadraticCurveTo(x, fy + 1.5, sx, fy - 1.5).stroke();
      }
    }
  }

  private drawBeatAbove(beat: Beat, slot: Slot, line: LineLayout) {
    const { doc } = this;
    const { lanes } = line;
    const x = slot.x;

    const textY = line.top + 6 + lanes.section + LANE.text / 2;
    const note = typeof beat.text === "string" ? beat.text : beat.text?.text;
    if (note) text(doc, note, x - 3, textY, { size: 7, font: "Helvetica-Oblique" });
    const chordY = line.top + 6 + lanes.section + lanes.text + LANE.chord / 2;
    if (beat.chord?.text) text(doc, beat.chord.text, x - 3, chordY, { size: 7.5, font: "Helvetica-Bold" });

    const marksY = chordY - LANE.chord / 2 + lanes.chord + LANE.marks / 2;
    let mx = x;
    const mark = (s: string, font = "Helvetica-Bold") => {
      mx += text(doc, s, mx, marksY, { size: 6.5, font, align: mx === x ? "center" : "left" }) / (mx === x ? 2 : 1) + 2;
    };
    if (beat.tapping) mark("T");
    if (beat.tremoloPicking) mark("tr.", "Helvetica-Oblique");
    if (beat.pickStroke === "down") {
      doc.lineWidth(0.8).strokeColor(INK);
      doc.moveTo(mx - 2.5, marksY + 2.5).lineTo(mx - 2.5, marksY - 2.5).lineTo(mx + 2.5, marksY - 2.5).lineTo(mx + 2.5, marksY + 2.5).stroke();
      mx += 5;
    } else if (beat.pickStroke === "up") {
      doc.lineWidth(0.8).strokeColor(INK);
      doc.moveTo(mx - 2.2, marksY - 3).lineTo(mx, marksY + 3).lineTo(mx + 2.2, marksY - 3).stroke();
      mx += 5;
    }
    const harmonic = beat.notes.find((n) => n.harmonic && n.harmonic !== "natural")?.harmonic;
    if (harmonic) mark(harmonic === "pinch" ? "P.H." : "A.H.");
    if (beat.notes.some((n) => n.accentuated)) mark(">");
    const vib = beat.notes.find((n) => n.leftHandVibrato)?.leftHandVibrato;
    if (vib) this.vibrato(Math.max(mx - 2, x - 3), x + slot.w - 4, marksY, vib === "wide");

    // Bends.
    const bendTop = line.staffTop - LANE.bend + 3;
    for (const n of beat.notes) if (n.bend && !n.rest) this.drawBend(n, x, this.stringY(line, n.string), bendTop, line.staffTop);
  }

  private vibrato(x0: number, x1: number, y: number, wide: boolean) {
    const { doc } = this;
    const amp = wide ? 2.2 : 1.3;
    const step = wide ? 3.2 : 2.4;
    doc.lineWidth(wide ? 0.9 : 0.7).strokeColor(INK).moveTo(x0, y);
    let up = true;
    for (let x = x0 + step; x <= Math.max(x1, x0 + step * 3); x += step) {
      doc.lineTo(x, y + (up ? -amp : amp));
      up = !up;
    }
    doc.stroke();
  }

  private drawBend(n: Note, x: number, yNote: number, top: number, staffTop: number) {
    const { doc } = this;
    const pts = n.bend!.points;
    const start = pts[0]?.tone ?? 0;
    const endTone = pts[pts.length - 1]?.tone ?? 0;
    const max = Math.max(n.bend!.tone, ...pts.map((p) => p.tone));
    const arrow = (tx: number, ty: number, down: boolean) => {
      const d = down ? -1 : 1;
      doc.fillColor(INK).moveTo(tx, ty).lineTo(tx - 2, ty + 3.5 * d).lineTo(tx + 2, ty + 3.5 * d).fill();
    };
    doc.lineWidth(0.7).strokeColor(INK);
    const peakX = x + 10;
    if (start === 0) {
      doc.moveTo(x + 4, yNote).quadraticCurveTo(peakX, yNote, peakX, top + 4).stroke();
      arrow(peakX, top + 1, false);
    } else {
      doc.moveTo(peakX, yNote - 4).lineTo(peakX, top + 4).dash(1.5, { space: 1.2 }).stroke().undash();
      arrow(peakX, top + 1, false);
    }
    text(doc, bendLabel(max), peakX, top - 3.5, { size: 6, align: "center" });
    if (endTone < max) {
      doc.moveTo(peakX, top + 4).quadraticCurveTo(peakX + 7, top + 4, peakX + 7, staffTop - 3).stroke();
      arrow(peakX + 7, staffTop - 1, true);
      if (endTone > 0) text(doc, bendLabel(endTone), peakX + 10, staffTop - 5, { size: 5.5 });
    }
  }

  private drawSustainLanes(line: LineLayout) {
    const slots = line.measures.flatMap((m) => m.slots);
    const { section, text: txt, chord, marks } = line.lanes;
    const lr = line.top + 6 + section + txt + chord + marks + LANE.letRing / 2;
    const pm = lr - LANE.letRing / 2 + line.lanes.letRing + LANE.palmMute / 2;
    if (line.lanes.letRing) this.sustainRuns(slots, (b) => !!b.letRing, "let ring", lr);
    if (line.lanes.palmMute) this.sustainRuns(slots, (b) => !!b.palmMute, "P.M.", pm);
  }

  private sustainRuns(slots: Slot[], on: (b: Beat) => boolean, label: string, y: number) {
    const { doc } = this;
    let i = 0;
    while (i < slots.length) {
      if (!slots[i]!.beats.some(({ beat }) => on(beat))) {
        i++;
        continue;
      }
      let j = i;
      while (j + 1 < slots.length && slots[j + 1]!.beats.some(({ beat }) => on(beat))) j++;
      const start = slots[i]!.x - 3;
      const end = slots[j]!.x + Math.min(slots[j]!.w - 3, 8);
      const w = text(doc, label, start, y, { size: 6.5, font: "Helvetica-Oblique" });
      if (end > start + w + 4) {
        doc.lineWidth(0.6).strokeColor(INK).dash(2, { space: 1.5 }).moveTo(start + w + 2, y).lineTo(end, y).stroke().undash();
        doc.moveTo(end, y - 2.5).lineTo(end, y + 2.5).stroke();
      }
      i = j + 1;
    }
  }

  private drawRhythm(ml: MeasureLayout, line: LineLayout) {
    const { doc } = this;
    const voice = ml.measure.voices[0];
    if (!voice) return;
    const beats = voice.beats.filter((b) => !b.graceNote);
    const xs = new Map<Beat, number>(beats.map((b) => [b, this.beatPos.get(b)!.x]));
    const stemTop = line.staffTop + this.staffH + 5;
    const stemBottom = stemTop + 17;

    doc.lineWidth(0.8).strokeColor(INK).fillColor(INK);
    for (const b of beats) {
      if (b.rest) continue;
      const x = xs.get(b)!;
      if (b.type >= 2) doc.moveTo(x, b.type === 2 ? stemTop + 8 : stemTop).lineTo(x, stemBottom).stroke();
      for (let d = 0; d < (b.dots ?? 0); d++) doc.circle(x + 3 + d * 2.5, stemTop + 9, 0.9).fill();
    }

    // Beam groups from beamStart/beamStop; stray eighths get flags.
    const groups: Beat[][] = [];
    let cur: Beat[] | null = null;
    for (const b of beats) {
      if (b.beamStart) cur = [];
      if (cur && !b.rest && beamLevel(b) > 0) cur.push(b);
      else if (!cur && !b.rest && beamLevel(b) > 0) groups.push([b]);
      if (b.beamStop && cur) {
        groups.push(cur);
        cur = null;
      }
    }
    if (cur) groups.push(cur);

    for (const g of groups) {
      if (g.length === 1) {
        const b = g[0]!;
        const x = xs.get(b)!;
        for (let k = 0; k < beamLevel(b); k++) {
          const y = stemBottom - k * 3.2;
          doc.lineWidth(1.1).moveTo(x, y).quadraticCurveTo(x + 1.5, y - 3, x + 5, y - 5.5).stroke();
        }
        continue;
      }
      const maxLevel = Math.max(...g.map(beamLevel));
      for (let L = 1; L <= maxLevel; L++) {
        const y = stemBottom - (L - 1) * 3.2 - 2;
        g.forEach((b, i) => {
          if (beamLevel(b) < L) return;
          const x = xs.get(b)!;
          const next = g[i + 1];
          const prev = g[i - 1];
          if (next && beamLevel(next) >= L) doc.rect(x - 0.4, y, xs.get(next)! - x + 0.8, 2).fill();
          else if (!(prev && beamLevel(prev) >= L)) {
            const dir = next ? 1 : -1;
            doc.rect(dir > 0 ? x - 0.4 : x - 5, y, 5.4, 2).fill();
          }
        });
      }
    }

    // Tuplet numbers.
    const tupletGroups: Beat[][] = [];
    let tg: Beat[] | null = null;
    for (const b of beats) {
      if (!b.tuplet) {
        if (tg) tupletGroups.push(tg);
        tg = null;
        continue;
      }
      if (b.tupletStart || !tg || tg.length >= b.tuplet) {
        if (tg) tupletGroups.push(tg);
        tg = [];
      }
      tg.push(b);
      if (b.tupletStop) {
        tupletGroups.push(tg);
        tg = null;
      }
    }
    if (tg) tupletGroups.push(tg);
    for (const t of tupletGroups) {
      const a = xs.get(t[0]!)!;
      const z = xs.get(t[t.length - 1]!)!;
      text(doc, String(t[0]!.tuplet), (a + z) / 2, stemBottom + 6, { size: 6.5, font: "Helvetica-Oblique", align: "center" });
    }
  }

  // Hammer-ons/pull-offs, slides and ties, which may cross measure/line boundaries.
  private drawConnections() {
    const { doc } = this;
    const voices = Math.max(...this.track.measures.map((m) => m.voices.length));
    for (let v = 0; v < voices; v++) {
      const seq = this.track.measures.flatMap((m) => m.voices[v]?.beats ?? []);
      seq.forEach((beat, i) => {
        const a = this.beatPos.get(beat);
        if (!a) return;
        doc.switchToPage(a.line.page);
        for (const n of beat.notes) {
          if (n.rest) continue;
          const y = this.stringY(a.line, n.string);
          const off = a.grace ? 3 : 4.5;
          if (n.slide === "below") this.seg(a.x - 11, y + 2.5, a.x - off - 1, y - 0.5);
          if (n.slide === "above") this.seg(a.x - 11, y - 2.5, a.x - off - 1, y + 0.5);
          if (n.slide === "downwards") this.seg(a.x + off + 1, y - 0.5, a.x + 11, y + 2.5);
          if (n.slide === "upwards") this.seg(a.x + off + 1, y + 0.5, a.x + 11, y - 2.5);

          const nextBeat = seq[i + 1];
          const target = nextBeat?.notes.find((m) => m.string === n.string && !m.rest);
          const b = nextBeat && this.beatPos.get(nextBeat);
          const connects = n.hp || n.slide === "legato" || n.slide === "shift" || target?.tie;
          if (!connects || !target || !b) continue;

          const sameLine = b.line === a.line;
          const lastM = a.line.measures[a.line.measures.length - 1]!;
          const x0 = a.x + off;
          const x1 = sameLine ? b.x - (b.grace ? 3 : 4.5) : lastM.x + lastM.width - 2;
          const rising = (target.fret ?? 0) > (n.fret ?? 0);

          if (n.slide === "legato" || n.slide === "shift") this.seg(x0, y + (rising ? 2 : -2), x1, y + (rising ? -2 : 2));
          if (n.hp || n.slide === "legato" || target.tie) {
            const below = !!target.tie && !n.hp;
            const cy = below ? y + 3 : y - 3.5;
            const bulge = below ? 4 : -4;
            doc.lineWidth(0.6).strokeColor(INK).moveTo(x0, cy).quadraticCurveTo((x0 + x1) / 2, cy + bulge * 1.6, x1, cy).stroke();
            if (n.hp && sameLine && x1 - x0 > 7)
              text(doc, rising ? "H" : "P", (x0 + x1) / 2, cy + bulge * 1.5 - 1.5, { size: 5, align: "center" });
          }
        }
      });
    }
  }

  private seg(x0: number, y0: number, x1: number, y1: number) {
    this.doc.lineWidth(0.7).strokeColor(INK).moveTo(x0, y0).lineTo(x1, y1).stroke();
  }
}

export interface Part {
  track: Track;
  title: string;
}

export interface RenderOptions {
  paper?: Paper;
}

/**
 * Render one or more tracks of a song into a single PDF. Each track starts on a
 * new page with its own header and gets a bookmark; footers carry the track
 * name and overall page numbers.
 */
export async function renderPdf(meta: SongMeta, parts: Part[], opts: RenderOptions = {}): Promise<Uint8Array> {
  const paper = opts.paper ?? "a4";
  const [pageW, pageH] = PAPER_SIZES[paper];
  const single = parts.length === 1;
  const doc = new PDFDocument({
    size: [pageW, pageH],
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
    bufferPages: true,
    info: {
      Title: single ? `${meta.artist} - ${meta.title} (${parts[0]!.title})` : `${meta.artist} - ${meta.title}`,
      Author: meta.artist,
      Subject: "Guitar tab",
      Creator: "savesterr",
    },
  });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<void>((resolve) => doc.on("end", () => resolve()));

  const pageLabels: string[] = [];
  parts.forEach((part, i) => {
    if (i > 0) doc.addPage();
    if (!single) doc.outline.addItem(part.title);
    const r = new TabRenderer(doc, meta, part.track, part.title, paper);
    r.render();
    for (let p = r.firstPage; p <= r.lastPage; p++) pageLabels[p] = part.title;
  });

  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const label = `${meta.artist} – ${meta.title} · ${pageLabels[i] ?? ""}`;
    text(doc, label, MARGIN.l, pageH - 22, { size: 7, color: MUTED });
    text(doc, `${i + 1} / ${range.count}`, pageW - MARGIN.r, pageH - 22, { size: 7, color: MUTED, align: "right" });
  }

  doc.end();
  await done;
  return new Uint8Array(Buffer.concat(chunks));
}
