; Custom NSIS include for the assisted installer.
; Adds the MUI welcome page (electron-builder's assisted flow starts at the
; directory page by default). Welcome/finish text uses MUI's built-in strings,
; which ship localized for every installerLanguages entry (en_US / zh_CN).

!macro customWelcomePage
  !insertmacro MUI_PAGE_WELCOME
!macroend
