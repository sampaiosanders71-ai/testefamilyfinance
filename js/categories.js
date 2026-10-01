import { supabase } from './supabase.js';
import { getCurrentUser } from './database.js';

export const CATEGORY_DEFAULTS = [
  { kind:'expense', name:'Alimentação', origin:'default', default_key:'expense_food', icon_key:'food', color_key:'orange', sort_order:10 },
  { kind:'expense', name:'Transporte', origin:'default', default_key:'expense_transport', icon_key:'car', color_key:'blue', sort_order:20 },
  { kind:'expense', name:'Moradia', origin:'default', default_key:'expense_home', icon_key:'home', color_key:'green', sort_order:30 },
  { kind:'expense', name:'Saúde', origin:'default', default_key:'expense_health', icon_key:'health', color_key:'red', sort_order:40 },
  { kind:'expense', name:'Lazer', origin:'default', default_key:'expense_leisure', icon_key:'leisure', color_key:'purple', sort_order:50 },
  { kind:'expense', name:'Educação', origin:'default', default_key:'expense_education', icon_key:'education', color_key:'purple', sort_order:60 },
  { kind:'expense', name:'Assinaturas', origin:'default', default_key:'expense_subscriptions', icon_key:'subscription', color_key:'pink', sort_order:70 },
  { kind:'expense', name:'Dívidas', origin:'default', default_key:'expense_debt', icon_key:'debt', color_key:'red', sort_order:80 },
  { kind:'expense', name:'Investimento', origin:'default', default_key:'expense_investment', icon_key:'investment', color_key:'green', sort_order:90 },
  { kind:'expense', name:'Outros', origin:'system', default_key:'expense_other', icon_key:'more', color_key:'slate', sort_order:999 },
  { kind:'income', name:'Salário', origin:'default', default_key:'income_salary', icon_key:'salary', color_key:'green', sort_order:10 },
  { kind:'income', name:'Bolsa', origin:'default', default_key:'income_scholarship', icon_key:'education', color_key:'purple', sort_order:20 },
  { kind:'income', name:'Pensão', origin:'default', default_key:'income_pension', icon_key:'income', color_key:'green', sort_order:30 },
  { kind:'income', name:'Benefícios', origin:'default', default_key:'income_benefits', icon_key:'benefit', color_key:'blue', sort_order:40 },
  { kind:'income', name:'Rendimentos', origin:'default', default_key:'income_returns', icon_key:'investment', color_key:'green', sort_order:50 },
  { kind:'income', name:'Reembolso', origin:'default', default_key:'income_refund', icon_key:'refund', color_key:'teal', sort_order:60 },
  { kind:'income', name:'Outros', origin:'system', default_key:'income_other', icon_key:'more', color_key:'slate', sort_order:999 }
];

export const CATEGORY_ICON_OPTIONS = [
  ['tag','Categoria'],['food','Alimentação'],['car','Transporte'],['home','Casa'],['health','Saúde'],
  ['education','Educação'],['leisure','Lazer'],['subscription','Assinatura'],['debt','Dívida'],
  ['investment','Investimento'],['salary','Salário'],['income','Receita'],['benefit','Benefício'],
  ['refund','Reembolso'],['fuel','Combustível'],['gift','Presente'],['pet','Pet'],['travel','Viagem'],['more','Outros']
];

export const CATEGORY_COLOR_OPTIONS = [
  ['orange','Laranja'],['blue','Azul'],['green','Verde'],['red','Vermelho'],['purple','Roxo'],
  ['pink','Rosa'],['yellow','Amarelo'],['teal','Turquesa'],['slate','Cinza']
];

function cleanName(value){return String(value??'').replace(/\s+/g,' ').trim()}

export function categoryGlyph(iconKey='tag'){
  return ({
    tag:'●',food:'🍴',car:'🚗',home:'⌂',health:'♥',education:'◆',leisure:'★',subscription:'▣',
    debt:'↓',investment:'↗',salary:'$',income:'+',benefit:'✦',refund:'↩',fuel:'⛽',gift:'◆',pet:'●',travel:'✈',more:'•••'
  })[iconKey]||'●';
}

