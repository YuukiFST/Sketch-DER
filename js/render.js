import { state, appState } from './state.js';
import { CONSTANTS } from './config.js';
import { edgeRect, edgeDiamond } from './compute.js';
import { bindDrag } from './dragger.js';
import { openPanel } from './panel.js';

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k,v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

// ══════════════════════════════════════════════════════════════════
// RENDER — rebuild SVG from state.nodes + state.edges
// ══════════════════════════════════════════════════════════════════
export function render() {
  const svg = document.getElementById('der-svg');
  if(!svg) return;
  const ll = document.getElementById('layer-lines');
  const la = document.getElementById('layer-attrs');
  const ls = document.getElementById('layer-shapes');
  const lb = document.getElementById('layer-labels');
  ll.innerHTML = ''; la.innerHTML = ''; ls.innerHTML = ''; lb.innerHTML = '';

  const nodes = state.nodes;
  const edges = state.edges;

  // ── ATTR LINES ──
  edges.filter(e => e.type === 'attr-line').forEach(e => {
    const from = nodes.find(n => n.id === e.from);
    const to   = nodes.find(n => n.id === e.to);
    if (!from || !to) return;

    const fp = window.RENDER_LOOP ? (RENDER_LOOP.getPosition(from.id) || { x: from.cx, y: from.cy }) : { x: from.cx, y: from.cy };
    const tp = window.RENDER_LOOP ? (RENDER_LOOP.getPosition(to.id) || { x: to.cx, y: to.cy }) : { x: to.cx, y: to.cy };

    const ep = (() => {
      const dx = fp.x - tp.x, dy = fp.y - tp.y;
      const d = Math.sqrt(dx*dx+dy*dy)||1;
      return { x: tp.x + (dx/d)*6, y: tp.y + (dy/d)*6 };
    })();
    const line = svgEl('line', { x1: fp.x, y1: fp.y, x2: ep.x, y2: ep.y, stroke:'#707888', 'stroke-width':'0.9', opacity:'0.6' });
    ll.appendChild(line);
  });

  // ── REL LINES + CARDINALITIES ──
  edges.filter(e => e.type === 'rel-line').forEach(e => {
    const from = nodes.find(n => n.id === e.from);
    const to   = nodes.find(n => n.id === e.to);
    if (!from || !to) return;

    const fp = window.RENDER_LOOP ? (RENDER_LOOP.getPosition(from.id) || { x: from.cx, y: from.cy }) : { x: from.cx, y: from.cy };
    const tp = window.RENDER_LOOP ? (RENDER_LOOP.getPosition(to.id) || { x: to.cx, y: to.cy }) : { x: to.cx, y: to.cy };

    // Compute edge points
    let p1, p2;
    if (from.type === 'entity') {
      p1 = edgeRect(fp.x, fp.y, from.w+2, from.h+2, tp.x, tp.y);
    } else if (from.type === 'relationship') {
      p1 = edgeDiamond(fp.x, fp.y, from.hw, from.hh, tp.x, tp.y);
    } else {
      p1 = { x: fp.x, y: fp.y };
    }
    if (to.type === 'entity') {
      p2 = edgeRect(tp.x, tp.y, to.w+2, to.h+2, fp.x, fp.y);
    } else if (to.type === 'relationship') {
      p2 = edgeDiamond(tp.x, tp.y, to.hw, to.hh, fp.x, fp.y);
    } else {
      p2 = { x: tp.x, y: tp.y };
    }

    const line = svgEl('line', { x1: p1.x.toFixed(1), y1: p1.y.toFixed(1), x2: p2.x.toFixed(1), y2: p2.y.toFixed(1), stroke:'#111827', 'stroke-width':'1.1', opacity:'0.75' });
    ll.appendChild(line);

    // Cardinality label — 22% along line from "from" entity/diamond side
    if (e.card) {
      const tx = p1.x + (p2.x - p1.x) * 0.22;
      const ty = p1.y + (p2.y - p1.y) * 0.22;
      const dx = p2.x - p1.x, dy = p2.y - p1.y;
      const len = Math.sqrt(dx*dx+dy*dy)||1;
      const offX = (-dy/len)*14 + (e.cardOffX || 0);
      const offY = (dx/len)*14 + (e.cardOffY || 0);
      const ct = svgEl('text', {
        class: 'card-label',
        'data-edge-id': e.id,
        x: (tx+offX).toFixed(1), y: (ty+offY).toFixed(1),
        'font-family': CONSTANTS.FONT, 'font-size':'11',
        fill:'#111827', 'text-anchor':'middle', 'dominant-baseline':'middle',
        style:'user-select:none; cursor: pointer;'
      });
      ct.textContent = `(${e.card})`;
      lb.appendChild(ct);
    }
  });

  // ── ATTRIBUTE DOTS + LABELS ──
  nodes.filter(n => n.type === 'attribute').forEach(n => {
    const pos = window.RENDER_LOOP ? (RENDER_LOOP.getPosition(n.id) || { x: n.cx, y: n.cy }) : { x: n.cx, y: n.cy };
    const g = svgEl('g', { class:'attr-group', 'data-id': n.id });

    // Hit area (transparent, wider)
    g.appendChild(svgEl('circle', { cx: pos.x.toFixed(1), cy: pos.y.toFixed(1), r:'12', fill:'transparent' }));

    // Dot
    const dotR = n.pk ? 6 : 5;
    const dotFill = n.pk ? '#1a3fa8' : '#ffffff';
    const dot = svgEl('circle', {
      class:'dot',
      cx: pos.x.toFixed(1), cy: pos.y.toFixed(1), r: dotR,
      fill: dotFill, stroke:'#111827', 'stroke-width':'1.2'
    });
    g.appendChild(dot);

    // Label
    let lx = (pos.x + dotR + 5).toFixed(1);
    let anchor = 'start';
    
    // Se o atributo foi organizado pela Fase 3 (radiais), orienta inteligentemente o texto base na órbita.
    // Lado esquerdo do relógio (radianos PI/2 até 3PI/2) espelha a âncora para a direita crescer pra trás
    if (n._angle !== undefined) {
      const PI = Math.PI;
      let a = n._angle % (2 * PI);
      if (a < 0) a += 2 * PI;
      if (a > PI/2 + 0.1 && a < 3*PI/2 - 0.1) {
        anchor = 'end';
        lx = (pos.x - dotR - 5).toFixed(1);
      }
    }

    const labelStyle = n.pk ? 'user-select:none;font-weight:bold;text-decoration:underline' : 'user-select:none';
    const txt = svgEl('text', {
      x: lx, y: pos.y.toFixed(1),
      'font-family': CONSTANTS.FONT, 'font-size':'11.5',
      fill:'#111827', 'dominant-baseline':'middle', 'text-anchor': anchor,
      style: labelStyle
    });
    txt.textContent = n.name;
    g.appendChild(txt);

    // Tooltip events
    g.addEventListener('mouseenter', showTip);
    g.addEventListener('mousemove',  moveTip);
    g.addEventListener('mouseleave', hideTip);

    la.appendChild(g);
  });

  // ── ENTITY RECTS ──
  nodes.filter(n => n.type === 'entity').forEach(n => {
    const pos = window.RENDER_LOOP ? (RENDER_LOOP.getPosition(n.id) || { x: n.cx, y: n.cy }) : { x: n.cx, y: n.cy };
    const g = svgEl('g', { class:'ent-group', 'data-id': n.id });

    // Lock Indicator
    if (n._lockColor) {
      g.appendChild(svgEl('rect', {
        x: (pos.x - n.w/2 - 4).toFixed(1), y: (pos.y - n.h/2 - 4).toFixed(1),
        width: n.w + 8, height: n.h + 8,
        fill:'none', stroke: n._lockColor, 'stroke-width':'2', 'stroke-dasharray':'4,3',
        rx: '4'
      }));
      const l = svgEl('text', {
        x: (pos.x - n.w/2).toFixed(1), y: (pos.y - n.h/2 - 8).toFixed(1),
        'font-family': CONSTANTS.FONT, 'font-size':'10', fill: n._lockColor, 'font-weight':'bold'
      });
      l.textContent = n._lockUser || '';
      g.appendChild(l);
    }

    g.appendChild(svgEl('rect', {
      x: (pos.x - n.w/2).toFixed(1), y: (pos.y - n.h/2).toFixed(1),
      width: n.w, height: n.h,
      fill:'#ffffff', stroke:'#111827', 'stroke-width':'1.5'
    }));
    const t = svgEl('text', {
      x: pos.x.toFixed(1), y: pos.y.toFixed(1),
      'font-family': CONSTANTS.FONT, 'font-size':'13', 'font-weight':'bold',
      fill:'#111827', 'text-anchor':'middle', 'dominant-baseline':'middle',
      style:'user-select:none; pointer-events:none'
    });
    t.textContent = n.name;
    g.appendChild(t);
    ls.appendChild(g);
  });

  // ── RELATIONSHIP DIAMONDS ──
  nodes.filter(n => n.type === 'relationship').forEach(n => {
    const pos = window.RENDER_LOOP ? (RENDER_LOOP.getPosition(n.id) || { x: n.cx, y: n.cy }) : { x: n.cx, y: n.cy };
    const g = svgEl('g', { class:'rel-group', 'data-id': n.id });

    // Lock Indicator
    if (n._lockColor) {
      const ptsL = `${pos.x},${(pos.y-n.hh-5).toFixed(1)} ${(pos.x+n.hw+6).toFixed(1)},${pos.y} ${pos.x},${(pos.y+n.hh+5).toFixed(1)} ${(pos.x-n.hw-6).toFixed(1)},${pos.y}`;
      g.appendChild(svgEl('polygon', { points:ptsL, fill:'none', stroke: n._lockColor, 'stroke-width':'2', 'stroke-dasharray':'4,3' }));
      const l = svgEl('text', {
        x: (pos.x - n.hw).toFixed(1), y: (pos.y - n.hh - 8).toFixed(1),
        'font-family': CONSTANTS.FONT, 'font-size':'10', fill: n._lockColor, 'font-weight':'bold'
      });
      l.textContent = n._lockUser || '';
      g.appendChild(l);
    }

    const pts = `${pos.x},${(pos.y-n.hh).toFixed(1)} ${(pos.x+n.hw).toFixed(1)},${pos.y} ${pos.x},${(pos.y+n.hh).toFixed(1)} ${(pos.x-n.hw).toFixed(1)},${pos.y}`;
    g.appendChild(svgEl('polygon', { points:pts, fill:'#ffffff', stroke:'#111827', 'stroke-width':'1.5' }));
    const t = svgEl('text', {
      x: pos.x.toFixed(1), y: pos.y.toFixed(1),
      'font-family': CONSTANTS.FONT, 'font-size':'12', 'font-style':'italic',
      fill:'#111827', 'text-anchor':'middle', 'dominant-baseline':'middle',
      style:'user-select:none; pointer-events:none'
    });
    t.textContent = n.name;
    g.appendChild(t);
    ls.appendChild(g);
  });

  // Bind drag & drop interactivity globally to these new SVGs
  bindDrag();

  const emptyEl = document.getElementById('empty');
  if(emptyEl) emptyEl.style.display = 'none';

  updateInfo();
}

