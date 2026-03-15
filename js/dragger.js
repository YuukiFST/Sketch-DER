import { state, appState, pushState, popState } from './state.js';
import { render } from './render.js';
import { openPanel } from './panel.js';

// ══════════════════════════════════════════════════════════════════
// ESTADO: nós selecionados pelo lasso
// ══════════════════════════════════════════════════════════════════
let selectedIds = new Set();
export function getSelectedIds() { return selectedIds; }

// ══════════════════════════════════════════════════════════════════
// DRAG — entities, relationships, attributes, cardinalities
// ══════════════════════════════════════════════════════════════════
let drag = null;

export function bindDrag() {
  const svg = document.getElementById('der-svg');
  if(!svg) return;

  svg.querySelectorAll('.ent-group, .rel-group, .attr-group, .card-label').forEach(g => {
    g.addEventListener('mousedown', onNodeMouseDown);
    g.addEventListener('touchstart', onNodeTouchStart, { passive: false });
    if (!g.classList.contains('card-label')) {
      g.addEventListener('click', onNodeClick);
    }
  });

  // Atualiza visual de seleção
  updateSelectionVisual();
}

function updateSelectionVisual() {
  const svg = document.getElementById('der-svg');
  if (!svg) return;
  svg.querySelectorAll('.ent-group, .rel-group, .attr-group').forEach(g => {
    const id = +g.dataset.id;
    if (selectedIds.has(id)) {
      g.classList.add('selected');
    } else {
      g.classList.remove('selected');
    }
  });
}

function onNodeClick(e) {
  if (appState.dragMovedForClick) {
    appState.dragMovedForClick = false;
    return;
  }
  e.stopPropagation();
  const nodeId = +e.currentTarget.dataset.id;
  openPanel(nodeId);
}

function onNodeMouseDown(e) {
  if (e.button !== 0) return;
  e.stopPropagation();
  startDrag(e.currentTarget, e.clientX, e.clientY);
  window.addEventListener('mousemove', onDragMove);
  window.addEventListener('mouseup', onDragEnd);
}

function onNodeTouchStart(e) {
  e.preventDefault();
  const t = e.touches[0];
  startDrag(e.currentTarget, t.clientX, t.clientY);
  window.addEventListener('touchmove', onTouchMove, { passive: false });
  window.addEventListener('touchend', onDragEnd);
}

function startDrag(el, clientX, clientY) {
  // Drag de cardinalidade
  if (el.classList.contains('card-label')) {
    const edgeId = +el.dataset.edgeId;
    const edge = state.edges.find(e => e.id === edgeId);
    if (!edge) return;
    pushState(); // Snapshot ANTES de mover a cardinalidade
    el.classList.add('dragging');
    drag = { isCard: true, edgeId, el, clientX, clientY, origX: edge.cardOffX || 0, origY: edge.cardOffY || 0 };
    return;
  }

  const nodeId = +el.dataset.id;
  const node = state.nodes.find(n => n.id === nodeId);
  if (!node) return;

  pushState(); // Snapshot ANTES de arrastar o nó
  el.classList.add('dragging');

  // Se o nó clicado for parte da seleção múltipla, arrasta todos juntos
  if (selectedIds.size > 1 && selectedIds.has(nodeId)) {
    const selected = state.nodes.filter(n => selectedIds.has(n.id));
    const origins = selected.map(n => ({ nodeId: n.id, origCx: n.cx, origCy: n.cy }));
    // Atributos filhos dos nós selecionados também se movem
    const attrOrigins = [];
    selected.forEach(n => {
      if (n.type === 'entity') {
        state.nodes.filter(a => a.type === 'attribute' && a.parentId === n.id && !selectedIds.has(a.id))
          .forEach(a => attrOrigins.push({ nodeId: a.id, parentId: n.id, origCx: a.cx, origCy: a.cy, offX: a.cx - n.cx, offY: a.cy - n.cy }));
      }
    });
    drag = { isMulti: true, el, clientX, clientY, origins, attrOrigins };
    return;
  }

  // Clique simples num nó: limpa seleção e arrasta só ele
  selectedIds.clear();

  // Se arrastar entidade, os atributos filhos acompanham
  let children = [];
  if (node.type === 'entity') {
    children = state.nodes
      .filter(n => n.type === 'attribute' && n.parentId === nodeId)
      .map(n => ({ nodeId: n.id, offX: n.cx - node.cx, offY: n.cy - node.cy }));
  }

  drag = { nodeId, el, clientX, clientY, origCx: node.cx, origCy: node.cy, children };
}

function onDragMove(e) { applyDrag(e.clientX, e.clientY); }
function onTouchMove(e) { e.preventDefault(); applyDrag(e.touches[0].clientX, e.touches[0].clientY); }