async function ensureDefaults(user){
  const { data: existing, error } = await supabase.from('ff2_categories').select('kind,name,default_key').eq('user_id',user.id).eq('is_deleted',false);
  if(error)throw error;
  const identityKeys=new Set((existing||[]).map(row=>row.default_key).filter(Boolean));
  const legacyKeys=new Set((existing||[]).map(row=>`${row.kind}|${String(row.name).toLocaleLowerCase('pt-BR')}`));
  const missing=CATEGORY_DEFAULTS.filter(row=>!identityKeys.has(row.default_key)&&!legacyKeys.has(`${row.kind}|${row.name.toLocaleLowerCase('pt-BR')}`)).map(row=>({user_id:user.id,...row}));
  if(!missing.length)return;
  const { error: insertError }=await supabase.from('ff2_categories').insert(missing);
  if(insertError)throw insertError;
}

export async function listCategories(){
  const user=await getCurrentUser();
  await ensureDefaults(user);
  const { data,error }=await supabase.from('ff2_categories').select('*').eq('user_id',user.id).eq('is_deleted',false).order('kind').order('sort_order').order('name');
  if(error)throw error;
  return data||[];
}

export function activeCategories(rows,kind){
  return (rows||[]).filter(row=>!row.is_deleted&&row.is_active&&(row.kind===kind||row.kind==='both'));
}

export async function createCategory({kind,name,iconKey='tag',colorKey='orange'}){
  const user=await getCurrentUser();
  const cleaned=cleanName(name);
  if(!['income','expense'].includes(kind))throw new Error('Escolha se a categoria é de receita ou despesa.');
  if(cleaned.length<2||cleaned.length>60)throw new Error('O nome da categoria deve ter entre 2 e 60 caracteres.');
  const { data:duplicates,error:duplicateError }=await supabase.from('ff2_categories').select('id').eq('user_id',user.id).eq('kind',kind).eq('is_deleted',false).ilike('name',cleaned).limit(1);
  if(duplicateError)throw duplicateError;
  if((duplicates||[]).length)throw new Error(`A categoria “${cleaned}” já existe.`);
  const { data,error }=await supabase.from('ff2_categories').insert({
    user_id:user.id,kind,name:cleaned,origin:'custom',is_active:true,is_deleted:false,
    icon_key:String(iconKey||'tag'),color_key:String(colorKey||'orange'),sort_order:1000,updated_at:new Date().toISOString()
  }).select('*').single();
  if(error)throw error;
  return data;
}

export async function updateCategory(id,{name,iconKey,colorKey}){
  const user=await getCurrentUser();
  const cleaned=cleanName(name);
  if(cleaned.length<2||cleaned.length>60)throw new Error('O nome da categoria deve ter entre 2 e 60 caracteres.');
  const { data:current,error:currentError }=await supabase.from('ff2_categories').select('*').eq('id',id).eq('user_id',user.id).single();
  if(currentError)throw currentError;
  const safeName=current.origin==='system'?current.name:cleaned;
  const { data:dupes,error:dupeError }=await supabase.from('ff2_categories').select('id').eq('user_id',user.id).eq('kind',current.kind).eq('is_deleted',false).ilike('name',safeName);
  if(dupeError)throw dupeError;
  if((dupes||[]).some(row=>row.id!==id))throw new Error(`A categoria “${safeName}” já existe.`);
  const { data,error }=await supabase.from('ff2_categories').update({
    name:safeName,icon_key:String(iconKey||current.icon_key||'tag'),color_key:String(colorKey||current.color_key||'slate'),updated_at:new Date().toISOString()
  }).eq('id',id).eq('user_id',user.id).select('*').single();
  if(error)throw error;
  return data;
}

export async function setCategoryActive(id,active){
  const user=await getCurrentUser();
  const { data,error }=await supabase.from('ff2_categories').update({is_active:!!active,updated_at:new Date().toISOString()}).eq('id',id).eq('user_id',user.id).eq('is_deleted',false).select('*').single();
  if(error)throw error;
  return data;
}

export async function deleteCustomCategory(id){
  const user=await getCurrentUser();
  const { data:current,error:currentError }=await supabase.from('ff2_categories').select('*').eq('id',id).eq('user_id',user.id).single();
  if(currentError)throw currentError;
  if(current.origin!=='custom')throw new Error('Categorias padrão podem ser ocultadas, mas não excluídas.');
  const { data,error }=await supabase.from('ff2_categories').update({is_active:false,is_deleted:true,updated_at:new Date().toISOString()}).eq('id',id).eq('user_id',user.id).select('*').single();
  if(error)throw error;
  return data;
}
