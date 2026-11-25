// Montagem e assinatura da DPS (NFS-e Nacional, leiaute 1.01).
// Módulo puro: a criptografia (SHA-1 e RSA-SHA1) é injetada, para rodar no Deno (edge) e no Node (testes).

export const NS = 'http://www.sped.fazenda.gov.br/nfse';
export const DSIG = 'http://www.w3.org/2000/09/xmldsig#';

export type Endereco = { cep: string; logradouro: string; numero: string; complemento?: string | null; bairro: string; ibge: string };
export type Favorecido = { nome: string; cpf: string; valor: number; pagoEm: string; endereco: Endereco };
export type DadosDps = {
  ambiente: 1 | 2;
  serie: string;
  nDps: number;
  dhEmi: string;          // AAAA-MM-DDThh:mm:ss-03:00
  dCompet: string;        // AAAA-MM-DD
  codMun: string;         // IBGE do emissor e da prestação
  prestCnpj: string;
  prestIm?: string | null; // inscrição municipal do prestador
  aliqSn: number;         // % aproximado de tributos (Simples)
  tomador: { doc: string; nome: string; email?: string | null; endereco?: Endereco | null };
  cTribNac: string; cTribMun?: string | null; nbs: string;
  descricao: string;
  valorServico: number;
  ordemNumero: number;
  favorecidos: Favorecido[];
  custoTed?: number;      // dedução adicional (tarifas TED), se houver
};

const esc = (s: string) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r/g, '&#xD;');
const v2 = (n: number) => (Math.round(n * 100) / 100).toFixed(2);
const dig = (s: string) => String(s || '').replace(/\D/g, '');
// remove caracteres de controle e espaços duplicados; limita tamanho
const txt = (s: string, max: number) => String(s || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/[ \t]+/g, ' ').trim().slice(0, max);
const el = (name: string, value: string | number | null | undefined) =>
  value === null || value === undefined || value === '' ? '' : `<${name}>${esc(String(value))}</${name}>`;

function endereco(e: Endereco): string {
  return `<end><endNac>${el('cMun', dig(e.ibge))}${el('CEP', dig(e.cep))}</endNac>` +
    el('xLgr', txt(e.logradouro, 255)) + el('nro', txt(e.numero, 60)) + el('xCpl', e.complemento ? txt(e.complemento, 156) : null) +
    el('xBairro', txt(e.bairro, 60)) + `</end>`;
}

export function idDps(d: DadosDps): string {
  const cnpj = dig(d.prestCnpj).padStart(14, '0');
  return 'DPS' + d.codMun.padStart(7, '0') + '2' + cnpj + dig(d.serie).padStart(5, '0') + String(d.nDps).padStart(15, '0');
}

export function validar(d: DadosDps): string[] {
  const erros: string[] = [];
  if (dig(d.prestCnpj).length !== 14) erros.push('CNPJ do prestador inválido');
  if (!d.tomador?.doc || ![11, 14].includes(dig(d.tomador.doc).length)) erros.push('CPF/CNPJ do tomador inválido');
  if (!d.tomador?.nome) erros.push('Nome do tomador ausente');
  if (!(d.valorServico > 0)) erros.push('Valor do serviço inválido');
  d.favorecidos.forEach((f) => {
    if (dig(f.cpf).length !== 11) erros.push(`CPF inválido: ${f.nome}`);
    const e = f.endereco;
    if (!e || dig(e.cep).length !== 8 || !e.logradouro || !e.numero || !e.bairro || dig(e.ibge).length !== 7)
      erros.push(`Endereço incompleto (CEP, rua, número, bairro e código IBGE): ${f.nome}`);
  });
  const ded = d.favorecidos.reduce((s, f) => s + f.valor, 0) + (d.custoTed || 0);
  if (ded > d.valorServico + 0.001) erros.push('Deduções maiores que o valor do serviço');
  if (d.descricao.length > 2000) erros.push('Descrição maior que 2000 caracteres');
  return erros;
}

