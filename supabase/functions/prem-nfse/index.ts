// prem-nfse: emissão de NFS-e na API da Receita (Sefin Nacional) a partir de uma ordem do sistema.
// Ações: { acao:'info' } -> dados do certificado | { acao:'emitir', ordem_id, ambiente? } -> emite a nota.
import { createClient } from 'npm:@supabase/supabase-js@2';
import forge from 'npm:node-forge@1.3.1';
import { dpsAssinada, validar, lerNfse, type DadosDps, type Endereco } from './dps.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });
const SEFIN = { 1: 'https://sefin.nfse.gov.br/SefinNacional', 2: 'https://sefin.producaorestrita.nfse.gov.br/SefinNacional' } as const;

const brl = (n: number) => 'R$ ' + Number(n).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const dig = (s: string) => String(s || '').replace(/\D/g, '');
const dBr = (iso: string) => iso.split('-').reverse().join('/');
const cpfMasc = (c: string) => { const d = dig(c).padStart(11, '0'); return `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**`; };
function agoraBrasilia(): string {
  const t = new Date(Date.now() - 60_000 - 3 * 3600_000); // 1 min de folga, fuso -03:00
  return t.toISOString().slice(0, 19) + '-03:00';
}

async function gzipB64(s: string): Promise<string> {
  const cs = new Blob([new TextEncoder().encode(s)]).stream().pipeThrough(new CompressionStream('gzip'));
  const buf = new Uint8Array(await new Response(cs).arrayBuffer());
  let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}
async function gunzipB64(b64: string): Promise<string> {
  const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const ds = new Blob([bin]).stream().pipeThrough(new DecompressionStream('gzip'));
  return await new Response(ds).text();
}

type Cert = { pfxB64: string; senha: string; keyPem: string; certPem: string; cadeiaPem: string[]; certB64: string; key: forge.pki.rsa.PrivateKey; titular: string; cnpj: string | null; validade: string; emissor: string };
async function carregarCertificado(adm: ReturnType<typeof createClient>): Promise<Cert> {
  const { data: cfg, error: eCfg } = await adm.from('prem_config').select('nfse_cert_path').single();
  if (eCfg) throw new Error('Não consegui ler a configuração: ' + eCfg.message);
  if (!cfg?.nfse_cert_path) throw new Error('Certificado A1 não cadastrado. Envie o arquivo .pfx em Contrato → NFS-e automática.');
  const { data: arq, error } = await adm.storage.from('nfse-cert').download(cfg.nfse_cert_path);
  if (error || !arq) throw new Error('Não consegui ler o arquivo do certificado.');
  const { data: senha } = await adm.rpc('prem_nfse_ler_senha');
  if (!senha) throw new Error('Senha do certificado não cadastrada.');
  const bytes = new Uint8Array(await arq.arrayBuffer());
  let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  let p12;
  try { p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(bin), false, senha); }
  catch (e) {
    const det = String((e as Error)?.message || e);
    console.error('pkcs12', det, (e as Error)?.stack);
    if (/MAC|password|Invalid/i.test(det)) throw new Error('Senha do certificado incorreta (a senha não abre este arquivo). Detalhe: ' + det);
    throw new Error('Não consegui abrir o certificado. Detalhe: ' + det);
  }
  const keyBag = (p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] || [])[0]
    || (p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] || [])[0];
  if (!keyBag?.key) throw new Error('Chave privada não encontrada no certificado.');
  const key = keyBag.key as forge.pki.rsa.PrivateKey;
  const certs = (p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || []).map((b) => b.cert!).filter(Boolean);
  const cert = certs.find((c) => (c.publicKey as forge.pki.rsa.PublicKey).n.equals(key.n)) || certs[0];
  if (!cert) throw new Error('Certificado não encontrado no arquivo.');
  const cadeia = [cert]; let atual = cert;
  for (let i = 0; i < 5; i++) {
    const emissor = certs.find((c) => c !== atual && c.subject.hash === atual.issuer.hash);
    if (!emissor || emissor.subject.hash === emissor.issuer.hash) break;
    cadeia.push(emissor); atual = emissor;
  }
  const cn = String(cert.subject.getField('CN')?.value || '');
  const keyPem = forge.pki.privateKeyInfoToPem(forge.pki.wrapRsaPrivateKey(forge.pki.privateKeyToAsn1(key)));
  return {
    pfxB64: btoa(bin), senha: String(senha),
    key, keyPem, certPem: forge.pki.certificateToPem(cert), cadeiaPem: cadeia.map((c) => forge.pki.certificateToPem(c)),
    certB64: forge.util.encode64(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes()),
    titular: cn, cnpj: (cn.match(/:(\d{14})$/) || [])[1] || null,
    validade: cert.validity.notAfter.toISOString(), emissor: String(cert.issuer.getField('CN')?.value || ''),
  };
}

