import { buildCardInvoices,cardLimitSummary,cardToday,cardMonth,cardDate,invoiceStatusLabel } from './card-domain.js?v=2.9.14';
import { payCardInvoice,reverseCardPayment,deleteCard } from './cards.js?v=2.9.14';
import { formOperation,clearFormOperation } from './request-operation.js?v=2.9.14';
import { calculateCashStats } from './finance.js?v=2.9.14';
import { formatBRL,formatDate,monthLabel,escapeHTML,openDialog,closeDialog,setFormError,toast } from './ui.js?v=2.9.14';
import { categoryIconSVG } from './categories.js?v=2.9.14';
import { canonicalCategoryName } from './category-alias.js?v=2.9.14';
const e=escapeHTML;
const icon=(name)=>`<svg class="ui-icon" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
const shortMonth=key=>new Intl.DateTimeFormat('pt-BR',{month:'short',year:'numeric'}).format(cardDate(key)).replace('.','').replace(' de ','/');
const empty=text=>`<p class="card-empty">${e(text)}</p>`;
export function initCardsWorkspace({getState,onRefresh,onOperation,onNewPurchase,onEditPurchase,onEditCard,onCancelPurchase}){
 let selectedCardId=null,activeInvoice=null,activePurchase=null,paying=false,negativeApproved=false,lastRenderedCardId=null;
 const state=()=>getState();
 const findCard=id=>state().cards.find(card=>card.id===id);
 const invoices=card=>buildCardInvoices(card,state().installments,state().invoiceStatuses);
 const selectedInvoice=(id,key)=>{const card=findCard(id);return card?invoices(card).find(invoice=>invoice.invoiceMonth===key):null};
 const categoryTile=name=>{const canonical=canonicalCategoryName(name,state().categories);const record=state().categories.find(row=>!row.is_deleted&&row.name.toLocaleLowerCase('pt-BR')===canonical.toLocaleLowerCase('pt-BR'));return `<span class="category-icon-tile category-color-${e(record?.color_key||'slate')}">${categoryIconSVG(record?.icon_key||'tag')}</span>`};
 const statusBadge=invoice=>`<span class="card-status card-status-${e(invoice.status)}">${invoice.total<=0?'Sem compras':e(invoiceStatusLabel(invoice.status))}</span>`;
 function chart(card,items){
  const months=items.filter(inv=>inv.total>0||inv.paidAmount>0);if(!months.length)return empty('As faturas aparecerão aqui após a primeira compra.');
  const max=Math.max(...months.map(inv=>inv.total),1);
  const bars=months.map(inv=>`<button type="button" class="card-chart-column ${inv.invoiceMonth===cardMonth()?'current':''}" data-card-invoice="${e(card.id)}" data-card-month="${inv.invoiceMonth}" aria-label="${e(monthLabel(cardDate(inv.invoiceMonth)))}: fatura de ${e(formatBRL(inv.total))}, ${e(invoiceStatusLabel(inv.status))}"><span class="card-chart-track"><span class="card-chart-fill" style="height:${Math.max(0,Math.min(100,inv.total/max*100)).toFixed(3)}%"><span class="card-chart-value">${e(formatBRL(inv.total))}</span></span></span><span class="card-chart-month">${e(shortMonth(inv.invoiceMonth))}</span></button>`).join('');
  return `<div class="card-barchart"><div class="card-chart-scale" aria-hidden="true"><span>${e(formatBRL(max))}</span><span>${e(formatBRL(max/2))}</span><span>R$ 0</span></div><div class="card-chart-scroll" role="region" aria-label="Faturas de todos os meses; selecione uma barra para abrir a fatura" tabindex="0"><div class="card-chart-bars" style="--card-months:${months.length}">${bars}</div></div></div>`;
 }
 function purchaseRow(row){
  const p=row.ff2_card_purchases||{},count=Number(p.installment_count)||1;
  return `<button type="button" class="card-purchase-row" data-card-purchase="${e(row.purchase_id)}">${categoryTile(p.category||'Outros')}<span class="card-row-copy"><strong>${e(p.description||'Compra no cartão')}</strong><small>${e(p.category||'Outros')} · ${count===1?'À vista':`${Number(row.installment_no)} de ${count}`}</small></span><strong class="card-row-amount">${e(formatBRL(row.amount))}</strong><span class="card-row-arrow" aria-hidden="true">›</span></button>`;
 }
 function purchaseHistory(card){
  const groups=invoices(card).slice().reverse().map(inv=>({inv,rows:inv.rows.filter(row=>row.ff2_card_purchases?.record_kind!=='invoice_opening')})).filter(group=>group.rows.length);
  return groups.length?groups.map(({inv,rows})=>`<div class="card-purchase-group"><h4>${e(monthLabel(cardDate(inv.invoiceMonth)))}</h4>${rows.slice().sort((a,b)=>String(b.ff2_card_purchases?.purchase_date||'').localeCompare(String(a.ff2_card_purchases?.purchase_date||''))||String(a.id).localeCompare(String(b.id))).map(purchaseRow).join('')}</div>`).join(''):empty('Nenhuma compra cadastrada neste cartão.');
 }
 function render(){
  const previousScroll=document.querySelector('.card-chart-scroll')?.scrollLeft||0;
  const current=cardMonth();
  document.getElementById('cards-list').innerHTML=state().cards.length?state().cards.map(card=>{const inv=invoices(card).find(item=>item.invoiceMonth===current);return `<button type="button" class="card-entry" data-card-open="${e(card.id)}">${icon('card')}<span><strong>${e(card.name)}</strong><small>Fatura atual · ${e(formatBRL(inv?.total||0))}</small></span><span class="card-entry-arrow" aria-hidden="true">›</span></button>`}).join(''):`<div class="card-empty-state">${icon('card')}<p>Nenhum cartão cadastrado.</p><button type="button" class="secondary-btn" data-card-create>Adicionar primeiro cartão</button></div>`;
  const card=findCard(selectedCardId);if(!card)selectedCardId=null;
  document.getElementById('cards-overview').classList.toggle('hidden',!!card);
  document.getElementById('card-detail').classList.toggle('hidden',!card);
  if(!card)return;
  const items=invoices(card),limit=cardLimitSummary(card,items),currentInvoice=items.find(inv=>inv.invoiceMonth===current);
  document.getElementById('card-detail-name').textContent=card.name;
  document.getElementById('card-detail-content').innerHTML=`<section class="card-limit-panel" aria-labelledby="card-limit-title"><h3 id="card-limit-title">Limite disponível</h3><strong class="card-available ${limit.available<0?'negative':''}">${e(formatBRL(limit.available))}</strong><div class="card-limit-meta"><span>Comprometido <b>${e(formatBRL(limit.committed))}</b></span><span>Limite total <b>${e(formatBRL(limit.total))}</b></span></div><div class="card-limit-bar" role="meter" aria-label="Utilização do limite" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(limit.utilization)}" aria-valuetext="${e(formatBRL(limit.committed))} comprometidos de ${e(formatBRL(limit.total))}"><span style="width:${limit.utilization.toFixed(2)}%"></span></div></section>
  <section class="card-current-section" aria-labelledby="card-current-title"><h3 id="card-current-title">Fatura do mês atual</h3><button type="button" class="card-current-invoice" data-card-invoice="${e(card.id)}" data-card-month="${current}"><span class="card-row-copy"><strong>${e(monthLabel(cardDate(current)))}</strong><small>Vencimento ${formatDate(currentInvoice.dueOn)}</small>${statusBadge(currentInvoice)}</span><span class="card-current-value"><strong>${e(formatBRL(currentInvoice.total))}</strong>${currentInvoice.paidAmount>0&&currentInvoice.balanceDue>0?`<small>Falta ${e(formatBRL(currentInvoice.balanceDue))}</small>`:''}</span><span class="card-row-arrow" aria-hidden="true">›</span></button></section>
  <section class="card-chart-section" aria-labelledby="card-chart-title"><h3 id="card-chart-title">Faturas por mês</h3>${chart(card,items)}</section>
  <section class="card-history-section" aria-labelledby="card-history-title"><h3 id="card-history-title">Histórico de compras</h3>${purchaseHistory(card)}</section>`;
  const scroll=document.querySelector('.card-chart-scroll');
  if(scroll){const currentBar=scroll.querySelector('.current');scroll.scrollLeft=lastRenderedCardId===card.id?previousScroll:currentBar?Math.max(0,currentBar.offsetLeft-scroll.clientWidth/2+currentBar.clientWidth/2):0;}
  lastRenderedCardId=card.id;
  if(activeInvoice&&document.getElementById('invoice-dialog').open&&!paying)renderInvoice();
 }
 function openCard(id){if(!findCard(id))return;selectedCardId=id;render();document.getElementById('card-detail-name').focus();}
 function openInvoice(cardId,key=cardMonth()){
  if(!selectedInvoice(cardId,key))return;
  activeInvoice={cardId,key};renderInvoice();openDialog('invoice-dialog');
 }
 function openInvoiceById(id){const stored=state().invoiceStatuses.find(inv=>inv.id===id);if(stored){openCard(stored.card_id);openInvoice(stored.card_id,stored.invoice_month)}else if(findCard(id)){openCard(id);openInvoice(id)}}
 function renderInvoice(){
  if(!activeInvoice)return;
  const inv=selectedInvoice(activeInvoice.cardId,activeInvoice.key);if(!inv)return;
  document.getElementById('invoice-title').textContent=`${inv.card.name} · ${monthLabel(cardDate(inv.invoiceMonth))}`;
  const payments=(state().cardPayments||[]).filter(p=>p.invoice_id===inv.id).sort((a,b)=>String(b.paid_on).localeCompare(String(a.paid_on))||String(b.id).localeCompare(String(a.id)));
  document.getElementById('invoice-content').innerHTML=`<div class="card-invoice-summary"><div><small>Valor da fatura</small><strong>${e(formatBRL(inv.total))}</strong>${statusBadge(inv)}</div><dl><div><dt>Fechamento</dt><dd>${formatDate(inv.closingOn)}</dd></div><div><dt>Vencimento</dt><dd>${formatDate(inv.dueOn)}</dd></div><div><dt>Pago</dt><dd>${e(formatBRL(inv.paidAmount))}</dd></div><div><dt>Saldo devido</dt><dd>${e(formatBRL(inv.balanceDue))}</dd></div></dl></div>
  ${inv.balanceDue>0?'<button type="button" class="primary-compact card-pay-button" data-card-pay>Registrar pagamento</button>':''}
  <section class="card-invoice-purchases"><h4>Compras e parcelas</h4>${inv.reconciledAmount>0?`<div class="card-reconciliation"><strong>Saldo de conciliação · ${e(formatBRL(inv.reconciledAmount))}</strong><p>Valor anterior da fatura sem compras detalhadas. Não é contado como uma nova compra de consumo.</p></div>`:''}${inv.rows.filter(row=>row.ff2_card_purchases?.record_kind!=='invoice_opening').map(purchaseRow).join('')||(!inv.reconciledAmount?empty('Nenhuma compra nesta fatura.'):'')}</section>
  <section class="card-payments-section"><h4>Pagamentos</h4>${payments.length?payments.map(p=>`<div class="card-payment-row"><span><strong>${e(formatBRL(p.amount))}</strong><small>${formatDate(p.paid_on)}${p.reversed_at?' · Revertido':''}</small>${p.reversed_at?`<small>${e(p.reversal_reason||'')}</small>`:''}</span>${!p.reversed_at?`<button type="button" class="text-btn" data-card-reverse="${e(p.id)}">Corrigir</button>`:''}</div>`).join(''):empty(inv.paidAmount>0?'Quitação anterior preservada na conciliação.':'Nenhum pagamento registrado.')}</section>`;
 }
 function openPurchase(id){
  const purchase=state().purchases.find(p=>p.id===id);if(!purchase){toast('Aguarde a sincronização dos detalhes da compra.','error');return;}
  activePurchase=id;
  const card=findCard(purchase.card_id);const rows=state().installments.filter(row=>row.purchase_id===id).sort((a,b)=>a.installment_no-b.installment_no);
  const locked=rows.some(row=>selectedInvoice(purchase.card_id,row.invoice_month)?.paidAmount>0)||purchase.record_kind==='invoice_opening';
  document.getElementById('card-purchase-title').textContent=purchase.description;
  document.getElementById('card-purchase-detail').innerHTML=`<dl class="card-purchase-facts"><div><dt>Cartão</dt><dd>${e(card?.name||purchase.ff2_cards?.name||'Cartão')}</dd></div><div><dt>Data original</dt><dd>${formatDate(purchase.purchase_date)}</dd></div><div><dt>Valor total</dt><dd>${e(formatBRL(purchase.total_amount))}</dd></div><div><dt>Categoria</dt><dd>${e(purchase.category||'Outros')}</dd></div><div><dt>Parcelamento</dt><dd>${Number(purchase.installment_count)===1?'À vista':`${Number(purchase.installment_count)} parcelas`}</dd></div></dl><h4>Parcelas e faturas</h4><div class="card-purchase-invoices">${rows.map(row=>`<button type="button" class="card-related-invoice" data-card-related-invoice="${e(purchase.card_id)}" data-card-month="${row.invoice_month}"><span>${e(shortMonth(row.invoice_month))} · ${row.installment_no} de ${purchase.installment_count}</span><strong>${e(formatBRL(row.amount))}</strong><span aria-hidden="true">›</span></button>`).join('')}</div>${locked?'<p class="card-lock-note">Há pagamentos nesta compra. Corrija os pagamentos vinculados antes de editar ou excluir.</p>':''}`;
  document.getElementById('card-purchase-edit').disabled=locked;document.getElementById('card-purchase-delete').disabled=locked;
  openDialog('card-purchase-dialog');
 }
 function paymentFieldsChanged(){negativeApproved=false;document.getElementById('card-payment-warning').classList.add('hidden');document.getElementById('card-payment-save').textContent='Confirmar pagamento';setFormError('card-payment-error','');const partial=document.getElementById('card-payment-mode').value==='partial';document.getElementById('card-payment-amount-wrap').classList.toggle('hidden',!partial);document.getElementById('card-payment-amount').required=partial;document.getElementById('card-payment-amount').disabled=!partial;}
 function openPayment(){
  const inv=activeInvoice&&selectedInvoice(activeInvoice.cardId,activeInvoice.key);if(!inv||inv.balanceDue<=0)return;
  const form=document.getElementById('card-payment-form');form.reset();clearFormOperation(form);
  document.getElementById('card-payment-title').textContent=`Pagar fatura · ${inv.card.name}`;
  document.getElementById('card-payment-due').textContent=formatBRL(inv.balanceDue);
  const date=document.getElementById('card-payment-date');date.max=cardToday();date.value=cardToday();
  document.getElementById('card-payment-amount').max=inv.balanceDue.toFixed(2);paymentFieldsChanged();openDialog('card-payment-dialog');
 }
 function showNegative(before,amount,after){
  document.getElementById('card-payment-warning').innerHTML=`<strong>O pagamento ultrapassa seu saldo disponível.</strong><dl><div><dt>Saldo disponível</dt><dd>${e(formatBRL(before))}</dd></div><div><dt>Pagamento</dt><dd>${e(formatBRL(amount))}</dd></div><div><dt>Saldo após pagamento</dt><dd>${e(formatBRL(after))}</dd></div></dl><p>Você pode confirmar para continuar com saldo negativo.</p>`;
  document.getElementById('card-payment-warning').classList.remove('hidden');document.getElementById('card-payment-save').textContent='Confirmar mesmo assim';negativeApproved=true;
 }
 function setPaymentBusy(busy){paying=busy;document.querySelectorAll('#card-payment-dialog button,#card-payment-dialog input,#card-payment-dialog select').forEach(el=>{el.disabled=busy});document.getElementById('card-payment-save').textContent=busy?'Registrando…':'Confirmar pagamento';if(!busy)document.getElementById('card-payment-amount').disabled=document.getElementById('card-payment-mode').value!=='partial'}
 async function submitPayment(event){
  event.preventDefault();if(paying)return;
  const inv=activeInvoice&&selectedInvoice(activeInvoice.cardId,activeInvoice.key);if(!inv)return;
  const form=event.currentTarget,partial=document.getElementById('card-payment-mode').value==='partial',date=document.getElementById('card-payment-date').value;
  const amount=partial?Number(document.getElementById('card-payment-amount').value):inv.balanceDue;
  if(!date||date>cardToday()){setFormError('card-payment-error','Informe uma data de pagamento até hoje.');return;}
  if(!Number.isFinite(amount)||amount<=0||amount>inv.balanceDue||Math.abs(amount*100-Math.round(amount*100))>1e-6){setFormError('card-payment-error','Informe um valor válido até o saldo devido.');return;}
  const balance=calculateCashStats(state().transactions).balance;
  if(balance-amount<0&&!negativeApproved){showNegative(balance,amount,balance-amount);return;}
  const input={cardId:inv.card.id,month:inv.invoiceMonth,date,amount:partial?amount:null,allowNegative:negativeApproved};input.operation=formOperation(form,input);
  setPaymentBusy(true);setFormError('card-payment-error','');
  try{
   await onOperation('Registrando pagamento…','Atualizando fatura, lançamento e limite juntos.',async()=>{await payCardInvoice(input);await onRefresh();},{animateDashboard:true});
   closeDialog('card-payment-dialog');clearFormOperation(form);render();renderInvoice();toast('Pagamento registrado.','success');
  }catch(error){
   if(error.message==='NEGATIVE_BALANCE_CONFIRMATION'){
    try{const detail=JSON.parse(error.details||error.detail);showNegative(detail.before,detail.payment,detail.after)}catch{showNegative(balance,amount,balance-amount)}
   }else setFormError('card-payment-error',cardErrorMessage(error));
  }finally{setPaymentBusy(false);if(negativeApproved&&document.getElementById('card-payment-dialog').open)document.getElementById('card-payment-save').textContent='Confirmar mesmo assim';}
 }
 async function submitReversal(event){
  event.preventDefault();if(paying)return;
  const id=document.getElementById('card-reversal-id').value,reason=document.getElementById('card-reversal-reason').value.trim();if(reason.length<3){setFormError('card-reversal-error','Informe o motivo da correção.');return;}
  const button=document.getElementById('card-reversal-save');paying=true;button.disabled=true;
  try{await onOperation('Revertendo pagamento…','Preservando o pagamento original e registrando a correção.',async()=>{await reverseCardPayment(id,reason);await onRefresh();},{animateDashboard:true});closeDialog('card-reversal-dialog');render();renderInvoice();toast('Pagamento revertido.','success')}
  catch(error){setFormError('card-reversal-error',cardErrorMessage(error))}
  finally{paying=false;button.disabled=false}
 }
 document.addEventListener('click',async event=>{
  const entry=event.target.closest('[data-module],[data-go-module],[data-mobile-go]');
  if((entry?.dataset.module||entry?.dataset.goModule||entry?.dataset.mobileGo)==='cards'){selectedCardId=null;activeInvoice=null;lastRenderedCardId=null;render();}
  const button=event.target.closest('button');if(!button||paying)return;
  try{
   if(button.dataset.cardOpen)return openCard(button.dataset.cardOpen);
   if(button.hasAttribute('data-card-back')){selectedCardId=null;render();document.querySelector('[data-card-open]')?.focus();return;}
   if(button.hasAttribute('data-card-create'))return document.getElementById('new-card-btn').click();
   if(button.hasAttribute('data-card-new-purchase'))return onNewPurchase(selectedCardId);
   if(button.hasAttribute('data-card-settings'))return onEditCard(selectedCardId);
   if(button.dataset.cardInvoice)return openInvoice(button.dataset.cardInvoice,button.dataset.cardMonth);
   if(button.dataset.cardRelatedInvoice){closeDialog('card-purchase-dialog');return openInvoice(button.dataset.cardRelatedInvoice,button.dataset.cardMonth);}
   if(button.dataset.cardPurchase)return openPurchase(button.dataset.cardPurchase);
   if(button.hasAttribute('data-card-pay'))return openPayment();
   if(button.dataset.cardReverse){document.getElementById('card-reversal-form').reset();document.getElementById('card-reversal-id').value=button.dataset.cardReverse;setFormError('card-reversal-error','');return openDialog('card-reversal-dialog');}
   if(button.id==='card-purchase-edit'){closeDialog('card-purchase-dialog');return onEditPurchase(activePurchase);}
   if(button.id==='card-purchase-delete'){if(!confirm('Excluir esta compra e suas parcelas? O registro da exclusão será preservado.'))return;await onCancelPurchase(activePurchase);closeDialog('card-purchase-dialog');render();return;}
   if(button.id==='card-archive-btn'){const id=document.getElementById('card-id').value;if(!id||!confirm('Arquivar este cartão? O histórico será preservado. É necessário quitar todas as faturas.'))return;await onOperation('Arquivando cartão…','Preservando compras e pagamentos anteriores.',async()=>{await deleteCard(id);closeDialog('card-dialog');await onRefresh();});render();toast('Cartão arquivado.','success');}
  }catch(error){console.error(error);toast(cardErrorMessage(error),'error');}
 });
 document.getElementById('card-payment-form').addEventListener('submit',submitPayment);
 for(const id of ['card-payment-mode','card-payment-date','card-payment-amount'])document.getElementById(id).addEventListener('input',paymentFieldsChanged);
 document.getElementById('card-reversal-form').addEventListener('submit',submitReversal);
 for(const id of ['card-payment-dialog','card-reversal-dialog'])document.getElementById(id).addEventListener('cancel',event=>{if(paying)event.preventDefault()});
 return {render,openInvoice,openInvoiceById,reset(){selectedCardId=null;activeInvoice=null;activePurchase=null;for(const id of ['invoice-dialog','card-payment-dialog','card-purchase-dialog','card-reversal-dialog'])closeDialog(id);},isBusy:()=>paying};
}
export function cardErrorMessage(error){
 const messages={INVOICE_ALREADY_PAID:'Esta fatura já está quitada. Atualize os dados.',INVOICE_HAS_PAYMENTS:'Corrija os pagamentos desta fatura antes de alterar a compra.',INVALID_PAYMENT_AMOUNT:'O pagamento deve ser maior que zero e até o saldo devido.',INVALID_PAYMENT_DATE:'Informe uma data de pagamento até hoje.',CARD_HAS_BALANCE:'Quite todas as faturas antes de arquivar o cartão.',CARD_PAYMENT_LINKED:'Corrija este pagamento nos detalhes da fatura.',RECONCILIATION_LOCKED:'Este registro é um saldo de conciliação e mantém o histórico anterior.',REQUEST_CONFLICT:'Esta operação mudou. Feche o formulário e tente novamente.',INVALID_INSTALLMENTS:'Revise a quantidade de parcelas e o valor da compra.'};
 return messages[error?.message]||(/^(Revise|Ative|Corrija)/.test(error?.message||'')?error.message:'Não foi possível concluir. Tente novamente.');
}
