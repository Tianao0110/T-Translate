; Custom NSIS include for the assisted installer.
; UTF-8 with BOM — the context-menu text below carries Chinese and makensis
; falls back to the ANSI codepage without the BOM.
;
; Adds the MUI welcome page (electron-builder's assisted flow starts at the
; directory page by default). Welcome/finish text uses MUI's built-in strings,
; which ship localized for every installerLanguages entry (en_US / zh_CN).

!macro customWelcomePage
  !insertmacro MUI_PAGE_WELCOME
!macroend

; Explorer context menu: "Translate with T-Translate" on the document types
; the in-app document translator opens directly. SystemFileAssociations adds
; a verb per extension without touching the default-open association, and HKCU
; matches the per-user install (no elevation needed). $R9 carries the menu
; text picked by installer language. Removed symmetrically in customUnInstall
; — that cleanup is a product hard requirement.

!macro writeContextMenuFor EXT
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\${EXT}\shell\TTranslate" "" "$R9"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\${EXT}\shell\TTranslate" "Icon" "$INSTDIR\T-Translate.exe"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\${EXT}\shell\TTranslate\command" "" "$\"$INSTDIR\T-Translate.exe$\" $\"%1$\""
!macroend

!macro removeContextMenuFor EXT
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\${EXT}\shell\TTranslate"
!macroend

!macro customInstall
  StrCpy $R9 "Translate with T-Translate"
  StrCmp $LANGUAGE 2052 0 +2
    StrCpy $R9 "用 T-Translate 翻译"

  !insertmacro writeContextMenuFor ".pdf"
  !insertmacro writeContextMenuFor ".docx"
  !insertmacro writeContextMenuFor ".txt"

  ; Bring back what customUnInstall parked beside the install dir — during an
  ; update, or when the user chose to keep their data on uninstall.
  IfFileExists "$INSTDIR\..\T-Translate-data\models\*.*" 0 +3
    RMDir /r "$INSTDIR\models"
    Rename "$INSTDIR\..\T-Translate-data\models" "$INSTDIR\models"
  IfFileExists "$INSTDIR\..\T-Translate-data\data\*.*" 0 +3
    RMDir /r "$INSTDIR\data"
    Rename "$INSTDIR\..\T-Translate-data\data" "$INSTDIR\data"
  RMDir "$INSTDIR\..\T-Translate-data"

  ; Pre-v0.4.7 uninstallers stashed under these two names. The data one is
  ; the same folder as above on a case-insensitive disk, so it is only
  ; looked at after that folder has been emptied.
  IfFileExists "$INSTDIR\..\t-translate-models\*.*" 0 +3
    RMDir /r "$INSTDIR\models"
    Rename "$INSTDIR\..\t-translate-models" "$INSTDIR\models"
  IfFileExists "$INSTDIR\..\t-translate-data\*.*" 0 +3
    RMDir /r "$INSTDIR\data"
    Rename "$INSTDIR\..\t-translate-data" "$INSTDIR\data"
!macroend

; Park the two user folders beside the install dir so electron-builder's
; closing `RMDir /r $INSTDIR` does not take them; customInstall of the next
; version (or a later reinstall) moves them back.
!macro parkUserFolders
  IfFileExists "$INSTDIR\models\*.*" 0 +4
    CreateDirectory "$INSTDIR\..\T-Translate-data"
    RMDir /r "$INSTDIR\..\T-Translate-data\models"
    Rename "$INSTDIR\models" "$INSTDIR\..\T-Translate-data\models"
  IfFileExists "$INSTDIR\data\*.*" 0 +4
    CreateDirectory "$INSTDIR\..\T-Translate-data"
    RMDir /r "$INSTDIR\..\T-Translate-data\data"
    Rename "$INSTDIR\data" "$INSTDIR\..\T-Translate-data\data"
!macroend

!macro customUnInstall
  !insertmacro removeContextMenuFor ".pdf"
  !insertmacro removeContextMenuFor ".docx"
  !insertmacro removeContextMenuFor ".txt"

  ; Since v0.4.7 everything the user owns sits in the install dir: settings,
  ; history and cache in $INSTDIR\data, downloaded packs in $INSTDIR\models.
  ; electron-builder's uninstaller ends with `RMDir /r $INSTDIR` and runs
  ; that during UPDATES too, so an update always parks both folders beside
  ; the install dir. A real uninstall asks; keeping is the default, and a
  ; silent uninstall keeps as well — data loss must be an explicit choice.
  ; Declining also clears the pre-v0.4.7 %APPDATA% folder and the updater cache.
  ${if} ${isUpdated}
    !insertmacro parkUserFolders
  ${else}
    IfSilent keepData
    StrCpy $R8 "Keep your data (settings, history, downloaded models) for a future reinstall?"
    StrCmp $LANGUAGE 2052 0 +2
      StrCpy $R8 "保留数据（设置、历史记录、已下载的模型）以便日后重装？"
    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON1 "$R8" IDYES keepData
      RMDir /r "$APPDATA\t-translate"
      RMDir /r "$LOCALAPPDATA\t-translate-updater"
      Goto dataDone
    keepData:
      !insertmacro parkUserFolders
    dataDone:
  ${endif}
!macroend
