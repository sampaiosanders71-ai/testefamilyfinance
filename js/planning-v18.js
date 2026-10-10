import { supabase } from './supabase.js';
import { getCurrentUser, newRequestId } from './database.js';

export function planningMonthKey(value=new Date()){
  const date=value instanceof Date?value:new Date(`${String(value).slice(0,7)}-01T12:00:00`);
  if(Number.isNaN(date.getTime()))throw new TypeError('INVALID_PLANNING_MONTH');
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-01`;
}
export function planningMonthDate(value){const key=planningMonthKey(value);return new Date(Number(key.slice(0,4)),Number(key.slice(5,7))-1,1,12)}
export function shiftPlanningMonth(value,offset){const d=planningMonthDate(value);return new Date(d.getFullYear(),d.getMonth()+Number(offset||0),1,12)}
export function planningMonthInput(value){return planningMonthKey(value).slice(0,7)}
export function planningLocalISO(date=new Date()){return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`}
function nextMonthKey(value){return planningMonthKey(shiftPlanningMonth(value,1))}

export async function listPlanningMonth(value=new Date()){
  const user=await getCurrentUser();const start=planningMonthKey(value),end=nextMonthKey(value);
  const {data,error}=await supabase.from('ff2_planning_items').select('*').eq('user_id',user.id).gte('planned_on',start).lt('planned_on',end).order('planned_on',{ascending:true}).order('created_at',{ascending:true});
  if(error)throw error;return data||[];
}
export async function listPlanningByMonths(monthKeys=[]){
  const user=await getCurrentUser();const keys=[...new Set((monthKeys||[]).map(planningMonthKey))].sort();if(!keys.length)return{};
  const start=keys[0],end=nextMonthKey(keys[keys.length-1]);
  const {data,error}=await supabase.from('ff2_planning_items').select('*').eq('user_id',user.id).gte('planned_on',start).lt('planned_on',end).order('planned_on',{ascending:true});
  if(error)throw error;const wanted=new Set(keys);const out=Object.fromEntries(keys.map(k=>[k,[]]));
  (data||[]).forEach(row=>{const key=`${String(row.planned_on).slice(0,7)}-01`;if(wanted.has(key))out[key].push(row)});return out;
}
export function planningNature(item){
  if(Number(item?.direction)>0)return 'income';
  return ['consumption','allocation','transfer'].includes(item?.financial_nature)?item.financial_nature:'consumption';
}
export async function createPlanningItem(input){
  const user=await getCurrentUser();const row={user_id:user.id,direction:Number(input.direction)>0?1:-1,description:String(input.description||'').trim(),amount:Number(input.amount),planned_on:input.date,category:input.category||'Outros',status:'pending',financial_nature:Number(input.direction)>0?'income':(input.financialNature||'consumption'),notes:String(input.notes||'').trim()||null,client_request_id:newRequestId()};
  const {data,error}=await supabase.from('ff2_planning_items').insert(row).select('*').single();if(error)throw error;return data;
}
export async function updatePlanningItem(id,input){
  const user=await getCurrentUser();const changes={direction:Number(input.direction)>0?1:-1,description:String(input.description||'').trim(),amount:Number(input.amount),planned_on:input.date,category:input.category||'Outros',financial_nature:Number(input.direction)>0?'income':(input.financialNature||'consumption'),notes:String(input.notes||'').trim()||null,updated_at:new Date().toISOString()};
  const {data,error}=await supabase.from('ff2_planning_items').update(changes).eq('id',id).eq('user_id',user.id).eq('status','pending').select('*').single();if(error)throw error;return data;
}
export async function cancelPlanningItem(id){const user=await getCurrentUser();const {data,error}=await supabase.from('ff2_planning_items').update({status:'cancelled',updated_at:new Date().toISOString()}).eq('id',id).eq('user_id',user.id).eq('status','pending').select('*').single();if(error)throw error;return data}
export async function completePlanningItem(id,realizedOn=planningLocalISO(new Date()),nature='consumption'){
  const fn='ff2_complete_planning_item';
  const {data,error}=await supabase.rpc(fn,{p_item_id:id,p_realized_on:realizedOn});if(error)throw error;return data;
}
export async function movePlanningItem(id,targetDate,nature='consumption'){const fn='ff2_move_planning_item';const {data,error}=await supabase.rpc(fn,{p_item_id:id,p_target_date:targetDate});if(error)throw error;return data}
export async function movePendingPlanningMonth(sourceMonth,targetMonth){
 const {data,error}=await supabase.rpc('ff2_move_pending_planning_month_297',{
  p_source_month:planningMonthKey(sourceMonth),p_target_month:planningMonthKey(targetMonth)
 });
 if(error)throw error;
 return Number(data||0);
}
export function planningNextMonthDate(plannedOn){const d=new Date(`${plannedOn}T12:00:00`);const target=new Date(d.getFullYear(),d.getMonth()+1,1,12);const last=new Date(target.getFullYear(),target.getMonth()+1,0,12).getDate();target.setDate(Math.min(d.getDate(),last));return planningLocalISO(target)}
export function planningStatusLabel(item){if(item.status==='received')return'Recebido';if(item.status==='paid')return'Pago';if(item.status==='deferred')return'Adiado';if(item.status==='cancelled')return'Cancelado';return'Pendente'}
export function summarizePlanning(items=[]){
  const summary={plannedIncome:0,plannedExpense:0,plannedAllocation:0,plannedTransfer:0,plannedResult:0,plannedFreeResult:0,received:0,paid:0,allocated:0,pendingIncome:0,pendingExpense:0,pendingAllocation:0,pendingTransfer:0,deferred:0,cancelled:0,completedCount:0,pendingCount:0,deferredCount:0,cancelledCount:0,totalCount:items.length,completionRate:0};
  for(const item of items){
    const amount=Math.max(0,Number(item.amount||0)),nature=planningNature(item),active=!['deferred','cancelled'].includes(item.status);
    if(active){if(nature==='income')summary.plannedIncome+=amount;else if(nature==='allocation')summary.plannedAllocation+=amount;else if(nature==='transfer')summary.plannedTransfer+=amount;else summary.plannedExpense+=amount;}
    if(item.status==='received'){summary.received+=amount;summary.completedCount++;}
    else if(item.status==='paid'){if(nature==='allocation')summary.allocated+=amount;else if(nature==='consumption')summary.paid+=amount;summary.completedCount++;}
    else if(item.status==='pending'){
      if(nature==='income')summary.pendingIncome+=amount;
      else if(nature==='allocation')summary.pendingAllocation+=amount;
      else if(nature==='transfer')summary.pendingTransfer+=amount;
      else summary.pendingExpense+=amount;
      summary.pendingCount++;
    }else if(item.status==='deferred'){summary.deferred+=amount;summary.deferredCount++;}
    else if(item.status==='cancelled'){summary.cancelled+=amount;summary.cancelledCount++;}
  }
  summary.plannedResult=summary.plannedIncome-summary.plannedExpense;
  summary.plannedFreeResult=summary.plannedResult-summary.plannedAllocation-summary.plannedTransfer;
  const base=summary.completedCount+summary.pendingCount+summary.deferredCount;
  summary.completionRate=base?summary.completedCount/base*100:0;
  return summary;
}
export function summarizePlanningPeriod(byMonth={},monthKeys=[]){return summarizePlanning((monthKeys||[]).flatMap(key=>byMonth[planningMonthKey(key)]||[]))}
