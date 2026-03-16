import { state, appState, pushState, undoState, redoState, clearHistory } from './state.js';
import { parseScript } from './parser.js';
import { buildState } from './compute.js';
import { render } from './render.js';
import { initViewportEvents, applyTransform, setStatus, getSelectedIds } from './dragger.js';
import { closePanel, applyEdits } from './panel.js';
import { exportSVG, exportPNG, saveProject } from './export.js';

// MAIN ENTRY LOGIC
function init() {
  initViewportEvents();
  setStatus('idl', 'Pronto');
  setupKeyboardShortcuts();

  // RENDER LOOP setup (Performance Layer)
  if (window.RENDER_LOOP) {
    RENDER_LOOP.setRenderCallback(() => render());
    RENDER_LOOP.start();
  }

  // Sincronização periódica de estado para colaboração
  setInterval(() => {
    if (window.COLLAB && COLLAB.isInRoom() && window.SKETCH_DER) {
      COLLAB.emitStateSync(window.SKETCH_DER.getFullState());
    }
  }, 10000);
}

window.addEventListener('load', init);

// ══════════════════════════════════════════════════════════════════
// BIND GLOBALS FOR HTML onclick=""
// ══════════════════════════════════════════════════════════════════
window.generate = function() {
  const t = document.getElementById('inp').value;
  if (!t.trim()) {
    showError('Script vazio.');
    document.getElementById('empty').style.display = 'flex';
    document.getElementById('der-svg').innerHTML = '<defs><pattern id="grid" width="30" height="30" patternUnits="userSpaceOnUse"><path d="M 30 0 L 0 0 0 30" fill="none" stroke="#1e2538" stroke-width="0.5"/></pattern></defs><rect width="4000" height="3000" fill="#f2f2f2"/><g id="layer-grid"><rect width="4000" height="3000" fill="url(#grid)" opacity="0"/></g><g id="layer-lines"></g><g id="layer-attrs"></g><g id="layer-shapes"></g><g id="layer-labels"></g>';
    state.nodes = []; state.edges = [];
    return;
  }
  hideError();
  setStatus('gen', 'Gerando...');
  
  setTimeout(() => {
    try {
      const parsed = parseScript(t);
      if(!parsed.entities.length) throw new Error("Nenhuma entidade encontrada.");
      
      const {nodes, edges} = buildState(parsed);
      
      pushState(); // Salva o estado ANTES de aplicar o novo
      
      state.nodes = nodes;
      state.edges = edges;
      
      // Registrar no Render Loop para animações suaves
      if (window.RENDER_LOOP) {
        RENDER_LOOP.clear();
        state.nodes.forEach(n => RENDER_LOOP.register(n.id, n.cx, n.cy, n));
      }

      render();
      fitView();
      setStatus('ok', 'DER gerado!');

      // Emite novo estado para a sala
      if (window.COLLAB && COLLAB.isInRoom()) {
        COLLAB.emitDerUpdate(window.SKETCH_DER.getFullState());
      }
    } catch(e) {
      showError(e.message);
      setStatus('err', 'Erro de sintaxe');
    }
  }, 50);
};

window.clearAll = function() {
  pushState(); // Salva estado atual antes de limpar (permitindo Undo)
  document.getElementById('inp').value = '';
  window.generate();
};

window.useEx = function(id) {
  document.getElementById('inp').value = document.getElementById('ex-'+id).textContent;
  switchTab('editor', document.querySelector('.tbtn.active'));
  document.querySelector('.tbtn').classList.add('active'); // mock active to 1st
  window.generate();
};

window.switchTab = function(id, btn) {
  document.querySelectorAll('.tc').forEach(el=>el.classList.remove('active'));
  document.querySelectorAll('.tbtn').forEach(el=>el.classList.remove('active'));
  document.getElementById('tab-'+id).classList.add('active');
  if(btn) btn.classList.add('active');
};

function showError(msg) {
  const e = document.getElementById('errbox');
  e.style.display = 'block'; e.textContent = 'Erro: ' + msg;
}
function hideError() {
  document.getElementById('errbox').style.display = 'none';
}

// ══════════════════════════════════════════════════════════════════
// ZOOM & FULLSCREEN
// ══════════════════════════════════════════════════════════════════
window.doZoom = function(d) {
  state.zoom = Math.max(0.1, Math.min(5.0, state.zoom + d));
  document.getElementById('zl').textContent = Math.round(state.zoom*100)+'%';
  applyTransform();
};

window.resetZoom = function() { fitView(); };

