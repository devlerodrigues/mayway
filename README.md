
## Indicadores e comissões
- Tabelas `prem_indicadores` (cadastro, % padrão, PIX) e `prem_comissoes` (uma por ordem paga); `prem_clientes.indicador_id` e `comissao_percentual` (% específico, opcional).
- Gatilho `prem_ordens_comissao`: quando `pago_cliente_em` é preenchido, cria a comissão = (valor_pagamento + valor_taxa + custo_transferencia) × %.
- Regra dos 3 meses (`prem_indicador_ativo_em`): só vira `a_pagar` se algum cliente da carteira teve a 1ª ordem paga nos 3 meses anteriores; senão `sem_direito` (não é pago depois). Indicador desativado também gera `sem_direito`.
- Fechamento mensal na tela **Indicadores**: registrar pagamento marca as comissões do mês como `paga`, com data e comprovante (`indicadores/<id>/...`).
