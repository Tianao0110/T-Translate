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
!macroend

!macro customUnInstall
  !insertmacro removeContextMenuFor ".pdf"
  !insertmacro removeContextMenuFor ".docx"
  !insertmacro removeContextMenuFor ".txt"
!macroend
