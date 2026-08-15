<#
    Veridi Nutrition — bootstrap do ambiente local (Windows)

    Executa os passos que exigem shell na maquina: verificacao/instalacao de
    Git, Node LTS, pnpm e PostgreSQL, criacao do banco de desenvolvimento,
    instalacao de dependencias, Prisma, verificacao (typecheck/build/test),
    configuracao do Git e smoke test de `pnpm dev` + `GET /health`.

    NAO executa nenhum comando destrutivo. Nao usa reset --hard nem clean -fd.
    Nada e apagado; arquivos existentes sao preservados.

    Cada comando externo tem o exit code verificado: se um passo falhar, o
    script para ali. Nunca commita nem publica um bootstrap quebrado.

    Uso (PowerShell na pasta do projeto):
        .\scripts\bootstrap-local.ps1

    Parametros opcionais:
        -DbPassword "senha"      senha do usuario veridi_dev (default: prompt).
                                 Ignorado se o .env ja existir — nesse caso o
                                 .env e a fonte da verdade.
        -PostgresPassword "..."  senha do superusuario postgres (default: o
                                 proprio psql pergunta no console)
        -GitUserName  "Nome"     identidade do Git, se ainda nao configurada
        -GitUserEmail "a@b.c"    idem
        -RemoteUrl "..."         origin (default: repositorio Veridi no GitHub)
        -SkipInstalls            nao tenta instalar nada via winget
        -SkipPush                faz o commit, mas nao publica
        -SkipSmokeTest           nao sobe `pnpm dev` no final

    Exit codes:
        0  bootstrap completo
        1  falha real (a mensagem diz onde)
        2  bootstrap incompleto por dependencia recem-instalada:
           abra um novo PowerShell e rode de novo
#>

[CmdletBinding()]
param(
    [string]$DbPassword,
    [string]$PostgresPassword,
    [string]$GitUserName,
    [string]$GitUserEmail,
    [string]$RemoteUrl = "https://github.com/gkakimor/Veridi_NutriProject.git",
    [switch]$SkipInstalls,
    [switch]$SkipPush,
    [switch]$SkipSmokeTest
)

$ErrorActionPreference = "Stop"

# O comportamento de comandos nativos muda entre PowerShell 5.1, 7.4 e 7.5.
# Fixamos o modo e verificamos $LASTEXITCODE explicitamente, sempre.
$PSNativeCommandUseErrorActionPreference = $false

$root = Split-Path -Parent $PSScriptRoot

function Write-Step($text) { Write-Host "`n=== $text ===" -ForegroundColor Cyan }
function Write-Ok($text)   { Write-Host "  OK  $text" -ForegroundColor Green }
function Write-Warn($text) { Write-Host "  !!  $text" -ForegroundColor Yellow }
function Write-Info($text) { Write-Host "      $text" -ForegroundColor Gray }

function Test-Command($name) {
    return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

<#
    Executa um comando externo e ABORTA se o exit code nao for 0.

    Sem isto, `$ErrorActionPreference = "Stop"` nao cobre executaveis nativos:
    pnpm/prisma/git podem falhar e o script segue imprimindo "OK" ate commitar
    e publicar um bootstrap quebrado.
#>
function Invoke-Native {
    param(
        [Parameter(Mandatory)][string]$FilePath,
        [string[]]$Arguments = @(),
        [string]$What
    )
    $label = if ($What) { $What } else { "$FilePath $($Arguments -join ' ')" }
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Falhou: $label (exit code $LASTEXITCODE). Corrija a causa e rode o script de novo."
    }
}

# Igual ao anterior, mas devolve saida + exit code e NAO aborta. Para sondagens.
function Invoke-NativeProbe {
    param(
        [Parameter(Mandatory)][string]$FilePath,
        [string[]]$Arguments = @()
    )
    $output = & $FilePath @Arguments 2>&1 | Out-String
    return [pscustomobject]@{
        ExitCode = $LASTEXITCODE
        Output   = $output.Trim()
    }
}

