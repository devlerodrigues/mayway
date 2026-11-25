// Cliente HTTPS com certificado (mTLS) para a Sefin Nacional.
// A Sefin pede o certificado do cliente por RENEGOCIAÇÃO TLS depois do primeiro handshake;
// o TLS nativo do Deno (rustls) não suporta isso. Usamos o TLS em JavaScript do node-forge,
// com três ajustes de renegociação segura (RFC 5746) aplicados ao texto-fonte original,
// que fica guardado na tabela prem_vendor com o hash SHA-256 conferido aqui.
import forge from 'npm:node-forge@1.3.1';

const SHA: Record<string, string> = {
  'node-forge@1.3.1/lib/tls.js': 'a88cad702cd3951c16a43f784b280a018dfd4e2face055761b1b229d75caa70d',
  'node-forge@1.3.1/lib/aesCipherSuites.js': 'bdc5762c0d6edee74e469a59e0157555463d7abeadf34c4377121673dacc2360',
};
const b2u = (s: string) => { const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 255; return u; };
const u2b = (u: Uint8Array) => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return s; };
async function sha256(s: string) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('');
}
function trocar(src: string, de: string, para: string): string {
  const i = src.indexOf(de);
  if (i < 0 || src.indexOf(de, i + 1) >= 0) throw new Error('Ajuste TLS não aplicável: ' + de.slice(0, 40));
  return src.slice(0, i) + para + src.slice(i + de.length);
}

// deno-lint-ignore no-explicit-any
let carregado: Promise<any> | null = null;
// deno-lint-ignore no-explicit-any
export function carregarTls(adm: any) {
  if (!carregado) carregado = (async () => {
    const { data, error } = await adm.from('prem_vendor').select('nome, fonte');
    if (error) throw new Error('Não consegui carregar o módulo TLS: ' + error.message);
    const fonte: Record<string, string> = {};
    for (const r of data || []) fonte[r.nome] = r.fonte;
    for (const [nome, h] of Object.entries(SHA)) {
      if (!fonte[nome] || (await sha256(fonte[nome])) !== h) throw new Error('Módulo TLS ausente ou alterado: ' + nome);
    }
    let src = fonte['node-forge@1.3.1/lib/tls.js'];
    // 1) aceitar o pedido de renegociação do servidor (HelloRequest) depois de conectado
    src = trocar(src, 'tls.handleHelloRequest = function(c, record, length) {\n',
      'tls.handleHelloRequest = function(c, record, length) {\n' +
      '  if(c.__reneg && c.__conectado && !c.handshaking) {\n' +
      '    c.sessionCache = null; c.expect = 0; c.handshake(); return c.process();\n  }\n');
    // 2) extensão renegotiation_info no ClientHello (vazia no 1º, com verify_data no 2º)
    src = trocar(src, 'var extLength = extensions.length();',
      'if(c.__reneg) {\n    var __vd = c.__vd || \'\';\n    var __ri = forge.util.createBuffer();\n' +
      '    __ri.putByte(0xff); __ri.putByte(0x01); __ri.putInt16(__vd.length + 1); __ri.putByte(__vd.length); __ri.putBytes(__vd);\n' +
      '    extensions.putBuffer(__ri);\n  }\n  var extLength = extensions.length();');
    // 3) guardar o verify_data do Finished do cliente
    src = trocar(src, 'rval.putBuffer(b);\n  return rval;', 'if(client) { c.__vd = b.bytes(); }\n  rval.putBuffer(b);\n  return rval;');
    const req = () => forge;
    const m1 = { exports: {} };
    new Function('module', 'exports', 'require', src)(m1, m1.exports, req);
    const m2 = { exports: {} };
    // deno-lint-ignore no-explicit-any
    new Function('module', 'exports', 'require', fonte['node-forge@1.3.1/lib/aesCipherSuites.js'])(m2, m2.exports, (p: string) => (p === './tls' ? (forge as any).tls : forge));
    // deno-lint-ignore no-explicit-any
    return (forge as any).tls;
  })().catch((e) => { carregado = null; throw e; });
  return carregado;
}