// A Sefin pede o certificado por renegociação TLS 1.2, que o servidor de funções do Supabase não suporta.
// O envio passa pela ponte própria (pasta ponte-nfse do repositório), que não guarda nada:
// recebe o certificado a cada chamada, fala com a Receita e devolve a resposta.
// deno-lint-ignore no-explicit-any
async function chamar(_adm: any, cert: Cert, url: string, init: { method: string; body?: string }) {
  const ponte = (Deno.env.get('NFSE_PONTE_URL') || '').replace(/\/+$/, '');
  const token = Deno.env.get('NFSE_PONTE_TOKEN') || '';
  if (!ponte || !token) throw new Error('A ponte da NFS-e ainda não está configurada.');
  const r = await fetch(`${ponte}/mtls`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-ponte-token': token },
    body: JSON.stringify({ pfx: cert.pfxB64, senha: cert.senha, metodo: init.method, url, corpo: init.body ?? null }),
    signal: AbortSignal.timeout(120_000),
  });
  const p = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('Ponte: ' + (p.erro || `HTTP ${r.status}`));
  // deno-lint-ignore no-explicit-any
  let corpo: any = null; try { corpo = JSON.parse(p.corpo); } catch (_) { corpo = { texto: String(p.corpo || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 2000) }; }
  return { status: Number(p.status), corpo };
}

