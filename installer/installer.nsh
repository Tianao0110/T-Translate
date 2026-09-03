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

  ; Put back the models folder that an update's silent uninstall stashed next
  ; to the install dir (see customUnInstall for why).
  IfFileExists "$INSTDIR\..\t-translate-models\*.*" 0 noStashedModels
    RMDir /r "$INSTDIR\models"
    Rename "$INSTDIR\..\t-translate-models" "$INSTDIR\models"
  noStashedModels:

  ; Same for the data folder (translation cache, session logs — v0.4.6).
  IfFileExists "$INSTDIR\..\t-translate-data\*.*" 0 noStashedData
    RMDir /r "$INSTDIR\data"
    Rename "$INSTDIR\..\t-translate-data" "$INSTDIR\data"
  noStashedData:
!macroend

!macro customUnInstall
  !insertmacro removeContextMenuFor ".pdf"
  !insertmacro removeContextMenuFor ".docx"
  !insertmacro removeContextMenuFor ".txt"

  ; Downloaded models live in $INSTDIR\models (v0.4.0 moved them off the system
  ; drive — a program installed on D: keeps its 300 MB packs there). But
  ; electron-builder's uninstaller ends with `RMDir /r $INSTDIR`, and it runs
  ; that during UPDATES too, so stash the folder beside the install dir first;
  ; customInstall moves it back. A real uninstall skips the stash on purpose:
  ; the models are part of the program folder and go with it.
  ${if} ${isUpdated}
    IfFileExists "$INSTDIR\models\*.*" 0 noModelsToStash
      RMDir /r "$INSTDIR\..\t-translate-models"
      Rename "$INSTDIR\models" "$INSTDIR\..\t-translate-models"
    noModelsToStash:
    IfFileExists "$INSTDIR\data\*.*" 0 noDataToStash
      RMDir /r "$INSTDIR\..\t-translate-data"
      Rename "$INSTDIR\data" "$INSTDIR\..\t-translate-data"
    noDataToStash:
  ${endif}

  ; Optional user-data cleanup — settings, history vault and logs live under
  ; %APPDATA%\t-translate (Electron userData derives from package.json "name").
  ; Silent uninstalls (including any update-driven flow) never delete: data
  ; loss must always be an explicit human choice.
  IfSilent skipDataDelete
  StrCpy $R8 "Also delete all user data (settings, history, cache)?"
  StrCmp $LANGUAGE 2052 0 +2
    StrCpy $R8 "同时删除全部用户数据（设置、历史记录、缓存）？"
  MessageBox MB_YESNO|MB_ICONQUESTION "$R8" IDNO skipDataDelete
    RMDir /r "$APPDATA\t-translate"
    RMDir /r "$LOCALAPPDATA\t-translate-updater"
  skipDataDelete:
!macroend