export type Resposta = { status: number; corpo: string };

/** Uma requisição HTTP/1.1 com certificado do cliente. */
// deno-lint-ignore no-explicit-any
export async function requisicaoMtls(tls: any, host: string, metodo: string, caminho: string, corpo: string | null,
  certsPem: string[], chavePem: string, timeoutMs = 60000, log: (s: string) => void = () => {}): Promise<Resposta> {
  const conn = await Deno.connect({ hostname: host, port: 443 });
  const corpoBin = corpo === null ? '' : u2b(new TextEncoder().encode(corpo));
  const req = `${metodo} ${caminho} HTTP/1.1\r\nHost: ${host}\r\nAccept: application/json\r\nUser-Agent: Mayway/1.0\r\nConnection: close\r\n` +
    (corpo === null ? '' : `Content-Type: application/json\r\nContent-Length: ${corpoBin.length}\r\n`) + '\r\n' + corpoBin;
  let bruto = '', erro = '', enviado = false;
  let fim!: () => void; const pronto = new Promise<void>((r) => (fim = r));
  const c = tls.createConnection({
    server: false, virtualHost: host,
    // deno-lint-ignore no-explicit-any
    verify: (_c: any, _ok: any, depth: number, chain: any[]) => {
      if (depth !== 0) return true;
      const cn = String(chain[0].subject.getField('CN')?.value || '');
      const okHost = cn === host || (cn.startsWith('*.') && host.endsWith(cn.slice(1)));
      if (!okHost) log('certificado do servidor inesperado: ' + cn);
      return okHost;
    },
    getCertificate: () => { log('certificado solicitado'); return certsPem; },
    getPrivateKey: () => chavePem,
    // deno-lint-ignore no-explicit-any
    connected: (cc: any) => { if (!enviado) { enviado = true; cc.__conectado = true; cc.prepare(req); } else log('renegociado'); },
    // deno-lint-ignore no-explicit-any
    tlsDataReady: (cc: any) => { const b = cc.tlsData.getBytes(); if (b.length) conn.write(b2u(b)).catch(() => {}); },
    // deno-lint-ignore no-explicit-any
    dataReady: (cc: any) => { bruto += cc.data.getBytes(); },
    closed: () => fim(),
    // deno-lint-ignore no-explicit-any
    error: (_cc: any, e: any) => { erro = e?.message || JSON.stringify(e); log('erro TLS: ' + erro); },
  });
  c.__reneg = true;
  c.handshake();
  (async () => {
    const buf = new Uint8Array(65536);
    try { while (true) { const n = await conn.read(buf); if (n === null) break; c.process(u2b(buf.subarray(0, n))); } }
    catch (e) { if (!erro) erro = (e as Error).message; }
    fim();
  })();
  const t = setTimeout(() => { erro = erro || 'tempo esgotado'; fim(); }, timeoutMs);
  await pronto; clearTimeout(t); try { conn.close(); } catch (_) { /* já fechada */ }
  const sep = bruto.indexOf('\r\n\r\n');
  if (sep < 0) throw new Error('Sem resposta HTTP' + (erro ? ': ' + erro : ''));
  const cab = bruto.slice(0, sep).split('\r\n');
  const status = Number((cab[0].match(/^HTTP\/1\.\d (\d{3})/) || [])[1] || 0);
  const h: Record<string, string> = {};
  for (const l of cab.slice(1)) { const i = l.indexOf(':'); if (i > 0) h[l.slice(0, i).trim().toLowerCase()] = l.slice(i + 1).trim(); }
  let raw = bruto.slice(sep + 4);
  if ((h['transfer-encoding'] || '').includes('chunked')) {
    let out = '', i = 0;
    while (i < raw.length) { const j = raw.indexOf('\r\n', i); const n = parseInt(raw.slice(i, j), 16); if (!n) break; out += raw.slice(j + 2, j + 2 + n); i = j + 2 + n + 2; }
    raw = out;
  } else if (h['content-length']) raw = raw.slice(0, Number(h['content-length']));
  return { status, corpo: new TextDecoder().decode(b2u(raw)) };
}