/** infDPS já em forma canônica (C14N): xmlns declarado no próprio elemento. */
export function infDpsCanonico(d: DadosDps): string {
  const id = idDps(d);
  const docs = d.favorecidos.map((f) =>
    '<docDedRed>' +
      el('nDoc', txt(`PIX ${f.pagoEm.split('-').reverse().join('/')} - ${f.nome}`, 255)) +
      el('tpDedRed', '99') +
      el('xDescOutDed', txt(`Premiação paga em nome e por conta e ordem do tomador - Ordem ${d.ordemNumero}`, 150)) +
      el('dtEmiDoc', f.pagoEm) +
      el('vDedutivelRedutivel', v2(f.valor)) +
      el('vDeducaoReducao', v2(f.valor)) +
      '<fornec>' + el('CPF', dig(f.cpf)) + el('xNome', txt(f.nome, 300)) + endereco(f.endereco) + '</fornec>' +
    '</docDedRed>').join('') +
    (d.custoTed && d.custoTed > 0
      ? '<docDedRed>' + el('nDoc', txt(`Tarifas TED - Ordem ${d.ordemNumero}`, 255)) + el('tpDedRed', '99') +
        el('xDescOutDed', 'Custo de transferência bancária repassado ao tomador') + el('dtEmiDoc', d.dCompet) +
        el('vDedutivelRedutivel', v2(d.custoTed)) + el('vDeducaoReducao', v2(d.custoTed)) + '</docDedRed>'
      : '');

  const tdoc = dig(d.tomador.doc);
  const toma = '<toma>' + el(tdoc.length === 14 ? 'CNPJ' : 'CPF', tdoc) + el('xNome', txt(d.tomador.nome, 300)) +
    (d.tomador.endereco ? endereco(d.tomador.endereco) : '') + el('email', d.tomador.email ? txt(d.tomador.email, 80) : null) + '</toma>';

  return `<infDPS xmlns="${NS}" Id="${id}">` +
    el('tpAmb', d.ambiente) + el('dhEmi', d.dhEmi) + el('verAplic', 'Mayway1.0') +
    el('serie', dig(d.serie)) + el('nDPS', d.nDps) + el('dCompet', d.dCompet) + el('tpEmit', '1') + el('cLocEmi', d.codMun) +
    '<prest>' + el('CNPJ', dig(d.prestCnpj)) + el('IM', d.prestIm ? dig(d.prestIm) : null) +
      '<regTrib>' + el('opSimpNac', '3') + el('regApTribSN', '1') + el('regEspTrib', '0') + '</regTrib>' +
    '</prest>' +
    toma +
    '<serv><locPrest>' + el('cLocPrestacao', d.codMun) + '</locPrest>' +
      '<cServ>' + el('cTribNac', d.cTribNac) + el('cTribMun', d.cTribMun || null) + el('xDescServ', txt(d.descricao, 2000)) + el('cNBS', d.nbs) + '</cServ>' +
    '</serv>' +
    '<valores>' +
      '<vServPrest>' + el('vServ', v2(d.valorServico)) + '</vServPrest>' +
      (docs ? '<vDedRed><documentos>' + docs + '</documentos></vDedRed>' : '') +
      '<trib><tribMun>' + el('tribISSQN', '1') + el('tpRetISSQN', '1') + '</tribMun>' +
        '<totTrib>' + el('pTotTribSN', v2(d.aliqSn)) + '</totTrib></trib>' +
    '</valores>' +
  '</infDPS>';
}

export type Cripto = {
  sha1b64: (s: string) => Promise<string>;           // SHA-1 do texto UTF-8, em base64
  assinarRsaSha1b64: (s: string) => Promise<string>;  // assinatura RSA-SHA1 (PKCS#1 v1.5), em base64
  certB64: string;                                   // certificado X.509 (DER) em base64
};

const C14N = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';

/** Monta o XML final assinado da DPS. */
export async function dpsAssinada(d: DadosDps, c: Cripto): Promise<{ xml: string; id: string }> {
  const inf = infDpsCanonico(d);
  const id = idDps(d);
  const digest = await c.sha1b64(inf);
  const signedInfo = `<SignedInfo xmlns="${DSIG}">` +
    `<CanonicalizationMethod Algorithm="${C14N}"></CanonicalizationMethod>` +
    `<SignatureMethod Algorithm="${DSIG}rsa-sha1"></SignatureMethod>` +
    `<Reference URI="#${id}"><Transforms>` +
      `<Transform Algorithm="${DSIG}enveloped-signature"></Transform>` +
      `<Transform Algorithm="${C14N}"></Transform>` +
    `</Transforms><DigestMethod Algorithm="${DSIG}sha1"></DigestMethod><DigestValue>${digest}</DigestValue></Reference>` +
  `</SignedInfo>`;
  const sig = await c.assinarRsaSha1b64(signedInfo);
  // no documento, infDPS herda o xmlns do DPS (a forma canônica é a mesma)
  const infNoDoc = inf.replace(`<infDPS xmlns="${NS}" `, '<infDPS ');
  const signedInfoNoDoc = signedInfo.replace(`<SignedInfo xmlns="${DSIG}">`, '<SignedInfo>');
  const xml = `<?xml version="1.0" encoding="UTF-8"?><DPS xmlns="${NS}" versao="1.01">${infNoDoc}` +
    `<Signature xmlns="${DSIG}">${signedInfoNoDoc}<SignatureValue>${sig}</SignatureValue>` +
    `<KeyInfo><X509Data><X509Certificate>${c.certB64}</X509Certificate></X509Data></KeyInfo></Signature></DPS>`;
  return { xml, id };
}

/** Lê a resposta da NFS-e (XML) e extrai número e chave. */
export function lerNfse(xml: string): { numero: string | null; chave: string | null } {
  const numero = (xml.match(/<nNFSe>(\d+)<\/nNFSe>/) || [])[1] || null;
  const chave = (xml.match(/Id="NFS(\d{50})"/) || [])[1] || null;
  return { numero, chave };
}
