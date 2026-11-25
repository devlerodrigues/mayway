# Ponte NFS-e (Mayway) - roda no PC com Windows.
# Busca na fila do sistema os pedidos de NFS-e, envia para a Receita (Sefin Nacional) usando
# o certificado A1 que vem junto com o pedido e devolve a resposta ao sistema.
# O Windows faz a conexão com certificado (inclusive a renegociação TLS que a Receita exige).
# Nada fica gravado: o certificado só existe na memória durante o envio.
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
[Net.ServicePointManager]::Expect100Continue = $false

$pasta = Split-Path -Parent $MyInvocation.MyCommand.Path
$cfg = Get-Content -Raw -Encoding UTF8 (Join-Path $pasta 'config.json') | ConvertFrom-Json
$logDir = Join-Path $env:LOCALAPPDATA 'MaywayPonte'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir 'ponte.log'

function Log($msg) {
  $linha = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '  ' + $msg
  Add-Content -Path $log -Value $linha -Encoding UTF8
  if ((Get-Item $log).Length -gt 1MB) { Move-Item -Force $log ($log + '.old') }
}

# uma cópia só
$mutex = New-Object System.Threading.Mutex($false, 'Global\MaywayPonteNFSe')
if (-not $mutex.WaitOne(0)) { exit }

$cabecalhos = @{ apikey = $cfg.chave_publica; Authorization = 'Bearer ' + $cfg.chave_publica }
$permitido = '^https://(sefin|adn)(\.producaorestrita)?\.nfse\.gov\.br/'

function Rpc($nome, $dados) {
  $json = $dados | ConvertTo-Json -Compress -Depth 5
  $bytes = [Text.Encoding]::UTF8.GetBytes($json)
  return Invoke-RestMethod -Method Post -Uri ($cfg.supabase_url + '/rest/v1/rpc/' + $nome) -Headers $cabecalhos `
    -ContentType 'application/json; charset=utf-8' -Body $bytes -TimeoutSec 30
}

function Enviar($pedido) {
  if ($pedido.url -notmatch $permitido) { throw 'endereço não permitido: ' + $pedido.url }
  $flags = [Security.Cryptography.X509Certificates.X509KeyStorageFlags]::UserKeySet
  $cert = New-Object Security.Cryptography.X509Certificates.X509Certificate2(
    [Convert]::FromBase64String($pedido.pfx), $pedido.senha, $flags)
  try {
    $req = [Net.HttpWebRequest]::Create($pedido.url)
    $req.Method = $pedido.metodo
    $req.Accept = 'application/json'
    $req.UserAgent = 'Mayway-Ponte-PC/1.0'
    $req.Timeout = 90000
    $req.ReadWriteTimeout = 90000
    [void]$req.ClientCertificates.Add($cert)
    if ($null -ne $pedido.corpo) {
      $b = [Text.Encoding]::UTF8.GetBytes([string]$pedido.corpo)
      $req.ContentType = 'application/json'
      $req.ContentLength = $b.Length
      $s = $req.GetRequestStream(); $s.Write($b, 0, $b.Length); $s.Close()
    }
    try { $resp = $req.GetResponse() }
    catch [Net.WebException] {
      if ($null -eq $_.Exception.Response) { throw }
      $resp = $_.Exception.Response
    }
    $leitor = New-Object IO.StreamReader($resp.GetResponseStream(), [Text.Encoding]::UTF8)
    $corpo = $leitor.ReadToEnd(); $leitor.Close()
    $status = [int]$resp.StatusCode
    $resp.Close()
    return @{ status = $status; corpo = $corpo }
  } finally {
    $cert.Reset()
  }
}

Log 'ponte iniciada'
$falhas = 0
while ($true) {
  try {
    $fila = @(Rpc 'prem_ponte_pegar' @{ p_token = $cfg.token })
    $falhas = 0
    foreach ($p in $fila) {
      if ($null -eq $p -or $null -eq $p.id) { continue }
      Log ("pedido " + $p.metodo + ' ' + $p.url)
      try {
        $r = Enviar $p
        Rpc 'prem_ponte_responder' @{ p_token = $cfg.token; p_id = $p.id; p_status = $r.status; p_corpo = $r.corpo; p_erro = $null } | Out-Null
        Log ("  resposta HTTP " + $r.status)
      } catch {
        $msg = $_.Exception.Message
        if ($_.Exception.InnerException) { $msg += ' | ' + $_.Exception.InnerException.Message }
        Log ("  erro: " + $msg)
        try { Rpc 'prem_ponte_responder' @{ p_token = $cfg.token; p_id = $p.id; p_status = 0; p_corpo = $null; p_erro = $msg } | Out-Null } catch {}
      }
      $p.pfx = $null; $p.senha = $null
    }
  } catch {
    $falhas++
    if ($falhas -le 3 -or $falhas % 60 -eq 0) { Log ('sem conexão com o sistema: ' + $_.Exception.Message) }
  }
  Start-Sleep -Seconds 3
}
