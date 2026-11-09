# Sistema Premiação: ordens de pagamento

## O fluxo
1. **Cliente** envia a ordem (favorecido, dados de pagamento, valor, anexo).
2. **Você** emite a nota: valor da nota = pagamento + sua taxa (% cadastrada no cliente, ajustável por ordem).
3. **Cliente** baixa a nota, paga e anexa o comprovante.
4. **Você** paga o favorecido, anexa o comprovante e conclui. A taxa entra no faturamento.

Status: Aguardando nota → Aguardando pagamento do cliente → Pagar favorecido → Concluída (ou Cancelada).

## Onde estão os dados
- Supabase, projeto **Sistema Alter**, tabelas `prem_*` (isoladas das tabelas do Alter).
- Arquivos no bucket privado `premiacao` (pastas por cliente/ordem, até 15 MB por arquivo).
- Cada cliente só vê as próprias ordens. Usuários do Alter não enxergam nada do Premiação.
- Admin: leandro160490@gmail.com (para adicionar outro admin: inserir o e-mail na tabela `prem_admin_emails`).

## Publicar o site (grátis)
**GitHub Pages:** crie um repositório → envie o `index.html` → Settings → Pages → Branch `main` / root → Salvar. O link fica `https://SEU-USUARIO.github.io/NOME-DO-REPO/`.
**Vercel / Netlify:** arraste a pasta com o `index.html` no painel (Netlify Drop) ou importe o repositório.

Depois de publicar, no Supabase → Authentication → URL Configuration:
- **Site URL** e **Redirect URLs**: adicione o link do site (necessário para os e-mails de confirmação e de "esqueci a senha").
- Como o Alter usa o mesmo login, confira se **Allow new users to sign up** está ligado (é por aí que o cliente cria a senha no "Primeiro acesso").

## Como liberar um cliente
1. No sistema → **Clientes** → **Novo cliente** → informe o e-mail e a taxa.
2. Avise o cliente: abrir o link → **Primeiro acesso** → criar a senha com esse e-mail.
