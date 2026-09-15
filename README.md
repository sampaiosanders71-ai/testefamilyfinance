# Family Finance — autenticação por usuário e senha

Esta é a base reconstruída e homologada do Family Finance.

## Acesso
O usuário final usa somente:
- nome de usuário;
- senha.

Não há campo de e-mail no cadastro, login, perfil, Família ou migração do sistema antigo.

O Supabase Auth exige internamente um identificador de autenticação. Para manter o Auth oficial e o RLS por `auth.uid()` sem pedir dados pessoais adicionais, o backend cria um identificador técnico não entregável e invisível. Ele nunca é mostrado nem digitado pelo usuário.

Fluxo atual no Supabase:
- login usa o Auth oficial diretamente; para contas antigas, um RPC rápido resolve apenas o identificador técnico oculto;
- `ff-username-auth` ficou dedicada somente ao cadastro e já tenta devolver a primeira sessão;
- `ff-username-finalize` padroniza a identidade técnica em segundo plano para acelerar acessos seguintes.

As antigas funções separadas de login/cadastro não fazem parte do fluxo do frontend atual.

## Família
Os convites agora são enviados pelo nome de usuário. A tabela `ff2_family_invites` referencia diretamente o UUID Auth do convidado e não possui coluna de e-mail.

## Migração antiga
Em Configurações → Trazer dados do Family Finance antigo, a pessoa informa apenas o usuário e a senha antigos. O banco valida o hash legado e transfere os dados para o `auth.uid()` atual.

## Segurança
- Supabase Auth oficial;
- RLS baseado em `auth.uid()`;
- chave pública moderna no navegador;
- chaves privilegiadas somente no backend/Edge Functions;
- cadastro público limitado a 5 tentativas por hora por origem;
- senha nunca é armazenada no frontend ou nas tabelas públicas.

## PWA
Manifesto, ícones e Service Worker estão ativos. O shell pode abrir pelo cache; gravações e sincronizações financeiras continuam exigindo conexão.

## Publicação
Publique todo o conteúdo deste pacote no repositório de teste. As mudanças de banco e as Edge Functions já foram aplicadas no Supabase.

## Atualização de iconografia
- Sidebar desktop: ícones vetoriais claros para Início, Lançamentos, Cartões, Metas, Orçamento, Família, Configurações e Sair.
- Dashboard: ícones vetoriais em Ajustar saldo, Novo lançamento, DRE, PDF, Receitas, Despesas, Cartão no mês, Próximas faturas, Metas e Orçamento.
- Navegação mobile: mesmos ícones do desktop para manter reconhecimento visual.
- Não depende de biblioteca externa de ícones; os SVGs ficam no próprio HTML e funcionam offline.


Correção adicional: os ícones de Próximas faturas, Metas e Orçamento agora usam stroke SVG corretamente, sem placeholders pretos.


## Proteção do histórico de lançamentos
- Lançamentos abre em **Todos os períodos**; mudar o mês do dashboard não altera mais o filtro do histórico.
- `ff2_transactions` é carregada em páginas de 500 registros até o fim.
- A contagem exata do banco é conferida antes e depois da leitura. A lista só é aceita quando contagem, quantidade carregada e IDs únicos conferem.
- Se houver mudança concorrente ou leitura incompleta, a sincronização é refeita automaticamente uma vez. Persistindo divergência, a lista anterior é mantida e o app mostra erro, evitando ocultar registros silenciosamente.
- A ordem visual permanece: data do lançamento mais recente primeiro; empates por criação e ID.


## Proteção de login e cadastro

- Tela de carregamento bloqueante durante autenticação e sincronização inicial.
- Usuário, senha, alternância de modo e botão de envio ficam desabilitados durante a operação.
- Segundo submit é ignorado por uma trava lógica, mesmo se disparado por teclado/código.
- Mensagens de etapa: Entrando/Criando conta e Carregando seus dados.
- A finalização técnica da identidade não bloqueia mais a entrada; roda em segundo plano.
- Chamadas concorrentes de inicialização compartilham a mesma Promise para evitar corrida entre `setSession` e `onAuthStateChange`.


## Proteção contra ações repetidas e delays

Operações que dependem do Supabase agora exibem uma tela modal de carregamento que bloqueia a interface até a resposta terminar. Isso cobre gravações, exclusões, faturas, orçamento, Família, configurações, migração, troca de mês e logout. Navegação local, filtros, DRE e geração local de PDF continuam sem bloqueio porque não dependem de ida e volta ao servidor. O carregamento inicial de uma sessão já salva também mostra feedback visual.


## Otimização de cadastro e login — 2026-09-13
- cadastro + primeira sessão em uma única Edge Function (`ff-username-auth`);
- login rápido por identificador técnico determinístico;
- contas antigas migram automaticamente no primeiro login correto;
- `getCurrentUser()` reutiliza a sessão local em vez de validar o mesmo JWT remotamente em cada módulo;
- health check saiu do caminho crítico do login;
- sincronização do histórico preserva integridade com uma chamada a menos no caso comum.


## Reconstrução limpa de autenticação — 2026-09-13
- o `auth.js` anterior foi substituído por uma implementação nova;
- login deixou de passar por Edge Function no caminho normal;
- contas existentes resolvem o identificador técnico por uma RPC curta e autenticam diretamente no Supabase Auth;
- após um login correto, a padronização da conta roda em segundo plano e o dispositivo passa a usar login direto em uma única chamada;
- o cadastro usa uma Edge Function enxuta, sem SDKs/importações externas no runtime;
- perfil + dados essenciais do dashboard carregam em paralelo; compras, Família e status de migração carregam depois, sem segurar a entrada no app;
- inicialização do PWA não bloqueia mais a restauração de sessão;
- RLS continua baseado em `auth.uid()` e nenhuma chave privilegiada foi movida para o navegador.

## Reconstrução visual do Orçamento — 2026-09-15

Etapas 1, 2 e 3 executadas sem alteração de dados no Supabase.

- Interface antiga do módulo Orçamento removida e reconstruída do zero.
- Persistência em `ff2_budget_plans` e `ff2_budget_items` mantida sem alteração.
- Renda planejada agora é explicada como referência e não cria lançamento.
- Resumo mostra renda, valor distribuído, valor sem destino e gasto real.
- Limites por categoria mostram gasto, saldo disponível e percentual utilizado.
- Calibração automática usa até 3 meses anteriores como sugestão local; só grava após `Salvar orçamento`.
- Referência 50/30/20 é apenas explicativa.
- PWA cache atualizado.

## Reconstrução da Central de Notificações — Etapas 4, 5 e 6

A central de notificações foi reconstruída sem apagar dados existentes. O sininho no topo exibe avisos internos, convites da Família e alertas financeiros úteis. O histórico completo fica em "Ver todas as notificações" e as notificações novas chegam em tempo real enquanto o app está aberto.

Alertas financeiros incluídos: orçamento a partir de 80%, orçamento ultrapassado, meta atingida e fatura aberta a até 5 dias do vencimento.

## Reconstrução do relatório financeiro — 15/09/2026

O botão **Baixar relatório** foi reconstruído funcionalmente.

- abre um seletor de um ou vários meses;
- aceita meses não consecutivos;
- possui atalhos para mês atual, últimos 3, últimos 6 e todos os meses com dados;
- consolida gastos reais por categoria e por cartão;
- compara orçamento planejado x realizado em cada mês;
- separa lançamentos futuros do valor realizado;
- mantém ajustes de saldo e pagamentos de fatura fora do resultado para evitar duplicidade;
- nenhum registro financeiro existente foi alterado ou removido.
