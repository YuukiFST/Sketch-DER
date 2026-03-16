import { state, appState, pushState } from './state.js';
import { render } from './render.js';
import { setStatus } from './dragger.js';

// ══════════════════════════════════════════════════════════════════
// SIDE PANEL (EDIT NODE)
// ══════════════════════════════════════════════════════════════════
export function openPanel(nodeId) {
  const n = state.nodes.find(x => x.id === nodeId);
  if (!n) return;
  appState.activeEditNode = n;
  
  const p = document.getElementById('prop-panel');
  const b = document.getElementById('pp-body');
  const ic = document.getElementById('pp-icon');
  const tt = document.getElementById('pp-title');
  if(!p || !b || !ic || !tt) return;

  b.innerHTML = '';
  
  if (n.type === 'entity') {
    ic.textContent = 'E'; ic.className = 'sp-tit-icon ent'; tt.textContent = 'Editar Entidade';
    b.innerHTML = `
      <div class="fg">
        <label>Nome da Entidade</label>
        <input type="text" id="edit-name" value="${n.name}">
      </div>
    `;
  } else if (n.type === 'relationship') {
    ic.textContent = 'R'; ic.className = 'sp-tit-icon rel'; tt.textContent = 'Editar Relacionamento';
    b.innerHTML = `
      <div class="fg">
        <label>Nome do Relacionamento</label>
        <input type="text" id="edit-name" value="${n.name}">
      </div>
    `;
  } else if (n.type === 'attribute') {
    ic.textContent = 'A'; ic.className = 'sp-tit-icon attr'; tt.textContent = 'Editar Atributo';
    b.innerHTML = `
      <div class="fg">
        <label>Nome do Atributo</label>
        <input type="text" id="edit-name" value="${n.name}">
      </div>
      <div class="fg">
        <label>Tipo (Ex: varchar, int, serial)</label>
        <input type="text" id="edit-type" value="${n.typeStr || ''}">
      </div>
      <div class="fg fg-cb">
        <input type="checkbox" id="edit-pk" ${n.pk ? 'checked' : ''}>
        <label for="edit-pk">É Chave Primária (PK)</label>
      </div>
    `;
  }
  
  p.classList.add('open');
}

export function closePanel() {
  const p = document.getElementById('prop-panel');
  if(p) p.classList.remove('open');
  appState.activeEditNode = null;
}

export function applyEdits() {
  if (!appState.activeEditNode) return;
  const n = appState.activeEditNode;
  
  pushState(); // Snapshot ANTES de alterar propriedades
  
  const ename = document.getElementById('edit-name');
  if (ename && ename.value.trim() !== '') {
    n.name = ename.value.trim();
  }
  
  if (n.type === 'attribute') {
    const etype = document.getElementById('edit-type');
    const epk = document.getElementById('edit-pk');
    if (etype) n.typeStr = etype.value.trim();
    if (epk) n.pk = epk.checked;
  }
  
  closePanel();
  render();
  setStatus('ok', 'Alterações salvas no diagrama!');

  // Emite para colaboração
  if (window.COLLAB && COLLAB.isInRoom()) {
    const changes = { name: n.name };
    if (n.type === 'attribute') {
        changes.typeStr = n.typeStr;
        changes.pk = n.pk;
    }
    // No performance plan, podemos enviar como der_update para simplificar sincronismo total de labels
    COLLAB.emitDerUpdate(window.SKETCH_DER.getFullState());
  }
}
