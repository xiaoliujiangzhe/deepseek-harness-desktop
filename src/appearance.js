'use strict';

(function () {
  const PRESETS = [
    { name: 'DeepSeek 蓝（默认）', value: '' },
    { name: '紫色', value: '#7c3aed' },
    { name: '绿色', value: '#059669' },
    { name: '橙色', value: '#ea580c' },
    { name: '红色', value: '#dc2626' },
    { name: '粉色', value: '#db2777' },
    { name: '青色', value: '#0891b2' }
  ];

  const swatchesEl = document.getElementById('swatches');
  const accentInput = document.getElementById('accent');
  const resetAccentBtn = document.getElementById('resetAccent');
  const cssInput = document.getElementById('css');
  const saveBtn = document.getElementById('save');
  const cancelBtn = document.getElementById('cancel');

  let accent = '';

  function renderSwatches() {
    swatchesEl.innerHTML = '';
    for (const p of PRESETS) {
      const b = document.createElement('button');
      b.className = 'swatch';
      b.title = p.name;
      b.style.background = p.value || '#4176e6';
      if (p.value === accent || (p.value === '' && accent === '')) {
        b.classList.add('selected');
      }
      b.addEventListener('click', () => {
        accent = p.value;
        accentInput.value = accent || '#4176e6';
        renderSwatches();
      });
      swatchesEl.appendChild(b);
    }
  }

  accentInput.addEventListener('input', () => {
    accent = accentInput.value;
    renderSwatches();
  });

  resetAccentBtn.addEventListener('click', () => {
    accent = '';
    accentInput.value = '#4176e6';
    renderSwatches();
  });

  saveBtn.addEventListener('click', async () => {
    await window.appearanceApi.save({
      accent: accent || '',
      customCss: cssInput.value || ''
    });
    window.close();
  });

  cancelBtn.addEventListener('click', () => window.close());

  (async () => {
    const a = await window.appearanceApi.get();
    accent = a.accent || '';
    cssInput.value = a.customCss || '';
    accentInput.value = accent || '#4176e6';
    renderSwatches();
  })();
})();
