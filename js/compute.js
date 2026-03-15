import { CONSTANTS } from './config.js';

// ══════════════════════════════════════════════════════════════════
// BUILD STATE from parsed data
// ══════════════════════════════════════════════════════════════════
export function buildState(data) {
  const { entities, relationships } = data;
  let id = 1;
  const nodes = [];
  const edges = [];
  const entityNodeMap = {}; // name -> nodeId

  // ── PHASE 1: Create nodes loosely in the center ──
  entities.forEach((ent) => {
    // Initial random placement around the center to kickstart physics
    const cx = CONSTANTS.MARGIN * 2 + Math.random() * 400;
    const cy = CONSTANTS.MARGIN * 2 + Math.random() * 400;
    const entId = id++;
    entityNodeMap[ent.name] = entId;

    nodes.push({ id: entId, type: 'entity', name: ent.name, cx, cy, w: CONSTANTS.ENT_W, h: CONSTANTS.ENT_H });

    // Attributes (will be positioned in phase 3, just create them now at (0,0))
    ent.attrs.forEach((attr) => {
      const attrId = id++;
      nodes.push({ id: attrId, type: 'attribute', name: attr.name, typeStr: attr.type, pk: attr.pk, cx: 0, cy: 0, parentId: entId });
      edges.push({ id: id++, type: 'attr-line', from: entId, to: attrId });
    });
  });

  // Create Relationships
  const relCount = {};
  relationships.forEach(rel => {
    const fromId = entityNodeMap[rel.from.entity];
    const toId   = entityNodeMap[rel.to.entity];
    if (!fromId || !toId) return;

    const fn = nodes.find(n => n.id === fromId);
    const tn = nodes.find(n => n.id === toId);
    
    // Multiple relationships between same two entities offset logic
    const key = [fromId, toId].sort().join('|');
    relCount[key] = (relCount[key] || 0) + 1;
    const offset = (relCount[key] - 1) * 85;

    const relId = id++;
    // Midpoint + slight random/offset noise
    const mx = (fn.cx + tn.cx) / 2 + (Math.random()*40 - 20);
    const my = (fn.cy + tn.cy) / 2 + offset;
    nodes.push({ id: relId, type: 'relationship', name: rel.name, cx: mx, cy: my, hw: 65, hh: 28 });

    edges.push({ id: id++, type: 'rel-line', from: fromId, to: relId, card: rel.from.card, cardOffX: 0, cardOffY: 0 });
    edges.push({ id: id++, type: 'rel-line', from: relId,  to: toId,  card: rel.to.card, cardOffX: 0, cardOffY: 0 });
  });

  // ── PHASE 2: Force-Directed Layout (Physics Simulation) ──
  const layoutNodes = nodes.filter(n => n.type === 'entity' || n.type === 'relationship');
  const layoutEdges = edges.filter(e => e.type === 'rel-line');
  
  const REPULSION = 40000;   // How strongly boxes push each other away
  const ATTRACTION = 0.04;   // How strongly links pull them together
  const IDEAL_LEN = 160;     // Ideal length of a relationship line
  const DAMPING = 0.85;
  const ITERATIONS = 150;

  // Initialize velocities
  layoutNodes.forEach(n => { n.vx = 0; n.vy = 0; });

  for (let iter = 0; iter < ITERATIONS; iter++) {
    // 1. Repulsion (Coulomb) - Every node repels every other node
    for (let i = 0; i < layoutNodes.length; i++) {
      for (let j = i + 1; j < layoutNodes.length; j++) {
        const n1 = layoutNodes[i];
        const n2 = layoutNodes[j];
        const dx = n1.cx - n2.cx;
        const dy = n1.cy - n2.cy;
        let distSq = dx*dx + dy*dy;
        if (distSq === 0) distSq = 1; // Prevent division by zero
        
        // Extra repulsion if they are vertically aligned to force them sideways (easier to read DER)
        const vWeight = Math.abs(dy) < 50 ? 1.5 : 1; 
        
        const force = (REPULSION * vWeight) / distSq;
        const dist = Math.sqrt(distSq);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;

        n1.vx += fx; n1.vy += fy;
        n2.vx -= fx; n2.vy -= fy;
      }
    }

    // 2. Attraction (Hooke's Spring) - Only connected nodes
    layoutEdges.forEach(edge => {
      const n1 = layoutNodes.find(n => n.id === edge.from);
      const n2 = layoutNodes.find(n => n.id === edge.to);
      if(!n1 || !n2) return;
      
      const dx = n2.cx - n1.cx;
      const dy = n2.cy - n1.cy;
      const dist = Math.sqrt(dx*dx + dy*dy) || 1;
      
      // The force pulls them together if dist > IDEAL_LEN, or pushes them lightly if very close
      const force = (dist - IDEAL_LEN) * ATTRACTION;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;

      n1.vx += fx; n1.vy += fy;
      n2.vx -= fx; n2.vy -= fy;
    });

    // 3. Apply Velocities with Damping
    layoutNodes.forEach(n => {
      n.vx *= DAMPING;
      n.vy *= DAMPING;
      
      // Hard cap speed per frame to prevent explosions
      const speed = Math.sqrt(n.vx*n.vx + n.vy*n.vy);
      if (speed > 50) {
        n.vx = (n.vx/speed) * 50;
        n.vy = (n.vy/speed) * 50;
      }
      
      n.cx += n.vx;
      n.cy += n.vy;
    });
  }

  // Shift entire graph back to positive coordinates nicely aligned
  let minX = Infinity, minY = Infinity;
  layoutNodes.forEach(n => { minX = Math.min(minX, n.cx); minY = Math.min(minY, n.cy); });
  layoutNodes.forEach(n => { 
    n.cx = n.cx - minX + CONSTANTS.MARGIN * 2; 
    n.cy = n.cy - minY + CONSTANTS.MARGIN * 2; 
  });


  // ── PHASE 3: Automatic Radial Distribution of Attributes ──
  const entitiesToOrganize = nodes.filter(n => n.type === 'entity');
  
  entitiesToOrganize.forEach(entNode => {
    rebuildEntityAttributes(entNode);
  });

  return { nodes, edges };
}

