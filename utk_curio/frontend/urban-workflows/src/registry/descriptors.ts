import { NodeType, SupportedType } from '../constants';
import { Position } from 'reactflow';
import {
  faMagnifyingGlassChart,
  faSquareRootVariable,
  faUpload,
  faDownload,
  faServer,
  faDatabase,
  faRepeat,
  faCodeMerge,
  faTable,
  faCube,
  faChartLine,
  faCopy,
  faRectangleList,
} from '@fortawesome/free-solid-svg-icons';
import { faJs } from '@fortawesome/free-brands-svg-icons';

import { registerNode } from './nodeRegistry';

import {
  standardInOut,
  outputOnly,
  inputOnly,
  withBidirectional,
  flowSwitchHandles,
  useCodeNodeLifecycle,
  useDataExportLifecycle,
  useVegaLifecycle,
  useUtkLifecycle,
  useSimpleVisLifecycle,
  useFlowSwitchLifecycle,
  useMergeFlowLifecycle,
  useDataPoolLifecycle,
  useDataSummaryLifecycle,
} from '../adapters/node';

const ALL_TYPES = [
  SupportedType.DATAFRAME,
  SupportedType.GEODATAFRAME,
  SupportedType.VALUE,
  SupportedType.LIST,
  SupportedType.JSON,
  SupportedType.RASTER,
];

const SPATIAL_DATA = [
  SupportedType.DATAFRAME,
  SupportedType.GEODATAFRAME,
  SupportedType.RASTER,
];

const TABULAR_DATA = [
  SupportedType.DATAFRAME,
  SupportedType.GEODATAFRAME,
];

// ── Data nodes ──────────────────────────────────────────────────────────

registerNode({
  id: NodeType.DATA_LOADING,
  category: 'data',
  label: 'Data Loading',
  icon: faUpload,
  inputPorts: [],
  outputPorts: [{ types: SPATIAL_DATA, cardinality: '[1,n]' }],
  editor: 'code',
  inPalette: true,
  paletteOrder: 0,
  description: 'The Data Loading box is responsible for getting data from the outside world into the dataflow.',
  hasCode: true,
  hasWidgets: true,
  hasGrammar: false,
  tutorialId: 'step-loading',
  adapter: {
    handles: outputOnly(),
    editor: { code: true, grammar: false, widgets: true },
    container: { handleType: 'out', disablePlay: false },
    outputIconType: 'N',
    showTemplateModal: true,
    useLifecycle: useCodeNodeLifecycle,
  },
});

registerNode({
  id: NodeType.DATA_EXPORT,
  category: 'data',
  label: 'Data Export',
  icon: faDownload,
  inputPorts: [{ types: SPATIAL_DATA, cardinality: '1' }],
  outputPorts: [],
  editor: 'code',
  inPalette: true,
  paletteOrder: 1,
  description: 'The Export box is responsible for getting data from the dataflow to the outside world.',
  hasCode: true,
  hasWidgets: true,
  hasGrammar: false,
  adapter: {
    handles: inputOnly(),
    editor: { code: false, grammar: false, widgets: false },
    container: { handleType: 'in' },
    inputIconType: '1',
    showTemplateModal: true,
    useLifecycle: useDataExportLifecycle,
  },
});


registerNode({
  id: NodeType.DATA_TRANSFORMATION,
  category: 'data',
  label: 'Data Transformation',
  icon: faDatabase,
  inputPorts: [{ types: SPATIAL_DATA, cardinality: '[1,2]' }],
  outputPorts: [{ types: SPATIAL_DATA, cardinality: '[1,2]' }],
  editor: 'code',
  inPalette: true,
  paletteOrder: 3,
  description: 'The Data Transformation box is responsible for performing any kinds of transformations to the data.',
  hasCode: true,
  hasWidgets: true,
  hasGrammar: false,
  tutorialId: 'step-transformation',
  adapter: {
    handles: standardInOut(),
    editor: { code: true, grammar: false, widgets: true },
    container: { handleType: 'in/out' },
    inputIconType: '2',
    outputIconType: '2',
    showTemplateModal: true,
    useLifecycle: useCodeNodeLifecycle,
  },
});

registerNode({
  id: NodeType.DATA_POOL,
  category: 'data',
  label: 'Data Pool',
  icon: faServer,
  inputPorts: [{ types: TABULAR_DATA, cardinality: '1' }],
  outputPorts: [{ types: TABULAR_DATA, cardinality: '1' }],
  editor: 'none',
  inPalette: true,
  paletteOrder: 5,
  description: 'The Data Pool is reponsible for storing data that can be interacted by all connected visualizations. Interactions can also be propagated to other Data Pools.',
  hasCode: false,
  hasWidgets: false,
  hasGrammar: false,
  tutorialId: 'step-pool',
  adapter: {
    handles: withBidirectional(standardInOut()),
    editor: { code: false, grammar: false, widgets: true, provenance: false },
    container: {},
    inputIconType: '1',
    outputIconType: '1',
    showTemplateModal: false,
    useLifecycle: useDataPoolLifecycle,
  },
});

