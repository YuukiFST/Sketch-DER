// =============================================================
// render-loop.js — Loop de render com interpolação de posição
// =============================================================

const RENDER_LOOP = (() => {

  // Fator de interpolação: 0.18 = suave (Figma-like), 0.35 = mais rápido
  const LERP = 0.20;

  // Elementos rastreados: Map<id, { x, y, targetX, targetY, data }>
  const elements = new Map();

  let isDirty = false;
  let renderCallback = null;
  let isRunning = false;

  // ── API de controle de elementos ──

  // Registra ou atualiza elemento com posição atual (sem interpolação)
  function register(id, x, y, data = {}) {
    elements.set(id, { x, y, targetX: x, targetY: y, data });
    markDirty();
  }

  // Remove elemento do loop
  function unregister(id) {
    elements.delete(id);
    markDirty();
  }

  // Move elemento LOCAL (usuário local arrastando) — sem interpolação, imediato
  function moveLocal(id, x, y) {
    const el = elements.get(id);
    if (!el) return;
    el.x = x;
    el.y = y;
    el.targetX = x;
    el.targetY = y;
    markDirty();
  }

  // Move elemento REMOTO (chegou via WebSocket) — com interpolação suave
  function moveRemote(id, targetX, targetY) {
    const el = elements.get(id);
    if (!el) return;
    el.targetX = targetX;
    el.targetY = targetY;
    markDirty();
  }

  // Obtém posição atual interpolada de um elemento
  function getPosition(id) {
    const el = elements.get(id);
    if (!el) return null;
    return { x: el.x, y: el.y };
  }

  // Marca que o canvas precisa ser redesenhado
  function markDirty() {
    isDirty = true;
  }

  // ── Loop principal ──

  function setRenderCallback(fn) {
    renderCallback = fn;
  }

  function tick() {
    if (!isRunning) return;

    let anyMoving = false;

    // Interpola todos os elementos remotos em direção ao alvo
    elements.forEach(el => {
      const dx = el.targetX - el.x;
      const dy = el.targetY - el.y;

      if (Math.abs(dx) > 0.05 || Math.abs(dy) > 0.05) {
        el.x += dx * LERP;
        el.y += dy * LERP;
        anyMoving = true;
        isDirty = true;
      } else if (dx !== 0 || dy !== 0) {
        // Snap final para evitar drift infinito
        el.x = el.targetX;
        el.y = el.targetY;
        isDirty = true;
      }
    });

    // Só redesenha se algo mudou
    if (isDirty && renderCallback) {
      renderCallback();
      isDirty = false;
    }

    requestAnimationFrame(tick);
  }

  function start() {
    if (isRunning) return;
    isRunning = true;
    requestAnimationFrame(tick);
  }

  function stop() {
    isRunning = false;
  }

  // Força redesenho imediato (ex: após zoom, pan, geração de DER)
  function forceRedraw() {
    isDirty = true;
  }

  return {
    register,
    unregister,
    moveLocal,
    moveRemote,
    getPosition,
    markDirty,
    forceRedraw,
    setRenderCallback,
    start,
    stop,
    clear: () => elements.clear()
  };
})();
