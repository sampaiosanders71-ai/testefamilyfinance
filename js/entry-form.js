import {moneyValue,setMoney} from './money-input.js?v=2.9.46';
import {closeDialog} from './ui.js?v=2.9.46';

// Shared presentation, with the existing cash, card and planning persistence paths.
// Drafts live only while switching a new entry between these two forms.
export function initEntryForms({getCards,onNewTransaction,onNewPurchase,onPurchaseChange}){
 const cash=document.getElementById('transaction-form');
 const purchase=document.getElementById('purchase-form');
 const planning=document.getElementById('planning-form');
 const byId=id=>document.getElementById(id);
 let switching=false,cashDraft=null,purchaseDraft=null;
 const dateInputs=[byId('transaction-date'),byId('purchase-date'),byId('planning-date')];

 function syncDates(){
  for(const input of dateInputs){
   const label=input.parentElement.querySelector('.entry-date-value');
   label.textContent=input.value?input.value.split('-').reverse().join('/'):'dd/mm/aaaa';
  }
 }
 for(const input of dateInputs){
  const control=document.createElement('div');control.className='entry-date-control';
  const label=document.createElement('span');label.className='entry-date-value';label.setAttribute('aria-hidden','true');
  const icon=document.createElementNS('http://www.w3.org/2000/svg','svg');
  icon.classList.add('ui-icon');icon.setAttribute('aria-hidden','true');
  const use=document.createElementNS('http://www.w3.org/2000/svg','use');use.setAttribute('href','#i-calendar');icon.append(use);
  input.before(control);control.append(label,icon,input);
  input.addEventListener('input',syncDates);input.addEventListener('change',syncDates);
  input.addEventListener('click',()=>{if(!input.disabled)try{input.showPicker?.()}catch{}});
 }

 function syncTypes(){
  const direction=byId('transaction-direction').value;
  cash.dataset.entryType=direction==='1'?'income':'expense';
  byId('transaction-description').placeholder=direction==='1'?'Ex.: Salário':'Ex.: Compras da semana';
  for(const radio of cash.querySelectorAll('[data-entry-type]')){
   radio.checked=radio.value===direction;
   radio.disabled=radio.value==='card'&&!!byId('transaction-id').value;
  }
  for(const radio of purchase.querySelectorAll('[data-entry-type]')){
   radio.checked=radio.value==='card';
   radio.disabled=radio.value!=='card'&&!!byId('purchase-id').value;
  }
  const planningDirection=byId('planning-direction').value;
  planning.dataset.entryType=planningDirection==='1'?'income':'expense';
  byId('planning-description').placeholder=planningDirection==='1'?'Ex.: Bolsa de estudos':'Ex.: Consulta, formatura';
  for(const radio of planning.querySelectorAll('[data-entry-type]'))radio.checked=radio.value===planningDirection;
 }
 function fillCards(){
  const select=byId('purchase-card-select'),selected=byId('purchase-card-id').value;
  const cards=getCards().filter(card=>card.active!==false||card.id===selected);
  const options=[new Option(cards.length?'Selecione o cartão':'Nenhum cartão cadastrado','')];
  for(const card of cards)options.push(new Option(card.name,card.id));
  if(selected&&!cards.some(card=>card.id===selected))options.push(new Option('Cartão do registro',selected));
  select.replaceChildren(...options);select.value=selected;select.disabled=!!byId('purchase-id').value;
  byId('purchase-empty-cards').classList.toggle('hidden',!!cards.length||!!selected);
 }
 function beforeOpen(kind){
  if(kind==='planning'){syncTypes();syncDates();return;}
  if(!switching){cashDraft=null;purchaseDraft=null;}
  if(kind==='purchase'){fillCards();onPurchaseChange();}
  byId('transaction-recurring-count').disabled=!!byId('transaction-id').value||!byId('transaction-recurring').checked;
  syncTypes();syncDates();
 }
 function capture(form){
  const values={};
  for(const input of form.querySelectorAll('input[id],select[id]')){
   if(input.matches('[data-entry-type]'))continue;
   values[input.id]=input.type==='checkbox'?input.checked:input.hasAttribute('data-money')?moneyValue(input):input.value;
  }
  return values;
 }
 function restore(values){
  if(!values)return;
  for(const [id,value]of Object.entries(values)){
   const input=byId(id);if(!input)continue;
   if(input.type==='checkbox')input.checked=value;
   else if(input.hasAttribute('data-money'))setMoney(input,value);
   else input.value=value;
  }
 }
 function common(prefix){return{
  description:byId(prefix+'-description').value,
  date:byId(prefix+'-date').value,
  amount:moneyValue(prefix==='purchase'?'purchase-total':'transaction-amount'),
  amountFilled:byId(prefix==='purchase'?'purchase-total':'transaction-amount').value!=='',
  category:byId(prefix+'-category').value
 };}
 function applyCommon(prefix,values){
  byId(prefix+'-description').value=values.description;
  byId(prefix+'-date').value=values.date;
  setMoney(prefix==='purchase'?'purchase-total':'transaction-amount',values.amountFilled?values.amount:'');
  const select=byId(prefix+'-category');
  // Never turn an income-only or historical category into a new expense category.
  if([...select.options].some(option=>option.value===values.category))select.value=values.category;
 }
 function changeCashDirection(value){
  const direction=byId('transaction-direction');
  if(direction.value!==value){direction.value=value;direction.dispatchEvent(new Event('change',{bubbles:true}));}
  syncTypes();
 }
 function switchType(value,source){
  if(source==='cash'&&value!=='card'){changeCashDirection(value);return;}
  if(source==='purchase'&&value==='card')return;
  if(byId(source==='cash'?'transaction-id':'purchase-id').value){syncTypes();return;}
  switching=true;
  try{
   if(source==='cash'){
    cashDraft=capture(cash);const values=common('transaction');
    closeDialog('transaction-dialog');onNewPurchase(purchaseDraft?.['purchase-card-id']||'');
    restore(purchaseDraft);applyCommon('purchase',values);fillCards();onPurchaseChange();
    syncDates();syncTypes();byId('purchase-dialog').querySelector('.entry-body').scrollTop=0;
   }else{
    purchaseDraft=capture(purchase);const values=common('purchase');
    closeDialog('purchase-dialog');onNewTransaction();
    // The cash opener refills categories, so restore the direction first.
    changeCashDirection(cashDraft?.['transaction-direction']||value);
    restore(cashDraft);changeCashDirection(value);applyCommon('transaction',values);
    byId('transaction-nature').dispatchEvent(new Event('change',{bubbles:true}));
    // Nature validation resets goal links. Restore those only for the same nature/direction.
    if(cashDraft&&cashDraft['transaction-direction']===value&&cashDraft['transaction-nature']===byId('transaction-nature').value){
     byId('transaction-goal-link').checked=!!cashDraft['transaction-goal-link'];
     byId('transaction-goal-link').dispatchEvent(new Event('change',{bubbles:true}));
     byId('transaction-goal-id').value=cashDraft['transaction-goal-id']||'';
    }
    byId('recurring-count-wrap').classList.toggle('hidden',!byId('transaction-recurring').checked);
    byId('transaction-recurring-count').disabled=!byId('transaction-recurring').checked;
    syncDates();syncTypes();byId('transaction-dialog').querySelector('.entry-body').scrollTop=0;
   }
  }finally{switching=false;}
 }
 for(const [form,source]of [[cash,'cash'],[purchase,'purchase']]){
  form.querySelector('.entry-types').addEventListener('change',event=>{
   if(event.target.matches('[data-entry-type]'))switchType(event.target.value,source);
  });
  form.addEventListener('reset',()=>queueMicrotask(()=>{syncDates();syncTypes();}));
 }
 byId('purchase-card-select').addEventListener('change',event=>{
  byId('purchase-card-id').value=event.target.value;onPurchaseChange();
 });
 byId('transaction-direction').addEventListener('change',syncTypes);
 planning.querySelector('.entry-types').addEventListener('change',event=>{
  if(!event.target.matches('[data-entry-type]'))return;
  const direction=byId('planning-direction');direction.value=event.target.value;
  direction.dispatchEvent(new Event('change',{bubbles:true}));
 });
 byId('planning-direction').addEventListener('change',syncTypes);
 planning.addEventListener('reset',()=>queueMicrotask(()=>{syncTypes();syncDates();}));
 byId('transaction-recurring').addEventListener('change',event=>{byId('transaction-recurring-count').disabled=!event.target.checked;});
 return{beforeOpen};
}
