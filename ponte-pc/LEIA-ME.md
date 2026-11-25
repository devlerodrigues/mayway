# Ponte NFS-e no PC (Windows)

Programa em PowerShell (já vem no Windows) que leva as notas do sistema até a Receita.
A Sefin Nacional pede o certificado por renegociação TLS; o Windows faz isso, o Supabase não.

Como funciona: o sistema põe o pedido numa fila; este programa consulta a fila a cada 3 s,
envia para a Receita com o certificado que vem no pedido (apagado da fila no mesmo instante),
e devolve a resposta. Nada fica gravado no PC além do log em `%LOCALAPPDATA%\MaywayPonte`.

Instalar: colocar `ponte.ps1`, `instalar.bat` e `config.json` na mesma pasta e dar dois cliques em
`instalar.bat`. Ele abre sozinho com o Windows. Para remover: `desinstalar.bat`.

`config.json` (não vai para o GitHub): `{ "supabase_url": "...", "chave_publica": "sb_publishable_...", "token": "..." }`
— o token é o segredo `prem_ponte_token` do Vault.
