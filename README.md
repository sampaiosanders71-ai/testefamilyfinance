# Family Finance — Reconstrução total (Etapas 1–9)

Esta base NÃO reutiliza o frontend antigo.

## Etapa 7 — Família
- convites por e-mail;
- aceitar/recusar/cancelar convite;
- vínculos familiares;
- permissões separadas para Lançamentos, Cartões, Metas e Orçamento;
- monitoramento em modo somente leitura;
- RLS baseado em auth.uid() e vínculo ativo.

## Etapa 8 — Interface definitiva
- layout desktop com sidebar;
- layout mobile próprio com navegação inferior;
- menu móvel para Orçamento, Família e Configurações;
- modais e formulários responsivos;
- tema Escuro / Claro / Sistema salvo no perfil;
- telas de Família e Configurações reconstruídas.

## Etapa 9 — Migração segura
As 7 contas antigas usam username e não possuem e-mail no sistema legado. Por isso os dados NÃO são atribuídos a contas Auth inventadas.

Fluxo correto:
1. usuário cria sua conta nova com e-mail;
2. abre Configurações > Trazer dados do Family Finance antigo;
3. informa username + senha antigos;
4. o banco verifica o hash bcrypt legado;
5. os dados são copiados para o auth.uid() atual;
6. o vínculo é registrado e não pode ser reivindicado por outra conta.

O banco legado e o snapshot ff_backup_20260913 continuam preservados.

## Banco
As alterações das etapas 7 e 9 já foram aplicadas no Supabase.
O Security Advisor foi validado sem alertas após o isolamento da rotina privilegiada de migração.

## PWA
O Service Worker continua intencionalmente sem cache. A instalação/offline entra somente na Etapa 10 após a homologação funcional.


## Etapa 10 — homologação e PWA

- manifesto PWA definitivo com ícones 192/512 e suporte iOS;
- Service Worker de shell com limpeza automática de caches antigos;
- instalação disponível em Configurações → Aplicativo quando o navegador liberar;
- navegação pode abrir pelo cache, mas sincronizações financeiras continuam exigindo internet;
- RLS e índices otimizados no Supabase;
- Security Advisor final sem alertas.
