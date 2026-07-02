<#
.SYNOPSIS
  PowerShell helper script for Skywave deployment and testing on Windows.
.DESCRIPTION
  Replicates the targets defined in the Makefile natively in PowerShell.
.PARAMETER Command
  The target to run. Valid options: all, up, down, build, rebuild, logs, ps, p533, wasm, ionos-load, frontend, clean, distclean. Default is 'all'.
.PARAMETER DXSpiderLogin
  The callsign used to log into the DX Spider node. Default is 'N0CALL'.
.EXAMPLE
  .\run.ps1 all -DXSpiderLogin YOURCALL
#>

param (
    [Parameter(Position=0)]
    [ValidateSet("all", "up", "down", "build", "rebuild", "logs", "ps", "p533", "wasm", "ionos-load", "frontend", "clean", "distclean")]
    [string]$Command = "all",

    [Parameter(Mandatory=$false)]
    [string]$DXSpiderLogin = "N0CALL"
)

$IONOS_VOLUME = "skywave-ionos-data"
$IONOS_SRC = "p533-wasm/vendor/ITU-R-HF/P533/Data"

# Helper for colorful output
function Write-Header($msg) {
    Write-Host "`n=== $msg ===" -ForegroundColor Cyan
}

function Write-Success($msg) {
    Write-Host "[SUCCESS] $msg" -ForegroundColor Green
}

function Write-ErrorMsg($msg) {
    Write-Host "[ERROR] $msg" -ForegroundColor Red
}

function Cmd-Up {
    Write-Header "Starting the stack (estimate-mode propagation)"
    $env:DXSPIDER_LOGIN = $DXSpiderLogin
    docker compose up -d --build
    if ($LASTEXITCODE -eq 0) {
        Write-Success "Stack started successfully."
    } else {
        Write-ErrorMsg "Failed to start stack."
        exit $LASTEXITCODE
    }
}

function Cmd-Down {
    Write-Header "Stopping the stack"
    docker compose down
}

function Cmd-Build {
    Write-Header "Building images"
    docker compose build
}

function Cmd-Logs {
    Write-Header "Fetching logs"
    docker compose logs -f --tail=100
}

function Cmd-Ps {
    Write-Header "Checking stack status"
    docker compose ps
}

function Cmd-Wasm {
    Write-Header "Compiling ITU-R P.533 + P372 to WASM"
    $vendorDir = Join-Path "p533-wasm" "vendor"
    $iturDir = Join-Path $vendorDir "ITU-R-HF"
    if (-not (Test-Path $iturDir)) {
        Write-Host "==> cloning ITU-R-HF (shallow)"
        git clone --depth 1 "https://github.com/ITU-R-Study-Group-3/ITU-R-HF.git" $iturDir
        if ($LASTEXITCODE -ne 0) {
            Write-ErrorMsg "Failed to clone ITU-R-HF repository."
            exit $LASTEXITCODE
        }
    }

    Write-Host "==> compiling P533 + P372 + wrapper with Emscripten"
    $absolutePath = (Get-Item .).FullName
    $wasmSrcPath = Join-Path $absolutePath "p533-wasm"
    
    # Run the emscripten compiler via docker (single-line commands to ensure cross-shell safety)
    docker run --rm -v "${wasmSrcPath}:/src" -w /src emscripten/emsdk:3.1.61 bash -c 'mkdir -p dist && emcc vendor/ITU-R-HF/P533/Src/P533/*.c vendor/ITU-R-HF/P372/Src/P372/Noise.c vendor/ITU-R-HF/P372/Src/P372/NoiseMemory.c vendor/ITU-R-HF/P372/Src/P372/InitializeNoise.c wrapper.c -I vendor/ITU-R-HF/P533/Src/P533 -D__linux__ -fcommon -O2 -sMODULARIZE -sEXPORT_ES6 -sEXPORT_NAME=createP533Module -sALLOW_MEMORY_GROWTH -sSTACK_SIZE=8388608 -sEXPORTED_FUNCTIONS=_p533_predict_reliability -sEXPORTED_RUNTIME_METHODS=cwrap,FS,IDBFS -lidbfs.js -o dist/p533.js'

    if ($LASTEXITCODE -ne 0) {
        Write-ErrorMsg "WASM Compilation failed."
        exit $LASTEXITCODE
    }

    Write-Host "==> installing artifacts into frontend"
    $frontendP533 = Join-Path (Join-Path "frontend" "public") "p533"
    $frontendCoeff = Join-Path (Join-Path "frontend" "public") "coeff"
    
    if (-not (Test-Path $frontendP533)) { New-Item -ItemType Directory -Force -Path $frontendP533 | Out-Null }
    if (-not (Test-Path $frontendCoeff)) { New-Item -ItemType Directory -Force -Path $frontendCoeff | Out-Null }
    
    Copy-Item "p533-wasm/dist/p533.js" -Destination $frontendP533 -Force
    Copy-Item "p533-wasm/dist/p533.wasm" -Destination $frontendP533 -Force
    Copy-Item "p533-wasm/js/p533-loader.js" -Destination (Join-Path $frontendP533 "loader.js") -Force
    
    Copy-Item "p533-wasm/vendor/ITU-R-HF/P533/Data/COEFF*.txt" -Destination $frontendCoeff -Force
    Copy-Item "p533-wasm/vendor/ITU-R-HF/P533/Data/P1239-3 Decile Factors.txt" -Destination (Join-Path $frontendCoeff "P1239-3-decile-factors.txt") -Force

    Write-Success "WASM compilation and frontend installation complete."
}