function Install-WithWinget($id, $label) {
    if ($SkipInstalls) { Write-Warn "$label ausente (-SkipInstalls ativo)"; return $false }
    if (-not (Test-Command winget)) { Write-Warn "winget nao disponivel; instale $label manualmente"; return $false }
    Write-Info "instalando $label ($id)..."
    & winget install --id $id -e --source winget --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) {
        Write-Warn "winget retornou $LASTEXITCODE ao instalar $label"
        return $false
    }
    # winget nao atualiza o PATH da sessao atual
    $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
                [Environment]::GetEnvironmentVariable("Path", "User")
    return $true
}

# Escreve texto como UTF-8 SEM BOM.
# `Set-Content -Encoding UTF8` grava COM BOM no Windows PowerShell 5.1 e SEM BOM
# no PowerShell 7 — essa diferenca silenciosa nao pode chegar ao .env.
function Write-Utf8NoBom($path, $content) {
    [System.IO.File]::WriteAllText($path, $content, (New-Object System.Text.UTF8Encoding($false)))
}

# ---------------------------------------------------------------- 0. Preflight
Write-Step "Projeto"
foreach ($required in @("package.json", "pnpm-workspace.yaml")) {
    if (-not (Test-Path (Join-Path $root $required))) {
        throw "'$required' nao encontrado em $root. Rode o script a partir da raiz do projeto Veridi."
    }
}
Write-Ok "raiz do monorepo: $root"

# ---------------------------------------------------------------- 1. Git
Write-Step "Git"
if (-not (Test-Command git)) {
    Install-WithWinget "Git.Git" "Git for Windows" | Out-Null
    if (-not (Test-Command git)) {
        Write-Warn "Git ausente ou ainda fora do PATH desta sessao."
        Write-Warn "Abra um novo PowerShell e rode o script de novo."
        exit 2
    }
}
Write-Ok (git --version)

# Numa instalacao nova do Git a identidade nao existe e `git commit` falha com
# "Please tell me who you are" — depois de todo o resto ja ter rodado.
$gitEmail = (Invoke-NativeProbe git @("config", "--get", "user.email")).Output
$gitName  = (Invoke-NativeProbe git @("config", "--get", "user.name")).Output

if (-not $gitEmail) {
    if (-not $GitUserEmail) { $GitUserEmail = Read-Host "E-mail para os commits do Git" }
    if (-not $GitUserEmail) { throw "Git sem user.email configurado; o commit falharia." }
    Invoke-Native git @("config", "--global", "user.email", $GitUserEmail) -What "git config user.email"
    $gitEmail = $GitUserEmail
}
if (-not $gitName) {
    if (-not $GitUserName) { $GitUserName = Read-Host "Nome para os commits do Git" }
    if (-not $GitUserName) { throw "Git sem user.name configurado; o commit falharia." }
    Invoke-Native git @("config", "--global", "user.name", $GitUserName) -What "git config user.name"
    $gitName = $GitUserName
}
Write-Ok "identidade Git: $gitName <$gitEmail>"

# ---------------------------------------------------------------- 2. Node
Write-Step "Node.js"
function Get-NodeMajor {
    if (-not (Test-Command node)) { return 0 }
    $probe = Invoke-NativeProbe node @("--version")
    if ($probe.ExitCode -ne 0) { return 0 }
    return [int](($probe.Output -replace "^v", "") -split "\.")[0]
}

$nodeMajor = Get-NodeMajor
if ($nodeMajor -lt 22) {
    if ($nodeMajor -eq 0) { Write-Warn "Node nao encontrado. Instalando LTS..." }
    else { Write-Warn "Node $nodeMajor abaixo do minimo (22 LTS). Instalando LTS..." }
    Install-WithWinget "OpenJS.NodeJS.LTS" "Node.js LTS" | Out-Null
    $nodeMajor = Get-NodeMajor
    if ($nodeMajor -lt 22) {
        Write-Warn "Node 22+ ainda nao disponivel nesta sessao."
        Write-Warn "Abra um novo PowerShell e rode o script de novo."
        exit 2
    }
}
Write-Ok "node $(node --version) / npm $(npm --version)"