function fitView() {
  if(!state.nodes.length) return;
  let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;
  state.nodes.forEach(n => {
    // Entities and Attributes spread outwards, so their width/height must be considered for true boundaries
    const pw = (n.w || 90) / 2;
    const ph = (n.h || 30) / 2;
    minX=Math.min(minX, n.cx - pw); minY=Math.min(minY, n.cy - ph);
    maxX=Math.max(maxX, n.cx + pw); maxY=Math.max(maxY, n.cy + ph);
  });
  
  const vp = document.getElementById('viewport');
  const vw = vp.clientWidth, vh = vp.clientHeight;
  
  // Minimal padding just to avoid elements touching the very pixel edge
  const padding = 60; 
  const dw = maxX - minX + padding, dh = maxY - minY + padding;
  
  // Limita o zoom máximo a 1.5x, suficiente para ler textos e sem sobras
  const z = Math.min(vw/dw, vh/dh, 1.5);
  state.zoom = z;
  document.getElementById('zl').textContent = Math.round(z*100)+'%';
  
  // Center taking actual real coordinate center vs viewport center
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  
  state.panX = vw/2 - cx*z;
  state.panY = vh/2 - cy*z;
  applyTransform();
}

window.toggleFullscreen = function() {
  const el = document.querySelector('.rp');
  const btn = document.getElementById('btn-fullscreen');
  const isFS = document.fullscreenElement || document.webkitFullscreenElement || document.body.classList.contains('fullscreen-mode');

  if (!isFS) {
    document.body.classList.add('fullscreen-mode');
    if (el.requestFullscreen) { el.requestFullscreen().catch(e=>console.log(e)); }
    else if (el.webkitRequestFullscreen) { el.webkitRequestFullscreen(); }
    btn.textContent = '🗗';
    btn.title = 'Restaurar Tela';
  } else {
    document.body.classList.remove('fullscreen-mode');
    if (document.fullscreenElement && document.exitFullscreen) { document.exitFullscreen().catch(e=>console.log(e)); }
    else if (document.webkitFullscreenElement && document.webkitExitFullscreen) { document.webkitExitFullscreen(); }
    btn.textContent = '⛶';
    btn.title = 'Maximizar Tela';
  }
  setTimeout(() => { if (state.nodes.length > 0) fitView(); }, 150);
};

// ══════════════════════════════════════════════════════════════════
// IMPORT SCRIPT / PROJECT LOAD
// ══════════════════════════════════════════════════════════════════
window.triggerImport = function() { document.getElementById('file-input').click(); };

window.importScript = function(e) {
  const file = e.target.files[0];
  if (!file) return;
  appState.lastImportedFileName = file.name.replace(/\.[^/.]+$/, "");
  const reader = new FileReader();
  reader.onload = function(evt) {
    document.getElementById('inp').value = evt.target.result;
    window.generate();
    setStatus('ok', `Script '${file.name}' importado com sucesso!`);
  };
  reader.readAsText(file);
  e.target.value = '';
};

window.triggerProjectImport = function() { document.getElementById('proj-input').click(); };

window.loadProject = function(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (evt) => {
    try {
      const proj = JSON.parse(evt.target.result);
      if (proj.script !== undefined && proj.state) {
        clearHistory(); // Reseta histórico para o novo projeto carregado
        
        // Mute any potential input listeners by updating silently
        const inp = document.getElementById('inp');
        inp.value = proj.script;
        
        // Deep copy state to ensure no references are tied to old garbage collections
        state.nodes = JSON.parse(JSON.stringify(proj.state.nodes));
        state.edges = JSON.parse(JSON.stringify(proj.state.edges));
        state.zoom = proj.state.zoom || 1;
        state.panX = proj.state.panX || 0;
        state.panY = proj.state.panY || 0;
        
        document.getElementById('zl').textContent = Math.round(state.zoom*100)+'%';
        
        // Render explicitly
        render();
        applyTransform();
        setStatus('ok', `Projeto '${file.name}' carregado!`);
      } else {
        throw new Error("Formato do JSON de projeto inválido.");
      }
    } catch (err) {
      alert("Erro ao ler o projeto: " + err.message);
      setStatus('err', 'Erro de leitura do projeto');
    }
  };
  reader.readAsText(file);
  e.target.value = '';
};

// ══════════════════════════════════════════════════════════════════
// SHORTCUTS (O KEY & R KEY) + EXTERNAL ATTACH
// ══════════════════════════════════════════════════════════════════
import { rebuildEntityAttributes } from './compute.js';

