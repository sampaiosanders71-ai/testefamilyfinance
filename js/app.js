import { signIn,signUp,signOut,getSession,onAuthChange } from './auth.js';
import { ensureProfile,foundationHealthCheck } from './database.js';
import { listFamilyData,sendFamilyInvite,respondFamilyInvite,cancelFamilyInvite,updateFamilyPermissions,removeFamilyLink,loadFamilyOverview } from './family.js';
import { getLegacyMigrationStatus,claimLegacyAccount } from './migration.js';
import { updateProfileSettings } from './settings.js';
import { initPWA } from './pwa.js';
import { DEFAULT_CATEGORIES,localISO,listTransactions,createTransaction,updateTransaction,deleteTransaction,applyBalanceAdjustment,calculateCashStats,filterTransactions } from './finance.js';
import { listCards,createCard,updateCard,deleteCard,createPurchase,updatePurchase,deletePurchase,listPurchases,listInstallments,listInvoiceStatuses,setInvoicePaid,sumCardExpensesForMonth,cardInvoiceSummaries } from './cards.js';
import { listGoals,createGoal,updateGoal,deleteGoal } from './goals.js';
import { BUDGET_CATEGORIES,getBudget,saveBudget,budgetSummary } from './budget.js';
import { listNotifications,markNotificationRead,markAllNotificationsRead,markNotificationsForTarget,syncFinancialNotifications,subscribeNotifications } from './notifications.js';
import { setAuthMode,showAuth,showApp,showModule,setAuthError,setAuthBusy,setAppBusy,toast,setLoading,formatBRL,formatDate,monthLabel,escapeHTML,openDialog,closeDialog,setFormError,emptyState,applyTheme } from './ui.js';
import { getMonthlyDRE,getReportMonthOptions,downloadFinancialReportPDF } from './reports.js';

let authMode='login', authBusy=false, appActionBusy=false, enterAppPromise=null, refreshBusy=false, bootstrapGeneration=0, notificationChannel=null;
let currentUser=null, currentProfile=null;
let dashboardDate=new Date(new Date().getFullYear(),new Date().getMonth(),1,12);
let budgetDate=new Date(new Date().getFullYear(),new Date().getMonth(),1,12);
let reportReferenceDate=new Date(new Date().getFullYear(),new Date().getMonth(),1,12);
let state={transactions:[],cards:[],purchases:[],installments:[],invoiceStatuses:[],goals:[],budget:{plan:null,items:[]},family:null,migration:{claimed:false},notifications:[]};