# ---------------------------------------------------------------- 3. pnpm
Write-Step "pnpm"
if (-not (Test-Command pnpm)) {
    if (Test-Command corepack) {
        Write-Info "habilitando pnpm via corepack..."
        & corepack enable
        & corepack prepare pnpm@10.28.0 --activate
    }
    if (-not (Test-Command pnpm)) {
        Write-Info "instalando pnpm via npm..."
        Invoke-Native npm @("install", "-g", "pnpm") -What "npm install -g pnpm"
    }
    if (-not (Test-Command pnpm)) {
        Write-Warn "pnpm instalado, mas ainda fora do PATH desta sessao."
        Write-Warn "Abra um novo PowerShell e rode o script de novo."
        exit 2
    }
}
Write-Ok "pnpm $(pnpm --version)"

# ---------------------------------------------------------------- 4. PostgreSQL
Write-Step "PostgreSQL"
if (-not (Test-Command psql)) {
    # a instalacao do PostgreSQL nao adiciona psql ao PATH automaticamente
    $candidates = Get-ChildItem "C:\Program Files\PostgreSQL" -Directory -ErrorAction SilentlyContinue |
                  Sort-Object Name -Descending
    foreach ($c in $candidates) {
        $bin = Join-Path $c.FullName "bin"
        if (Test-Path (Join-Path $bin "psql.exe")) {
            $env:Path = "$bin;$env:Path"
            Write-Warn "psql encontrado em $bin (adicionado ao PATH desta sessao)"
            break
        }
    }
}

if (-not (Test-Command psql)) {
    Write-Warn "PostgreSQL nao encontrado."
    Install-WithWinget "PostgreSQL.PostgreSQL.16" "PostgreSQL 16" | Out-Null
    Write-Warn "O instalador do PostgreSQL pede a senha do superusuario 'postgres' em tela grafica."
    Write-Warn "Conclua o instalador, abra um novo PowerShell e rode este script novamente."
    exit 2
}
Write-Ok (psql --version)

# psql instalado nao significa servidor no ar.
if (Test-Command pg_isready) {
    $ready = Invoke-NativeProbe pg_isready @("-h", "localhost", "-p", "5432")
    if ($ready.ExitCode -ne 0) {
        throw "PostgreSQL nao aceita conexoes em localhost:5432. Inicie o servico (services.msc -> postgresql-x64-16) e rode o script de novo."
    }
    Write-Ok "servidor aceitando conexoes em localhost:5432"
}

# ---------------------------------------------------------------- 5. .env + banco
Write-Step "Configuracao do banco"
$envPath = Join-Path $root ".env"

# Quando o .env existe, ele e a fonte da verdade: a senha do role tem que bater
# com a que a aplicacao usa. Sem isto, rodar o script duas vezes com senhas
# diferentes deixa .env e PostgreSQL fora de sincronia.
$dbUser = "veridi_dev"
$dbName = "veridi_dev"
$dbHost = "localhost"
$dbPort = 5432

if (Test-Path $envPath) {
    $line = Select-String -Path $envPath -Pattern '^\s*DATABASE_URL\s*=' -ErrorAction SilentlyContinue |
            Select-Object -First 1
    if (-not $line) {
        throw ".env existe mas nao tem DATABASE_URL. Ajuste o arquivo (ver .env.example) e rode o script de novo."
    }
    $rawUrl = ($line.Line -replace '^\s*DATABASE_URL\s*=\s*', '').Trim().Trim('"').Trim("'")
    try { $parsedUrl = [uri]$rawUrl } catch { throw "DATABASE_URL do .env nao e uma URL valida." }
    $userInfo = $parsedUrl.UserInfo -split ":", 2
    if ($userInfo.Count -lt 2 -or -not $userInfo[1]) {
        throw "DATABASE_URL do .env nao traz usuario e senha. Ajuste o arquivo e rode o script de novo."
    }
    $dbUser     = [uri]::UnescapeDataString($userInfo[0])
    $DbPassword = [uri]::UnescapeDataString($userInfo[1])
    $dbHost     = $parsedUrl.Host
    $dbPort     = $parsedUrl.Port
    $dbName     = $parsedUrl.AbsolutePath.TrimStart("/")
    Write-Ok ".env existente preservado — usando suas credenciais ($dbUser@$dbHost`:$dbPort/$dbName)"
} else {
    if (-not $DbPassword) {
        $secure = Read-Host "Defina uma senha local para o usuario veridi_dev" -AsSecureString
        $DbPassword = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
            [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
    }
    if (-not $DbPassword) { throw "Senha do banco vazia." }
}

# A mesma senha entra em dois contextos com regras de escape diferentes.
$sqlPassword = $DbPassword.Replace("'", "''")        # literal SQL
$urlPassword = [uri]::EscapeDataString($DbPassword)  # componente de URL

Write-Info "conectando como superusuario 'postgres' (a senha sera solicitada pelo psql)..."
if ($PostgresPassword) { $env:PGPASSWORD = $PostgresPassword }
try {
    # Sem arquivo temporario: a senha nao toca o disco.
    $sql = @"
SELECT 'CREATE ROLE "$dbUser" LOGIN PASSWORD ''$sqlPassword'''
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$dbUser')\gexec
ALTER ROLE "$dbUser" WITH LOGIN PASSWORD '$sqlPassword';
SELECT 'CREATE DATABASE "$dbName" OWNER "$dbUser"'
 WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = '$dbName')\gexec
"@
    $sql | & psql -U postgres -h $dbHost -p $dbPort -v ON_ERROR_STOP=1 -f -
    if ($LASTEXITCODE -ne 0) {
        throw "psql falhou ao garantir role/database (exit code $LASTEXITCODE)."
    }
    Write-Ok "role e database '$dbName' garantidos, senha sincronizada com o .env"
} finally {
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
}

