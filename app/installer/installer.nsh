; VBLIS installer additions, included via "build.nsis.include" in package.json.
;
; Builds before VBLIS_DATA_DIR kept models, the search index, caches and settings inside the
; install folder (resources\api\_internal). An upgrade runs the previous version's uninstaller
; before installing, and that deletes the whole install folder, so move those items to the
; per-user data folder that new builds use (resolveDataDir in electron/main.js) first.
; api/paths.py moves anything still left behind when the app starts (e.g. portable builds).

!define VBLIS_STAGING ".vblis-migrating"

; Move one item (file or folder) from SRC to DST unless DST already has it. Aborts the installer
; if the move fails, so the uninstaller never runs while the data is still in the install folder.
!macro vblisMoveLegacyItem SRC DST NAME
  ; An empty folder at the destination counts as absent (RMDir without /r only removes empty ones)
  RMDir "${DST}\${NAME}"
  ${If} ${FileExists} "${SRC}\${NAME}"
  ${AndIfNot} ${FileExists} "${DST}\${NAME}"
    ClearErrors
    Rename "${SRC}\${NAME}" "${DST}\${NAME}"
    ${If} ${Errors}
      ; Different drive: copy into a staging folder first, then rename into place
      RMDir /r "${DST}\${VBLIS_STAGING}"
      CreateDirectory "${DST}\${VBLIS_STAGING}"
      ClearErrors
      CopyFiles /SILENT "${SRC}\${NAME}" "${DST}\${VBLIS_STAGING}"
      ${IfNot} ${Errors}
        Rename "${DST}\${VBLIS_STAGING}\${NAME}" "${DST}\${NAME}"
      ${EndIf}
      ${If} ${Errors}
        RMDir /r "${DST}\${VBLIS_STAGING}"
        MessageBox MB_OK|MB_ICONSTOP "Setup could not move your VBLIS data ($\"${NAME}$\") from$\r$\n${SRC}$\r$\nto$\r$\n${DST}.$\r$\n$\r$\nClose VBLIS, copy it there yourself, then run Setup again." /SD IDOK
        Abort
      ${EndIf}
      RMDir /r "${DST}\${VBLIS_STAGING}"
      Delete "${SRC}\${NAME}"
      RMDir /r "${SRC}\${NAME}"
    ${EndIf}
  ${EndIf}
!macroend

!macro customInit
  ; $INSTDIR is the previous install location here (initMultiUser reads it from the registry)
  Push $R0
  Push $R1
  Push $R2
  Push $R3
  StrCpy $R0 "$INSTDIR\resources\api\_internal"
  ${If} ${FileExists} "$R0\*.*"
    ; Per-user folder even for per-machine installs, like the app (process.env.LOCALAPPDATA)
    SetShellVarContext current
    StrCpy $R1 "$LOCALAPPDATA\VBLIS"
    ${If} $installMode == "all"
      SetShellVarContext all
    ${EndIf}
    ; Installed straight into that folder: the app uses VBLIS-data instead
    StrLen $R2 "$INSTDIR\"
    StrCpy $R3 "$R1\" $R2
    ${If} $R3 == "$INSTDIR\"
      StrCpy $R1 "$R1-data"
    ${EndIf}
    CreateDirectory "$R1"
    !insertmacro vblisMoveLegacyItem "$R0" "$R1" "models"
    !insertmacro vblisMoveLegacyItem "$R0" "$R1" "chroma_data"
    !insertmacro vblisMoveLegacyItem "$R0" "$R1" "cache"
    !insertmacro vblisMoveLegacyItem "$R0" "$R1" "data"
    !insertmacro vblisMoveLegacyItem "$R0" "$R1" ".env"
  ${EndIf}
  Pop $R3
  Pop $R2
  Pop $R1
  Pop $R0
!macroend