// ── Computation nodes ───────────────────────────────────────────────────

registerNode({
  id: NodeType.COMPUTATION_ANALYSIS,
  category: 'computation',
  label: 'Computation Analysis',
  icon: faMagnifyingGlassChart,
  inputPorts: [{ types: ALL_TYPES, cardinality: '[1,n]' }],
  outputPorts: [{ types: ALL_TYPES, cardinality: '[1,n]' }],
  editor: 'code',
  inPalette: true,
  paletteOrder: 2,
  description: 'The Computation Analysis box is the box generic box responsible for performing any kinds of computations.',
  hasCode: true,
  hasWidgets: true,
  hasGrammar: false,
  tutorialId: 'step-analysis',
  adapter: {
    handles: standardInOut(),
    editor: { code: true, grammar: false, widgets: true },
    container: { handleType: 'in/out' },
    inputIconType: 'N',
    outputIconType: 'N',
    showTemplateModal: true,
    useLifecycle: useCodeNodeLifecycle,
  },
});

registerNode({
  id: NodeType.DATA_SUMMARY,
  category: 'computation',
  label: 'Data Summary',
  icon: faRectangleList,
  inputPorts: [{ types: TABULAR_DATA, cardinality: '1' }],
  outputPorts: [{ types: [SupportedType.JSON], cardinality: '1' }],
  editor: 'code',
  inPalette: true,
  paletteOrder: 10,
  description: 'The Data Summary node computes descriptive statistics and schema information (shape, dtypes, missing values, describe) for a DataFrame.',
  hasCode: true,
  hasWidgets: false,
  hasGrammar: false,
  adapter: {
    handles: standardInOut(),
    editor: { code: true, grammar: false, widgets: true },
    container: { handleType: 'in/out' },
    inputIconType: '1',
    outputIconType: '1',
    showTemplateModal: true,
    useLifecycle: useDataSummaryLifecycle,
  },
});

registerNode({
  id: NodeType.CONSTANTS,
  category: 'computation',
  label: 'Constants',
  icon: faSquareRootVariable,
  inputPorts: [],
  outputPorts: [{ types: [SupportedType.VALUE], cardinality: '1' }],
  editor: 'code',
  inPalette: false,
  description: 'The Constant box stores a constant.',
  hasCode: false,
  hasWidgets: true,
  hasGrammar: false,
  adapter: {
    handles: standardInOut(),
    editor: { code: false, grammar: false, widgets: true },
    container: { handleType: 'in/out' },
    outputIconType: '1',
    showTemplateModal: true,
    useLifecycle: useCodeNodeLifecycle,
  },
});

registerNode({
  id: NodeType.JS_COMPUTATION,
  category: 'computation',
  label: 'JS Computation',
  icon: faJs,
  inputPorts: [{ types: ALL_TYPES, cardinality: '[0,1]' }],
  outputPorts: [{ types: ALL_TYPES, cardinality: '[0,1]' }],
  editor: 'code',
  inPalette: true,
  paletteOrder: 11,
  description: 'Run JavaScript via Node.js. Input from the previous node is available as `arg`. Use `return` to pass output downstream.',
  hasCode: true,
  hasWidgets: false,
  hasGrammar: false,
  adapter: {
    handles: standardInOut(),
    editor: { code: true, grammar: false, widgets: true },
    container: { handleType: 'in/out', disablePlay: false },
    inputIconType: '1',
    outputIconType: '1',
    showTemplateModal: false,
    useLifecycle: useCodeNodeLifecycle,
  },
});

// ── Grammar visualization nodes ─────────────────────────────────────────

registerNode({
  id: NodeType.VIS_VEGA,
  category: 'vis_grammar',
  label: 'Vega-Lite',
  icon: faChartLine,
  inputPorts: [{ types: [SupportedType.DATAFRAME], cardinality: '1' }],
  outputPorts: [{ types: [SupportedType.DATAFRAME], cardinality: '1' }],
  editor: 'grammar',
  grammarId: 'vega-lite',
  inPalette: true,
  paletteOrder: 7,
  description: 'The Vega box is responsible for visualizing 2D plots.',
  hasCode: false,
  hasWidgets: true,
  hasGrammar: true,
  hasProvenance: true,
  tutorialId: 'step-vega',
  adapter: {
    handles: withBidirectional(standardInOut()),
    editor: { code: false, grammar: true, widgets: true, outputId: (nodeId) => 'vega' + nodeId },
    container: { handleType: 'in/out' },
    inputIconType: '1',
    outputIconType: '1',
    showTemplateModal: true,
    useLifecycle: useVegaLifecycle,
  },
});