if (-not (Test-Path $envPath)) {
    $envContent = @"
DATABASE_URL="postgresql://$dbUser`:$urlPassword@$dbHost`:$dbPort/$dbName`?schema=public"
API_PORT=3333
API_HOST=127.0.0.1
VITE_API_URL="http://127.0.0.1:3333"
WEB_ORIGIN="http://127.0.0.1:5173"
"@
    Write-Utf8NoBom $envPath $envContent
    Write-Ok ".env criado (UTF-8 sem BOM, ignorado pelo Git)"
}

# ---------------------------------------------------------------- 6. Dependencias
Push-Location $root
try {
    Write-Step "Dependencias"
    Invoke-Native pnpm @("install") -What "pnpm install"
    Write-Ok "pnpm install"

    Write-Step "Prisma"
    Invoke-Native pnpm @("db:generate") -What "pnpm db:generate"
    Write-Ok "prisma generate"

    Invoke-Native pnpm @("db:deploy") -What "pnpm db:deploy"
    Write-Ok "migrations aplicadas"

    Write-Step "Verificacao"
    Invoke-Native pnpm @("typecheck") -What "pnpm typecheck"
    Write-Ok "typecheck"

    Invoke-Native pnpm @("build") -What "pnpm build"
    Write-Ok "build"

    Invoke-Native pnpm @("test") -What "pnpm test"
    Write-Ok "testes"
} finally {
    Pop-Location
}