function Cmd-IonosLoad {
    Write-Header "Loading monthly ionos data into volume"
    if (-not (Test-Path $IONOS_SRC)) {
        Write-ErrorMsg "Monthly ionos source data not found at $IONOS_SRC. Run '.\run.ps1 wasm' first."
        exit 1
    }

    $absolutePath = (Get-Item .).FullName
    $absoluteIonosSrcPath = Join-Path $absolutePath $IONOS_SRC

    docker run --rm -v "${IONOS_VOLUME}:/dst" -v "${absoluteIonosSrcPath}:/src:ro" alpine:3 sh -c 'cp /src/ionos*.bin /dst/ && ls /dst | wc -l'

    if ($LASTEXITCODE -eq 0) {
        Write-Success "Ionos data loaded successfully into volume."
    } else {
        Write-ErrorMsg "Failed to load ionos data."
        exit $LASTEXITCODE
    }
}

function Cmd-Frontend {
    Write-Header "Rebuilding and redeploying frontend"
    docker compose build frontend
    $env:DXSPIDER_LOGIN = $DXSpiderLogin
    docker compose up -d frontend
    if ($LASTEXITCODE -eq 0) {
        Write-Success "Frontend updated."
    } else {
        Write-ErrorMsg "Failed to update frontend."
        exit $LASTEXITCODE
    }
}

function Cmd-Clean {
    Write-Header "Stopping the stack and removing built images"
    docker compose down --rmi local
}

function Cmd-DistClean {
    Write-Header "Full cleanup (volumes, cached ionos data, build outputs)"
    docker compose down --rmi local --volumes
    Remove-Item -Recurse -Force "p533-wasm/dist" -ErrorAction SilentlyContinue
    Remove-Item -Recurse -Force "p533-wasm/vendor" -ErrorAction SilentlyContinue
    Remove-Item -Recurse -Force "frontend/public/p533" -ErrorAction SilentlyContinue
    Remove-Item -Recurse -Force "frontend/public/coeff" -ErrorAction SilentlyContinue
    Write-Success "DistClean completed."
}

# Main Execution Routing
switch ($Command) {
    "all" {
        Cmd-Up
        Cmd-Wasm
        Cmd-IonosLoad
        Cmd-Frontend
        Write-Success "Full install complete! The propagation panel badge now reads P.533."
    }
    "up" { Cmd-Up }
    "down" { Cmd-Down }
    "build" { Cmd-Build }
    "rebuild" { Cmd-Build }
    "logs" { Cmd-Logs }
    "ps" { Cmd-Ps }
    "wasm" { Cmd-Wasm }
    "ionos-load" { Cmd-IonosLoad }
    "frontend" { Cmd-Frontend }
    "clean" { Cmd-Clean }
    "distclean" { Cmd-DistClean }
    "p533" {
        Cmd-Wasm
        Cmd-IonosLoad
        Cmd-Frontend
        Write-Success "P.533 engine deployed!"
    }
}