function setupKeyboardShortcuts() {
  document.addEventListener('keydown', e => {
    // Gerar script nativo (Ctrl+Enter)
    if ((e.ctrlKey||e.metaKey) && e.key==='Enter') { e.preventDefault(); window.generate(); }
    
    // Undo (Ctrl+Z)
    if ((e.ctrlKey||e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
      if (undoState()) { render(); setStatus('ok', 'Desfeito!'); }
    }
    
    // Redo (Ctrl+Y or Ctrl+Shift+Z)
    if ((e.ctrlKey||e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
      if (redoState()) { render(); setStatus('ok', 'Refeito!'); }
    }
    
    // Auto Arrange (O key)
    if (e.key.toLowerCase() === 'o') {
      const activeEl = document.activeElement;
      if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) return;
      if (!appState.activeEditNode) return;
      
      const nType = appState.activeEditNode.type;
      let targetNode = null;
      if (nType === 'entity') targetNode = appState.activeEditNode;
      else if (nType === 'attribute') targetNode = state.nodes.find(n => n.id === appState.activeEditNode.parentId);
      
      if (targetNode) {
        pushState(); // Salva a foto antes de alinhar
        rebuildEntityAttributes(targetNode);
        render();
        setStatus('ok', `Atributos de '${targetNode.name}' organizados com sucesso!`);
      }
    }

    // Invert Attrs Side (R key)
    if (e.key.toLowerCase() === 'r') {
      const activeEl = document.activeElement;
      if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) return;
      
      const selIds = getSelectedIds();
      let flippedCount = 0;
      
      if (selIds && selIds.size > 0) {
        pushState(); // Salva ANTES de inverter
        state.nodes.forEach(n => {
          if (selIds.has(n.id) && n.type === 'attribute') {
            if (n._angle === undefined) n._angle = 0; // Default angle is zero (right side)
            n._angle = (n._angle + Math.PI) % (2 * Math.PI); // Soma 180 graus no offset trigonométrico do texto alvo
            flippedCount++;
          }
        });
      }
      
      if (flippedCount > 0) {
        render();
        setStatus('ok', `Texto invertido para ${flippedCount} atributo(s) selecionado(s)!`);
        return;
      }
      
      if (!appState.activeEditNode) return;
      
      const nType = appState.activeEditNode.type;
      let targetNode = null;
      if (nType === 'entity') targetNode = appState.activeEditNode;
      else if (nType === 'attribute') targetNode = state.nodes.find(n => n.id === appState.activeEditNode.parentId);
      
      if (targetNode) {
        pushState(); // Salva o estado de inversão em massa
        targetNode.invertAttrs = !targetNode.invertAttrs; // Espelha a flag
        rebuildEntityAttributes(targetNode); // Força recálculo matemático
        render(); // Pinta tela com SVG invertido pra esquerda/direita
        setStatus('ok', `Atributos de '${targetNode.name}' espelhados para o outro lado!`);
      }
    }
  });
}

// ══════════════════════════════════════════════════════════════════
// COLLAB BRIDGE (window.SKETCH_DER)
// ══════════════════════════════════════════════════════════════════
window.SKETCH_DER = {
  getFullState() {
    const nodesData = state.nodes.map(n => {
        const pos = window.RENDER_LOOP ? (RENDER_LOOP.getPosition(n.id) || { x: n.cx, y: n.cy }) : { x: n.cx, y: n.cy };
        return { ...n, cx: pos.x, cy: pos.y };
    });
    return JSON.stringify({
      script: document.getElementById('inp').value,
      nodes: nodesData
    });
  },

  loadFullState(fullState) {
    try {
      const data = JSON.parse(fullState);
      if (data.script !== undefined) {
        document.getElementById('inp').value = data.script;
      }
      if (data.nodes) {
        state.nodes = JSON.parse(JSON.stringify(data.nodes));
        if (window.RENDER_LOOP) {
           RENDER_LOOP.clear();
           state.nodes.forEach(n => RENDER_LOOP.register(n.id, n.cx, n.cy, n));
        }
        render();
      }
    } catch (e) {
      console.error('[Collab] Erro ao carregar estado remoto:', e);
    }
  },

  setElementLock(id, color, name) {
    const node = state.nodes.find(n => n.id === id);
    if (node) {
      node._lockColor = color;
      node._lockUser = name;
      if (window.RENDER_LOOP) RENDER_LOOP.markDirty();
    }
  },

  clearElementLock(id) {
    const node = state.nodes.find(n => n.id === id);
    if (node) {
      delete node._lockColor;
      delete node._lockUser;
      if (window.RENDER_LOOP) RENDER_LOOP.markDirty();
    }
  },

  applyElementMove(elementId, elementType, x, y) {
    // No "Performance Plan", isso é tratado via RENDER_LOOP.moveRemote direto no collab.js
    // Mas mantemos aqui para compatibilidade
    if (window.RENDER_LOOP) {
        RENDER_LOOP.moveRemote(elementId, x, y);
    } else {
        const node = state.nodes.find(n => n.id === elementId);
        if (node) { node.cx = x; node.cy = y; render(); }
    }
  },

  getViewTransform() {
    return {
      panX: state.panX,
      panY: state.panY,
      scale: state.zoom
    };
  }
};

// Ensure external binds for panel + export
window.closePanel = closePanel;
window.applyEdits = applyEdits;
window.saveProject = saveProject;
window.exportSVG = exportSVG;
window.exportPNG = exportPNG;
