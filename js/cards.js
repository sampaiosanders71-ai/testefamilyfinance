import { operationIds, insertOnce } from './request-operation.js?v=2.9.12';
import { listAllRows } from './pagination.js?v=2.9.12';
import { supabase } from './supabase.js?v=2.9.12';
import { getCurrentUser } from './database.js?v=2.9.12';
import { monthISO } from './finance.js?v=2.9.12';

export async function listCards() {
  const user = await getCurrentUser();
  const rows = await listAllRows(options => supabase.from('ff2_cards').select('*',options).eq('user_id',user.id).eq('active',true).order('created_at').order('id'), 'listCards');
  return rows;
}

export async function createCard(input) {
  const user = await getCurrentUser();
  const row = {
    id: operationIds(input)[0],
    user_id: user.id, name: input.name.trim(), credit_limit: Number(input.limit), closing_day: Number(input.closingDay),
    due_day: Number(input.dueDay), revolving_interest: Number(input.interest || 0), active: true
  };
  return (await insertOnce(supabase, 'ff2_cards', row, user.id, 'id'))[0];
}

export async function updateCard(id, input) {
  const user = await getCurrentUser();
  const { data, error } = await supabase.from('ff2_cards').update({
    name: input.name.trim(), credit_limit: Number(input.limit), closing_day: Number(input.closingDay),
    due_day: Number(input.dueDay), revolving_interest: Number(input.interest || 0), updated_at: new Date().toISOString()
  }).eq('id', id).eq('user_id', user.id).select('*').single();
  if (error) throw error;
  return data;
}

export async function deleteCard(id) {
  const user = await getCurrentUser();
  const { error } = await supabase.from('ff2_cards').delete().eq('id', id).eq('user_id', user.id);
  if (error) throw error;
}

export async function createPurchase(input) {
  const { data, error } = await supabase.rpc('ff2_create_card_purchase', {
    p_card_id: input.cardId,
    p_description: input.description,
    p_total_amount: Number(input.total),
    p_purchase_date: input.date,
    p_category: input.category || 'Outros',
    p_installment_count: Number(input.installments),
    p_client_request_id: operationIds(input)[0]
  });
  if (error) throw error;
  return data;
}

export async function updatePurchase(id, input) {
  const { data, error } = await supabase.rpc('ff2_update_card_purchase', {
    p_purchase_id: id,
    p_description: input.description,
    p_total_amount: Number(input.total),
    p_purchase_date: input.date,
    p_category: input.category || 'Outros',
    p_installment_count: Number(input.installments)
  });
  if (error) throw error;
  return data;
}

export async function deletePurchase(id) {
  const user = await getCurrentUser();
  const { error } = await supabase.from('ff2_card_purchases').delete().eq('id', id).eq('user_id', user.id);
  if (error) throw error;
}

export async function listPurchases() {
  const user = await getCurrentUser();
  const rows = await listAllRows(options => supabase.from('ff2_card_purchases').select('*, ff2_cards(name)',options).eq('user_id',user.id).order('created_at',{ascending:false}).order('id',{ascending:false}), 'listPurchases');
  return rows.sort((a,b)=>String(b.purchase_date||'').localeCompare(String(a.purchase_date||''))||String(b.created_at||'').localeCompare(String(a.created_at||''))); 
}

export async function listInstallments() {
  const user = await getCurrentUser();
  const rows = await listAllRows(options => supabase.from('ff2_card_installments').select('*, ff2_card_purchases(description,category,total_amount,installment_count,purchase_date), ff2_cards(name,due_day,closing_day)',options).eq('user_id',user.id).order('invoice_month').order('installment_no').order('id'), 'listInstallments');
  return rows;
}

export async function listInvoiceStatuses() {
  const user = await getCurrentUser();
  const rows = await listAllRows(options => supabase.from('ff2_card_invoices').select('*',options).eq('user_id',user.id).order('id'), 'listInvoiceStatuses');
  return rows;
}

export async function setInvoicePaid(cardId, invoiceMonth, paid) {
  const { data, error } = await supabase.rpc('ff2_set_invoice_paid', {
    p_card_id: cardId,
    p_invoice_month: invoiceMonth,
    p_paid: !!paid
  });
  if (error) throw error;
  return data;
}

export function sumCardExpensesForMonth(installments, refDate) {
  const key = monthISO(refDate);
  return installments.filter(i => i.invoice_month === key).reduce((sum, i) => sum + Number(i.amount || 0), 0);
}

export function cardInvoiceSummaries(cards, installments, statuses, refDate = new Date()) {
  const key = monthISO(refDate);
  return cards.map(card => {
    const rows = installments.filter(i => i.card_id === card.id && i.invoice_month === key);
    const total = rows.reduce((sum, i) => sum + Number(i.amount || 0), 0);
    const status = statuses.find(s => s.card_id === card.id && s.invoice_month === key)?.status || 'open';
    const month = new Date(refDate.getFullYear(), refDate.getMonth(), 1, 12);
    let dueMonth = new Date(month.getFullYear(), month.getMonth(), 1, 12);
    if (Number(card.due_day) <= Number(card.closing_day)) dueMonth = new Date(month.getFullYear(), month.getMonth() + 1, 1, 12);
    const dueDay = Math.min(Number(card.due_day), new Date(dueMonth.getFullYear(), dueMonth.getMonth() + 1, 0).getDate());
    const dueDate = new Date(dueMonth.getFullYear(), dueMonth.getMonth(), dueDay, 12);
    return { card, rows, total, status, invoiceMonth:key, dueDate };
  });
}