function applyDrag(clientX, clientY) {
  if (!drag) return;
  const dx = (clientX - drag.clientX) / state.zoom;
  const dy = (clientY - drag.clientY) / state.zoom;
  if (Math.abs(dx) > 2 || Math.abs(dy) > 2) appState.dragMovedForClick = true;

  // Drag de cardinalidade
  if (drag.isCard) {
    const edge = state.edges.find(e => e.id === drag.edgeId);
    if (!edge) return;
    edge.cardOffX = drag.origX + dx;
    edge.cardOffY = drag.origY + dy;
    render();
    return;
  }

  // Drag de seleção múltipla
  if (drag.isMulti) {
    drag.origins.forEach(o => {
      const n = state.nodes.find(n => n.id === o.nodeId);
      if (n) { n.cx = o.origCx + dx; n.cy = o.origCy + dy; }
    });
    // Atributos filhos também se movem junto com suas entidades pai
    drag.attrOrigins.forEach(a => {
      const parent = state.nodes.find(n => n.id === a.parentId);
      const attr = state.nodes.find(n => n.id === a.nodeId);
      if (parent && attr) { attr.cx = parent.cx + a.offX; attr.cy = parent.cy + a.offY; }
    });
    render();
    updateSelectionVisual();
    return;
  }

  // Drag de nó único
  const node = state.nodes.find(n => n.id === drag.nodeId);
  if (!node) return;
  node.cx = drag.origCx + dx;
  node.cy = drag.origCy + dy;

  drag.children.forEach(c => {
    const child = state.nodes.find(n => n.id === c.nodeId);
    if (child) { child.cx = node.cx + c.offX; child.cy = node.cy + c.offY; }
  });

  render();
}

function onDragEnd() {
  if (drag) {
    if (drag.el) drag.el.classList.remove('dragging');
    // Se houve mousedown mas não houve movimento real (click simples),
    // removemos o snapshot que o startDrag criou preventivamente.
    if (!appState.dragMovedForClick) {
      popState();
    }
    drag = null;
  }
  setTimeout(() => appState.dragMovedForClick = false, 50);
  window.removeEventListener('mousemove', onDragMove);
  window.removeEventListener('mouseup', onDragEnd);
  window.removeEventListener('touchmove', onTouchMove);
  window.removeEventListener('touchend', onDragEnd);
}

// ══════════════════════════════════════════════════════════════════
// LASSO — seleção em área com botão esquerdo no canvas vazio
// ══════════════════════════════════════════════════════════════════
let lasso = null;
let lassoRect = null;

function startLasso(clientX, clientY) {
  // Converte coordenadas de tela para coordenadas do SVG
  const svgPt = screenToSVG(clientX, clientY);
  lasso = { startSvgX: svgPt.x, startSvgY: svgPt.y, currentX: svgPt.x, currentY: svgPt.y };

  // Cria o retângulo visual de seleção
  const svg = document.getElementById('der-svg');
  lassoRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  lassoRect.setAttribute('class', 'lasso-rect');
  lassoRect.setAttribute('x', svgPt.x);
  lassoRect.setAttribute('y', svgPt.y);
  lassoRect.setAttribute('width', 0);
  lassoRect.setAttribute('height', 0);
  svg.appendChild(lassoRect);
}

function updateLasso(clientX, clientY) {
  if (!lasso || !lassoRect) return;
  const svgPt = screenToSVG(clientX, clientY);
  lasso.currentX = svgPt.x;
  lasso.currentY = svgPt.y;

  const x = Math.min(lasso.startSvgX, svgPt.x);
  const y = Math.min(lasso.startSvgY, svgPt.y);
  const w = Math.abs(svgPt.x - lasso.startSvgX);
  const h = Math.abs(svgPt.y - lasso.startSvgY);

  lassoRect.setAttribute('x', x);
  lassoRect.setAttribute('y', y);
  lassoRect.setAttribute('width', w);
  lassoRect.setAttribute('height', h);
}

function endLasso() {
  if (!lasso) return;

  const x1 = Math.min(lasso.startSvgX, lasso.currentX);
  const y1 = Math.min(lasso.startSvgY, lasso.currentY);
  const x2 = Math.max(lasso.startSvgX, lasso.currentX);
  const y2 = Math.max(lasso.startSvgY, lasso.currentY);

  // Só seleciona se o lasso tiver tamanho mínimo (não foi apenas um clique)
  if (x2 - x1 > 5 || y2 - y1 > 5) {
    selectedIds.clear();
    state.nodes.forEach(n => {
      if (n.cx >= x1 && n.cx <= x2 && n.cy >= y1 && n.cy <= y2) {
        selectedIds.add(n.id);
      }
    });
    render();
    updateSelectionVisual();
  } else {
    // Clique simples no fundo: limpa seleção
    selectedIds.clear();
    render();
    updateSelectionVisual();
  }

  // Remove o retângulo de seleção
  if (lassoRect && lassoRect.parentNode) lassoRect.parentNode.removeChild(lassoRect);
  lassoRect = null;
  lasso = null;
}

