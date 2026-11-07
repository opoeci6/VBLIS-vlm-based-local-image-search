# -*- mode: python ; coding: utf-8 -*-
import sys
import os
from PyInstaller.utils.hooks import collect_all, collect_data_files, collect_submodules

block_cipher = None

datas = []
binaries = []
hidden_imports = [
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

# Explicitly collect all data, binaries, and submodules for critical packages
for pkg in [
    'fastapi',
    'starlette',
    'uvicorn',
    'pydantic',
    'pydantic_core',
    'chromadb',
    'transformers',
    'tokenizers',
    'huggingface_hub',
    'av',
    'PIL',
    'pillow_heif'
]:
    pkg_datas, pkg_binaries, pkg_hidden = collect_all(pkg)
    datas += pkg_datas
    binaries += pkg_binaries
    hidden_imports += pkg_hidden


a = Analysis(
    ['main.py'],
    pathex=[],
    binaries=binaries,
    datas=datas,
    hiddenimports=hidden_imports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['torchvision', 'scipy', 'matplotlib', 'pytest', 'tkinter', 'IPython'],
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
