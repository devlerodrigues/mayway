// Ponte NFS-e (Mayway): repassa requisições do sistema para a Sefin Nacional usando o
// certificado A1 do prestador (mTLS). Existe porque a Sefin pede o certificado por
// renegociação TLS 1.2, que o servidor de funções do Supabase não suporta.
//
// A ponte NÃO guarda nada: o certificado e a senha chegam em cada requisição (vindos do
// cofre do Supabase), são usados só na memória e descartados. Só aceita chamadas com o
// token secreto (variável RELAY_TOKEN) e só fala com os endereços oficiais da NFS-e.
import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';

const TOKEN = process.env.RELAY_TOKEN || '';
const PERMITIDO = /^https:\/\/(sefin|adn)(\.producaorestrita)?\.nfse\.gov\.br\//;
const LIMITE = 8 * 1024 * 1024;

const iguais = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
const responder = (res, status, obj) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
};

function lerCorpo(req) {
  return new Promise((ok, falha) => {
    let tam = 0; const partes = [];
    req.on('data', (p) => { tam += p.length; if (tam > LIMITE) { falha(new Error('corpo grande demais')); req.destroy(); } else partes.push(p); });
    req.on('end', () => ok(Buffer.concat(partes).toString('utf8')));
    req.on('error', falha);
  });
}

function chamarReceita({ pfx, senha, metodo, url, corpo }) {
  return new Promise((ok, falha) => {
    const u = new URL(url);
    const dados = corpo == null ? null : Buffer.from(corpo, 'utf8');
    const req = https.request({
      host: u.hostname, port: 443, path: u.pathname + u.search, method: metodo,
      pfx: Buffer.from(pfx, 'base64'), passphrase: senha,
      // a Sefin pede o certificado por renegociação, que só existe até o TLS 1.2
      minVersion: 'TLSv1.2', maxVersion: 'TLSv1.2',
      headers: {
        Accept: 'application/json', 'User-Agent': 'Mayway-Ponte/1.0',
        ...(dados ? { 'Content-Type': 'application/json', 'Content-Length': dados.length } : {}),
      },
      timeout: 90_000,
    }, (resp) => {
      const partes = [];
      resp.on('data', (p) => partes.push(p));
      resp.on('end', () => ok({ status: resp.statusCode, corpo: Buffer.concat(partes).toString('utf8') }));
      resp.on('error', falha);
    });
    req.on('timeout', () => req.destroy(new Error('tempo esgotado falando com a Receita')));
    req.on('error', falha);
    if (dados) req.write(dados);
    req.end();
  });
}

http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && (req.url === '/' || req.url === '/saude')) return responder(res, 200, { ok: true, servico: 'ponte-nfse' });
    if (req.method !== 'POST' || req.url !== '/mtls') return responder(res, 404, { erro: 'não encontrado' });
    if (!TOKEN || !iguais(req.headers['x-ponte-token'] || '', TOKEN)) return responder(res, 401, { erro: 'não autorizado' });
    const b = JSON.parse(await lerCorpo(req));
    if (!PERMITIDO.test(String(b.url || ''))) return responder(res, 400, { erro: 'endereço não permitido' });
    if (!['GET', 'POST', 'HEAD'].includes(b.metodo)) return responder(res, 400, { erro: 'método não permitido' });
    if (!b.pfx || !b.senha) return responder(res, 400, { erro: 'certificado ausente' });
    const r = await chamarReceita(b);
    return responder(res, 200, r);
  } catch (e) {
    return responder(res, 502, { erro: String(e && e.message || e) });
  }
}).listen(process.env.PORT || 3000, () => console.log('ponte-nfse ouvindo'));
