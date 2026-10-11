import {recordCardAdjustment,reconcileCardLegacy} from './cards.js?v=2.9.16';
import {cardAdjustmentLabel,cardToday,cardMonth,cardDate,buildCardInvoices} from './card-domain.js?v=2.9.16';
import {formOperation,clearFormOperation} from './request-operation.js?v=2.9.16';
import {formatBRL,formatDate,monthLabel,escapeHTML,openDialog,closeDialog,setFormError,toast} from './ui.js?v=2.9.16';
const e=escapeHTML,$=id=>document.getElementById(id);
export function initCardAdjustments({getState,onRefresh,onOperation}){
 let context=null,busy=false,negativeApproved=false,reconciliationInvoice=null;
 const state=()=>getState();
 const adjustments=()=>state().cardAdjustments||[],links=()=>state().cardReconciliations||[];
 const reversed=id=>adjustments().some(a=>a.reversal_of===id);
 const refunded=purchaseId=>adjustments().filter(a=>a.purchase_id===purchaseId&&(['purchase_refund','credit_adjustment'].includes(a.kind)||a.kind==='reversal'&&['purchase_refund','credit_adjustment'].includes(adjustments().find(o=>o.id===a.reversal_of)?.kind))).reduce((sum,a)=>sum+(a.kind==='reversal'?-1:1)*Number(a.amount),0);
 const remainingRelease=a=>Math.max(0,Math.round((Number(a.amount)-Number(a.limit_released||0)-adjustments().filter(l=>l.origin_adjustment_id===a.id&&l.kind==='limit_release'&&!reversed(l.id)).reduce((sum,l)=>sum+Number(l.amount),0))*100)/100);
 const covered=id=>links().filter(r=>r.installment_id===id).reduce((sum,r)=>sum+Number(r.amount),0);
 function invoiceExtras(inv){
  const rows=adjustments().filter(a=>a.card_id===inv.card.id&&a.invoice_month===inv.invoiceMonth);
  const openings=inv.rows.filter(r=>r.ff2_card_purchases?.record_kind==='invoice_opening');
  const openingAmount=openings.reduce((sum,r)=>sum+Number(r.amount),0);
  return `<section class="card-adjustments-section"><div class="card-adjustments-heading"><h4>Ajustes, encargos e estornos</h4>${!inv.settledAt?'<button type="button" class="card-history-link" data-card-new-adjustment>Registrar ajuste</button>':''}</div>${rows.map(a=>`<div class="card-adjustment-row"><div><strong>${e(cardAdjustmentLabel(a.kind))} · ${e(formatBRL(a.kind==='limit_release'?Number(a.amount):Number(a.analytics_effect)))}</strong><small>${formatDate(a.occurred_on)} · ${a.destination==='cash'?'Devolução em conta':'Aplicado nesta fatura'}${reversed(a.id)?' · Corrigido':''}</small><p>${e(a.reason)}</p>${a.purchase_id?`<button type="button" class="card-history-link" data-card-purchase="${e(a.purchase_id)}">Consultar compra original</button>`:''}${['purchase_refund','credit_adjustment'].includes(a.kind)&&!reversed(a.id)&&remainingRelease(a)>0?`<button type="button" class="card-history-link" data-card-release-limit="${e(a.id)}">Confirmar liberação de limite</button>`:''}${a.transaction_id?`<button type="button" class="card-history-link" data-card-linked-transaction="${e(a.transaction_id)}">Ver lançamento vinculado</button>`:''}</div>${a.kind!=='reversal'&&!reversed(a.id)&&!(a.destination==='invoice'&&inv.settledAt)?`<button type="button" class="card-history-link" data-card-correct-adjustment="${e(a.id)}">Corrigir</button>`:''}</div>`).join('')||'<p class="card-empty">Nenhum ajuste registrado nesta competência.</p>'}${openings.length?`<div class="card-reconciliation"><strong>Saldo legado · ${e(formatBRL(openingAmount))}</strong><p>${inv.reconciledAmount===0?'Conciliado':inv.reconciledAmount<openingAmount?'Parcialmente conciliado':'Conciliação pendente'} · Sem detalhamento: ${e(formatBRL(inv.reconciledAmount))}</p><p>Origem preservada da migração anterior. As compras identificadas só compensam este saldo após sua confirmação.</p>${!inv.settledAt&&inv.paidAmount===0&&inv.rows.some(r=>r.ff2_card_purchases?.record_kind==='purchase')?'<button type="button" class="card-history-link" data-card-conciliate>Conciliar saldo legado</button>':''}</div>`:''}${inv.creditBalance>0?`<p class="card-lock-note">Crédito nesta fatura: ${e(formatBRL(inv.creditBalance))}. Ele permanece nesta competência até uma aplicação confirmada pelo emissor.</p>`:''}</section>`;
 }
 function openAdjustment(inv,purchase=null,original=null,mode=null){
  context={mode,cardId:purchase?.card_id||inv?.card.id||original.card_id,purchaseId:purchase?.id||original?.purchase_id||null,original};negativeApproved=false;
  const form=$('card-adjustment-form');form.reset();clearFormOperation(form);setFormError('card-adjustment-error','');$('card-adjustment-warning').classList.add('hidden');
  const card=state().cards.find(c=>c.id===context.cardId),items=buildCardInvoices(card,state().installments,state().invoiceStatuses);
  $('card-adjustment-title').textContent=mode==='limit_release'?'Confirmar liberação de limite':original?'Corrigir ajuste':purchase?'Registrar estorno':'Registrar ajuste';
  $('card-adjustment-origin').textContent=purchase?`Compra original: ${purchase.description} · ${formatBRL(purchase.total_amount)}`:`${card.name}${original?' · '+cardAdjustmentLabel(original.kind):''}`;
  const kind=$('card-adjustment-kind');kind.innerHTML=(purchase?['purchase_refund','debit_adjustment','credit_adjustment']:original?[mode||'reversal']:['interest','fine','fee','debit_adjustment','credit_adjustment']).map(k=>`<option value="${k}">${e(cardAdjustmentLabel(k))}</option>`).join('');
  $('card-adjustment-date').max=cardToday();$('card-adjustment-date').value=cardToday();
  const eligible=items.find(i=>i.invoiceMonth>=cardMonth()&&!i.settledAt);
  $('card-adjustment-month').value=(original?.invoice_month||(!inv?.settledAt&&inv?.invoiceMonth)||eligible?.invoiceMonth||cardMonth()).slice(0,7);
  $('card-adjustment-category').innerHTML=state().categories.filter(c=>!c.is_deleted&&(c.kind==='expense'||c.kind==='both')).map(c=>`<option value="${e(c.name)}">${e(c.name)}</option>`).join('')||'<option>Outros</option>';
  if(purchase?.category)$('card-adjustment-category').value=purchase.category;
  $('card-adjustment-destination').value=original?.destination||'invoice';
  $('card-adjustment-limit').value=original?.limit_released||0;
  $('card-adjustment-amount').removeAttribute('max');
  if(purchase){const remaining=Math.max(0,Math.round((Number(purchase.total_amount)-refunded(purchase.id))*100)/100);$('card-adjustment-amount').max=remaining;$('card-adjustment-amount').value=remaining;}
  if(original)$('card-adjustment-amount').value=mode==='limit_release'?remainingRelease(original):original.amount;
  if(mode==='limit_release'){$('card-adjustment-month').value=cardToday().slice(0,7);$('card-adjustment-destination').value='invoice';}
  updateFields();openDialog('card-adjustment-dialog');
 }
 function updateFields(){
  if(!context)return;
  negativeApproved=false;$('card-adjustment-warning').classList.add('hidden');$('card-adjustment-save').textContent='Confirmar registro';
  const kind=$('card-adjustment-kind').value,credit=['purchase_refund','credit_adjustment','reversal'].includes(kind),cash=$('card-adjustment-destination').value==='cash';
  $('card-adjustment-destination-wrap').classList.toggle('hidden',kind!=='purchase_refund'&&!context.original);
  if(kind!=='purchase_refund'&&!context.original)$('card-adjustment-destination').value='invoice';
  const actualCash=$('card-adjustment-destination').value==='cash';
  $('card-adjustment-month').disabled=actualCash||!!context.original;
  if(actualCash)$('card-adjustment-month').value=$('card-adjustment-date').value.slice(0,7);
  $('card-adjustment-limit-wrap').classList.toggle('hidden',!credit);
  if(context.purchaseId&&!context.original){const p=state().purchases.find(p=>p.id===context.purchaseId);if(['purchase_refund','credit_adjustment'].includes(kind))$('card-adjustment-amount').max=Math.max(0,Number(p.total_amount)-refunded(p.id));else $('card-adjustment-amount').removeAttribute('max');}
  $('card-adjustment-limit').disabled=!credit||!!context.original;$('card-adjustment-limit').max=$('card-adjustment-amount').value;
  $('card-adjustment-category-wrap').classList.toggle('hidden',!!context.purchaseId||!!context.original);
  for(const id of ['card-adjustment-kind','card-adjustment-destination','card-adjustment-amount'])$(id).disabled=!!context.original&&!(context.mode==='limit_release'&&id==='card-adjustment-amount');
 }
 function setBusy(value){busy=value;for(const id of ['card-adjustment-dialog','card-conciliation-dialog'])$(id).querySelectorAll('button,input,select').forEach(el=>el.disabled=value);if(!value)updateFields();}
 async function submitAdjustment(event){
  event.preventDefault();if(busy||!context)return;
  const original=context.original,kind=$('card-adjustment-kind').value;
  const input={cardId:context.cardId,month:$('card-adjustment-month').value+'-01',kind,amount:Number($('card-adjustment-amount').value),date:$('card-adjustment-date').value,reason:$('card-adjustment-reason').value.trim(),purchaseId:context.purchaseId,destination:$('card-adjustment-destination').value,limitReleased:['purchase_refund','credit_adjustment','reversal'].includes(kind)?Number($('card-adjustment-limit').value):0,category:original?.category||$('card-adjustment-category').value||'Outros',confirmed:$('card-adjustment-confirmed').checked,reversalOf:original?.id||null,allowNegative:negativeApproved};
  input.operation=formOperation(event.currentTarget,input);setFormError('card-adjustment-error','');setBusy(true);
  try{await onOperation('Registrando ajuste…','Preservando os vínculos e atualizando os saldos.',async()=>{await recordCardAdjustment(input);await onRefresh();});closeDialog('card-adjustment-dialog');clearFormOperation(event.currentTarget);toast('Registro confirmado.','success');}
  catch(error){if(error.message==='NEGATIVE_BALANCE_CONFIRMATION'){try{const d=JSON.parse(error.details);$('card-adjustment-warning').textContent=`Saldo disponível: ${formatBRL(d.before)}. Correção: ${formatBRL(d.payment)}. Saldo previsto: ${formatBRL(d.after)}. Confirme novamente para continuar.`;negativeApproved=true;$('card-adjustment-warning').classList.remove('hidden');}catch{setFormError('card-adjustment-error',message(error));}}else setFormError('card-adjustment-error',message(error));}
  finally{const approved=negativeApproved;setBusy(false);if(approved){negativeApproved=true;$('card-adjustment-warning').classList.remove('hidden');$('card-adjustment-save').textContent='Confirmar mesmo assim';}}
 }
 function openReconciliation(inv){
  reconciliationInvoice=inv;const form=$('card-conciliation-form');form.reset();clearFormOperation(form);setFormError('card-conciliation-error','');
  $('card-conciliation-origin').textContent=`${inv.card.name} · ${monthLabel(cardDate(inv.invoiceMonth))}. Saldo sem detalhamento: ${formatBRL(inv.reconciledAmount)}.`;
  $('card-conciliation-installment').innerHTML=inv.rows.filter(r=>r.ff2_card_purchases?.record_kind==='purchase').map(r=>`<option value="${e(r.id)}">${e(r.ff2_card_purchases.description)} · ${e(formatBRL(r.amount))}</option>`).join('');
  selectReconciliation();openDialog('card-conciliation-dialog');
 }
 function selectReconciliation(){
  const row=reconciliationInvoice?.rows.find(r=>r.id===$('card-conciliation-installment').value);if(!row)return;
  $('card-conciliation-amount').max=Math.min(Number(row.amount),reconciliationInvoice.reconciledAmount+covered(row.id));
  $('card-conciliation-amount').value=covered(row.id)||Math.min(Number(row.amount),reconciliationInvoice.reconciledAmount);
 }
 async function submitReconciliation(event){
  event.preventDefault();if(busy)return;const input={invoiceId:reconciliationInvoice.id,installmentId:$('card-conciliation-installment').value,amount:Number($('card-conciliation-amount').value),reason:$('card-conciliation-reason').value.trim(),confirmed:$('card-conciliation-confirmed').checked};input.operation=formOperation(event.currentTarget,input);setBusy(true);setFormError('card-conciliation-error','');
  try{await onOperation('Conciliando saldo…','Compensando apenas os valores confirmados.',async()=>{await reconcileCardLegacy(input);await onRefresh();});closeDialog('card-conciliation-dialog');clearFormOperation(event.currentTarget);toast('Conciliação registrada.','success');}catch(error){setFormError('card-conciliation-error',message(error));}finally{setBusy(false);}
 }
 function openLinkedTransaction(id){
  const t=state().transactions.find(t=>t.id===id);if(!t)return toast('Atualize os dados para consultar este lançamento.','error');
  $('card-linked-transaction-content').innerHTML=`<dl class="card-purchase-facts"><div><dt>Descrição</dt><dd>${e(t.description)}</dd></div><div><dt>Valor</dt><dd>${e(formatBRL(t.amount))}</dd></div><div><dt>Data</dt><dd>${formatDate(t.occurred_on)}</dd></div><div><dt>Movimento</dt><dd>${Number(t.direction)>0?'Entrada':'Saída'}</dd></div></dl><p class="card-lock-note">Identificador: ${e(t.id)}<br>Referência: ${e(t.reference_key||'')}<br>${e(t.notes||'')}</p>`;openDialog('card-linked-transaction-dialog');
 }
 function message(error){return ({SETTLED_INVOICE_IMMUTABLE:'Esta fatura possui histórico quitado. Escolha outra competência para registrar o ajuste.',REFUND_EXCEEDS_PURCHASE:'O estorno ultrapassa o valor ainda disponível da compra.',CREDIT_EXCEEDS_UNPAID_BALANCE:'O crédito ultrapassa o saldo pendente de uma fatura com pagamentos. Confira a competência aplicada pelo emissor.',PURCHASE_HAS_ADJUSTMENTS:'Esta compra possui ajustes ou conciliação. Corrija somente descrição e categoria.',INVALID_RECONCILIATION_AMOUNT:'Confira o valor coberto pela conciliação e o saldo legado disponível.',ISSUER_CONFIRMATION_REQUIRED:'Confirme os dados efetivamente aplicados pelo emissor.',REQUEST_CONFLICT:'Os dados desta operação mudaram. Reabra o formulário para corrigir.',ADJUSTMENT_HAS_LIMIT_RELEASE:'Corrija primeiro as liberações de limite vinculadas a este crédito.',LIMIT_RELEASE_EXCEEDS_CREDIT:'A liberação ultrapassa o crédito ainda disponível.',INVALID_AMOUNT:'Informe um valor positivo com até duas casas decimais.',INVALID_PAYMENT_DATE:'Informe uma data válida até hoje.'})[error.message]||error.message||'Não foi possível registrar a operação.';}
 $('card-adjustment-form').addEventListener('submit',submitAdjustment);$('card-conciliation-form').addEventListener('submit',submitReconciliation);
 for(const id of ['card-adjustment-kind','card-adjustment-destination','card-adjustment-date','card-adjustment-amount','card-adjustment-limit','card-adjustment-reason'])$(id).addEventListener('input',updateFields);
 $('card-conciliation-installment').addEventListener('change',selectReconciliation);
 for(const id of ['card-adjustment-dialog','card-conciliation-dialog'])$(id).addEventListener('cancel',event=>{if(busy)event.preventDefault();});
 document.addEventListener('click',event=>{const button=event.target.closest('button');if(button?.dataset.cardReleaseLimit&&!busy){const original=adjustments().find(a=>a.id===button.dataset.cardReleaseLimit);if(original)openAdjustment(null,null,original,'limit_release');}if(button?.dataset.cardLinkedTransaction&&!busy)openLinkedTransaction(button.dataset.cardLinkedTransaction);if(button?.dataset.cardCorrectAdjustment&&!busy){const original=adjustments().find(a=>a.id===button.dataset.cardCorrectAdjustment);if(original)openAdjustment(null,null,original);}});
 return {invoiceExtras,openAdjustment,openReconciliation,refunded,covered,isBusy:()=>busy,reset(){context=null;reconciliationInvoice=null;for(const id of ['card-adjustment-dialog','card-conciliation-dialog','card-linked-transaction-dialog'])closeDialog(id);}};
}
