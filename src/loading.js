'use strict';

(function () {
  const stageEl = document.getElementById('stage');
  const startupEl = document.getElementById('startup');
  const mascotEl = document.getElementById('mascot');
  const barFill = document.getElementById('barFill');
  const barPct = document.getElementById('barPct');
  const barLabel = document.getElementById('barLabel');
  const statusEl = document.getElementById('status');
  const detailEl = document.getElementById('detail');
  const bootStepEl = document.getElementById('bootStep');
  const tickEls = Array.from(document.querySelectorAll('#ticks i'));
  const errorEl = document.getElementById('error');
  const errorTitle = document.getElementById('errorTitle');
  const errorDetail = document.getElementById('errorDetail');
  const btnWorkspace = document.getElementById('btnWorkspace');
  const btnRetry = document.getElementById('btnRetry');

  const phases = [
    { max: 8, step: 'ENVIRONMENT', detail: '检查 Harness 与工作目录' },
    { max: 30, step: 'RUNTIME BOOT', detail: '启动本地 Node.js 服务' },
    { max: 54, step: 'PLUGIN TREE', detail: '加载 Harness 配置与插件' },
    { max: 92, step: 'SERVICE CHECK', detail: '确认本地 HTTP 服务可访问' },
    { max: 99, step: 'UI HANDOFF', detail: '准备桌面窗口' },
    { max: 100, step: 'READY', detail: '本地服务已就绪' }
  ];

  let target = 0;
  let current = 0;
  let rafId = null;

  function phaseFor(pct) {
    const index = phases.findIndex((phase) => pct <= phase.max);
    const safeIndex = index < 0 ? phases.length - 1 : index;
    return { phase: phases[safeIndex], index: safeIndex };
  }

  function paint(pct) {
    const rounded = Math.round(pct);
    const activeTicks = Math.ceil(rounded / 10);
    barFill.style.width = pct.toFixed(1) + '%';
    barPct.textContent = rounded + '%';
    tickEls.forEach((tick, index) => tick.classList.toggle('active', index < activeTicks));
    const { phase, index } = phaseFor(rounded);
    barLabel.textContent = phase.step;
    detailEl.textContent = phase.detail;
    bootStepEl.textContent = String(index + 1).padStart(2, '0') + ' / 06';
  }

  function animate() {
    current += (target - current) * 0.14;
    if (Math.abs(target - current) < 0.05) current = target;
    paint(current);
    if (current !== target) rafId = requestAnimationFrame(animate);
    else rafId = null;
  }

  function setProgress(payload) {
    target = Math.max(0, Math.min(100, Number(payload.pct) || 0));
    statusEl.textContent = payload.label || '正在启动本地服务';
    mascotEl.classList.toggle('is-paused', target >= 100);
    if (rafId === null) rafId = requestAnimationFrame(animate);
  }

  function showError(payload) {
    if (rafId !== null) cancelAnimationFrame(rafId);
    rafId = null;
    target = 0;
    current = 0;
    startupEl.hidden = true;
    errorEl.hidden = false;
    stageEl.classList.add('has-error');
    mascotEl.classList.add('is-error');
    bootStepEl.textContent = 'STOPPED';
    errorTitle.textContent = payload.message || '启动失败';
    errorDetail.textContent = payload.detail || '没有收到更多错误信息。';
  }

  function reset() {
    errorEl.hidden = true;
    startupEl.hidden = false;
    stageEl.classList.remove('has-error');
    mascotEl.classList.remove('is-error', 'is-paused');
    errorDetail.textContent = '';
    target = 0;
    current = 0;
    statusEl.textContent = '鲸鱼娘正在偷吃你的白饭';
    paint(0);
  }

  paint(0);

  if (window.dshDesktop) {
    window.dshDesktop.onProgress((payload) => {
      if (!errorEl.hidden) return;
      setProgress(payload);
    });
    window.dshDesktop.onError(showError);
    window.dshDesktop.onReset(reset);
    btnWorkspace.addEventListener('click', () => window.dshDesktop.chooseWorkspace());
    btnRetry.addEventListener('click', () => window.dshDesktop.retry());
  } else {
    showError({ message: '预加载桥接不可用', detail: '无法连接桌面主进程。' });
  }
})();
