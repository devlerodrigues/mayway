# Ponte NFS-e

Serviço pequeno (Node.js, sem dependências) que leva a nota do sistema até a Sefin Nacional.

Por que existe: a Sefin pede o certificado A1 por renegociação TLS 1.2, e o servidor de
funções do Supabase não suporta isso. O Node.js (OpenSSL) suporta.

- Não guarda nada: certificado e senha chegam a cada chamada (vindos do cofre do Supabase).
- Só aceita chamadas com o token secreto `RELAY_TOKEN`.
- Só fala com `sefin`/`adn` `*.nfse.gov.br`.

Hospedar: qualquer serviço que rode Node 20+ (`npm start`), de preferência com servidor no Brasil.
Depois, no Supabase, criar os segredos da função `prem-nfse`:
`NFSE_PONTE_URL` (endereço da ponte) e `NFSE_PONTE_TOKEN` (o mesmo valor do `RELAY_TOKEN`).