function fillCategorySelect(id){const el=document.getElementById(id);el.innerHTML=DEFAULT_CATEGORIES.map(c=>`<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`).join('')}
function monthPrefix(date){return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`}
function addMonth(date,offset){return new Date(date.getFullYear(),date.getMonth()+offset,1,12)}
function setButtonBusy(btn,busy,text='Salvando…'){if(!btn)return;if(busy){btn.dataset.oldText=btn.textContent;btn.textContent=text;btn.disabled=true}else{btn.textContent=btn.dataset.oldText||btn.textContent;btn.disabled=false}}
async function runAppOperation(title,message,task){
  if(appActionBusy)return undefined;
  appActionBusy=true;
  setAppBusy(true,title,message);
  try{return await task()}finally{setAppBusy(false);appActionBusy=false}
}
function syncOperationMessage(message='Conferindo e atualizando as informações exibidas.'){setAppBusy(true,'Sincronizando seus dados…',message)}

function renderBootstrapCore(){renderHome();renderTransactionPeriodOptions();renderTransactions();renderCards();renderGoals();renderBudget()}

async function loadDeferredStartupData(generation){
  try{
    const [purchases,family,migration]=await Promise.all([listPurchases(),listFamilyData(),getLegacyMigrationStatus()]);
    if(generation!==bootstrapGeneration||!currentUser)return;
    state.purchases=purchases;state.family=family;state.migration=migration;
    renderCards();renderFamily();renderSettings();
  }catch(error){
    if(generation===bootstrapGeneration){console.warn('Dados secundários não carregados no primeiro momento:',error);toast('Algumas informações secundárias ainda não foram sincronizadas.','error')}
  }
}

async function loadNotificationStartupData(generation){
  try{
    await syncFinancialNotifications({budget:state.budget,transactions:state.transactions,installments:state.installments,cards:state.cards,invoiceStatuses:state.invoiceStatuses,goals:state.goals});
    const notifications=await listNotifications();
    if(generation!==bootstrapGeneration||!currentUser)return;
    state.notifications=notifications;
    renderNotifications();
    if(notificationChannel){try{await notificationChannel.unsubscribe()}catch{}notificationChannel=null}
    notificationChannel=await subscribeNotifications(async()=>{
      if(generation!==bootstrapGeneration||!currentUser)return;
      try{state.notifications=await listNotifications();renderNotifications()}catch(error){console.warn('Atualização de notificações:',error)}
    });
  }catch(error){
    if(generation===bootstrapGeneration)console.warn('Notificações não carregadas no primeiro momento:',error);
  }
}

async function enterApp(session){
  if(!session?.user)return;
  if(enterAppPromise)return enterAppPromise;
  const generation=++bootstrapGeneration;
  enterAppPromise=(async()=>{
    try{
      currentUser=session.user;
      state={transactions:[],cards:[],purchases:[],installments:[],invoiceStatuses:[],goals:[],budget:{plan:null,items:[]},family:null,migration:{claimed:false},notifications:[]};
      const [profile,transactions,cards,installments,invoiceStatuses,goals,budget]=await Promise.all([
        ensureProfile(session.user),listTransactions(),listCards(),listInstallments(),listInvoiceStatuses(),listGoals(),getBudget(budgetDate)
      ]);
      if(generation!==bootstrapGeneration)return;
      currentProfile=profile;
      state.transactions=transactions;state.cards=cards;state.installments=installments;state.invoiceStatuses=invoiceStatuses;state.goals=goals;state.budget=budget;
      showApp(session.user,currentProfile);showModule('home');renderBootstrapCore();renderSettings();
      void loadDeferredStartupData(generation);
      void loadNotificationStartupData(generation);
      void foundationHealthCheck(session.user.id).catch(error=>console.warn('Health check em segundo plano:',error));
    }catch(error){
      console.error(error);
      if(generation===bootstrapGeneration){showAuth();toast('Não foi possível carregar seus dados.','error')}
    }finally{
      enterAppPromise=null;
    }
  })();
  return enterAppPromise;
}

async function refreshAll(){if(refreshBusy)return;refreshBusy=true;setLoading(true);try{const [transactions,cards,purchases,installments,invoiceStatuses,goals,budget,family,migration]=await Promise.all([listTransactions(),listCards(),listPurchases(),listInstallments(),listInvoiceStatuses(),listGoals(),getBudget(budgetDate),listFamilyData(),getLegacyMigrationStatus()]);state={transactions,cards,purchases,installments,invoiceStatuses,goals,budget,family,migration,notifications:state.notifications||[]};await syncFinancialNotifications({budget:state.budget,transactions:state.transactions,installments:state.installments,cards:state.cards,invoiceStatuses:state.invoiceStatuses,goals:state.goals});state.notifications=await listNotifications();renderAll()}catch(error){console.error(error);toast(error?.message||'Falha ao sincronizar dados.','error')}finally{setLoading(false);refreshBusy=false}}

function renderAll(){renderHome();renderTransactionPeriodOptions();renderTransactions();renderCards();renderGoals();renderBudget();renderFamily();renderSettings();renderNotifications()}

function renderHome(){
  document.getElementById('home-month-label').textContent=monthLabel(dashboardDate);document.getElementById('home-period').textContent=`Referência: ${monthLabel(dashboardDate)}`;
  const cash=calculateCashStats(state.transactions,dashboardDate);const cardExpense=sumCardExpensesForMonth(state.installments,dashboardDate);const result=cash.cashResult-cardExpense;const invoiceSummaries=cardInvoiceSummaries(state.cards,state.installments,state.invoiceStatuses,dashboardDate);const openCardTotal=invoiceSummaries.filter(s=>s.status!=='paid').reduce((sum,s)=>sum+s.total,0);const projected=cash.projectedCashBalance-openCardTotal;
  document.getElementById('stat-balance').textContent=formatBRL(cash.balance);document.getElementById('stat-income').textContent=formatBRL(cash.income);document.getElementById('stat-expense').textContent=formatBRL(cash.expense+cardExpense);document.getElementById('stat-card-expense').textContent=formatBRL(cardExpense);document.getElementById('stat-month-result').textContent=formatBRL(result);document.getElementById('stat-projected').textContent=formatBRL(projected);
  const recent=state.transactions.slice(0,5);document.getElementById('home-transactions').innerHTML=recent.length?recent.map(transactionRowHTML).join(''):emptyState('Nenhum lançamento nesta conta de testes.');
  const summaries=invoiceSummaries.filter(s=>s.total>0).sort((a,b)=>a.dueDate-b.dueDate).slice(0,4);document.getElementById('home-invoices').innerHTML=summaries.length?summaries.map(s=>`<div class="list-row"><div class="list-row-main"><div class="list-row-title">${escapeHTML(s.card.name)}</div><div class="list-row-meta"><span>Vence ${s.dueDate.toLocaleDateString('pt-BR')}</span><span>${s.status==='paid'?'Paga':'Aberta'}</span></div></div><div class="list-row-amount">${formatBRL(s.total)}</div></div>`).join(''):emptyState('Nenhuma fatura com valor neste mês.');
  const goals=state.goals.filter(g=>g.status!=='archived').slice(0,4);document.getElementById('home-goals').innerHTML=goals.length?goals.map(goalMiniHTML).join(''):emptyState('Nenhuma meta cadastrada.');
  const bs=budgetSummary(state.budget,state.transactions,state.installments,budgetDate);document.getElementById('home-budget-spent').textContent=formatBRL(bs.totalSpent);document.getElementById('home-budget-limit').textContent=`de ${formatBRL(bs.totalLimit)}`;document.getElementById('home-budget-caption').textContent=bs.totalLimit?`${Math.max(0,Math.min(100,(bs.totalSpent/bs.totalLimit)*100)).toFixed(0)}% utilizado`:'Nenhum orçamento definido.';document.getElementById('home-budget-progress').style.width=bs.totalLimit?`${Math.max(0,Math.min(100,(bs.totalSpent/bs.totalLimit)*100))}%`:'0%';
}

function transactionRowHTML(t){const signed=Number(t.direction)*Number(t.amount||0);const isAdj=t.type==='balance_adjustment';return `<div class="list-row"><div class="list-row-main"><div class="list-row-title">${escapeHTML(t.description)}</div><div class="list-row-meta"><span>${escapeHTML(t.category||'Outros')}</span><span>${formatDate(t.occurred_on)}</span>${t.recurring_group_id?'<span>Recorrente</span>':''}${isAdj?'<span>Ajuste</span>':''}</div></div><div><div class="list-row-amount ${signed>=0?'positive':'negative'}">${signed>=0?'+':'-'} ${formatBRL(Math.abs(signed))}</div><div class="row-actions">${isAdj?'':`<button class="mini-btn" data-edit-transaction="${t.id}">Editar</button>`}<button class="mini-btn danger" data-delete-transaction="${t.id}">Excluir</button></div></div></div>`}
function renderTransactionPeriodOptions(){const select=document.getElementById('transaction-filter-month');if(!select)return;const current=select.value||'';const months=[...new Set(state.transactions.map(t=>String(t.occurred_on||'').slice(0,7)).filter(v=>/^\d{4}-\d{2}$/.test(v)))].sort().reverse();select.innerHTML='<option value="">Todos os períodos</option>'+months.map(value=>{const [y,m]=value.split('-').map(Number);return `<option value="${value}">${escapeHTML(monthLabel(new Date(y,m-1,1,12)))}</option>`}).join('');select.value=current&&months.includes(current)?current:'';}
function renderTransactions(){const search=document.getElementById('transaction-search').value||'';const type=document.getElementById('transaction-filter-type').value||'all';const month=document.getElementById('transaction-filter-month').value||'';const rows=filterTransactions(state.transactions,{search,type,month});const status=document.getElementById('transaction-sync-status');if(status){const filtered=search.trim()||type!=='all'||month;status.textContent=filtered?`Histórico sincronizado · ${state.transactions.length} no banco · ${rows.length} exibido(s)`:`Histórico sincronizado · ${state.transactions.length} lançamento(s) · Todos os períodos`;}document.getElementById('transactions-list').innerHTML=rows.length?rows.map(transactionRowHTML).join(''):emptyState('Nenhum lançamento encontrado.')}

function renderCards(){
  document.getElementById('cards-list').innerHTML=state.cards.length?state.cards.map(card=>{const all=state.installments.filter(i=>i.card_id===card.id);const paidMonths=new Set(state.invoiceStatuses.filter(x=>x.card_id===card.id&&x.status==='paid').map(x=>x.invoice_month));const outstanding=all.filter(i=>!paidMonths.has(i.invoice_month)).reduce((a,b)=>a+Number(b.amount||0),0);const available=Number(card.credit_limit)-outstanding;return `<article class="credit-card"><div class="credit-card-head"><div><span class="eyebrow">CARTÃO</span><h3>${escapeHTML(card.name)}</h3></div><span>${card.closing_day}/${card.due_day}</span></div><div class="credit-limit">${formatBRL(card.credit_limit)}</div><div class="credit-meta"><span>Comprometido ${formatBRL(outstanding)}</span><span>Disponível ${formatBRL(available)}</span><span>Juros ${Number(card.revolving_interest||0).toFixed(2)}%</span></div><div class="card-actions"><button class="mini-btn" data-new-purchase="${card.id}">＋ Compra</button><button class="mini-btn" data-open-invoice="${card.id}">Fatura</button><button class="mini-btn" data-edit-card="${card.id}">Editar</button><button class="mini-btn danger" data-delete-card="${card.id}">Excluir</button></div></article>`}).join(''):emptyState('Nenhum cartão cadastrado.');
  document.getElementById('card-purchases-list').innerHTML=state.purchases.length?state.purchases.map(p=>`<div class="list-row"><div class="list-row-main"><div class="list-row-title">${escapeHTML(p.description)}</div><div class="list-row-meta"><span>${escapeHTML(p.ff2_cards?.name||'Cartão')}</span><span>${formatDate(p.purchase_date)}</span><span>${p.installment_count}x</span><span>${escapeHTML(p.category||'Outros')}</span></div></div><div><div class="list-row-amount">${formatBRL(p.total_amount)}</div><div class="row-actions"><button class="mini-btn" data-edit-purchase="${p.id}">Editar</button><button class="mini-btn danger" data-delete-purchase="${p.id}">Excluir</button></div></div></div>`).join(''):emptyState('Nenhuma compra cadastrada.');
}

function goalMiniHTML(g){const pct=Math.max(0,Math.min(100,(Number(g.saved_amount)/Number(g.target_amount||1))*100));return `<div class="list-row"><div class="list-row-main"><div class="list-row-title">${escapeHTML(g.name)}</div><div class="progress"><span style="width:${pct}%"></span></div><div class="list-row-meta"><span>${pct.toFixed(0)}%</span><span>${formatBRL(g.saved_amount)} de ${formatBRL(g.target_amount)}</span></div></div></div>`}
function renderGoals(){document.getElementById('goals-list').innerHTML=state.goals.length?state.goals.map(g=>{const pct=Math.max(0,Math.min(100,(Number(g.saved_amount)/Number(g.target_amount||1))*100));return `<article class="goal-card"><div class="goal-card-head"><div><span class="eyebrow">${g.status==='completed'?'CONCLUÍDA':'META'}</span><h3>${escapeHTML(g.name)}</h3></div>${g.due_date?`<span>${formatDate(g.due_date)}</span>`:''}</div><div class="goal-amounts"><strong>${formatBRL(g.saved_amount)}</strong><span>de ${formatBRL(g.target_amount)}</span></div><div class="progress"><span style="width:${pct}%"></span></div><div class="progress-meta"><span>${pct.toFixed(0)}%</span><span>Faltam ${formatBRL(Math.max(0,Number(g.target_amount)-Number(g.saved_amount)))}</span></div><div class="card-actions"><button class="mini-btn" data-edit-goal="${g.id}">Editar</button><button class="mini-btn danger" data-delete-goal="${g.id}">Excluir</button></div></article>`}).join(''):emptyState('Nenhuma meta cadastrada.')}

let budgetDraft={income:0,limits:{}};
let budgetDraftDirty=false;
function currentBudgetSummary(){return budgetSummary(state.budget,state.transactions,state.installments,budgetDate)}
function resetBudgetDraftFromState(){
  const bs=currentBudgetSummary();
  const limits={};
  BUDGET_CATEGORIES.forEach(cat=>limits[cat]=Math.max(0,Number(bs.itemMap[cat]||0)));
  budgetDraft={income:Math.max(0,Number(state.budget.plan?.planned_income||0)),limits};
  budgetDraftDirty=false;
}
function budgetDraftTotals(){
  const totalLimit=BUDGET_CATEGORIES.reduce((sum,cat)=>sum+Math.max(0,Number(budgetDraft.limits[cat]||0)),0);
  const unassigned=Number(budgetDraft.income||0)-totalLimit;
  return{totalLimit,unassigned,distribution:budgetDraft.income>0?(totalLimit/budgetDraft.income)*100:0};
}
function budgetCategoryRow(cat,bs){
  const limit=Math.max(0,Number(budgetDraft.limits[cat]||0));
  const spent=Math.max(0,Number(bs.spentMap[cat]||0));
  const remaining=limit-spent;
  const percent=limit>0?(spent/limit)*100:(spent>0?100:0);
  const status=limit>0?(remaining>=0?`${formatBRL(remaining)} restante`:`${formatBRL(Math.abs(remaining))} acima`):'Sem limite';
  return `<article class="budget-simple-row ${limit>0&&spent>limit?'over':''}"><div class="budget-simple-row-main"><strong>${escapeHTML(cat)}</strong><small>${limit>0?`${formatBRL(spent)} de ${formatBRL(limit)} usados`:`${formatBRL(spent)} gastos · sem limite definido`}</small><div class="budget-simple-row-track"><span style="width:${Math.max(0,Math.min(100,percent))}%"></span></div></div><span class="budget-simple-row-status">${escapeHTML(status)}</span><button type="button" class="mini-btn" data-budget-edit="${escapeHTML(cat)}">Editar</button></article>`;
}
function renderBudgetDraft(){
  const bs=currentBudgetSummary();
  const {totalLimit,unassigned,distribution}=budgetDraftTotals();
  const active=BUDGET_CATEGORIES.filter(cat=>Number(budgetDraft.limits[cat]||0)>0||Number(bs.spentMap[cat]||0)>0);
  document.getElementById('budget-planned-income').textContent=formatBRL(budgetDraft.income);
  document.getElementById('budget-total-limit').textContent=formatBRL(totalLimit);
  document.getElementById('budget-unassigned').textContent=formatBRL(Math.abs(unassigned));
  document.getElementById('budget-total-spent').textContent=formatBRL(bs.totalSpent);
  document.getElementById('budget-total-available').textContent=formatBRL(totalLimit-bs.totalSpent);
  const freeCard=document.getElementById('budget-free-card');
  freeCard?.classList.toggle('negative',unassigned<0);
  freeCard?.classList.toggle('positive',budgetDraft.income>0&&unassigned>=0);
  const freeLabel=document.getElementById('budget-free-label');
  if(freeLabel)freeLabel.textContent=unassigned<0?'Acima da renda':'Livre';
  const bar=document.getElementById('budget-income-progress');
  if(bar)bar.style.width=`${Math.max(0,Math.min(100,distribution))}%`;
  bar?.parentElement?.classList.toggle('over',distribution>100);
  document.getElementById('budget-distribution-percent').textContent=budgetDraft.income>0?`${Math.round(distribution)}%`:'0%';
  document.getElementById('budget-distribution-text').textContent=budgetDraft.income>0?`${formatBRL(totalLimit)} planejados de ${formatBRL(budgetDraft.income)}`:'Defina sua renda para começar.';
  const status=document.getElementById('budget-status-message');
  if(status){
    if(budgetDraft.income<=0)status.textContent='Defina sua renda mensal e depois escolha os limites das categorias.';
    else if(unassigned<0)status.textContent=`Os limites estão ${formatBRL(Math.abs(unassigned))} acima da sua renda.`;
    else if(Math.abs(unassigned)<0.005)status.textContent='Toda a renda foi planejada.';
    else status.textContent=`Você ainda tem ${formatBRL(unassigned)} livre para distribuir ou guardar.`;
  }
  document.getElementById('budget-items').innerHTML=active.length?active.map(cat=>budgetCategoryRow(cat,bs)).join(''):`<div class="empty-state budget-simple-empty"><strong>Nenhuma categoria planejada</strong><span>Adicione uma categoria ou use a calibração automática.</span></div>`;
  const hint=document.getElementById('budget-save-hint');
  if(hint)hint.textContent=budgetDraftDirty?'Há alterações que ainda não foram salvas.':'Tudo salvo.';
  document.querySelector('.budget-simple-save')?.classList.toggle('dirty',budgetDraftDirty);
}
function renderBudget(){
  document.getElementById('budget-month-label').textContent=monthLabel(budgetDate);
  resetBudgetDraftFromState();
  renderBudgetDraft();
}
function openBudgetCalibration(){
  document.getElementById('budget-calibration-income').value=budgetDraft.income||'';
  setFormError('budget-calibration-error','');
  openDialog('budget-calibration-dialog');
}
function applyManualBudgetCalibration(){
  const income=Math.max(0,Number(document.getElementById('budget-calibration-income').value||0));
  budgetDraft.income=income;
  budgetDraftDirty=true;
  closeDialog('budget-calibration-dialog');
  renderBudgetDraft();
  toast('Renda atualizada na tela. Agora ajuste as categorias e salve.','success');
}
function historicalBudgetSuggestion(){
  const income=Math.max(0,Number(document.getElementById('budget-calibration-income').value||0));
  if(income<=0){setFormError('budget-calibration-error','Informe sua renda antes de pedir uma sugestão.');return}
  const prefixes=[1,2,3].map(back=>monthPrefix(addMonth(budgetDate,-back)));
  const monthTotals=Object.fromEntries(prefixes.map(prefix=>[prefix,0]));
  const categoryTotals={};
  state.transactions.filter(t=>t.affects_month_result&&Number(t.direction)<0).forEach(t=>{const prefix=String(t.occurred_on||'').slice(0,7);if(!prefixes.includes(prefix))return;const cat=BUDGET_CATEGORIES.includes(t.category)?t.category:'Outros';categoryTotals[cat]=(categoryTotals[cat]||0)+Number(t.amount||0);monthTotals[prefix]+=Number(t.amount||0)});
  state.installments.forEach(i=>{const prefix=String(i.invoice_month||'').slice(0,7);if(!prefixes.includes(prefix))return;const raw=i.ff2_card_purchases?.category||'Outros';const cat=BUDGET_CATEGORIES.includes(raw)?raw:'Outros';categoryTotals[cat]=(categoryTotals[cat]||0)+Number(i.amount||0);monthTotals[prefix]+=Number(i.amount||0)});
  const activeMonths=Object.values(monthTotals).filter(value=>value>0).length;
  if(!activeMonths){setFormError('budget-calibration-error','Ainda não há gastos suficientes nos 3 meses anteriores para montar uma sugestão.');return}
  const suggestions={};
  BUDGET_CATEGORIES.forEach(cat=>suggestions[cat]=Math.round((((categoryTotals[cat]||0)/activeMonths)*1.10)*100)/100);
  let total=Object.values(suggestions).reduce((a,b)=>a+b,0);
  if(total>income&&total>0){const factor=income/total;Object.keys(suggestions).forEach(cat=>suggestions[cat]=Math.round(suggestions[cat]*factor*100)/100)}
  budgetDraft.income=income;
  budgetDraft.limits={...budgetDraft.limits,...suggestions};
  budgetDraftDirty=true;
  closeDialog('budget-calibration-dialog');
  renderBudgetDraft();
  toast(`Sugestão baseada em ${activeMonths} ${activeMonths===1?'mês anterior':'meses anteriores'}. Revise e salve se fizer sentido.`,'success');
}
function restoreSavedBudgetDraft(){renderBudget();toast('Alterações descartadas.','success')}
function openBudgetCategoryEditor(category=''){
  const bs=currentBudgetSummary();
  const select=document.getElementById('budget-category-select');
  const original=document.getElementById('budget-category-original');
  const remove=document.getElementById('budget-category-remove');
  const title=document.getElementById('budget-category-dialog-title');
  setFormError('budget-category-error','');
  if(category){
    original.value=category;
    select.innerHTML=`<option value="${escapeHTML(category)}">${escapeHTML(category)}</option>`;
    select.disabled=true;
    title.textContent=`Editar ${category}`;
    remove.classList.remove('hidden');
  }else{
    const available=BUDGET_CATEGORIES.filter(cat=>Number(budgetDraft.limits[cat]||0)<=0&&Number(bs.spentMap[cat]||0)<=0);
    if(!available.length){toast('Todas as categorias já aparecem no orçamento.','error');return}
    original.value='';
    select.disabled=false;
    select.innerHTML=available.map(cat=>`<option value="${escapeHTML(cat)}">${escapeHTML(cat)}</option>`).join('');
    title.textContent='Adicionar categoria';
    remove.classList.add('hidden');
  }
  updateBudgetCategoryDialog();
  openDialog('budget-category-dialog');
}
function updateBudgetCategoryDialog(){
  const cat=document.getElementById('budget-category-select').value;
  const bs=currentBudgetSummary();
  document.getElementById('budget-category-spent').textContent=formatBRL(Number(bs.spentMap[cat]||0));
  document.getElementById('budget-category-limit').value=Number(budgetDraft.limits[cat]||0)||'';
}
function applyBudgetCategoryDraft(){
  const cat=document.getElementById('budget-category-select').value;
  const limit=Number(document.getElementById('budget-category-limit').value||0);
  if(!BUDGET_CATEGORIES.includes(cat)){setFormError('budget-category-error','Escolha uma categoria válida.');return}
  if(!Number.isFinite(limit)||limit<0){setFormError('budget-category-error','Informe um limite válido.');return}
  budgetDraft.limits[cat]=limit;
  budgetDraftDirty=true;
  closeDialog('budget-category-dialog');
  renderBudgetDraft();
}
function removeBudgetCategoryLimit(){
  const cat=document.getElementById('budget-category-select').value;
  if(!BUDGET_CATEGORIES.includes(cat))return;
  budgetDraft.limits[cat]=0;
  budgetDraftDirty=true;
  closeDialog('budget-category-dialog');
  renderBudgetDraft();
}
function toggleBudgetAnalysis(){
  const panel=document.getElementById('budget-analysis-panel');
  const button=document.getElementById('budget-analysis-toggle');
  const hidden=panel.classList.toggle('hidden');
  button.textContent=hidden?'Ver análise do orçamento':'Ocultar análise do orçamento';
}


function notificationIcon(type){if(String(type||'').startsWith('family_'))return 'i-users';if(type==='budget_near'||type==='budget_over')return 'i-wallet';if(type==='goal_reached')return 'i-target';if(type==='invoice_due')return 'i-card';return 'i-bell'}
function notificationActionLabel(n){if(n.type==='family_invite')return 'Ver convite';if(n.target==='family')return 'Ver Família';if(n.target==='budget')return 'Ver orçamento';if(n.target==='goals')return 'Ver meta';if(n.target==='cards')return 'Ver fatura';return 'Abrir'}
function notificationTime(value){const date=new Date(value);if(Number.isNaN(date.getTime()))return '';const diff=Math.max(0,Date.now()-date.getTime());const minutes=Math.floor(diff/60000);if(minutes<1)return 'Agora';if(minutes<60)return `Há ${minutes} min`;const hours=Math.floor(minutes/60);if(hours<24)return `Há ${hours} h`;const days=Math.floor(hours/24);if(days<7)return `Há ${days} dia${days===1?'':'s'}`;return date.toLocaleDateString('pt-BR')}
function notificationItemHTML(n){const unread=!n.read_at;return `<article class="notification-item ${unread?'unread':''}"><span class="notification-item-icon"><svg class="ui-icon" aria-hidden="true"><use href="#${notificationIcon(n.type)}"></use></svg></span><div class="notification-item-main"><div class="notification-item-title">${unread?'<span class="notification-dot" aria-hidden="true"></span>':''}<span>${escapeHTML(n.title||'Notificação')}</span></div>${n.body?`<div class="notification-item-body">${escapeHTML(n.body)}</div>`:''}<div class="notification-item-meta">${escapeHTML(notificationTime(n.created_at))}</div></div><button class="notification-item-action" type="button" data-notification-open="${n.id}">${escapeHTML(notificationActionLabel(n))}</button></article>`}
function renderNotifications(){const rows=state.notifications||[];const unread=rows.filter(n=>!n.read_at).length;const badge=document.getElementById('notification-badge');if(badge){badge.textContent=unread>99?'99+':String(unread);badge.classList.toggle('hidden',unread===0)}const caption=document.getElementById('notification-popover-caption');if(caption)caption.textContent=unread?`${unread} não lida${unread===1?'':'s'}`:'Nenhuma não lida';const preview=document.getElementById('notification-preview-list');if(preview)preview.innerHTML=rows.length?rows.slice(0,6).map(notificationItemHTML).join(''):'<div class="notification-empty">Nenhuma notificação por enquanto.</div>';const history=document.getElementById('notification-history-list');if(history)history.innerHTML=rows.length?rows.map(notificationItemHTML).join(''):'<div class="notification-empty">Seu histórico de notificações está vazio.</div>';const center=document.getElementById('notification-center-caption');if(center)center.textContent=`${rows.length} notificação${rows.length===1?'':'ões'} · ${unread} não lida${unread===1?'':'s'}`;document.getElementById('notification-mark-all')?.toggleAttribute('disabled',unread===0);document.getElementById('notification-center-mark-all')?.toggleAttribute('disabled',unread===0)}
function setNotificationPopover(open){const pop=document.getElementById('notification-popover'),bell=document.getElementById('notification-bell');if(!pop||!bell)return;pop.classList.toggle('hidden',!open);bell.setAttribute('aria-expanded',open?'true':'false')}
async function openNotification(id){const item=(state.notifications||[]).find(n=>n.id===id);if(!item)return;if(!item.read_at){await markNotificationRead(item.id);item.read_at=new Date().toISOString();renderNotifications()}setNotificationPopover(false);closeDialog('notification-center-dialog');if(item.target==='family'){showModule('family');setTimeout(()=>document.getElementById('family-incoming')?.scrollIntoView({behavior:'smooth',block:'center'}),60);return}if(item.target==='budget'){showModule('budget');return}if(item.target==='goals'){showModule('goals');return}if(item.target==='cards'){showModule('cards');if(item.type==='invoice_due'&&item.target_id)setTimeout(()=>openInvoice(item.target_id),60);return}}
async function markAllNotifications(){if(!(state.notifications||[]).some(n=>!n.read_at))return;await markAllNotificationsRead();const now=new Date().toISOString();state.notifications.forEach(n=>{if(!n.read_at)n.read_at=now});renderNotifications()}

function familyProfile(id){return state.family?.profiles?.find(x=>x.user_id===id)||null}
function familyProfileName(id){const p=familyProfile(id);return p?.display_name||p?.username||'Membro da família'}
function familyProfileUsername(id){return familyProfile(id)?.username||''}
function permissionTags(link){const items=[['transactions','Lançamentos',link.can_view_transactions],['cards','Cartões',link.can_view_cards],['goals','Metas',link.can_view_goals],['budget','Orçamento',link.can_view_budget]];return `<div class="permission-tags">${items.map(([,label,on])=>`<span class="permission-tag ${on?'on':''}">${label}</span>`).join('')}</div>`}
function familyPersonHTML({name,subtitle='',actions='',tags=''}){const initial=escapeHTML(String(name||'F').trim().charAt(0).toUpperCase()||'F');return `<div class="family-person"><div class="family-avatar">${initial}</div><div class="family-person-main"><strong>${escapeHTML(name||'Família')}</strong><small>${escapeHTML(subtitle)}</small>${tags}</div><div class="family-actions">${actions}</div></div>`}
function renderFamily(){const data=state.family;if(!data)return;const me=data.user.id;const incoming=data.invites.filter(i=>i.status==='pending'&&i.inviter_user_id!==me);const outgoing=data.invites.filter(i=>i.status==='pending'&&i.inviter_user_id===me);const viewing=data.links.filter(l=>l.active&&l.viewer_user_id===me);const viewers=data.links.filter(l=>l.active&&l.owner_user_id===me);
  document.getElementById('family-incoming').innerHTML=incoming.length?incoming.map(i=>familyPersonHTML({name:familyProfileName(i.inviter_user_id),subtitle:`@${familyProfileUsername(i.inviter_user_id)} quer compartilhar o financeiro com você`,actions:`<button class="mini-btn" data-family-respond="${i.id}" data-accept="1">Aceitar</button><button class="mini-btn danger" data-family-respond="${i.id}" data-accept="0">Recusar</button>`})).join(''):emptyState('Nenhum convite pendente.');
  document.getElementById('family-viewing').innerHTML=viewing.length?viewing.map(l=>familyPersonHTML({name:familyProfileName(l.owner_user_id),subtitle:`@${familyProfileUsername(l.owner_user_id)} · acesso autorizado`,tags:permissionTags(l),actions:`<button class="mini-btn" data-family-monitor="${l.owner_user_id}">Visualizar</button><button class="mini-btn danger" data-family-remove="${l.id}">Sair</button>`})).join(''):emptyState('Você ainda não acompanha ninguém.');
  document.getElementById('family-viewers').innerHTML=viewers.length?viewers.map(l=>familyPersonHTML({name:familyProfileName(l.viewer_user_id),subtitle:`@${familyProfileUsername(l.viewer_user_id)} · pode acompanhar os grupos autorizados`,tags:permissionTags(l),actions:`<button class="mini-btn" data-family-permissions="${l.id}">Permissões</button><button class="mini-btn danger" data-family-remove="${l.id}">Remover</button>`})).join(''):emptyState('Ninguém acompanha seus dados atualmente.');
  document.getElementById('family-outgoing').innerHTML=outgoing.length?outgoing.map(i=>familyPersonHTML({name:familyProfileName(i.invitee_user_id),subtitle:`@${familyProfileUsername(i.invitee_user_id)} · convite enviado`,actions:`<button class="mini-btn danger" data-family-cancel-invite="${i.id}">Cancelar</button>`})).join(''):emptyState('Nenhum convite enviado aguardando resposta.');
}
function renderSettings(){if(!currentProfile)return;const usernameInput=document.getElementById('settings-username');if(usernameInput)usernameInput.value=currentProfile.username||'';const nameInput=document.getElementById('settings-display-name');if(nameInput&&document.activeElement!==nameInput)nameInput.value=currentProfile.display_name||'';applyTheme(currentProfile.theme||'system');const status=state.migration||{claimed:false};const pill=document.getElementById('migration-status-pill'),form=document.getElementById('legacy-migration-form'),done=document.getElementById('migration-complete');if(status.claimed){pill.textContent='Migrado';pill.classList.add('ok');form.classList.add('hidden');done.classList.remove('hidden');done.textContent=`Dados antigos vinculados ao usuário “${status.legacy_username}”. O backup legado permanece preservado.`}else{pill.textContent='Não migrado';pill.classList.remove('ok');form.classList.remove('hidden');done.classList.add('hidden')}}

async function openFamilyMonitor(ownerId){
  const link=state.family?.links?.find(l=>l.owner_user_id===ownerId&&l.viewer_user_id===currentUser?.id&&l.active);if(!link)return;
  await runAppOperation('Carregando dados da família…','Buscando somente as informações que foram compartilhadas com você.',async()=>{
    const data=await loadFamilyOverview(ownerId,dashboardDate);const name=familyProfileName(ownerId);document.getElementById('family-monitor-name').textContent=name;const tx=data.transactions||[];const month=monthPrefix(dashboardDate);const today=localISO();let balance=0,income=0,expense=0;tx.forEach(t=>{const signed=Number(t.direction)*Number(t.amount||0);if(t.occurred_on<=today)balance+=signed;if(String(t.occurred_on).startsWith(month)&&t.affects_month_result){if(signed>=0)income+=signed;else expense+=Math.abs(signed)}});const cardMonth=(data.installments||[]).reduce((a,b)=>a+Number(b.amount||0),0);const budgetLimit=(data.budget?.items||[]).reduce((a,b)=>a+Number(b.limit_amount||0),0);const metrics=[];if(link.can_view_transactions)metrics.push(['Saldo',formatBRL(balance)],['Receitas',formatBRL(income)],['Despesas',formatBRL(expense)]);if(link.can_view_cards)metrics.push(['Cartão no mês',formatBRL(cardMonth)]);if(link.can_view_goals)metrics.push(['Metas ativas',String((data.goals||[]).filter(g=>g.status!=='completed').length)]);if(link.can_view_budget)metrics.push(['Orçamento',formatBRL(budgetLimit)]);document.getElementById('family-monitor-metrics').innerHTML=metrics.length?metrics.map(([label,value])=>`<article class="metric-card"><span>${escapeHTML(label)}</span><strong>${escapeHTML(value)}</strong></article>`).join(''):emptyState('Nenhum grupo foi compartilhado.');document.getElementById('family-monitor-transactions').innerHTML=link.can_view_transactions&&tx.length?tx.slice(0,6).map(t=>`<div class="list-row"><div class="list-row-main"><div class="list-row-title">${escapeHTML(t.description)}</div><div class="list-row-meta"><span>${formatDate(t.occurred_on)}</span><span>${escapeHTML(t.category||'Outros')}</span></div></div><div class="list-row-amount ${Number(t.direction)>0?'positive':'negative'}">${formatBRL(Number(t.amount||0))}</div></div>`).join(''):emptyState(link.can_view_transactions?'Nenhum lançamento.':'Lançamentos não compartilhados.');document.getElementById('family-monitor-goals').innerHTML=link.can_view_goals&&data.goals?.length?data.goals.slice(0,5).map(goalMiniHTML).join(''):emptyState(link.can_view_goals?'Nenhuma meta.':'Metas não compartilhadas.');document.getElementById('family-monitor-panel').classList.remove('hidden');document.getElementById('family-monitor-panel').scrollIntoView({behavior:'smooth',block:'start'});
  }).catch(e=>{console.error(e);toast('Não foi possível abrir os dados familiares.','error')});
}
function openFamilyPermissions(linkId){const link=state.family?.links?.find(l=>l.id===linkId&&l.owner_user_id===currentUser?.id);if(!link)return;document.getElementById('family-link-id').value=link.id;document.getElementById('family-permissions-title').textContent=familyProfileName(link.viewer_user_id);document.getElementById('perm-transactions').checked=!!link.can_view_transactions;document.getElementById('perm-cards').checked=!!link.can_view_cards;document.getElementById('perm-goals').checked=!!link.can_view_goals;document.getElementById('perm-budget').checked=!!link.can_view_budget;setFormError('family-permissions-error','');openDialog('family-permissions-dialog')}


function openNewTransaction(){document.getElementById('transaction-form').reset();document.getElementById('transaction-id').value='';document.getElementById('transaction-dialog-title').textContent='Novo lançamento';document.getElementById('transaction-date').value=localISO();document.getElementById('transaction-recurring-count').value='12';document.getElementById('recurring-fields').classList.remove('hidden');document.getElementById('recurring-count-wrap').classList.add('hidden');setFormError('transaction-form-error','');openDialog('transaction-dialog')}
function openEditTransaction(id){const t=state.transactions.find(x=>x.id===id);if(!t||t.type==='balance_adjustment')return;document.getElementById('transaction-form').reset();document.getElementById('transaction-id').value=t.id;document.getElementById('transaction-dialog-title').textContent='Editar lançamento';document.getElementById('transaction-direction').value=String(t.direction);document.getElementById('transaction-description').value=t.description||'';document.getElementById('transaction-amount').value=Number(t.amount);document.getElementById('transaction-date').value=t.occurred_on;document.getElementById('transaction-category').value=t.category||'Outros';document.getElementById('transaction-notes').value=t.notes||'';document.getElementById('recurring-fields').classList.add('hidden');setFormError('transaction-form-error','');openDialog('transaction-dialog')}
function openBalance(){const cash=calculateCashStats(state.transactions,dashboardDate);document.getElementById('balance-form').reset();document.getElementById('balance-dialog-current').textContent=formatBRL(cash.balance);document.getElementById('balance-date').value=localISO();setFormError('balance-form-error','');openDialog('balance-dialog')}
function openNewCard(){document.getElementById('card-form').reset();document.getElementById('card-id').value='';document.getElementById('card-interest').value='0';document.getElementById('card-dialog-title').textContent='Novo cartão';setFormError('card-form-error','');openDialog('card-dialog')}
function openEditCard(id){const c=state.cards.find(x=>x.id===id);if(!c)return;document.getElementById('card-id').value=c.id;document.getElementById('card-name').value=c.name;document.getElementById('card-limit').value=Number(c.credit_limit);document.getElementById('card-closing').value=c.closing_day;document.getElementById('card-due').value=c.due_day;document.getElementById('card-interest').value=Number(c.revolving_interest||0);document.getElementById('card-dialog-title').textContent='Editar cartão';setFormError('card-form-error','');openDialog('card-dialog')}
function openNewPurchase(cardId){document.getElementById('purchase-form').reset();document.getElementById('purchase-id').value='';document.getElementById('purchase-card-id').value=cardId;document.getElementById('purchase-installments').value='1';document.getElementById('purchase-date').value=localISO();document.getElementById('purchase-dialog-title').textContent=`Nova compra — ${state.cards.find(c=>c.id===cardId)?.name||'Cartão'}`;setFormError('purchase-form-error','');openDialog('purchase-dialog')}
function openEditPurchase(id){const p=state.purchases.find(x=>x.id===id);if(!p)return;document.getElementById('purchase-id').value=p.id;document.getElementById('purchase-card-id').value=p.card_id;document.getElementById('purchase-description').value=p.description;document.getElementById('purchase-total').value=Number(p.total_amount);document.getElementById('purchase-installments').value=p.installment_count;document.getElementById('purchase-date').value=p.purchase_date;document.getElementById('purchase-category').value=p.category||'Outros';document.getElementById('purchase-dialog-title').textContent='Editar compra';setFormError('purchase-form-error','');openDialog('purchase-dialog')}
function openNewGoal(){document.getElementById('goal-form').reset();document.getElementById('goal-id').value='';document.getElementById('goal-saved').value='0';document.getElementById('goal-dialog-title').textContent='Nova meta';setFormError('goal-form-error','');openDialog('goal-dialog')}
function openEditGoal(id){const g=state.goals.find(x=>x.id===id);if(!g)return;document.getElementById('goal-id').value=g.id;document.getElementById('goal-name').value=g.name;document.getElementById('goal-target').value=Number(g.target_amount);document.getElementById('goal-saved').value=Number(g.saved_amount);document.getElementById('goal-due').value=g.due_date||'';document.getElementById('goal-dialog-title').textContent='Editar meta';setFormError('goal-form-error','');openDialog('goal-dialog')}

function openInvoice(cardId){const card=state.cards.find(c=>c.id===cardId);if(!card)return;const summaries=cardInvoiceSummaries(state.cards,state.installments,state.invoiceStatuses,dashboardDate);const summary=summaries.find(s=>s.card.id===cardId);document.getElementById('invoice-title').textContent=`${card.name} — ${monthLabel(dashboardDate)}`;document.getElementById('invoice-content').innerHTML=`<div class="invoice-headline"><div><span class="muted">Fatura</span><strong>${formatBRL(summary.total)}</strong><small>Vencimento ${summary.dueDate.toLocaleDateString('pt-BR')}</small></div><button class="${summary.status==='paid'?'secondary-btn':'primary-compact'}" data-toggle-invoice="${cardId}" data-invoice-paid="${summary.status==='paid'?'1':'0'}">${summary.status==='paid'?'Reabrir fatura':'Marcar como paga'}</button></div><div class="invoice-installments">${summary.rows.length?summary.rows.map(r=>`<div class="invoice-row"><div><strong>${escapeHTML(r.ff2_card_purchases?.description||'Compra')}</strong><div class="muted">Parcela ${r.installment_no}/${r.ff2_card_purchases?.installment_count||'?'}</div></div><strong>${formatBRL(r.amount)}</strong></div>`).join(''):emptyState('Nenhuma parcela nesta fatura.')}</div>`;openDialog('invoice-dialog')}

function reportDateOrFallback(refDate, fallbackDate) {
  if (refDate instanceof Date && !Number.isNaN(refDate.getTime())) return new Date(refDate.getFullYear(), refDate.getMonth(), 1, 12);
  return new Date(fallbackDate.getFullYear(), fallbackDate.getMonth(), 1, 12);
}
function openDRE(refDate) {
  const date = reportDateOrFallback(refDate, dashboardDate);
  const d = getMonthlyDRE(state.transactions, state.installments, date);
  document.getElementById('dre-title').textContent = `DRE — ${monthLabel(date)}`;
  document.getElementById('dre-content').innerHTML = `<div class="dre-grid"><div class="dre-line"><span>Receitas</span><strong class="positive">${formatBRL(d.income)}</strong></div><div class="dre-line"><span>Despesas à vista</span><strong class="negative">${formatBRL(d.cashExpense)}</strong></div><div class="dre-line"><span>Compras no cartão</span><strong class="negative">${formatBRL(d.cardExpense)}</strong></div><div class="dre-line"><span>Despesas totais</span><strong>${formatBRL(d.totalExpense)}</strong></div><div class="dre-line total"><span>Resultado</span><strong class="${d.result >= 0 ? 'positive' : 'negative'}">${formatBRL(d.result)}</strong></div><p class="muted" style="margin:8px 12px 0">Ajustes de saldo e pagamentos de fatura não entram novamente no resultado mensal.</p></div>`;
  openDialog('dre-dialog');
}
function reportMonthKey(date) {
  const ref=reportDateOrFallback(date,dashboardDate);
  return `${ref.getFullYear()}-${String(ref.getMonth()+1).padStart(2,'0')}-01`;
}
function reportDateFromKey(key) {
  const [year,month]=String(key||'').slice(0,7).split('-').map(Number);
  return new Date(year,(month||1)-1,1,12);
}
function reportDataMonthKeys() {
  const keys=new Set();
  const today=localISO();
  state.transactions.forEach(row=>{const raw=String(row.occurred_on||'');if(row?.affects_month_result===true&&raw<=today&&/^\d{4}-\d{2}/.test(raw))keys.add(`${raw.slice(0,7)}-01`)});
  state.installments.forEach(row=>{const raw=String(row.invoice_month||'');const purchaseDate=String(row.ff2_card_purchases?.purchase_date||'');if(/^\d{4}-\d{2}-01$/.test(raw)&&(!purchaseDate||purchaseDate<=today))keys.add(raw)});
  return keys;
}
function selectedReportMonthKeys() {
  return [...document.querySelectorAll('#report-month-list input[data-report-month]:checked')].map(input=>input.dataset.reportMonth).sort();
}
function updateReportSelectionSummary() {
  const keys=selectedReportMonthKeys();
  const summary=document.getElementById('report-selection-summary');
  const detail=document.getElementById('report-selection-detail');
  if(!keys.length){summary.textContent='Nenhum mês selecionado';detail.textContent='Marque pelo menos um mês para gerar o relatório.';return}
  summary.textContent=`${keys.length} ${keys.length===1?'mês selecionado':'meses selecionados'}`;
  const labels=keys.map(key=>monthLabel(reportDateFromKey(key)));
  detail.textContent=labels.length<=4?labels.join(' • '):`${labels.slice(0,3).join(' • ')} • +${labels.length-3}`;
}
function renderReportMonthSelector(defaultDate=dashboardDate) {
  reportReferenceDate=reportDateOrFallback(defaultDate,dashboardDate);
  const options=getReportMonthOptions(state.transactions,state.installments,reportReferenceDate);
  const selectedKey=reportMonthKey(reportReferenceDate);
  document.getElementById('report-month-list').innerHTML=options.map(option=>`<label class="report-month-option"><input type="checkbox" data-report-month="${option.key}" ${option.key===selectedKey?'checked':''}><span>${escapeHTML(monthLabel(option.date))}</span></label>`).join('');
  setFormError('report-form-error','');
  updateReportSelectionSummary();
}
function applyReportPreset(preset) {
  const inputs=[...document.querySelectorAll('#report-month-list input[data-report-month]')];
  const wanted=new Set();
  if(preset==='current') wanted.add(reportMonthKey(reportReferenceDate));
  else if(preset==='3'||preset==='6'){
    const count=Number(preset);for(let i=0;i<count;i+=1)wanted.add(reportMonthKey(addMonth(reportReferenceDate,-i)));
  } else if(preset==='all') {
    const dataKeys=reportDataMonthKeys();dataKeys.forEach(key=>wanted.add(key));if(!wanted.size)wanted.add(reportMonthKey(reportReferenceDate));
  }
  inputs.forEach(input=>{input.checked=preset==='none'?false:wanted.has(input.dataset.reportMonth)});
  setFormError('report-form-error','');
  updateReportSelectionSummary();
}
function openReportBuilder(refDate) {
  renderReportMonthSelector(reportDateOrFallback(refDate,dashboardDate));
  openDialog('report-dialog');
}
async function generateSelectedReport() {
  const monthKeys=selectedReportMonthKeys();
  if(!monthKeys.length){setFormError('report-form-error','Selecione pelo menos um mês.');return}
  setFormError('report-form-error','');
  try{
    await runAppOperation('Gerando relatório…',`Consolidando os gastos reais de ${monthKeys.length} ${monthKeys.length===1?'mês':'meses'}.`,async()=>{
      const budgetEntries=await Promise.all(monthKeys.map(async key=>[key,await getBudget(reportDateFromKey(key))]));
      const budgetsByMonth=Object.fromEntries(budgetEntries);
      const model=downloadFinancialReportPDF({
        transactions:state.transactions,
        installments:state.installments,
        invoiceStatuses:state.invoiceStatuses,
        budgetsByMonth,
        monthKeys,
        formatDate,
        formatBRL,
        monthLabel
      });
      closeDialog('report-dialog');
      toast(`Relatório financeiro gerado com ${model.months.length} ${model.months.length===1?'mês':'meses'}.`,'success');
    });
  }catch(error){console.error('Falha ao gerar relatório financeiro:',error);setFormError('report-form-error',error?.message||'Não foi possível gerar o relatório.');toast('Não foi possível gerar o relatório PDF.','error')}
}

async function onTransactionSubmit(event){event.preventDefault();const btn=document.getElementById('transaction-save-btn');setButtonBusy(btn,true);setFormError('transaction-form-error','');try{const id=document.getElementById('transaction-id').value;const input={direction:Number(document.getElementById('transaction-direction').value),description:document.getElementById('transaction-description').value,amount:Number(document.getElementById('transaction-amount').value),date:document.getElementById('transaction-date').value,category:document.getElementById('transaction-category').value,notes:document.getElementById('transaction-notes').value,recurring:document.getElementById('transaction-recurring').checked,recurringCount:Number(document.getElementById('transaction-recurring-count').value)};if(!input.description.trim()||!input.date||input.amount<=0)throw new Error('Preencha descrição, data e um valor maior que zero.');await runAppOperation(id?'Atualizando lançamento…':'Salvando lançamento…',input.recurring&&!id?'Criando a série recorrente e protegendo contra envios repetidos.':'Registrando a alteração no seu histórico financeiro.',async()=>{if(id)await updateTransaction(id,input);else await createTransaction(input);closeDialog('transaction-dialog');toast(id?'Lançamento atualizado.':'Lançamento salvo.','success');syncOperationMessage('Conferindo o histórico completo após a alteração.');await refreshAll()})}catch(e){console.error(e);setFormError('transaction-form-error',e.message||'Não foi possível salvar.')}finally{setButtonBusy(btn,false)}}
async function onBalanceSubmit(event){event.preventDefault();const btn=document.getElementById('balance-save-btn');setButtonBusy(btn,true);setFormError('balance-form-error','');try{const input={mode:document.getElementById('balance-mode').value,amount:Number(document.getElementById('balance-amount').value),reason:document.getElementById('balance-reason').value,date:document.getElementById('balance-date').value};if(input.amount<0||!input.reason.trim()||!input.date)throw new Error('Informe valor, motivo e data.');await runAppOperation('Ajustando saldo…','Registrando o ajuste sem duplicar o resultado mensal.',async()=>{await applyBalanceAdjustment(input);closeDialog('balance-dialog');toast('Saldo ajustado.','success');syncOperationMessage();await refreshAll()})}catch(e){console.error(e);setFormError('balance-form-error',e.message||'Não foi possível ajustar o saldo.')}finally{setButtonBusy(btn,false)}}
async function onCardSubmit(event){event.preventDefault();const btn=document.getElementById('card-save-btn');setButtonBusy(btn,true);setFormError('card-form-error','');try{const id=document.getElementById('card-id').value;const input={name:document.getElementById('card-name').value,limit:Number(document.getElementById('card-limit').value),closingDay:Number(document.getElementById('card-closing').value),dueDay:Number(document.getElementById('card-due').value),interest:Number(document.getElementById('card-interest').value||0)};if(!input.name.trim()||input.limit<0||input.closingDay<1||input.closingDay>31||input.dueDay<1||input.dueDay>31)throw new Error('Revise nome, limite, fechamento e vencimento.');await runAppOperation(id?'Atualizando cartão…':'Criando cartão…','Salvando limite, fechamento e vencimento.',async()=>{if(id)await updateCard(id,input);else await createCard(input);closeDialog('card-dialog');toast(id?'Cartão atualizado.':'Cartão criado.','success');syncOperationMessage();await refreshAll()})}catch(e){console.error(e);setFormError('card-form-error',e.message||'Não foi possível salvar o cartão.')}finally{setButtonBusy(btn,false)}}
async function onPurchaseSubmit(event){event.preventDefault();const btn=document.getElementById('purchase-save-btn');setButtonBusy(btn,true);setFormError('purchase-form-error','');try{const id=document.getElementById('purchase-id').value;const input={cardId:document.getElementById('purchase-card-id').value,description:document.getElementById('purchase-description').value,total:Number(document.getElementById('purchase-total').value),installments:Number(document.getElementById('purchase-installments').value),date:document.getElementById('purchase-date').value,category:document.getElementById('purchase-category').value};if(!input.description.trim()||input.total<=0||!input.date||input.installments<1||input.installments>60)throw new Error('Revise descrição, valor, data e parcelas.');await runAppOperation(id?'Atualizando compra…':'Salvando compra…',input.installments>1?'Gerando as parcelas e vinculando-as às faturas corretas.':'Registrando a compra no cartão.',async()=>{if(id)await updatePurchase(id,input);else await createPurchase(input);closeDialog('purchase-dialog');toast(id?'Compra atualizada.':'Compra salva e parcelas geradas.','success');syncOperationMessage();await refreshAll()})}catch(e){console.error(e);setFormError('purchase-form-error',e.message||'Não foi possível salvar a compra.')}finally{setButtonBusy(btn,false)}}
async function onGoalSubmit(event){event.preventDefault();const btn=document.getElementById('goal-save-btn');setButtonBusy(btn,true);setFormError('goal-form-error','');try{const id=document.getElementById('goal-id').value;const input={name:document.getElementById('goal-name').value,target:Number(document.getElementById('goal-target').value),saved:Number(document.getElementById('goal-saved').value||0),dueDate:document.getElementById('goal-due').value};if(!input.name.trim()||input.target<=0||input.saved<0)throw new Error('Revise nome e valores da meta.');await runAppOperation(id?'Atualizando meta…':'Criando meta…','Salvando valores e progresso da meta.',async()=>{if(id)await updateGoal(id,input);else await createGoal(input);closeDialog('goal-dialog');toast(id?'Meta atualizada.':'Meta criada.','success');syncOperationMessage();await refreshAll()})}catch(e){console.error(e);setFormError('goal-form-error',e.message||'Não foi possível salvar a meta.')}finally{setButtonBusy(btn,false)}}
async function onBudgetSave(){
  const btn=document.getElementById('save-budget-btn');setButtonBusy(btn,true);
  try{
    const limits=Object.fromEntries(BUDGET_CATEGORIES.map(cat=>[cat,Math.max(0,Number(budgetDraft.limits[cat]||0))]));
    await runAppOperation('Salvando orçamento…','Atualizando a renda planejada e os limites do mês.',async()=>{
      state.budget=await saveBudget(budgetDate,Math.max(0,Number(budgetDraft.income||0)),limits);
      toast('Orçamento salvo.','success');renderBudget();renderHome();
    });
  }catch(e){console.error(e);toast(e.message||'Não foi possível salvar o orçamento.','error')}finally{setButtonBusy(btn,false)}
}
async function onFamilyInviteSubmit(event){event.preventDefault();const btn=document.getElementById('family-invite-save');setButtonBusy(btn,true,'Enviando…');setFormError('family-invite-error','');try{await runAppOperation('Enviando convite…','Localizando o usuário e registrando o convite familiar.',async()=>{await sendFamilyInvite(document.getElementById('family-invite-username').value);closeDialog('family-invite-dialog');toast('Convite enviado.','success');syncOperationMessage('Atualizando os vínculos e convites familiares.');await refreshAll()})}catch(e){console.error(e);setFormError('family-invite-error',e.message||'Não foi possível enviar o convite.')}finally{setButtonBusy(btn,false)}}
async function onFamilyPermissionsSubmit(event){event.preventDefault();const btn=document.getElementById('family-permissions-save');setButtonBusy(btn,true);setFormError('family-permissions-error','');try{await runAppOperation('Salvando permissões…','Atualizando exatamente quais grupos financeiros podem ser visualizados.',async()=>{await updateFamilyPermissions(document.getElementById('family-link-id').value,{transactions:document.getElementById('perm-transactions').checked,cards:document.getElementById('perm-cards').checked,goals:document.getElementById('perm-goals').checked,budget:document.getElementById('perm-budget').checked});closeDialog('family-permissions-dialog');toast('Permissões atualizadas.','success');syncOperationMessage('Atualizando os vínculos familiares.');await refreshAll()})}catch(e){console.error(e);setFormError('family-permissions-error',e.message||'Não foi possível salvar as permissões.')}finally{setButtonBusy(btn,false)}}
async function onProfileSettingsSubmit(event){event.preventDefault();const btn=document.getElementById('save-profile-settings-btn');setButtonBusy(btn,true);try{await runAppOperation('Salvando perfil…','Atualizando suas informações de exibição.',async()=>{currentProfile=await updateProfileSettings({displayName:document.getElementById('settings-display-name').value});showApp(currentUser,currentProfile);toast('Nome atualizado.','success');renderSettings()})}catch(e){console.error(e);toast('Não foi possível atualizar o perfil.','error')}finally{setButtonBusy(btn,false)}}
async function onLegacyMigrationSubmit(event){event.preventDefault();const btn=document.getElementById('legacy-migration-btn');setButtonBusy(btn,true,'Migrando…');setFormError('migration-error','');try{await runAppOperation('Migrando dados antigos…','Validando sua conta antiga e copiando os dados com segurança. Esta etapa pode levar alguns segundos.',async()=>{const result=await claimLegacyAccount(document.getElementById('legacy-username').value,document.getElementById('legacy-password').value);document.getElementById('legacy-password').value='';currentProfile=await ensureProfile(currentUser);showApp(currentUser,currentProfile);toast(`Migração concluída: ${result.transactions||0} lançamentos e ${result.goals||0} metas importados.`,'success');syncOperationMessage('Conferindo os dados migrados e reconstruindo a visão financeira.');await refreshAll()})}catch(e){console.error(e);setFormError('migration-error',e.message||'Não foi possível migrar os dados.')}finally{setButtonBusy(btn,false)}}
async function handleDynamicClick(event){const target=event.target.closest('button');if(!target||appActionBusy)return;try{
  if(target.dataset.notificationOpen)return await openNotification(target.dataset.notificationOpen);
  if(target.dataset.familyRespond)return await runAppOperation(target.dataset.accept==='1'?'Aceitando convite…':'Recusando convite…','Atualizando o vínculo familiar.',async()=>{const inviteId=target.dataset.familyRespond;await respondFamilyInvite(inviteId,target.dataset.accept==='1');await markNotificationsForTarget('family',inviteId).catch(()=>{});toast(target.dataset.accept==='1'?'Convite aceito.':'Convite recusado.','success');syncOperationMessage('Atualizando a área Família.');await refreshAll()});
  if(target.dataset.familyCancelInvite)return await runAppOperation('Cancelando convite…','Removendo o convite pendente.',async()=>{await cancelFamilyInvite(target.dataset.familyCancelInvite);toast('Convite cancelado.','success');syncOperationMessage('Atualizando a área Família.');await refreshAll()});
  if(target.dataset.familyPermissions)return openFamilyPermissions(target.dataset.familyPermissions);
  if(target.dataset.familyMonitor)return openFamilyMonitor(target.dataset.familyMonitor);
  if(target.dataset.familyRemove){if(!confirm('Remover este vínculo familiar?'))return;return await runAppOperation('Removendo vínculo…','Atualizando o acesso familiar com segurança.',async()=>{await removeFamilyLink(target.dataset.familyRemove);toast('Vínculo removido.','success');document.getElementById('family-monitor-panel').classList.add('hidden');syncOperationMessage('Atualizando a área Família.');await refreshAll()})}

  if(target.dataset.editTransaction)return openEditTransaction(target.dataset.editTransaction);
  if(target.dataset.deleteTransaction){const id=target.dataset.deleteTransaction;const t=state.transactions.find(x=>x.id===id);const series=!!t?.recurring_group_id;let removeSeries=false;if(series){removeSeries=confirm('Este lançamento é recorrente. OK = excluir toda a série. Cancelar = escolher apenas esta ocorrência.');if(!removeSeries&&!confirm('Excluir somente esta ocorrência?'))return;}else if(!confirm('Excluir este lançamento?'))return;return await runAppOperation(removeSeries?'Excluindo série…':'Excluindo lançamento…',removeSeries?'Removendo todas as ocorrências desta série recorrente.':'Removendo o lançamento selecionado.',async()=>{await deleteTransaction(id,removeSeries);toast('Lançamento excluído.','success');syncOperationMessage('Conferindo o histórico completo após a exclusão.');await refreshAll()})}
  if(target.dataset.editCard)return openEditCard(target.dataset.editCard);
  if(target.dataset.deleteCard){if(!confirm('Excluir o cartão e todas as compras/parcelas vinculadas?'))return;return await runAppOperation('Excluindo cartão…','Removendo o cartão e os registros vinculados.',async()=>{await deleteCard(target.dataset.deleteCard);toast('Cartão excluído.','success');syncOperationMessage();await refreshAll()})}
  if(target.dataset.newPurchase)return openNewPurchase(target.dataset.newPurchase);
  if(target.dataset.editPurchase)return openEditPurchase(target.dataset.editPurchase);
  if(target.dataset.deletePurchase){if(!confirm('Excluir esta compra e suas parcelas?'))return;return await runAppOperation('Excluindo compra…','Removendo a compra e as parcelas vinculadas.',async()=>{await deletePurchase(target.dataset.deletePurchase);toast('Compra excluída.','success');syncOperationMessage();await refreshAll()})}
  if(target.dataset.openInvoice)return openInvoice(target.dataset.openInvoice);
  if(target.dataset.toggleInvoice){const cardId=target.dataset.toggleInvoice;const paid=target.dataset.invoicePaid==='1';await runAppOperation(!paid?'Confirmando pagamento…':'Reabrindo fatura…',!paid?'Registrando o pagamento da fatura sem duplicar despesas.':'Revertendo o status de pagamento da fatura.',async()=>{await setInvoicePaid(cardId,`${dashboardDate.getFullYear()}-${String(dashboardDate.getMonth()+1).padStart(2,'0')}-01`,!paid);toast(!paid?'Fatura marcada como paga.':'Fatura reaberta.','success');closeDialog('invoice-dialog');syncOperationMessage();await refreshAll()});return openInvoice(cardId)}
  if(target.dataset.budgetEdit)return openBudgetCategoryEditor(target.dataset.budgetEdit);
  if(target.dataset.editGoal)return openEditGoal(target.dataset.editGoal);
  if(target.dataset.deleteGoal){if(!confirm('Excluir esta meta?'))return;return await runAppOperation('Excluindo meta…','Removendo a meta selecionada.',async()=>{await deleteGoal(target.dataset.deleteGoal);toast('Meta excluída.','success');syncOperationMessage();await refreshAll()})}
  if(target.dataset.goModule)return showModule(target.dataset.goModule);
}catch(e){console.error(e);toast(e.message||'Não foi possível concluir a ação.','error')}}
function bindUI(){setAuthMode(authMode);fillCategorySelect('transaction-category');fillCategorySelect('purchase-category');document.getElementById('transaction-filter-month').value='';document.getElementById('app-loading-dialog')?.addEventListener('cancel',event=>event.preventDefault());
  document.getElementById('auth-toggle').addEventListener('click',()=>{if(authBusy)return;authMode=authMode==='login'?'register':'login';setAuthError('');setAuthMode(authMode)});
  document.getElementById('auth-form').addEventListener('submit',async event=>{event.preventDefault();if(authBusy)return;setAuthError('');const username=document.getElementById('username').value.trim().toLowerCase(),password=document.getElementById('password').value;if(!username||!password)return setAuthError('Informe usuário e senha.');if(!/^[a-z0-9._-]{3,24}$/.test(username))return setAuthError('O usuário deve ter de 3 a 24 caracteres: letras minúsculas, números, ponto, hífen ou underline.');if(password.length<6)return setAuthError('A senha precisa ter pelo menos 6 caracteres.');authBusy=true;setAuthBusy(true,authMode,'auth');try{const submittedMode=authMode;const {data,error}=submittedMode==='register'?await signUp(username,password):await signIn(username,password);if(error)throw error;setAuthBusy(true,submittedMode,'data');await enterApp(data.session);if(submittedMode==='register')toast('Conta criada com sucesso.','success')}catch(error){console.error(error);setAuthError(error?.message||'Não foi possível autenticar.')}finally{authBusy=false;setAuthBusy(false,authMode)}});
  document.querySelectorAll('.nav-item[data-module]').forEach(b=>b.addEventListener('click',()=>showModule(b.dataset.module)));document.querySelectorAll('[data-close-dialog]').forEach(b=>b.addEventListener('click',()=>closeDialog(b.dataset.closeDialog)));document.querySelectorAll('[data-go-module]').forEach(b=>b.addEventListener('click',()=>showModule(b.dataset.goModule)));document.querySelectorAll('.mobile-nav-item[data-module]').forEach(b=>b.addEventListener('click',()=>showModule(b.dataset.module)));document.getElementById('mobile-more-btn').addEventListener('click',()=>openDialog('mobile-more-dialog'));document.querySelectorAll('[data-mobile-go]').forEach(b=>b.addEventListener('click',()=>{closeDialog('mobile-more-dialog');showModule(b.dataset.mobileGo)}));
  document.getElementById('notification-bell').addEventListener('click',event=>{event.stopPropagation();const pop=document.getElementById('notification-popover');setNotificationPopover(pop?.classList.contains('hidden'))});document.getElementById('notification-mark-all').addEventListener('click',()=>markAllNotifications().catch(e=>{console.error(e);toast('Não foi possível atualizar as notificações.','error')}));document.getElementById('notification-center-mark-all').addEventListener('click',()=>markAllNotifications().catch(e=>{console.error(e);toast('Não foi possível atualizar as notificações.','error')}));document.getElementById('notification-view-all').addEventListener('click',()=>{setNotificationPopover(false);renderNotifications();openDialog('notification-center-dialog')});document.addEventListener('click',event=>{if(!event.target.closest('.notification-anchor'))setNotificationPopover(false)});
  document.getElementById('logout-btn').addEventListener('click',async()=>{try{await runAppOperation('Saindo…','Encerrando sua sessão com segurança.',async()=>{const {error}=await signOut();if(error)throw error;showAuth()})}catch(e){console.error(e);toast('Não foi possível encerrar a sessão.','error')}});document.getElementById('mobile-logout-btn').addEventListener('click',async()=>{closeDialog('mobile-more-dialog');try{await runAppOperation('Saindo…','Encerrando sua sessão com segurança.',async()=>{const {error}=await signOut();if(error)throw error;showAuth()})}catch(e){console.error(e);toast('Não foi possível encerrar a sessão.','error')}});
  document.getElementById('new-transaction-btn').addEventListener('click',openNewTransaction);document.getElementById('quick-transaction').addEventListener('click',openNewTransaction);document.getElementById('open-balance-adjust').addEventListener('click',openBalance);document.getElementById('new-card-btn').addEventListener('click',openNewCard);document.getElementById('new-goal-btn').addEventListener('click',openNewGoal);document.getElementById('quick-dre').addEventListener('click',()=>openDRE(dashboardDate));document.getElementById('budget-dre-btn').addEventListener('click',()=>openDRE(budgetDate));document.getElementById('quick-pdf').addEventListener('click',()=>openReportBuilder(dashboardDate));document.getElementById('budget-pdf-btn').addEventListener('click',()=>openReportBuilder(budgetDate));document.getElementById('report-generate-btn').addEventListener('click',generateSelectedReport);document.getElementById('report-month-list').addEventListener('change',event=>{if(event.target.matches('[data-report-month]')){setFormError('report-form-error','');updateReportSelectionSummary()}});document.querySelectorAll('[data-report-preset]').forEach(btn=>btn.addEventListener('click',()=>applyReportPreset(btn.dataset.reportPreset)));document.getElementById('save-budget-btn').addEventListener('click',onBudgetSave);document.getElementById('budget-calibrate-btn').addEventListener('click',openBudgetCalibration);document.getElementById('budget-add-category-btn').addEventListener('click',()=>openBudgetCategoryEditor());document.getElementById('budget-analysis-toggle').addEventListener('click',toggleBudgetAnalysis);document.getElementById('budget-auto-btn').addEventListener('click',historicalBudgetSuggestion);document.getElementById('budget-manual-btn').addEventListener('click',applyManualBudgetCalibration);document.getElementById('budget-restore-btn').addEventListener('click',restoreSavedBudgetDraft);document.getElementById('budget-category-select').addEventListener('change',updateBudgetCategoryDialog);document.getElementById('budget-category-apply').addEventListener('click',applyBudgetCategoryDraft);document.getElementById('budget-category-remove').addEventListener('click',removeBudgetCategoryLimit);
  document.getElementById('transaction-form').addEventListener('submit',onTransactionSubmit);document.getElementById('balance-form').addEventListener('submit',onBalanceSubmit);document.getElementById('card-form').addEventListener('submit',onCardSubmit);document.getElementById('purchase-form').addEventListener('submit',onPurchaseSubmit);document.getElementById('goal-form').addEventListener('submit',onGoalSubmit);document.getElementById('family-invite-form').addEventListener('submit',onFamilyInviteSubmit);document.getElementById('family-permissions-form').addEventListener('submit',onFamilyPermissionsSubmit);document.getElementById('profile-settings-form').addEventListener('submit',onProfileSettingsSubmit);document.getElementById('legacy-migration-form').addEventListener('submit',onLegacyMigrationSubmit);document.getElementById('new-family-invite-btn').addEventListener('click',()=>{document.getElementById('family-invite-form').reset();setFormError('family-invite-error','');openDialog('family-invite-dialog')});document.getElementById('family-monitor-close').addEventListener('click',()=>document.getElementById('family-monitor-panel').classList.add('hidden'));document.querySelectorAll('[data-theme-choice]').forEach(btn=>btn.addEventListener('click',async()=>{if(appActionBusy)return;try{await runAppOperation('Salvando aparência…','Guardando sua preferência de tema.',async()=>{currentProfile=await updateProfileSettings({theme:btn.dataset.themeChoice});applyTheme(currentProfile.theme);toast('Tema atualizado.','success')})}catch(e){console.error(e);toast('Não foi possível salvar o tema.','error')}}));
  document.getElementById('transaction-recurring').addEventListener('change',e=>document.getElementById('recurring-count-wrap').classList.toggle('hidden',!e.target.checked));['transaction-search','transaction-filter-type','transaction-filter-month'].forEach(id=>document.getElementById(id).addEventListener(id==='transaction-search'?'input':'change',renderTransactions));
  document.querySelectorAll('[data-month-action]').forEach(b=>b.addEventListener('click',async()=>{if(appActionBusy)return;const previousDashboard=new Date(dashboardDate),previousBudget=new Date(budgetDate);dashboardDate=addMonth(dashboardDate,b.dataset.monthAction==='next'?1:-1);budgetDate=new Date(dashboardDate);try{await runAppOperation('Carregando mês…',`Buscando o orçamento de ${monthLabel(budgetDate)}.`,async()=>{state.budget=await getBudget(budgetDate);renderHome();renderBudget()})}catch(e){dashboardDate=previousDashboard;budgetDate=previousBudget;renderHome();renderBudget();toast('Não foi possível carregar o mês.','error')}}));document.querySelectorAll('[data-budget-month]').forEach(b=>b.addEventListener('click',async()=>{if(appActionBusy)return;const previousBudget=new Date(budgetDate);budgetDate=addMonth(budgetDate,b.dataset.budgetMonth==='next'?1:-1);try{await runAppOperation('Carregando orçamento…',`Buscando os limites de ${monthLabel(budgetDate)}.`,async()=>{state.budget=await getBudget(budgetDate);renderBudget()})}catch(e){budgetDate=previousBudget;renderBudget();toast('Não foi possível carregar o orçamento.','error')}}));document.addEventListener('click',handleDynamicClick)}

async function init(){bindUI();void initPWA().catch(error=>console.warn('PWA:',error));const session=await getSession().catch(()=>null);if(session){setAuthBusy(true,'login','data');try{await enterApp(session)}finally{setAuthBusy(false,'login')}}else showAuth();onAuthChange(async next=>{if(next)await enterApp(next);else{bootstrapGeneration++;currentUser=null;currentProfile=null;if(notificationChannel){try{await notificationChannel.unsubscribe()}catch{}notificationChannel=null}showAuth()}})}
init();