// ══════════════════════════════════════════════════════════════════
// TOOLTIP (Internal)
// ══════════════════════════════════════════════════════════════════
function showTip(e) {
  const nodeId = +e.currentTarget.dataset.id;
  const n = state.nodes.find(x => x.id === nodeId);
  if (!n) return;
  document.getElementById('tn').textContent = n.name;
  document.getElementById('tt').textContent = n.typeStr || '';
  document.getElementById('tp').textContent = n.pk ? '🔑 Chave Primária (PK)' : '';
  const tip = document.getElementById('tip');
  tip.classList.add('on');
  posTip(e);
}
function moveTip(e) { posTip(e); }
function hideTip() { document.getElementById('tip').classList.remove('on'); }
function posTip(e) {
  const tip = document.getElementById('tip');
  let x = e.clientX + 14, y = e.clientY - 10;
  if (x + 220 > window.innerWidth) x = e.clientX - 200;
  if (y + 80 > window.innerHeight) y = e.clientY - 70;
  tip.style.left = x + 'px'; tip.style.top = y + 'px';
}

function updateInfo() {
  const nE = state.nodes.filter(n => n.type === 'entity').length;
  const nR = state.nodes.filter(n => n.type === 'relationship').length;
  const nA = state.nodes.filter(n => n.type === 'attribute').length;
  const ci = document.getElementById('ci');
  if(ci) ci.textContent = `${nE} entidades · ${nR} relacionamentos · ${nA} atributos`;
  const sc = document.getElementById('sc');
  if(sc) sc.textContent = '';
}
