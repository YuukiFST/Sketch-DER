// =============================================================
// collab.js — Colaboração em tempo real com performance total
// Camada 1: WebSocket nativo + throttle + delta only
// Camada 2: optimistic UI + lock por elemento
// Camada 3: delega render ao RENDER_LOOP
// =============================================================

const COLLAB = (() => {

  // ⚠️ Substituir pela URL real do servidor Go no Render:
  const SERVER_URL = 'wss://sketch-der.onrender.com/ws';

  let ws = null;
  let myInfo = null;        // { id, name, color }
  let roomCode = null;
  let reconnectTimer = null;

  // Estado de locks: Map<elementId, { userId, userName, color }>
  const locks = new Map();

  // Cursores remotos: Map<userId, { x, y, name, color, domEl }>
  const cursors = new Map();

  // Throttle de cursor: só envia a cada 40ms
  let cursorThrottle = null;
  let pendingCursor = null;

  // Throttle de move: acumula posições, envia no próximo tick
  let pendingMoves = new Map(); // elementId → {x, y}
  let moveFlushTimer = null;

  // ── Conexão WebSocket ──────────────────────────────────────

  function connect(firstMessage) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(firstMessage));
      return;
    }

    ws = new WebSocket(SERVER_URL);

    ws.onopen = () => {
      console.log('[Collab] Conectado');
      ws.send(JSON.stringify(firstMessage));
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    };

    ws.onerror = (e) => {
      console.warn('[Collab] Erro de conexão:', e);
      if (!roomCode) {
        hideLoadingOverlay();
        showToast('Não foi possível conectar ao servidor.', 'error');
      }
    };

    ws.onclose = () => {
      console.log('[Collab] Desconectado');
      if (roomCode) {
        showToast('Conexão perdida. Tentando reconectar...', 'error');
        reconnectTimer = setTimeout(() => {
          connect({
            type: 'join_room',
            payload: JSON.stringify({ roomCode, userName: myInfo?.name || 'Usuário' })
          });
        }, 3000);
      } else {
        hideLoadingOverlay();
        // Se fechou sem roomCode, é erro de conexão inicial
        showToast('Conexão encerrada pelo servidor.', 'error');
      }
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleMessage(msg);
      } catch(e) {
        console.error('[Collab] Erro ao parsear mensagem:', e);
      }
    };
  }

  function send(type, payload) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type, payload: JSON.stringify(payload) }));
  }

  // ── Handlers de mensagens recebidas ───────────────────────

  function handleMessage(msg) {
    switch (msg.type) {

      case 'room_created':
      case 'room_joined': {
        const d = JSON.parse(msg.payload);
        roomCode = d.roomCode;
        myInfo = d.userInfo;

        // Restaura locks vindos do servidor (sala já existia)
        if (d.locks) {
          Object.entries(d.locks).forEach(([elemId, userId]) => {
            const user = d.users.find(u => u.id === userId);
            if (user) applyLock(elemId, user);
          });
        }

        // Se entrou em sala existente, aplica o estado do DER
        if (msg.type === 'room_joined' && d.state) {
          applyFullState(d.state);
        }

        hideLoadingOverlay();
        updateRoomUI(d.roomCode, d.users);
        showCollabPanel();
        showToast(msg.type === 'room_created' ? `Sala ${d.roomCode} criada!` : `Entrou na sala ${d.roomCode}!`, 'success');
        break;
      }

      case 'join_error': {
        const d = JSON.parse(msg.payload);
        hideLoadingOverlay();
        showToast(d.message, 'error');
        break;
      }

      case 'user_joined': {
        const d = JSON.parse(msg.payload);
        updateUserList(d.users);
        showToast(`${d.userInfo.name} entrou.`, 'info');
        break;
      }

      case 'user_left': {
        const d = JSON.parse(msg.payload);
        removeCursor(d.userId);
        updateUserList(d.users);
        showToast('Um usuário saiu da sala.', 'info');
        break;
      }

      case 'move': {
        const d = JSON.parse(msg.payload);
        const lock = locks.get(d.id);
        if (lock && lock.userId === myInfo?.id) break;
        RENDER_LOOP.moveRemote(d.id, d.x, d.y);
        break;
      }

      case 'lock': {
        const d = JSON.parse(msg.payload);
        applyLock(d.id, { id: d.userId, name: d.userName, color: d.color });
        break;
      }

      case 'unlock': {
        const d = JSON.parse(msg.payload);
        removeLock(d.id);
        break;
      }

      case 'cursor': {
        const d = JSON.parse(msg.payload);
        updateRemoteCursor(d.userId, d.x, d.y);
        break;
      }

      case 'der_update': {
        const d = JSON.parse(msg.payload);
        applyFullState(d.state);
        showToast('DER atualizado por outro usuário.', 'info');
        break;
      }
    }
  }

  // ── Camada 2: Lock por elemento ────────────────────────────

  function applyLock(elementId, userInfo) {
    locks.set(elementId, userInfo);
    if (window.SKETCH_DER?.setElementLock) {
      window.SKETCH_DER.setElementLock(elementId, userInfo.color, userInfo.name);
    }
    RENDER_LOOP.markDirty();
  }

  function removeLock(elementId) {
    locks.delete(elementId);
    if (window.SKETCH_DER?.clearElementLock) {
      window.SKETCH_DER.clearElementLock(elementId);
    }
    RENDER_LOOP.markDirty();
  }

  function isLockedByOther(elementId) {
    const lock = locks.get(elementId);
    return lock && lock.userId !== myInfo?.id;
  }

  // ── Camada 1: Envio throttled de move ──────────────────────

  function emitMove(elementId, x, y) {
    if (!roomCode) return;

    RENDER_LOOP.moveLocal(elementId, x, y);

    pendingMoves.set(elementId, { x, y });
    if (!moveFlushTimer) {
      moveFlushTimer = setTimeout(() => {
        pendingMoves.forEach((pos, id) => {
          send('move', { id, x: pos.x, y: pos.y });
        });
        pendingMoves.clear();
        moveFlushTimer = null;
      }, 40);
    }
  }

  function emitLockStart(elementId) {
    if (!roomCode || isLockedByOther(elementId)) return false;
    applyLock(elementId, myInfo); 
    send('lock', { id: elementId });
    return true;
  }

  function emitLockEnd(elementId, x, y) {
    if (!roomCode) return;
    RENDER_LOOP.moveLocal(elementId, x, y);
    send('move', { id: elementId, x, y });
    send('unlock', { id: elementId });
    removeLock(elementId);
  }

  function emitCursor(canvasX, canvasY) {
    if (!roomCode) return;
    pendingCursor = { x: canvasX, y: canvasY };
    if (!cursorThrottle) {
      cursorThrottle = setTimeout(() => {
        if (pendingCursor) send('cursor', pendingCursor);
        cursorThrottle = null;
        pendingCursor = null;
      }, 40);
    }
  }

  function emitDerUpdate(fullState) {
    if (!roomCode) return;
    send('der_update', fullState);
  }

  function emitStateSync(fullState) {
    if (!roomCode) return;
    send('state_sync', fullState);
  }

  // ── Cursores remotos ───────────────────────────────────────

  function updateRemoteCursor(userId, canvasX, canvasY) {
    if (userId === myInfo?.id) return;

    let cursor = cursors.get(userId);
    if (!cursor) {
      const el = document.createElement('div');
      el.className = 'collab-cursor';
      el.dataset.userId = userId;
      document.body.appendChild(el);
      cursor = { el, x: canvasX, y: canvasY };
      cursors.set(userId, cursor);
    }

    cursor.x = canvasX;
    cursor.y = canvasY;
    const screen = canvasToScreen(canvasX, canvasY);
    if (screen) {
      cursor.el.style.transform = `translate(${screen.x}px, ${screen.y}px)`;
    }
  }

  function removeCursor(userId) {
    const cursor = cursors.get(userId);
    if (cursor) {
      cursor.el.remove();
      cursors.delete(userId);
    }
  }

  function refreshCursorPositions() {
    cursors.forEach((cursor, userId) => {
      const screen = canvasToScreen(cursor.x, cursor.y);
      if (screen) {
        cursor.el.style.transform = `translate(${screen.x}px, ${screen.y}px)`;
      }
    });
  }

  function canvasToScreen(cx, cy) {
    if (!window.SKETCH_DER?.getViewTransform) return null;
    const { panX, panY, scale } = window.SKETCH_DER.getViewTransform();
    const viewport = document.getElementById('viewport');
    if (!viewport) return null;
    const rect = viewport.getBoundingClientRect();
    return { x: rect.left + (cx * scale) + panX, y: rect.top + (cy * scale) + panY };
  }

  // ── Ações públicas de sala ─────────────────────────────────

  function createRoom(userName, derState) {
    showLoadingOverlay('Criando sala...');
    myInfo = { name: userName };
    connect({ type: 'create_room', payload: JSON.stringify({ userName, state: derState }) });
  }

  function joinRoom(userName, code) {
    showLoadingOverlay('Entrando na sala...');
    myInfo = { name: userName };
    connect({ type: 'join_room', payload: JSON.stringify({ roomCode: code.toUpperCase(), userName }) });
  }

  // ── UI ────────────────────────────────────────────────────

  function updateRoomUI(code, users) {
    const codeEl = document.getElementById('collab-room-code');
    if (codeEl) codeEl.textContent = code;
    updateUserList(users);
  }

  function updateUserList(users) {
    const list = document.getElementById('collab-user-list');
    if (!list) return;
    list.innerHTML = users.map(u => `
      <div class="collab-user-item" data-user-id="${u.id}">
        <span class="collab-user-dot" style="background:${u.color}"></span>
        <span class="collab-user-name">${u.name}${u.id === myInfo?.id ? ' (você)' : ''}</span>
      </div>
    `).join('');
    
    cursors.forEach((cursor, userId) => {
      const user = users.find(u => u.id === userId);
      if (user) {
        cursor.el.style.setProperty('--cursor-color', user.color);
        cursor.el.setAttribute('data-name', user.name);
      }
    });
  }

  function showCollabPanel() {
    const panel = document.getElementById('collab-panel');
    if (panel) panel.style.display = 'block';
    const modal = document.getElementById('collab-modal');
    if (modal) modal.style.display = 'none';
  }

  function applyFullState(state) {
    if (window.SKETCH_DER?.loadFullState) {
      window.SKETCH_DER.loadFullState(state);
    }
  }

  function showToast(message, type = 'info') {
    const colors = { info: '#4f8ef7', success: '#3dd68c', error: '#f76f6f' };
    const el = document.createElement('div');
    el.style.cssText = `
      position:fixed;bottom:40px;right:40px;z-index:99999;
      background:${colors[type]};color:white;padding:12px 20px;
      border-radius:8px;font-size:14px;font-family:sans-serif;font-weight:600;
      box-shadow:0 8px 32px rgba(0,0,0,0.3);
      animation:collabFadeIn 0.3s ease;
    `;
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(10px)';
        el.style.transition = 'all 0.3s';
        setTimeout(() => el.remove(), 300);
    }, 4000);
  }

  function showLoadingOverlay(text) {
    // Remove se já existir
    const old = document.getElementById('collab-loading');
    if (old) old.remove();

    const el = document.createElement('div');
    el.id = 'collab-loading';
    el.style.cssText = `
      position:fixed;inset:0;z-index:99998;background:rgba(0,0,0,0.55);
      display:flex;align-items:center;justify-content:center;font-family:sans-serif;
    `;
    el.innerHTML = `
      <div style="background:#fff;border-radius:14px;padding:36px 44px;
                  min-width:320px;max-width:380px;text-align:center;">
        <div id="cl-spinner" style="width:48px;height:48px;border:3px solid #e8e8e8;
             border-top-color:#3498DB;border-radius:50%;margin:0 auto 24px;
             animation:collabSpin 0.9s linear infinite;"></div>
        <p style="font-size:17px;font-weight:600;color:#1a1a1a;margin:0 0 8px;">${text}</p>
        <div style="height:22px;margin-bottom:16px;">
          <p id="cl-msg" style="font-size:13px;color:#888;margin:0;
             animation:collabFadeMsg 3s ease forwards;"></p>
        </div>
        <div style="background:#f0f0f0;border-radius:99px;height:4px;
                    overflow:hidden;margin-bottom:16px;">
          <div id="cl-bar" style="height:100%;background:#3498DB;border-radius:99px;
               width:0;transition:width 0.8s ease;"></div>
        </div>
        <p style="font-size:11px;color:#bbb;margin:0;line-height:1.5;">
          O servidor gratuito hiberna quando não está em uso.<br>
          Isso só acontece na primeira conexão do dia.
        </p>
      </div>
    `;
    document.body.appendChild(el);

    // Injeta keyframes uma vez
    if (!document.getElementById('collab-keyframes')) {
      const style = document.createElement('style');
      style.id = 'collab-keyframes';
      style.textContent = `
        @keyframes collabSpin { to { transform: rotate(360deg); } }
        @keyframes collabFadeMsg {
          0%   { opacity:0; transform:translateY(5px); }
          15%  { opacity:1; transform:translateY(0); }
          85%  { opacity:1; transform:translateY(0); }
          100% { opacity:0; transform:translateY(-5px); }
        }
      `;
      document.head.appendChild(style);
    }

    // Mensagens rotativas a cada 3s
    const msgs = [
      'Acordando o servidor (pode levar até 50s)...',
      'Estabelecendo conexão WebSocket...',
      'Aguardando resposta do servidor...',
      'Quase lá, só mais um momento...',
      'Ainda tentando conectar...',
      'O servidor está quase pronto...',
    ];
    let msgIndex = 0;
    const msgEl = document.getElementById('cl-msg');
    const barEl = document.getElementById('cl-bar');

    function nextMsg() {
      if (!msgEl) return;
      msgEl.style.animation = 'none';
      msgEl.offsetHeight; // força reflow
      msgEl.textContent = msgs[msgIndex % msgs.length];
      msgEl.style.animation = 'collabFadeMsg 3s ease forwards';
      msgIndex++;
    }

    nextMsg();
    el._msgTimer = setInterval(nextMsg, 3000);

    // Barra de progresso: avança linearmente em 55s (cobrindo o pior caso)
    let progress = 0;
    el._barTimer = setInterval(() => {
      progress = Math.min(progress + (100 / 55), 98); // nunca chega a 100 — só fecha ao conectar
      if (barEl) barEl.style.width = progress + '%';
    }, 1000);
  }

  function hideLoadingOverlay() {
    const el = document.getElementById('collab-loading');
    if (!el) return;

    // Para os timers
    clearInterval(el._msgTimer);
    clearInterval(el._barTimer);

    // Barra vai a 100% e some com fade
    const barEl = document.getElementById('cl-bar');
    if (barEl) barEl.style.width = '100%';

    setTimeout(() => el.remove(), 400);
  }

  // API pública
  return {
    init: () => {}, // placeholder
    createRoom,
    joinRoom,
    emitMove,
    emitLockStart,
    emitLockEnd,
    emitCursor,
    emitDerUpdate,
    emitStateSync,
    refreshCursorPositions,
    isLockedByOther,
    isInRoom: () => !!roomCode,
    getRoomCode: () => roomCode,
    getMyColor: () => myInfo?.color,
    initCursors: () => {} 
  };
})();
