import { calculateCashStats } from './finance.js';
import { sumCardExpensesForMonth } from './cards.js';
import { buildVisualPdf, PDF_PAGE } from './pdf.js';

const C = {
  ink:'#171717', muted:'#6f7379', subtle:'#9b9da1', panel:'#f5f2ed', line:'#dedbd5',
  orange:'#f28a2b', orangeSoft:'#fff0df', green:'#2f8f61', red:'#b84e4e', blue:'#4477aa', white:'#ffffff', dark:'#242526'
};

function requireDate(value) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new TypeError('REPORT_DATE_REQUIRED');
  return new Date(value.getFullYear(), value.getMonth(), 1, 12, 0, 0, 0);
}
function monthPrefix(date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`; }
function monthKey(date) { return `${monthPrefix(date)}-01`; }
function dateFromMonthKey(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})(?:-01)?$/);
  if (!match) throw new TypeError('INVALID_REPORT_MONTH');
  return new Date(Number(match[1]), Number(match[2]) - 1, 1, 12, 0, 0, 0);
}
function normalizeMonthKey(value) { return monthKey(value instanceof Date ? requireDate(value) : dateFromMonthKey(value)); }
function sortedMonthKeys(keys) { return [...new Set((keys || []).map(normalizeMonthKey))].sort(); }
function shiftKey(key, offset) { const d=dateFromMonthKey(key); return monthKey(new Date(d.getFullYear(),d.getMonth()+Number(offset||0),1,12)); }
function reportMoney(formatBRL, value) { return String(formatBRL(Number(value) || 0)).replace(/\u00a0/g, ' '); }
function compactText(value, max = 72) { const t=String(value??'').replace(/\s+/g,' ').trim(); return t.length<=max?t:`${t.slice(0,Math.max(1,max-3))}...`; }
function sumRows(rows, field='amount') { return (rows||[]).reduce((sum,row)=>sum+Number(row?.[field]||0),0); }
function pctChange(current, previous) { const a=Number(current||0), b=Number(previous||0); if(Math.abs(b)<0.005)return Math.abs(a)<0.005?0:null; return ((a-b)/Math.abs(b))*100; }

function actualCashRows(transactions,key,todayISO,direction){const prefix=key.slice(0,7);return (transactions||[]).filter(row=>row?.affects_month_result===true&&Number(row.direction)===direction&&String(row.occurred_on||'').startsWith(prefix)&&String(row.occurred_on||'')<=todayISO)}
function scheduledCashRows(transactions,key,todayISO){const prefix=key.slice(0,7);return (transactions||[]).filter(row=>row?.affects_month_result===true&&Number(row.direction)<0&&String(row.occurred_on||'').startsWith(prefix)&&String(row.occurred_on||'')>todayISO)}
function actualCardRows(installments,key,todayISO){return (installments||[]).filter(row=>String(row.invoice_month||'')===key&&(!row.ff2_card_purchases?.purchase_date||String(row.ff2_card_purchases.purchase_date)<=todayISO))}
function scheduledCardRows(installments,key,todayISO){return (installments||[]).filter(row=>String(row.invoice_month||'')===key&&row.ff2_card_purchases?.purchase_date&&String(row.ff2_card_purchases.purchase_date)>todayISO)}
function addCategory(target,category,cash=0,card=0){const name=String(category||'Outros').trim()||'Outros';if(!target[name])target[name]={category:name,cash:0,card:0,total:0};target[name].cash+=Number(cash||0);target[name].card+=Number(card||0);target[name].total=target[name].cash+target[name].card}
function addCard(target,cardName,amount,status='open'){const name=String(cardName||'Cartão').trim()||'Cartão';if(!target[name])target[name]={name,total:0,status};target[name].total+=Number(amount||0);if(status==='paid')target[name].status='paid'}
function invoiceStatusFor(invoiceStatuses,cardId,key){return (invoiceStatuses||[]).find(row=>row.card_id===cardId&&row.invoice_month===key)?.status||'open'}

function buildMonthModel({transactions,installments,invoiceStatuses,budget,key,todayISO,monthLabel}){
  const date=dateFromMonthKey(key), incomeRows=actualCashRows(transactions,key,todayISO,1), expenseRows=actualCashRows(transactions,key,todayISO,-1), cardRows=actualCardRows(installments,key,todayISO);
  const futureCashRows=scheduledCashRows(transactions,key,todayISO), futureCardRows=scheduledCardRows(installments,key,todayISO);
  const income=sumRows(incomeRows), cashExpense=sumRows(expenseRows), cardExpense=sumRows(cardRows), totalExpense=cashExpense+cardExpense;
  const categoryMap={}; expenseRows.forEach(row=>addCategory(categoryMap,row.category,row.amount,0)); cardRows.forEach(row=>addCategory(categoryMap,row.ff2_card_purchases?.category,0,row.amount));
  const categories=Object.values(categoryMap).sort((a,b)=>b.total-a.total||a.category.localeCompare(b.category,'pt-BR'));
  const cardMap={}; cardRows.forEach(row=>addCard(cardMap,row.ff2_cards?.name||'Cartão',row.amount,invoiceStatusFor(invoiceStatuses,row.card_id,key)));
  const cards=Object.values(cardMap).sort((a,b)=>b.total-a.total||a.name.localeCompare(b.name,'pt-BR'));
  const limits=Object.fromEntries((budget?.items||[]).map(item=>[item.category,Number(item.limit_amount||0)]));
  const budgetCategories=[...new Set([...Object.keys(limits),...categories.map(item=>item.category)])].map(category=>{const spent=categoryMap[category]?.total||0,limit=limits[category]||0;return{category,limit,spent,available:limit-spent}}).filter(item=>item.limit>0||item.spent>0).sort((a,b)=>Math.max(b.limit,b.spent)-Math.max(a.limit,a.spent));
  const details=[...expenseRows.map(row=>({date:row.occurred_on,description:row.description||'Despesa',category:row.category||'Outros',source:'À vista / conta',amount:Number(row.amount||0)})),...cardRows.map(row=>({date:row.ff2_card_purchases?.purchase_date||key,description:row.ff2_card_purchases?.description||'Compra no cartão',category:row.ff2_card_purchases?.category||'Outros',source:`${row.ff2_cards?.name||'Cartão'} · parcela ${row.installment_no}/${row.ff2_card_purchases?.installment_count||'?'}`,amount:Number(row.amount||0)}))].sort((a,b)=>String(a.date).localeCompare(String(b.date))||a.description.localeCompare(b.description,'pt-BR'));
  return {key,date,label:monthLabel(date),income,cashExpense,cardExpense,totalExpense,result:income-totalExpense,scheduledExpense:sumRows(futureCashRows)+sumRows(futureCardRows),categories,cards,details,budget:{plannedIncome:Number(budget?.plan?.planned_income||0),totalLimit:Object.values(limits).reduce((s,v)=>s+Number(v||0),0),categories:budgetCategories,exists:!!budget?.plan}};
}
function aggregateCategories(months){const map={};for(const month of months)for(const item of month.categories)addCategory(map,item.category,item.cash,item.card);return Object.values(map).sort((a,b)=>b.total-a.total||a.category.localeCompare(b.category,'pt-BR'))}
function aggregateCards(months){const map={};for(const month of months)for(const item of month.cards)addCard(map,item.name,item.total,item.status);return Object.values(map).sort((a,b)=>b.total-a.total)}
function aggregateBudget(months){const map={};let plannedIncome=0,totalLimit=0;for(const month of months){plannedIncome+=month.budget.plannedIncome;totalLimit+=month.budget.totalLimit;for(const item of month.budget.categories){if(!map[item.category])map[item.category]={category:item.category,limit:0,spent:0};map[item.category].limit+=item.limit;map[item.category].spent+=item.spent}}return{plannedIncome,totalLimit,categories:Object.values(map).map(item=>({...item,available:item.limit-item.spent})).sort((a,b)=>Math.max(b.limit,b.spent)-Math.max(a.limit,a.spent))}}

export function getMonthlyDRE(transactions,installments,refDate){const date=requireDate(refDate),cash=calculateCashStats(transactions||[],date),cardExpense=sumCardExpensesForMonth(installments||[],date),totalExpense=cash.expense+cardExpense;return{income:cash.income,cashExpense:cash.expense,cardExpense,totalExpense,result:cash.income-totalExpense}}
export function getReportMonthOptions(transactions,installments,referenceDate=new Date()){const reference=requireDate(referenceDate),now=new Date(),todayISO=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`,keys=new Set([monthKey(reference)]);for(let offset=0;offset<12;offset++)keys.add(monthKey(new Date(reference.getFullYear(),reference.getMonth()-offset,1,12)));for(const row of transactions||[]){const raw=String(row.occurred_on||'');if(row?.affects_month_result===true&&raw<=todayISO&&/^\d{4}-\d{2}/.test(raw))keys.add(`${raw.slice(0,7)}-01`)}for(const row of installments||[]){const raw=String(row.invoice_month||''),purchaseDate=String(row.ff2_card_purchases?.purchase_date||'');if(/^\d{4}-\d{2}-01$/.test(raw)&&(!purchaseDate||purchaseDate<=todayISO))keys.add(raw)}return[...keys].map(key=>({key,date:dateFromMonthKey(key)})).sort((a,b)=>b.key.localeCompare(a.key))}
export function buildFinancialReportModel({transactions,installments,invoiceStatuses,budgetsByMonth={},monthKeys,monthLabel,today=new Date()}){const keys=sortedMonthKeys(monthKeys||[]);if(!keys.length)throw new Error('Selecione pelo menos um mês para o relatório.');const todayISO=`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;const months=keys.map(key=>buildMonthModel({transactions,installments,invoiceStatuses,budget:budgetsByMonth[key]||{plan:null,items:[]},key,todayISO,monthLabel}));const totals=months.reduce((a,m)=>{a.income+=m.income;a.cashExpense+=m.cashExpense;a.cardExpense+=m.cardExpense;a.totalExpense+=m.totalExpense;a.result+=m.result;a.scheduledExpense+=m.scheduledExpense;return a},{income:0,cashExpense:0,cardExpense:0,totalExpense:0,result:0,scheduledExpense:0});return{keys,months,totals,categories:aggregateCategories(months),cards:aggregateCards(months),budget:aggregateBudget(months)}}

function wrapText(text,maxChars=70){const words=String(text||'').split(/\s+/).filter(Boolean),lines=[];let current='';for(const word of words){const next=current?`${current} ${word}`:word;if(next.length>maxChars&&current){lines.push(current);current=word}else current=next}if(current)lines.push(current);return lines.length?lines:['']}
function page(){return[]}
function text(p,x,y,value,size=10,opts={}){p.push({type:'text',x,y,text:String(value??''),size,bold:!!opts.bold,color:opts.color||C.ink,align:opts.align});}
function rect(p,x,y,w,h,fill,stroke){p.push({type:'rect',x,y,w,h,fill,stroke});}
function line(p,x1,y1,x2,y2,color=C.line,width=1){p.push({type:'line',x1,y1,x2,y2,color,width});}
function circle(p,x,y,r,fill){p.push({type:'circle',x,y,r,fill});}
function polyline(p,points,color,width=2){p.push({type:'polyline',points,color,width});}
function sectionTitle(p,y,title,subtitle=''){text(p,44,y,title,13,{bold:true});if(subtitle)text(p,44,y+18,subtitle,8,{color:C.muted});return y+34}
function metricCard(p,x,y,w,label,value,change,formatMoney,{goodUp=true,captionOverride=''}={}){rect(p,x,y,w,72,C.panel);text(p,x+12,y+12,label,8,{color:C.muted});text(p,x+12,y+31,reportMoney(formatMoney,value),15,{bold:true});let caption=captionOverride||'Sem base anterior',color=C.muted;if(!captionOverride&&change!==null&&Number.isFinite(change)){caption=`${change>0?'+':''}${change.toFixed(1)}% vs mês anterior`;const good=goodUp?change>=0:change<=0;color=Math.abs(change)<0.05?C.muted:(good?C.green:C.red)}text(p,x+12,y+53,caption,7.5,{color});}
function drawLineChart(p,{x,y,w,h,months,formatMoney}){rect(p,x,y,w,h,C.white,C.line);const plot={x:x+44,y:y+26,w:w-58,h:h-52};const max=Math.max(1,...months.flatMap(m=>[m.income,m.totalExpense]));for(let i=0;i<4;i++){const gy=plot.y+(plot.h/3)*i;line(p,plot.x,gy,plot.x+plot.w,gy,'#e7e4df',0.6);const val=max*(1-i/3);text(p,plot.x-8,gy-4,compactText(reportMoney(formatMoney,val),11),6.5,{color:C.subtle,align:'right'})}const pointsFor=field=>months.map((m,i)=>({x:plot.x+(months.length===1?plot.w/2:(plot.w*i/(months.length-1))),y:plot.y+plot.h-(Number(m[field]||0)/max)*plot.h}));const incomePts=pointsFor('income'),expensePts=pointsFor('totalExpense');if(incomePts.length>1){polyline(p,incomePts,C.green,1.8);polyline(p,expensePts,C.orange,1.8)}incomePts.forEach(pt=>circle(p,pt.x,pt.y,2.3,C.green));expensePts.forEach(pt=>circle(p,pt.x,pt.y,2.3,C.orange));months.forEach((m,i)=>{const px=plot.x+(months.length===1?plot.w/2:(plot.w*i/(months.length-1)));text(p,px,plot.y+plot.h+10,String(m.label).slice(0,3),6.8,{color:C.muted,align:'center'})});circle(p,x+14,y+14,2.5,C.green);text(p,x+21,y+8,'Receitas',7,{color:C.muted});circle(p,x+78,y+14,2.5,C.orange);text(p,x+85,y+8,'Despesas',7,{color:C.muted});}
function drawCategoryBars(p,{x,y,w,rows,total,formatMoney}){const max=Math.max(1,...rows.map(r=>r.total));let cy=y;for(const row of rows){text(p,x,cy,compactText(row.category,22),8,{bold:true});text(p,x+w,cy,reportMoney(formatMoney,row.total),8,{align:'right'});const by=cy+13;rect(p,x,by,w,8,'#eeeae4');rect(p,x,by,w*(row.total/max),8,C.orange);const pct=total>0?(row.total/total*100):0;text(p,x+w,by+11,`${pct.toFixed(1)}%`,6.5,{color:C.muted,align:'right'});cy+=35}return cy}
function categoryComparisonRows(current,previous,limit=7){const a=Object.fromEntries((current.categories||[]).map(i=>[i.category,Number(i.total||0)])),b=Object.fromEntries((previous.categories||[]).map(i=>[i.category,Number(i.total||0)]));return [...new Set([...Object.keys(a),...Object.keys(b)])].map(category=>({category,a:a[category]||0,b:b[category]||0})).sort((x,y)=>Math.max(y.a,y.b)-Math.max(x.a,x.b)||x.category.localeCompare(y.category,'pt-BR')).slice(0,limit)}
function drawCategoryComparisonBars(p,{x,y,w,rows,labelA,labelB,formatMoney}){const max=Math.max(1,...rows.flatMap(r=>[r.a,r.b]));circle(p,x,y+4,2.4,C.orange);text(p,x+8,y-2,labelA,6.7,{color:C.muted});circle(p,x+112,y+4,2.4,C.blue);text(p,x+120,y-2,labelB,6.7,{color:C.muted});let cy=y+22;for(const row of rows){text(p,x,cy,compactText(row.category,22),8,{bold:true});text(p,x+w,cy,`${reportMoney(formatMoney,row.a)} / ${reportMoney(formatMoney,row.b)}`,7.3,{align:'right',color:C.muted});rect(p,x,cy+13,w,6,'#eeeae4');rect(p,x,cy+13,w*(row.a/max),6,C.orange);rect(p,x,cy+22,w,6,'#eeeae4');rect(p,x,cy+22,w*(row.b/max),6,C.blue);cy+=39}return cy}
function drawBudgetBars(p,{x,y,w,rows,formatMoney}){const max=Math.max(1,...rows.flatMap(r=>[r.limit,r.spent]));let cy=y;for(const row of rows){text(p,x,cy,compactText(row.category,22),8,{bold:true});text(p,x+w,cy,`${reportMoney(formatMoney,row.spent)} / ${reportMoney(formatMoney,row.limit)}`,7.5,{align:'right',color:C.muted});rect(p,x,cy+13,w,6,'#eeeae4');rect(p,x,cy+13,w*(row.limit/max),6,C.blue);rect(p,x,cy+22,w,6,'#eeeae4');rect(p,x,cy+22,w*(row.spent/max),6,row.spent>row.limit&&row.limit>0?C.red:C.orange);cy+=39}text(p,x,cy+2,'Planejado',6.5,{color:C.blue});text(p,x+62,cy+2,'Realizado',6.5,{color:C.orange});return cy+16}
function insightLines(current,previous,formatMoney){const expensePct=pctChange(current.totalExpense,previous.totalExpense),result=[];if(expensePct===null){if(current.totalExpense>0&&previous.totalExpense===0)result.push('Os gastos saíram de zero no mês atual.')}else if(Math.abs(expensePct)<0.1)result.push('Os gastos ficaram praticamente estáveis em relação ao mês anterior.');else result.push(`Os gastos ${expensePct>0?'aumentaram':'diminuíram'} ${Math.abs(expensePct).toFixed(1)}% em relação ao mês anterior.`);const a=Object.fromEntries(current.categories.map(i=>[i.category,i.total])),b=Object.fromEntries(previous.categories.map(i=>[i.category,i.total]));const changes=[...new Set([...Object.keys(a),...Object.keys(b)])].map(category=>({category,delta:(a[category]||0)-(b[category]||0)}));const inc=[...changes].sort((x,y)=>y.delta-x.delta).find(i=>i.delta>0.005),dec=[...changes].sort((x,y)=>x.delta-y.delta).find(i=>i.delta<-0.005);if(inc)result.push(`${inc.category} teve o maior aumento: ${reportMoney(formatMoney,Math.abs(inc.delta))}.`);if(dec)result.push(`${dec.category} teve a maior redução: ${reportMoney(formatMoney,Math.abs(dec.delta))}.`);result.push(current.result>=0?'O mês mais recente fechou com resultado positivo.':'O mês mais recente fechou com resultado negativo.');return result.slice(0,4)}


function decorateReportPages(pages,{today,periodText}){
  const total=pages.length;
  pages.forEach((ops,index)=>{
    const footer=[];
    text(footer,505,730,`Página ${index+1} de ${total}`,6.8,{align:'right',color:C.subtle});
    if(index===0){
      text(footer,552,117,`Gerado em ${today.toLocaleDateString('pt-BR')}`,7,{align:'right',color:C.subtle});
      text(footer,552,129,compactText(periodText,38),7,{align:'right',color:C.muted});
    }
    pages[index]=ops.concat(footer);
  });
  return pages;
}

function reportTitle(p,title,subtitle=''){
  text(p,48,126,title,20,{bold:true,color:C.ink});
  if(subtitle) text(p,48,151,subtitle,10,{color:C.muted});
}

function buildAnalyticalPages({model,comparisonModel,contextModel,formatDate,formatBRL,monthLabel,today}){
  const pages=[];
  const latest=model.months[model.months.length-1],previous=comparisonModel.months[0];
  const selectedLabels=model.months.map(m=>m.label);
  const periodText=selectedLabels.length===1?selectedLabels[0]:`${selectedLabels[0]} a ${selectedLabels[selectedLabels.length-1]}`;

  const p1=page();pages.push(p1);
  reportTitle(p1,'Relatório Financeiro',periodText);
  text(p1,48,176,'Resumo executivo',13,{bold:true});
  const cardW=121,gap=10,multiCaption=model.months.length>1?`Total de ${model.months.length} meses`:'';
  metricCard(p1,48,198,cardW,'Receitas',model.totals.income,model.months.length===1?pctChange(latest.income,previous.income):null,formatBRL,{goodUp:true,captionOverride:multiCaption});
  metricCard(p1,48+cardW+gap,198,cardW,'Despesas',model.totals.totalExpense,model.months.length===1?pctChange(latest.totalExpense,previous.totalExpense):null,formatBRL,{goodUp:false,captionOverride:multiCaption});
  metricCard(p1,48+(cardW+gap)*2,198,cardW,'Resultado',model.totals.result,model.months.length===1?pctChange(latest.result,previous.result):null,formatBRL,{goodUp:true,captionOverride:multiCaption});
  metricCard(p1,48+(cardW+gap)*3,198,cardW,'Cartão',model.totals.cardExpense,model.months.length===1?pctChange(latest.cardExpense,previous.cardExpense):null,formatBRL,{goodUp:false,captionOverride:multiCaption});
  let y=292;
  y=sectionTitle(p1,y,'Evolução financeira','Receitas e despesas dos últimos meses até a competência mais recente.');
  drawLineChart(p1,{x:48,y,w:516,h:160,months:contextModel.months,formatMoney:formatBRL});
  y+=182;
  y=sectionTitle(p1,y,'Leitura automática',`${latest.label} comparado a ${previous.label}.`);
  rect(p1,48,y,516,112,C.orangeSoft);
  let iy=y+14;
  for(const insight of insightLines(latest,previous,formatBRL)){
    for(const wrapped of wrapText(insight,80)){text(p1,62,iy,`- ${wrapped}`,8.1,{color:C.ink});iy+=14}
    iy+=2;
  }
  text(p1,48,710,'Ajustes de saldo e pagamentos de fatura não são contabilizados novamente no resultado.',6.8,{color:C.subtle});

  const p2=page();pages.push(p2);
  reportTitle(p2,'Categorias e limites',`Comparativo financeiro - ${periodText}`);
  let y2=184;
  y2=sectionTitle(p2,y2,'Comparação por categoria',`${latest.label} x ${previous.label}. Laranja = atual; azul = anterior.`);
  const compareRows=categoryComparisonRows(latest,previous,5);
  if(compareRows.length)y2=drawCategoryComparisonBars(p2,{x:48,y:y2,w:516,rows:compareRows,labelA:latest.label,labelB:previous.label,formatMoney:formatBRL});
  else{text(p2,48,y2,'Nenhum gasto realizado nos meses comparados.',9,{color:C.muted});y2+=28}
  y2+=12;
  y2=sectionTitle(p2,y2,'Limites x realizado','Comparação entre os limites configurados e os gastos realizados.');
  const budgetRows=model.budget.categories.filter(r=>r.limit>0||r.spent>0).slice(0,5);
  if(budgetRows.length)y2=drawBudgetBars(p2,{x:48,y:y2,w:516,rows:budgetRows,formatMoney:formatBRL});
  else{text(p2,48,y2,'Nenhum limite salvo para os meses selecionados.',9,{color:C.muted});y2+=30}
  if(y2<650){
    y2+=10;y2=sectionTitle(p2,y2,'Cartões',model.cards.length?'Gastos por cartão no período selecionado.':'Nenhuma compra no cartão no período.');
    if(model.cards.length){
      const max=Math.max(1,...model.cards.map(c=>c.total));let cy=y2;
      for(const card of model.cards.slice(0,3)){
        text(p2,48,cy,compactText(card.name,30),8,{bold:true});
        text(p2,564,cy,reportMoney(formatBRL,card.total),8,{align:'right'});
        rect(p2,48,cy+13,516,7,'#eeeae4');rect(p2,48,cy+13,516*(card.total/max),7,C.blue);cy+=31;
      }
    }
  }

  for(const month of model.months){
    const p=page();pages.push(p);
    reportTitle(p,month.label,'Resumo mensal e detalhamento dos gastos realizados.');
    metricCard(p,48,170,121,'Receitas',month.income,null,formatBRL);
    metricCard(p,179,170,121,'Despesas',month.totalExpense,null,formatBRL,{goodUp:false});
    metricCard(p,310,170,121,'Resultado',month.result,null,formatBRL);
    metricCard(p,441,170,123,'Cartão',month.cardExpense,null,formatBRL,{goodUp:false});
    let y=264;
    y=sectionTitle(p,y,'Principais categorias','Maiores gastos realizados no mês.');
    if(month.categories.length)y=drawCategoryBars(p,{x:48,y,w:516,rows:month.categories.slice(0,4),total:month.totalExpense,formatMoney:formatBRL});
    else{text(p,48,y,'Sem gastos realizados neste mês.',9,{color:C.muted});y+=25}
    y+=8;y=sectionTitle(p,y,'Detalhamento','Lançamentos que compõem as despesas realizadas.');
    const rows=month.details,rowH=15,contentBottom=710;
    const maxRows=Math.max(0,Math.floor((contentBottom-y-22)/rowH));
    const firstRows=rows.slice(0,maxRows);
    text(p,48,y,'Data',7,{bold:true,color:C.muted});text(p,110,y,'Descrição',7,{bold:true,color:C.muted});text(p,338,y,'Categoria',7,{bold:true,color:C.muted});text(p,506,y,'Valor',7,{bold:true,color:C.muted});line(p,48,y+12,564,y+12,C.line,.7);
    let ry=y+18;
    for(const row of firstRows){text(p,48,ry,formatDate(row.date),7.2);text(p,110,ry,compactText(row.description,34),7.2);text(p,338,ry,compactText(row.category,20),7.2);text(p,564,ry,reportMoney(formatBRL,row.amount),7.2,{align:'right'});ry+=rowH}
    let remaining=rows.slice(firstRows.length);
    while(remaining.length){
      const extra=page();pages.push(extra);reportTitle(extra,`${month.label} - continuação`,'Detalhamento dos gastos realizados.');
      let ey=188;text(extra,48,ey,'Data',7,{bold:true,color:C.muted});text(extra,110,ey,'Descrição',7,{bold:true,color:C.muted});text(extra,338,ey,'Categoria',7,{bold:true,color:C.muted});text(extra,506,ey,'Valor',7,{bold:true,color:C.muted});line(extra,48,ey+12,564,ey+12,C.line,.7);ey+=20;
      const capacity=Math.floor((710-ey)/rowH),batch=remaining.slice(0,capacity);
      for(const row of batch){text(extra,48,ey,formatDate(row.date),7.2);text(extra,110,ey,compactText(row.description,34),7.2);text(extra,338,ey,compactText(row.category,20),7.2);text(extra,564,ey,reportMoney(formatBRL,row.amount),7.2,{align:'right'});ey+=rowH}
      remaining=remaining.slice(batch.length);
    }
  }
  return decorateReportPages(pages,{today,periodText});
}

let letterheadCache=null;
async function loadLetterheadJpeg(){
  if(letterheadCache)return letterheadCache;
  const response=await fetch('./assets/report-letterhead.jpg?rev=official-letterhead',{cache:'force-cache'});
  if(!response.ok)throw new Error('Não foi possível carregar o papel timbrado do relatório.');
  letterheadCache={bytes:new Uint8Array(await response.arrayBuffer()),width:1530,height:1980};
  return letterheadCache;
}

export async function buildFinancialReportPDFBytes({transactions,installments,invoiceStatuses,budgetsByMonth,monthKeys,comparisonMonthKey,contextMonthKeys,formatDate,formatBRL,monthLabel,today=new Date(),backgroundJpeg=null}){
  const model=buildFinancialReportModel({transactions,installments,invoiceStatuses,budgetsByMonth,monthKeys,monthLabel,today});
  const latestKey=model.keys[model.keys.length-1],comparisonKey=normalizeMonthKey(comparisonMonthKey||shiftKey(latestKey,-1));
  const comparisonModel=buildFinancialReportModel({transactions,installments,invoiceStatuses,budgetsByMonth,monthKeys:[comparisonKey],monthLabel,today});
  const contextKeys=(contextMonthKeys&&contextMonthKeys.length?contextMonthKeys:Array.from({length:6},(_,i)=>shiftKey(latestKey,i-5))).map(normalizeMonthKey);
  const contextModel=buildFinancialReportModel({transactions,installments,invoiceStatuses,budgetsByMonth,monthKeys:contextKeys,monthLabel,today});
  const pages=buildAnalyticalPages({model,comparisonModel,contextModel,formatDate,formatBRL,monthLabel,today});
  const bg=backgroundJpeg||await loadLetterheadJpeg();
  const bytes=buildVisualPdf(pages,{backgroundJpeg:bg});
  return{model,bytes};
}

export async function downloadFinancialReportPDF(args){
  const {model,bytes}=await buildFinancialReportPDFBytes(args);
  const blob=new Blob([bytes],{type:'application/pdf'}),url=URL.createObjectURL(blob),anchor=document.createElement('a');
  anchor.href=url;const first=model.keys[0].slice(0,7),last=model.keys[model.keys.length-1].slice(0,7);
  anchor.download=first===last?`family-finance-analise-${first}.pdf`:`family-finance-analise-${first}-a-${last}.pdf`;
  anchor.style.display='none';document.body.appendChild(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);return model;
}

