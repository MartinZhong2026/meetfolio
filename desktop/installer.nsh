; Keep electron-builder's maintained pages, install-scope detection and user-context launch.
; Optional documented language switch supports reproducible Chinese UI verification without a language-picker page.
!macro customInit
  Push $R0
  Push $R1
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "/LANG=" $R1
  ${IfNot} ${Errors}
    ${If} $R1 == "2052"
    ${OrIf} $R1 == "1028"
    ${OrIf} $R1 == "1033"
      StrCpy $LANGUAGE $R1
    ${EndIf}
  ${EndIf}
  ClearErrors
  Pop $R1
  Pop $R0
!macroend
