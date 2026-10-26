export interface Segment {
  id: number;
  text: string;
  line: number;
  speaker?: string;
  time?: string;
}

export interface Source {
  raw: string;
  kind: "transcript" | "notes";
  segments: Segment[];
}

/** A claim that has been traced back to the pasted source. */
export interface Grounded {
  quote: string;
  segIds: number[];
}

export type HoldReason =
  | "quote-not-found"
  | "unsupported-claim"
  | "invented-number"
  | "malformed"
  | "dangling-edge"
  | "duplicate";

export interface Held {
  section: SectionId;
  reason: HoldReason;
  item: string;
}

export type SectionId = "points" | "map" | "quiz" | "examples" | "audio" | "projects";

export interface Point extends Grounded {
  id: number;
  text: string;
}
export interface MapNode extends Grounded {
  id: string;
  label: string;
}
export interface MapEdge extends Grounded {
  from: string;
  to: string;
  label: string;
}
export interface QuizItem extends Grounded {
  question: string;
  options: string[];
  answer: number;
  explanation: string;
}
export interface Example extends Grounded {
  title: string;
  scenario: string;
  steps: string[];
}
export interface AudioLine extends Grounded {
  speaker: string;
  text: string;
}
export interface ProjectIdea extends Grounded {
  title: string;
  brief: string;
}

export interface Kit {
  model: string;
  points: Point[];
  map: { nodes: MapNode[]; edges: MapEdge[] };
  quiz: QuizItem[];
  examples: Example[];
  audio: AudioLine[];
  projects: ProjectIdea[];
  held: Held[];
  /** Sections whose model call failed outright (timeouts, bad JSON twice). */
  errors?: Partial<Record<SectionId, string>>;
  /** Number of items the model proposed per section, before code validation. */
  proposed: Record<SectionId, number>;
}

export type Llm = (req: {
  system: string;
  user: string;
  schema: object;
}) => Promise<unknown>;
