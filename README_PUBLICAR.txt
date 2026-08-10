FAMILY FINANCE - PACOTE CORRIGIDO

Publique todos os arquivos e pastas no GitHub Pages:

- index.html
- sw.js
- css/styles.css
- js/app.js
- manifest.json e icons/ se já existirem no seu repositório

IMPORTANTE:
Não teste login abrindo o arquivo baixado direto pelo celular, pois o navegador abre como content:// ou file://.
Para login, Supabase e sincronização em tempo real funcionarem, abra pelo link HTTPS do GitHub Pages.

Correção desta versão:
- mensagem clara quando o app for aberto como arquivo local/Downloads;
- tratamento melhor para erro TypeError: Failed to fetch no login/cadastro;
- service worker com cache atualizado.
