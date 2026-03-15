import { state, appState } from './state.js';
import { setStatus } from './dragger.js';

// ══════════════════════════════════════════════════════════════════
// EXPORT SVG / PNG
// ══════════════════════════════════════════════════════════════════
export function getExportSVG() {
  if (!state.nodes.length) return null;
  // Compute bounding box of all nodes
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  state.nodes.forEach(n => {
    const pad = n.type === 'entity' ? n.w/2 + 10 : n.type === 'relationship' ? n.hw + 10 : 60;
    minX = Math.min(minX, n.cx - pad); minY = Math.min(minY, n.cy - pad);
    maxX = Math.max(maxX, n.cx + pad); maxY = Math.max(maxY, n.cy + pad);
  });
  const PAD = 60, W = maxX - minX + PAD*2, H = maxY - minY + PAD*2;
  const ox = -minX + PAD, oy = -minY + PAD;

  // Temporarily offset all nodes for export
  state.nodes.forEach(n => { n._ex = n.cx; n._ey = n.cy; n.cx += ox; n.cy += oy; });

  // Build export SVG string
  const svgSrc = document.getElementById('der-svg');
  // Re-render to a temporary off-screen svg
  const tmp = document.createElementNS('http://www.w3.org/2000/svg','svg');
  tmp.setAttribute('xmlns','http://www.w3.org/2000/svg');
  tmp.setAttribute('width', W); tmp.setAttribute('height', H);
  tmp.setAttribute('viewBox', `0 0 ${W} ${H}`);

  // bg
  const bg = document.createElementNS('http://www.w3.org/2000/svg','rect');
  bg.setAttribute('width',W); bg.setAttribute('height',H); bg.setAttribute('fill','#f2f2f2');
  tmp.appendChild(bg);

  // Restore positions
  state.nodes.forEach(n => { n.cx = n._ex; n.cy = n._ey; });

  // Use the live SVG inner content but with offset transform
  const g = document.createElementNS('http://www.w3.org/2000/svg','g');
  g.setAttribute('transform', `translate(${ox},${oy})`);
  ['layer-lines','layer-attrs','layer-shapes','layer-labels'].forEach(id => {
    const l = document.getElementById(id);
    if (l) g.appendChild(l.cloneNode(true));
  });
  tmp.appendChild(g);

  return new XMLSerializer().serializeToString(tmp);
}

export function exportSVG() {
  const s = getExportSVG();
  if (!s) { alert('Gere o DER primeiro.'); return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([s], {type:'image/svg+xml'}));
  a.download = 'der_conceitual.svg'; a.click();
}

export function exportPNG() {
  const s = getExportSVG();
  if (!s) { alert('Gere o DER primeiro.'); return; }
  // Get dimensions from SVG string
  const match = s.match(/width="([^"]+)"/);
  const matchH = s.match(/height="([^"]+)"/);
  const W = match ? +match[1] : 1200, H = matchH ? +matchH[1] : 900;
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = W*2; c.height = H*2;
    const ctx = c.getContext('2d'); ctx.scale(2,2); ctx.drawImage(img,0,0);
    const a = document.createElement('a');
    a.href = c.toDataURL('image/png'); a.download = 'der_conceitual.png'; a.click();
  };
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s);
}

// ══════════════════════════════════════════════════════════════════
// SAVE/LOAD PROJECT (.JSON)
// ══════════════════════════════════════════════════════════════════
export function saveProject() {
  if (!state.nodes.length) {
    alert('Não há nenhum digrama para salvar!');
    return;
  }
  const proj = {
    script: document.getElementById('inp').value,
    state: state
  };
  const json = JSON.stringify(proj, null, 2);

  // Use modern File System Access API
  if (window.showSaveFilePicker) {
    window.showSaveFilePicker({
      suggestedName: appState.lastImportedFileName + '.json',
      types: [{ description: 'Projeto DER JSON', accept: { 'application/json': ['.json'] } }],
    }).then(async handle => {
      const writable = await handle.createWritable();
      await writable.write(json);
      await writable.close();
      setStatus('ok', 'Projeto salvo com sucesso!');
    }).catch(err => {
      if (err.name !== 'AbortError') {
        alert('Erro ao salvar arquivo: ' + err.message);
        setStatus('err', 'Erro ao salvar projeto.');
      }
    });
  } else {
    // Fallback
    const blob = new Blob([json], {type:'application/json'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = appState.lastImportedFileName + '.json';
    a.click();
    setStatus('ok', 'Projeto baixado com sucesso!');
  }
}