# ---------------------------------------------------------------- 7. Smoke test
if (-not $SkipSmokeTest) {
    Write-Step "Smoke test (pnpm dev + GET /health)"

    $logDir = Join-Path ([System.IO.Path]::GetTempPath()) "veridi-bootstrap"
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    $outLog = Join-Path $logDir "dev.out.log"
    $errLog = Join-Path $logDir "dev.err.log"

    $dev = Start-Process -FilePath (Get-Command pnpm).Source `
                         -ArgumentList "dev" `
                         -WorkingDirectory $root `
                         -PassThru -NoNewWindow `
                         -RedirectStandardOutput $outLog `
                         -RedirectStandardError $errLog
    try {
        $healthOk = $false
        $webOk    = $false
        $health   = $null
        $deadline = (Get-Date).AddSeconds(90)

        while ((Get-Date) -lt $deadline -and -not ($healthOk -and $webOk)) {
            Start-Sleep -Seconds 2
            if ($dev.HasExited) { break }

            if (-not $healthOk) {
                try {
                    $r = Invoke-WebRequest -Uri "http://127.0.0.1:3333/health" -UseBasicParsing -TimeoutSec 5
                    if ($r.StatusCode -eq 200) {
                        $health   = $r.Content | ConvertFrom-Json
                        $healthOk = $true
                    }
                } catch { }
            }
            if (-not $webOk) {
                try {
                    $w = Invoke-WebRequest -Uri "http://127.0.0.1:5173/" -UseBasicParsing -TimeoutSec 5
                    if ($w.StatusCode -eq 200) { $webOk = $true }
                } catch { }
            }
        }

        if (-not $healthOk) {
            Write-Warn "saida de 'pnpm dev':"
            Get-Content $outLog -Tail 25 -ErrorAction SilentlyContinue | ForEach-Object { Write-Info $_ }
            Get-Content $errLog -Tail 25 -ErrorAction SilentlyContinue | ForEach-Object { Write-Info $_ }
            throw "GET /health nao respondeu 200 em 90s. A API nao subiu ou o banco nao respondeu."
        }

        # 200 so acontece com o banco acessivel; conferimos o contrato completo.
        if ($health.status -ne "ok" -or $health.database -ne "up") {
            throw "GET /health respondeu 200 com corpo inesperado: $($health | ConvertTo-Json -Compress)"
        }
        if ([string]::IsNullOrWhiteSpace([string]$health.checkedAt)) {
            throw "GET /health sem 'checkedAt' valido."
        }
        Write-Ok "GET /health -> 200 {status: ok, database: up} — API -> Prisma -> PostgreSQL"

        if ($webOk) { Write-Ok "frontend respondendo em http://localhost:5173" }
        else { Write-Warn "frontend nao respondeu em 5173 (a API esta ok; confira com 'pnpm dev')" }
    } finally {
        if (-not $dev.HasExited) {
            # concurrently -> pnpm -> tsx/vite: precisa derrubar a arvore toda.
            & taskkill /PID $dev.Id /T /F *> $null
        }
    }
}

# ---------------------------------------------------------------- 8. Git
Write-Step "Git / GitHub"
Push-Location $root
try {
    if (-not (Test-Path (Join-Path $root ".git"))) {
        Invoke-Native git @("init", "-b", "main") -What "git init"
        Write-Ok "repositorio inicializado (branch main)"
    } else {
        Write-Ok "repositorio Git ja existe"
    }

    $originProbe = Invoke-NativeProbe git @("remote", "get-url", "origin")
    if ($originProbe.ExitCode -ne 0) {
        Invoke-Native git @("remote", "add", "origin", $RemoteUrl) -What "git remote add origin"
        Write-Ok "origin configurado: $RemoteUrl"
    } elseif ($originProbe.Output -ne $RemoteUrl) {
        Write-Warn "origin atual: $($originProbe.Output)"
        Write-Warn "diferente do esperado ($RemoteUrl); nao foi alterado"
    } else {
        Write-Ok "origin ja correto"
    }

    Invoke-Native git @("add", "-A") -What "git add -A"
    $staged = (Invoke-NativeProbe git @("diff", "--cached", "--name-only")).Output
    if ($staged) {
        Invoke-Native git @("commit", "-m", "chore: bootstrap Veridi MVP") -What "git commit"
        Write-Ok "commit criado"
    } else {
        Write-Warn "nada novo para commitar"
    }

    if ($SkipPush) {
        Write-Warn "push nao executado (-SkipPush)"
    } else {
        $remoteHeads = Invoke-NativeProbe git @("ls-remote", "--heads", $RemoteUrl)
        if ($remoteHeads.ExitCode -ne 0) {
            Write-Warn "nao foi possivel consultar o remoto:"
            Write-Info $remoteHeads.Output
            Write-Warn "commit local preservado. Rode 'git push -u origin main' depois de resolver o acesso."
        } elseif ($remoteHeads.Output) {
            Write-Warn "o remoto ja possui branches — push automatico cancelado para nao sobrescrever historico."
            Write-Warn "integre manualmente:  git pull --rebase origin main  &&  git push -u origin main"
        } else {
            Write-Info "se o GitHub pedir autenticacao, o Git Credential Manager abrira o navegador."
            Invoke-Native git @("push", "-u", "origin", "main") -What "git push"
            Write-Ok "push concluido"
        }
    }
} finally {
    Pop-Location
}

Write-Step "Pronto"
Write-Host "  pnpm dev      -> API em http://127.0.0.1:3333 e web em http://localhost:5173"
Write-Host "  /health       -> http://127.0.0.1:3333/health"
exit 0
