# Mayway Soluções: sistema de ordens de pagamento de premiações

**Link do sistema:** https://devlerodrigues.github.io/mayway/  (código: github.com/devlerodrigues/mayway)

## O fluxo
-1. **Contrato (primeiro acesso):** com a exigência ligada (menu Contrato do admin), o cliente só usa o sistema depois de assinar eletronicamente o contrato. O texto é montado no servidor a partir do modelo (`prem_contrato_modelo`, versão 1) com dados do cliente, taxa e TED; o aceite grava texto assinado, hash SHA-256, representante, CPF, login e data (`prem_contrato_aceites`). Antes de ligar, preencher os dados da nossa empresa no menu Contrato.
0. **Campanha obrigatória:** o cliente preenche o briefing (participantes, período, objetivos, critérios de avaliação e de premiação, formas de bonificação, orçamento, logo) e aceita o regulamento (inclui art. 457 §§2º e 4º CLT). Você aprova, pede ajustes ou reprova. Duração máxima 3 meses; ordens aceitas do início até 30 dias após o fim (`prem_config.duracao_max_meses` / `prazo_pos_campanha_dias`). Sem campanha aprovada e vigente o sistema bloqueia a ordem. No cadastro, o calendário do fim só permite até 3 meses após o início. A partir de 15 dias antes do fim (`prem_config.aviso_renovacao_dias`) o cliente vê o aviso "Repetir por mais 3 meses?"; ao confirmar, `prem_renovar_campanha` cria a cópia já aprovada, começando no dia seguinte ao fim (uma repetição por campanha).
1. **Cliente** cadastra seus favorecidos (nome, CPF, PIX ou TED) e envia a ordem com um ou mais favorecidos e o valor de cada um.
2. **Você** envia a **cobrança** (status `nota_emitida`): valor = soma dos pagamentos + sua taxa (% do cliente, ajustável por ordem) + R$ 9,00 por favorecido via TED (`prem_config.custo_ted`). O cliente vê a chave PIX da Mayway, um QR Code e o "PIX copia e cola" com o valor exato (BR Code estático gerado no navegador, `vendor/qrcode.js`; chave em `prem_config.contratada_pix`, menu Contrato).
3. **Cliente** paga por PIX e anexa o comprovante (`pago_cliente`).
4. **Você** paga cada favorecido usando a descrição pré-cadastrada **"Premiação ordem {ORDEM} – por conta e ordem de {CLIENTE}"** (`prem_config.texto_repasse`, editável no menu Contrato, até 140 caracteres, botão Copiar), informa a data de cada pagamento (e o E2E, opcional) e anexa um PDF com todos os comprovantes → `favorecidos_pagos` (RPC `prem_registrar_pagamentos`; grava `prem_ordem_itens.pago_em/pago_ref`).
5. **Você** emite a **NFS-e** no Emissor Nacional com o que o sistema monta (valores, lista de deduções por documento – CPF, nome, data e valor de cada favorecido + TED – e a discriminação), informa o número, anexa o PDF → Concluída (RPC `prem_emitir_nfse`). A taxa entra no faturamento.

Status: Enviar cobrança → Aguardando pagamento do cliente → Pagar favorecidos → Emitir NFS-e → Concluída (ou Cancelada; não dá para cancelar depois que os favorecidos foram pagos). Fluxo novo desde 09/11/2026 (antes a nota vinha primeiro); contrato v1 atualizado nas cláusulas 3, 6.1, 6.3 e 9.5 (sem assinaturas anteriores).

## Modelo da NFS-e (decisão de 09/11/2026)
- Nota única com o valor cheio, emitida **depois** dos pagamentos aos favorecidos: discriminação separando premiações pagas em nome e por conta e ordem do cliente, taxa de administração e custo de transferência, mais a relação dos pagamentos (CPF mascarado); deduções = repasses + TED, por documentos (tipo 99); base de cálculo do ISS = só a taxa. Código 17.06.01 + NBS 1.1406.19.00.
- Emissão automática (API do Emissor Nacional ou intermediário) fica para depois da alteração contratual + certificado A1.
- Conferências (09/11/2026, doc https://claude.ai/artifact/RXNb41mxaLLD6dBaMCyxDZ): Simples só deduz na NFS-e nacional em códigos específicos (17.06 está na lista); BH só aceita dedução por documentos no 17.06. CNAE problemático retirado pelo Leandro. Pendente consulta à PBH e o desdobramento de BH.

## Nossa empresa (CONTRATADA)
- Mayway Soluções em Premiações & Marketing LTDA (fantasia: Mayway Soluções), CNPJ 58.489.885/0001-14, Rua Furquim Werneck, 53, Letra B, Guarani, Belo Horizonte/MG, CEP 31840-050. Representante: Mayara Marques de Castro (sócia-administradora). Foro: Belo Horizonte/MG.
- Em 09/11/2026 a Receita ainda mostrava "Mayara Castro Corretora de Seguros LTDA", só com CNAE 66.22-3-00. Alteração de nome e atividades em andamento.
- Dados gravados em `prem_config` e no contrato (doc). **Assinatura obrigatória ligada em 09/11/2026** a pedido do Leandro (alteração na Junta/Receita ainda em andamento: conferir o nome na Receita quando sair).

## App no celular
- Sistema com nome Mayway Soluções, layout para celular (menu embaixo, tabelas viram cartões, janelas em tela cheia) e instalável como app (manifest + service worker + ícones em `icons/`). iPhone: Safari → Compartilhar → Adicionar à Tela de Início. Android: Chrome → Instalar app (o próprio sistema mostra o botão).

## Notificações
- Sino no topo (contador, lista, abre a ordem/campanha, marcar como lidas) em tempo real (`prem_notificacoes`, Realtime).
- Gatilhos no banco: nova ordem, cobrança enviada, comprovante do cliente, favorecidos pagos, NFS-e emitida, ordem cancelada, campanha nova/ajustada/aprovada/ajustes/reprovada/repetida, contrato assinado. Rotina diária 9h (pg_cron `prem-aviso-campanhas`) avisa o cliente 15 dias antes do fim da campanha.
- Push no celular/computador: cada pessoa ativa no sino. Inscrições em `prem_push_subs`; envio pela função `prem-push` (Supabase Edge Function, chamada pelo banco via pg_net com segredo no Vault `prem_push_secret`). iPhone só com o app instalado na tela inicial.

## Manual e vídeos
- Menu **Ajuda** no sistema (cliente vê o manual do cliente; admin vê os dois), com passo a passo e vídeo.
- Vídeos: `videos/manual-cliente.mp4` (1min45) e `videos/manual-admin.mp4` (1min15) no repositório, gravados com dados fictícios. Link na tela de login também.
- Manual em documento: "Manual de Uso – Mayway Soluções" (https://claude.ai/artifact/Ek6i2CSE2urZWeojkHWjrQ).
- Ao mudar telas importantes, regravar os vídeos (roteiro de gravação em demo com dados fictícios).

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
