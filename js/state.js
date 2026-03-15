export const state = {
  nodes: [],       // all draggable nodes
  edges: [],       // all connections
  zoom: 1.0,
  panX: 0, 
  panY: 0,
};

// Application-wide utility states
export const appState = {
  lastImportedFileName: 'projeto_der',
  activeEditNode: null,
  dragMovedForClick: false
};

// ══════════════════════════════════════════════════════════════════
// HISTORY SYSTEM (UNDO / REDO)
// ══════════════════════════════════════════════════════════════════
export const history = {
  past: [],
  future: []
};

function cloneState() {
  return {
    nodes: JSON.parse(JSON.stringify(state.nodes)),
    edges: JSON.parse(JSON.stringify(state.edges))
  };
}

export function pushState() {
  // Save current state to past
  history.past.push(cloneState());
  // Limit history size to 50 to avoid memory bombs
  if (history.past.length > 50) history.past.shift();
  // Clear future actions if we branch off
  history.future = [];
}

export function popState() {
  history.past.pop();
}

export function clearHistory() {
  history.past = [];
  history.future = [];
}

export function undoState() {
  if (history.past.length === 0) return false;
  
  // Save current to future
  history.future.push(cloneState());
  
  // Pop from past and apply
  const prev = history.past.pop();
  state.nodes = prev.nodes;
  state.edges = prev.edges;
  return true;
}

export function redoState() {
  if (history.future.length === 0) return false;
  
  // Save current to past
  history.past.push(cloneState());
  
  // Pop from future and apply
  const next = history.future.pop();
  state.nodes = next.nodes;
  state.edges = next.edges;
  return true;
}
