'use strict';

(function () {
  const barFill = document.getElementById('barFill');
  const barPct = document.getElementById('barPct');
  const statusEl = document.getElementById('status');
  const errorEl = document.getElementById('error');
  const errorTitle = document.getElementById('errorTitle');
  const errorDetail = document.getElementById('errorDetail');
  const btnWorkspace = document.getElementById('btnWorkspace');
  const btnRetry = document.getElementById('btnRetry');

  let target = 0;
  let current = 0;
  let rafId = null;

  function animate() {
    current += (target - current) * 0.12;
    if (Math.abs(target - current) < 0.05) current = target;
    barFill.style.width = current.toFixed(1) + '%';
    barPct.textContent = Math.round(current) + '%';
    if (current < target) {
      rafId = requestAnimationFrame(animate);
    } else {
      rafId = null;
    }
  }

  function setTarget(pct) {
    target = Math.max(0, Math.min(100, pct));
    if (rafId === null) rafId = requestAnimationFrame(animate);
  }

  function setStatus(label) {
    statusEl.textContent = label;
    statusEl.classList.add('busy');
  }

  function showError(payload) {
    statusEl.classList.remove('busy');
    statusEl.textContent = '';
    errorTitle.textContent = payload.message || '启动失败';
    errorDetail.textContent = payload.detail || '';
    errorEl.hidden = false;
    target = 0;
    current = 0;
    barFill.style.width = '0%';
    barPct.textContent = '0%';
  }

  function reset() {
    errorEl.hidden = true;
    errorDetail.textContent = '';
    statusEl.classList.add('busy');
    setStatus('正在准备…');
    target = 0;
    current = 0;
    barFill.style.width = '0%';
    barPct.textContent = '0%';
  }

  if (window.dshDesktop) {
    window.dshDesktop.onProgress((s) => {
      if (!errorEl.hidden) return; // freeze the bar once an error is shown
      setTarget(s.pct);
      setStatus(s.label);
    });
    window.dshDesktop.onError(showError);
    window.dshDesktop.onReset(reset);

    btnWorkspace.addEventListener('click', () => window.dshDesktop.chooseWorkspace());
    btnRetry.addEventListener('click', () => window.dshDesktop.retry());
  } else {
    // Fallback when the preload bridge is unavailable (e.g. opened directly).
    setStatus('预加载桥接不可用');
  }
})();
