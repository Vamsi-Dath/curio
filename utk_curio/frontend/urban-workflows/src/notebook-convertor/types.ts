export type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];

export interface JsonObject {
  [key: string]: JsonValue;
}

export interface NotebookCell {
  cell_type: "code" | "markdown" | string;
  source: string;
  metadata?: Record<string, unknown>;
}

export interface Notebook {
  cells: NotebookCell[];
  metadata: Record<string, unknown>;
  nbformat: number;
  nbformat_minor: number;
}

export interface TrillNode {
  id: string;
  type: string;
  x: number;
  y: number;
  content?: string;
  in?: string;
  out?: string;
}

export interface TrillEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  type?: string;
}

export interface TrillDataflow {
  nodes: TrillNode[];
  edges: TrillEdge[];
  name: string;
  task: string;
  timestamp: number;
  provenance_id: string;
}

export interface TrillSpec {
  dataflow: TrillDataflow;
}

export interface InputConnection {
  source: string;
  sourceHandle: string;
  bidirectional: boolean;
}

export interface OutputConnection {
  target: string;
  targetHandle: string;
  bidirectional: boolean;
}

export interface GraphNodeInfo {
  node: TrillNode;
  dependencies: Set<string>;
  dependents: Set<string>;
  inputs: Record<string, InputConnection[]>;
  outputs: Record<string, OutputConnection[]>;
}

export interface TrillMeta {
  id?: string;
  type?: string;
  in?: string;
  out?: string;
}

export interface NotebookTrillConnection {
  id?: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  bidirectional?: boolean;
  type?: string;
}

export interface NotebookTrillConnectionsMetadata {
  inputs?: NotebookTrillConnection[];
  outputs?: NotebookTrillConnection[];
}