// ══════════════════════════════════════════════════════════════════
// RADIAL ATTRIBUTE REBUILD (O / R KEYS)
// ══════════════════════════════════════════════════════════════════
export function rebuildEntityAttributes(entNode) {
  const attrs = state.nodes.filter(n => n.type === 'attribute' && n.parentId === entNode.id);
  if (!attrs.length) return;
  
  const relEdgesObj = state.edges.filter(e => e.type === 'rel-line' && (e.from === entNode.id || e.to === entNode.id));
  let blockedAngles = [];
  
  relEdgesObj.forEach(e => {
    const otherId = e.from === entNode.id ? e.to : e.from;
    const otherNode = state.nodes.find(n => n.id === otherId);
    if (otherNode) {
      let angle = Math.atan2(otherNode.cy - entNode.cy, otherNode.cx - entNode.cx);
      if (angle < 0) angle += 2 * Math.PI;
      blockedAngles.push(angle);
    }
  });

  blockedAngles.sort((a,b) => a-b);
  let bestStart = 0; let bestSpan = 2 * Math.PI;

  if (blockedAngles.length === 1) {
    bestStart = blockedAngles[0] + Math.PI/4;
    bestSpan = 2 * Math.PI - Math.PI/2;
  } else if (blockedAngles.length > 1) {
    let maxGap = -1;
    for (let i = 0; i < blockedAngles.length; i++) {
      const nextAngle = blockedAngles[(i + 1) % blockedAngles.length];
      let gap = nextAngle - blockedAngles[i];
      if (gap <= 0) gap += 2 * Math.PI;
      if (gap > maxGap) {
        maxGap = gap;
        const padding = Math.PI / 12; 
        bestStart = blockedAngles[i] + padding;
        bestSpan = gap - (padding * 2);
      }
    }
  }

  if (bestSpan <= 0) { bestStart = 0; bestSpan = 2 * Math.PI; }

  const nA = attrs.length;
  const midAngle = bestStart + bestSpan / 2;
  let dx = Math.cos(midAngle);
  let dy = Math.sin(midAngle);
  
  // Obey the manual inversion flag from user panel
  if (entNode.invertAttrs) {
    dx = -dx;
  }
  
  const pad = 35; // Espaço em branco estreito antes de começar a lista
  const hw = (entNode.w || 180) / 2 + pad;
  const hh = (entNode.h || 44) / 2 + pad;
  
  // Projeta o centro da "Lista" cruzando o raio no perímetro estendido do retângulo
  const tX = Math.abs(dx) > 0.001 ? hw / Math.abs(dx) : Infinity;
  const tY = Math.abs(dy) > 0.001 ? hh / Math.abs(dy) : Infinity;
  const t = Math.min(tX, tY);
  
  const gx = entNode.cx + dx * t;
  const gy = entNode.cy + dy * t;
  
  const maxPerCol = 8;
  const colSpacing = 110;
  const rowSpacing = 21;

  attrs.forEach((attr, ai) => {
    const col = Math.floor(ai / maxPerCol);
    const row = ai % maxPerCol;
    const rowsInThisCol = Math.min(maxPerCol, nA - col * maxPerCol);
    
    let cx = gx;
    if (dx >= 0) cx += col * colSpacing;
    else cx -= col * colSpacing;
    
    let cy = gy;
    if (Math.abs(dy) < 0.35) {
      cy += (row - (rowsInThisCol - 1) / 2) * rowSpacing;
    } else if (dy >= 0) {
      cy += row * rowSpacing;
    } else {
      cy -= (rowsInThisCol - 1 - row) * rowSpacing;
    }
    
    attr.cx = cx;
    attr.cy = cy;
    attr._angle = dx >= 0 ? 0 : Math.PI;
  });
}
// ══════════════════════════════════════════════════════════════════
// GEOMETRY HELPERS
// ══════════════════════════════════════════════════════════════════
export function edgeRect(cx, cy, w, h, tx, ty) {
  const dx = tx - cx, dy = ty - cy;
  if (!dx && !dy) return { x: cx, y: cy };
  const s = Math.min(w / 2 / (Math.abs(dx) || 1e-9), h / 2 / (Math.abs(dy) || 1e-9));
  const clamp = Math.min(s, Math.min(w/2/(Math.abs(dx)||1e-9), h/2/(Math.abs(dy)||1e-9)));
  const sx = (w/2) / (Math.abs(dx)||1e-9), sy = (h/2) / (Math.abs(dy)||1e-9);
  const sc = Math.min(sx, sy);
  return { x: cx + dx * sc, y: cy + dy * sc };
}

export function edgeDiamond(cx, cy, hw, hh, tx, ty) {
  const dx = tx - cx, dy = ty - cy;
  if (!dx && !dy) return { x: cx, y: cy };
  const t = 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh);
  return { x: cx + dx * t, y: cy + dy * t };
}