// Converte coordenadas de tela (px) para coordenadas internas do SVG (considerando pan/zoom)
function screenToSVG(clientX, clientY) {
  const vp = document.getElementById('viewport');
  const rect = vp.getBoundingClientRect();
  const screenX = clientX - rect.left;
  const screenY = clientY - rect.top;
  return {
    x: (screenX - state.panX) / state.zoom,
    y: (screenY - state.panY) / state.zoom
  };
}

// ══════════════════════════════════════════════════════════════════
// PAN — botão direito do mouse arrasta a tela
// ══════════════════════════════════════════════════════════════════
let pan = null;

export function initViewportEvents() {
  const vp = document.getElementById('viewport');
  const svgEl2 = document.getElementById('der-svg');
  if(!vp || !svgEl2) return;

  // Desabilita menu de contexto dentro do canvas (clique direito não abre menu)
  vp.addEventListener('contextmenu', e => e.preventDefault());

  vp.addEventListener('mousedown', e => {
    if (!svgEl2.contains(e.target) && e.target !== svgEl2) return;

    const tagName = e.target.tagName.toLowerCase();
    const isBackground = (tagName === 'rect' && !e.target.closest('.ent-group,.rel-group,.attr-group'))
                      || tagName === 'svg'
                      || tagName === 'line'
                      || tagName === 'path';

    // Botão DIREITO → Pan (arrastar a tela)
    if (e.button === 2) {
      e.preventDefault();
      pan = { startX: e.clientX, startY: e.clientY, origX: state.panX, origY: state.panY };
      vp.style.cursor = 'grabbing';
      window.addEventListener('mousemove', onPanMove);
      window.addEventListener('mouseup', onPanEnd);
      return;
    }

    // Botão ESQUERDO no fundo → Lasso de seleção
    if (e.button === 0 && isBackground) {
      startLasso(e.clientX, e.clientY);
      window.addEventListener('mousemove', onLassoMove);
      window.addEventListener('mouseup', onLassoEnd);
    }
  });

  vp.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    const tagName = t.target.tagName.toLowerCase();
    const isBackground = tagName === 'rect' || tagName === 'svg';
    if (!isBackground) return;
    pan = { startX: t.clientX, startY: t.clientY, origX: state.panX, origY: state.panY };
    window.addEventListener('touchmove', onPanTouchMove, { passive: false });
    window.addEventListener('touchend', onPanEnd);
  }, { passive: true });

  // ── Scroll zoom ──
  vp.addEventListener('wheel', e => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    state.zoom = Math.max(0.1, Math.min(5.0, state.zoom + delta));
    const zl = document.getElementById('zl');
    if(zl) zl.textContent = Math.round(state.zoom * 100) + '%';
    applyTransform();
  }, { passive: false });
}

function onPanMove(e) { applyPan(e.clientX, e.clientY); }
function onPanTouchMove(e) { e.preventDefault(); applyPan(e.touches[0].clientX, e.touches[0].clientY); }

function applyPan(cx, cy) {
  if (!pan) return;
  state.panX = pan.origX + cx - pan.startX;
  state.panY = pan.origY + cy - pan.startY;
  applyTransform();
}

function onPanEnd() {
  pan = null;
  const vp = document.getElementById('viewport');
  if(vp) vp.style.cursor = 'default';
  window.removeEventListener('mousemove', onPanMove);
  window.removeEventListener('mouseup', onPanEnd);
  window.removeEventListener('touchmove', onPanTouchMove);
  window.removeEventListener('touchend', onPanEnd);
}

function onLassoMove(e) { updateLasso(e.clientX, e.clientY); }
function onLassoEnd() {
  endLasso();
  window.removeEventListener('mousemove', onLassoMove);
  window.removeEventListener('mouseup', onLassoEnd);
}

export function applyTransform() {
  const svgEl2 = document.getElementById('der-svg');
  if(svgEl2) {
    svgEl2.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.zoom})`;
    svgEl2.style.transformOrigin = '0 0';
  }
}

export function setStatus(s, msg) {
  const d = document.getElementById('sd'), t = document.getElementById('st');
  if(d) d.className = 'sd' + (s==='err'?' err':s==='idl'?' idl':'');
  if(t) t.textContent = msg || (s==='gen'?'Gerando...':'Pronto');
}