function mensagensErro(corpo: any): string {
  const lista = corpo?.erros || corpo?.Erros || corpo?.erro || corpo?.errors || [];
  const arr = Array.isArray(lista) ? lista : [lista];
  const msgs = arr.map((e: any) => [e?.Codigo ?? e?.codigo, e?.Descricao ?? e?.descricao ?? e?.mensagem, e?.Complemento ?? e?.complemento].filter(Boolean).join(' – ')).filter(Boolean);
  return msgs.join(' | ') || corpo?.texto || corpo?.message || 'Rejeitada sem mensagem';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
    const { data: eu } = await asUser.auth.getUser();
    if (!eu?.user) return json({ error: 'Faça login novamente' }, 401);
    const { data: ehAdmin } = await asUser.rpc('prem_is_admin');
    if (ehAdmin !== true) return json({ error: 'Só administradores emitem NFS-e' }, 403);
    const sk = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const adm = createClient(url, sk, { auth: { persistSession: false, autoRefreshToken: false, storageKey: 'prem-nfse-adm' }, global: { headers: { apikey: sk, Authorization: 'Bearer ' + sk } } });
    const body = await req.json().catch(() => ({}));

    if (body.acao === 'info') {
      const c = await carregarCertificado(adm);
      const info = { titular: c.titular, cnpj: c.cnpj, validade: c.validade, emissor: c.emissor };
      await adm.from('prem_config').update({ nfse_cert_info: info }).not('id', 'is', null);
      return json({ ok: true, ...info });
    }
    if (body.acao !== 'emitir' || !body.ordem_id) return json({ error: 'Ação inválida' }, 400);
    if (!Deno.env.get('NFSE_PONTE_URL') || !Deno.env.get('NFSE_PONTE_TOKEN')) return json({ error: 'A ponte da NFS-e ainda não está configurada. Use a emissão manual pelo portal por enquanto.' }, 400);

    // ---------- dados ----------
    const { data: cfg, error: eCfg } = await adm.from('prem_config').select('*').single();
    if (!cfg) throw new Error('Não consegui ler a configuração: ' + (eCfg?.message || 'vazia'));
    const ambiente = (Number(body.ambiente) || cfg.nfse_ambiente || 2) as 1 | 2;
    const { data: o } = await adm.from('prem_ordens').select('*, prem_clientes(*), prem_campanhas(nome)').eq('id', body.ordem_id).single();
    if (!o) return json({ error: 'Ordem não encontrada' }, 404);
    if (o.status !== 'favorecidos_pagos') return json({ error: 'A ordem precisa estar na etapa "Emitir NFS-e" (favorecidos pagos).' }, 400);
    const { data: ja } = await adm.from('prem_nfse').select('*').eq('ordem_id', o.id).eq('ambiente', ambiente).order('created_at', { ascending: false });
    if (ambiente === 1 && (ja || []).some((n: any) => n.status === 'autorizada')) return json({ error: 'Esta ordem já tem NFS-e autorizada.' }, 400);
    const pendente = (ja || []).find((n: any) => n.status === 'enviando' && Date.now() - new Date(n.created_at).getTime() < 120_000);
    if (pendente) return json({ error: 'Já há um envio em andamento para esta ordem. Aguarde 2 minutos.' }, 409);

    const cli = o.prem_clientes;
    const endCli: Endereco | null = cli?.cep && cli?.cod_ibge
      ? { cep: cli.cep, logradouro: cli.logradouro, numero: cli.numero, complemento: cli.complemento, bairro: cli.bairro, ibge: cli.cod_ibge } : null;
    const { data: itens } = await adm.from('prem_ordem_itens').select('*').eq('ordem_id', o.id).order('nome');
    const favs = (itens || []).map((i: any) => {
      const e = i.endereco && i.endereco.cep && (i.endereco.ibge) ? { cep: i.endereco.cep, logradouro: i.endereco.logradouro, numero: i.endereco.numero, complemento: i.endereco.complemento, bairro: i.endereco.bairro, ibge: i.endereco.ibge } : endCli;
      return { nome: i.nome, cpf: i.cpf, valor: Number(i.valor), pagoEm: i.pago_em, endereco: e as Endereco };
    });
    if (favs.some((f) => !f.endereco)) return json({ error: `Cadastre o endereço com CEP do cliente ${cli?.nome} (Clientes → editar). Ele é usado para os favorecidos sem endereço.` }, 400);
    if (favs.some((f) => !f.pagoEm)) return json({ error: 'Há favorecido sem data de pagamento.' }, 400);

    const rep = Number(o.valor_pagamento), tx = Number(o.valor_taxa), ted = Number(o.custo_transferencia || 0);
    const total = Math.round((rep + tx + ted) * 100) / 100;
    const dCompet = favs.map((f) => f.pagoEm).sort().pop()!;
    const linhas = favs.map((f) => `- ${f.nome} – CPF ${cpfMasc(f.cpf)} – ${brl(f.valor)} (${dBr(f.pagoEm)})`);
    const cab = `Serviço de planejamento e gestão de campanha de incentivo (premiação por desempenho) – Ordem nº ${o.numero}` +
      (o.prem_campanhas?.nome ? ` – Campanha "${o.prem_campanhas.nome}"` : '') + `.\nValor total do serviço: ${brl(total)}, composto por:\n` +
      `(a) Premiações pagas em nome e por conta e ordem do tomador aos participantes da campanha: ${brl(rep)} – valor deduzido da base de cálculo (documentos relacionados);\n` +
      `(b) Taxa de administração (${Number(o.taxa_percentual).toLocaleString('pt-BR')}%): ${brl(tx)} – base de cálculo do ISSQN` +
      (ted > 0 ? `;\n(c) Custo de transferência (TED) repassado ao tomador: ${brl(ted)} – valor deduzido.` : '.') +
      `\nRelação dos pagamentos realizados:\n`;
    const rod = '\nOs valores repassados não constituem receita do prestador.';
    let corpoLista = linhas.join('\n');
    if ((cab + corpoLista + rod).length > 2000) {
      let n = linhas.length; while (n > 0 && (cab + linhas.slice(0, n).join('\n') + `\n... e mais ${linhas.length - n} pagamentos (ver documentos de dedução)` + rod).length > 2000) n--;
      corpoLista = linhas.slice(0, n).join('\n') + `\n... e mais ${linhas.length - n} pagamentos (ver documentos de dedução)`;
    }
    const descricao = cab + corpoLista + rod;

    const cert = await carregarCertificado(adm);
    if (new Date(cert.validade) < new Date()) return json({ error: `Certificado vencido em ${cert.validade.slice(0, 10)}.` }, 400);
    const prestCnpj = dig(cfg.contratada_cnpj || '') || cert.cnpj || '';

    // ---------- recuperar envio anterior com resultado desconhecido ----------
    for (const n of (ja || []).filter((n: any) => n.status === 'erro' && !n.chave)) {
      const r = await chamar(adm, cert, `${SEFIN[ambiente]}/dps/${n.id_dps}`, { method: 'GET' }).catch(() => null);
      const chave = r && r.status === 200 ? (r.corpo?.chaveAcesso || r.corpo?.ChaveAcesso) : null;
      if (chave) {
        const q = await chamar(adm, cert, `${SEFIN[ambiente]}/nfse/${chave}`, { method: 'GET' });
        if (q.status === 200 && q.corpo?.nfseXmlGZipB64) return await finalizar(adm, o, n.id, ambiente, chave, await gunzipB64(q.corpo.nfseXmlGZipB64), q.corpo);
      }
    }

    const nDps = Number((await adm.rpc('prem_nfse_reservar_dps', { p_ambiente: ambiente })).data);
    const dados: DadosDps = {
      ambiente, serie: cfg.nfse_serie || '1', nDps, dhEmi: agoraBrasilia(), dCompet, codMun: cfg.nfse_cod_mun || '3106200',
      prestCnpj, aliqSn: Number(cfg.nfse_aliq_sn || 6),
      tomador: { doc: cli.documento, nome: cli.nome, email: cli.email, endereco: endCli },
      cTribNac: cfg.nfse_ctrib_nac || '170601', cTribMun: cfg.nfse_ctrib_mun || '001', nbs: cfg.nfse_nbs || '114061900',
      descricao, valorServico: total, ordemNumero: o.numero, favorecidos: favs, custoTed: ted,
    };
    const erros = validar(dados);
    if (erros.length) return json({ error: erros.join('; ') }, 400);

    const { xml, id } = await dpsAssinada(dados, {
      certB64: cert.certB64,
      sha1b64: async (s) => { const md = forge.md.sha1.create(); md.update(s, 'utf8'); return forge.util.encode64(md.digest().getBytes()); },
      assinarRsaSha1b64: async (s) => { const md = forge.md.sha1.create(); md.update(s, 'utf8'); return forge.util.encode64(cert.key.sign(md)); },
    });
    const { data: reg } = await adm.from('prem_nfse').insert({ ordem_id: o.id, ambiente, id_dps: id, n_dps: nDps, serie: dados.serie, status: 'enviando', xml_dps: xml, criado_por: eu.user.id }).select().single();

    let r;
    try {
      r = await chamar(adm, cert, `${SEFIN[ambiente]}/nfse`, { method: 'POST', body: JSON.stringify({ dpsXmlGZipB64: await gzipB64(xml) }) });
    } catch (e) {
      await adm.from('prem_nfse').update({ status: 'erro', mensagem: 'Falha de comunicação: ' + String((e as Error).message || e).slice(0, 500) }).eq('id', reg.id);
      return json({ error: 'Falha de comunicação com a Receita. Tente de novo: o sistema confere antes se a nota chegou a ser gerada.' }, 502);
    }
    const chave = r.corpo?.chaveAcesso || r.corpo?.ChaveAcesso;
    if ((r.status === 200 || r.status === 201) && chave && r.corpo?.nfseXmlGZipB64) {
      return await finalizar(adm, o, reg.id, ambiente, chave, await gunzipB64(r.corpo.nfseXmlGZipB64), r.corpo);
    }
    const msg = mensagensErro(r.corpo);
    await adm.from('prem_nfse').update({ status: r.status >= 500 ? 'erro' : 'rejeitada', mensagem: `HTTP ${r.status}: ${msg}`.slice(0, 2000), resposta: r.corpo }).eq('id', reg.id);
    return json({ error: `A Receita recusou a DPS: ${msg}`, http: r.status }, 422);
  } catch (e) {
    console.error('prem-nfse', (e as Error)?.message, (e as Error)?.stack);
    return json({ error: (e as Error).message || 'Erro' }, 500);
  }
});

// deno-lint-ignore no-explicit-any
async function finalizar(adm: any, o: any, regId: string, ambiente: number, chave: string, xmlNfse: string, resposta: unknown) {
  const { numero } = lerNfse(xmlNfse);
  const path = `${o.cliente_id}/${o.id}/nfse-${ambiente === 1 ? '' : 'homolog-'}${numero || chave}.xml`;
  await adm.storage.from('premiacao').upload(path, new Blob([xmlNfse], { type: 'application/xml' }), { upsert: true, contentType: 'application/xml' });
  await adm.from('prem_nfse').update({ status: 'autorizada', chave, numero, xml_nfse_path: path, resposta, mensagem: null }).eq('id', regId);
  if (ambiente === 1) {
    const { error } = await adm.rpc('prem_nfse_concluir', { p_ordem: o.id, p_numero: numero || chave, p_anexo: path });
    if (error) return json({ ok: true, ambiente, chave, numero, aviso: 'Nota autorizada, mas não consegui concluir a ordem: ' + error.message });
  }
  return json({ ok: true, ambiente, chave, numero, xml_path: path });
}