registerNode({
  id: NodeType.VIS_UTK,
  category: 'vis_grammar',
  label: 'UTK',
  icon: faCube,
  inputPorts: [{ types: [SupportedType.GEODATAFRAME], cardinality: '[1,n]' }],
  outputPorts: [{ types: [SupportedType.GEODATAFRAME], cardinality: '[1,n]' }],
  editor: 'grammar',
  grammarId: 'utk',
  inPalette: true,
  paletteOrder: 6,
  description: 'The Urban Toolkit box is responsible for visualizing geolocated data.',
  hasCode: false,
  hasWidgets: true,
  hasGrammar: true,
  hasProvenance: true,
  tutorialId: 'step-utk',
  adapter: {
    handles: withBidirectional(standardInOut()),
    editor: { code: false, grammar: true, widgets: true, outputId: (nodeId) => 'utk' + nodeId + 'outer' },
    container: { handleType: 'in/out', disablePlay: false },
    inputIconType: 'N',
    outputIconType: 'N',
    showTemplateModal: true,
    useLifecycle: useUtkLifecycle,
  },
});

// ── Simple visualization nodes ──────────────────────────────────────────

registerNode({
  id: NodeType.VIS_SIMPLE,
  category: 'vis_simple',
  label: 'Simple View',
  icon: faTable,
  inputPorts: [{ types: ALL_TYPES, cardinality: '1' }],
  outputPorts: [{ types: ALL_TYPES, cardinality: '1' }],
  editor: 'none',
  inPalette: true,
  paletteOrder: 8,
  description: 'Displays incoming data: renders a table for DataFrames, an image grid for image DataFrames, or passes through other values.',
  hasCode: false,
  hasWidgets: false,
  hasGrammar: false,
  hasProvenance: true,
  tutorialId: 'step-image',
  adapter: {
    handles: withBidirectional(standardInOut()),
    editor: { code: false, grammar: false, widgets: false, provenance: false },
    container: {},
    inputIconType: '1',
    outputIconType: '1',
    showTemplateModal: false,
    useLifecycle: useSimpleVisLifecycle,
  },
});

// ── Flow nodes ──────────────────────────────────────────────────────────

registerNode({
  id: NodeType.FLOW_SWITCH,
  category: 'flow',
  label: 'Flow Switch',
  icon: faRepeat,
  inputPorts: [{ types: ALL_TYPES, cardinality: '2' }],
  outputPorts: [{ types: ALL_TYPES, cardinality: '1' }],
  editor: 'none',
  inPalette: false,
  description: 'The Flow Switch box is responsible for choosing which incoming data flow will be passed forward to the next box',
  hasCode: false,
  hasWidgets: true,
  hasGrammar: false,
  adapter: {
    handles: flowSwitchHandles(),
    editor: { code: true, grammar: false, widgets: true },
    container: { handleType: 'in' },
    inputIconType: '2',
    outputIconType: '1',
    showTemplateModal: false,
    useLifecycle: useFlowSwitchLifecycle,
  },
});

registerNode({
  id: NodeType.MERGE_FLOW,
  category: 'flow',
  label: 'Merge Flow',
  icon: faCodeMerge,
  inputPorts: [{ types: ALL_TYPES, cardinality: '[1,n]' }],
  outputPorts: [{ types: ALL_TYPES, cardinality: '1' }],
  editor: 'none',
  inPalette: true,
  paletteOrder: 9,
  description: 'The Merge Flow box merges multiple incoming data flows into one.',
  hasCode: false,
  hasWidgets: false,
  hasGrammar: false,
  tutorialId: 'step-merge',
  adapter: {
    handles: [{
      id: 'out',
      type: 'source',
      position: Position.Right,
      style: { top: '50%' },
      isConnectableOverride: (data: any, isConnectable: boolean) =>
        isConnectable && (data.suggestionType == undefined || data.suggestionType === 'none'),
    }],
    editor: null,
    container: { noContent: true, nodeWidth: 100, nodeHeight: 60 + 5 * 50 },
    showTemplateModal: false,
    useLifecycle: useMergeFlowLifecycle,
  },
});

// ── Special nodes ───────────────────────────────────────────────────────

registerNode({
  id: NodeType.COMMENTS,
  category: 'flow',
  label: 'Comments',
  icon: faCopy,
  inputPorts: [],
  outputPorts: [],
  editor: 'none',
  inPalette: false,
  description: 'A free-form comment box for annotations.',
  hasCode: false,
  hasWidgets: false,
  hasGrammar: false,
  adapter: {
    handles: [],
    editor: null,
    container: {},
    showTemplateModal: false,
    useLifecycle: () => ({}),
  },
});
