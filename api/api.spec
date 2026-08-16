# -*- mode: python ; coding: utf-8 -*-
import sys
import os
from PyInstaller.utils.hooks import collect_data_files, collect_submodules

block_cipher = None

# Collect all data files for chromadb and its dependencies
datas = collect_data_files('chromadb')
datas += collect_data_files('transformers')
datas += collect_data_files('tokenizers')
datas += collect_data_files('av')

# Include all submodules for chromadb to avoid missing hidden imports
hidden_imports = collect_submodules('chromadb')
hidden_imports += collect_submodules('av')
hidden_imports += [
    'uvicorn.logging', 
    'uvicorn.loops', 
    'uvicorn.loops.auto', 
    'uvicorn.protocols', 
    'uvicorn.protocols.http', 
    'uvicorn.protocols.http.auto', 
    'uvicorn.protocols.websockets', 
    'uvicorn.protocols.websockets.auto', 
    'uvicorn.lifespan', 
    'uvicorn.lifespan.on', 
    'fastapi',
    'pydantic.deprecated.decorator',
    'huggingface_hub',
    'opentelemetry.instrumentation',
    'cffi',
    '_cffi_backend',
    'tzdata',
    'importlib_resources',
    'av',
    'av.video',
    'av.codec',
    'av.packet'
]

a = Analysis(
    ['main.py'],
    pathex=[],
    binaries=[],
    datas=datas,
    hiddenimports=hidden_imports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)
pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='api',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='api',
)
