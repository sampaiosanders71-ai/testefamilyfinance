const RELEASE = {
  version: '2.4.0',
  publishedAt: '07/10/2026',
  improvementCount: 6,
  title: 'Nova atualização disponível',
  summary: 'Veja as principais mudanças desta versão antes de atualizar o Family Finance.',
  statusTitle: 'A atualização está pronta para instalar agora.',
  statusText: 'Você pode atualizar agora ou deixar para depois.',
  highlights: [
    { title: 'Planejamento e limites aprimorados', text: 'Planejamento, limites e gastos passam a ficar mais claros e organizados, inclusive no celular.' },
    { title: 'Limites com visual em camadas', text: 'Gasto realizado, planejamento pendente e limite da categoria agora podem ser comparados na mesma barra.' },
    { title: 'Sugestão inteligente de limites', text: 'O app analisa os últimos 3 meses e sugere novos limites antes de qualquer alteração ser aplicada.' },
    { title: 'Ajuda contextual em todo o app', text: 'Explicações longas saíram da interface e agora ficam disponíveis pelo ícone de ajuda quando necessário.' },
    { title: 'Relatórios com papel timbrado', text: 'Os PDFs passam a usar a identidade visual do Family Finance para uma apresentação mais profissional.' },
    { title: 'Melhorias no mobile e navegação', text: 'Cards, menu Mais, ícones e organização visual foram refinados para facilitar o uso no celular.' }
  ]
}

const STORAGE_KEY = 'ff:last-seen-release';
const SESSION_KEY = 'ff:release-prompt-opened';
let updateNowHandler = null;
let bound = false;

function $(id){ return document.getElementById(id); }
function getDialog(){ return $('app-update-dialog'); }
function getDetails(){ return $('app-update-details'); }

function renderRelease(){
  const versionNodes = document.querySelectorAll('[data-release-version]');
  versionNodes.forEach(node => { node.textContent = RELEASE.version; });
  if ($('app-update-title')) $('app-update-title').textContent = RELEASE.title;
  if ($('app-update-subtitle')) $('app-update-subtitle').textContent = RELEASE.summary;
  if ($('app-update-published')) $('app-update-published').textContent = RELEASE.publishedAt;
  if ($('app-update-count')) $('app-update-count').textContent = `${RELEASE.improvementCount} melhorias principais`;
  if ($('app-update-status-title')) $('app-update-status-title').textContent = RELEASE.statusTitle;
  if ($('app-update-status-text')) $('app-update-status-text').textContent = RELEASE.statusText;
  if ($('install-current-version')) $('install-current-version').textContent = RELEASE.version;
  const list = $('app-update-highlights');
  if (list) {
    list.innerHTML = RELEASE.highlights.map(item => `
      <article class="app-update-item">
        <div class="app-update-item-icon">•</div>
        <div class="app-update-item-copy">
          <strong>${item.title}</strong>
          <small>${item.text}</small>
        </div>
      </article>
    `).join('');
  }
}

function markSeen(){
  try{ localStorage.setItem(STORAGE_KEY, RELEASE.version); }catch{}
}

function closeUpdateDialog(mark = true){
  const dialog = getDialog();
  if (mark) markSeen();
  if (dialog?.open) dialog.close();
}

export function openUpdateDialog({ markAsSeen = false } = {}){
  renderRelease();
  const dialog = getDialog();
  if (!dialog) return;
  if (markAsSeen) markSeen();
  if (!dialog.open) dialog.showModal();
}

export function promptAppUpdateIfNeeded(){
  renderRelease();
  let seen = null;
  let sessionFlag = null;
  try{ seen = localStorage.getItem(STORAGE_KEY); }catch{}
  try{ sessionFlag = sessionStorage.getItem(SESSION_KEY); }catch{}
  if (seen === RELEASE.version || sessionFlag === RELEASE.version) return;
  try{ sessionStorage.setItem(SESSION_KEY, RELEASE.version); }catch{}
  openUpdateDialog();
}

export function initUpdateCenter({ onUpdateNow } = {}){
  updateNowHandler = typeof onUpdateNow === 'function' ? onUpdateNow : null;
  renderRelease();
  if (bound) return;
  bound = true;

  $('open-update-dialog-btn')?.addEventListener('click', () => openUpdateDialog({ markAsSeen: true }));
  $('app-update-close')?.addEventListener('click', () => closeUpdateDialog(true));
  $('app-update-later')?.addEventListener('click', () => closeUpdateDialog(true));
  $('app-update-now')?.addEventListener('click', async () => {
    markSeen();
    if ($('app-update-now')) {
      const btn = $('app-update-now');
      btn.disabled = true;
      const old = btn.textContent;
      btn.textContent = 'Atualizando…';
      try {
        if (updateNowHandler) await updateNowHandler();
      } finally {
        btn.disabled = false;
        btn.textContent = old;
      }
    }
    closeUpdateDialog(false);
  });
  $('app-update-details-btn')?.addEventListener('click', () => {
    const details = getDetails();
    if (!details) return;
    const expanded = !details.classList.contains('hidden');
    details.classList.toggle('hidden', expanded);
    $('app-update-details-btn').textContent = expanded ? 'Ver detalhes' : 'Ocultar detalhes';
  });
  getDialog()?.addEventListener('click', event => {
    const dialog = getDialog();
    if (event.target === dialog) closeUpdateDialog(true);
  });
}

export { RELEASE };
