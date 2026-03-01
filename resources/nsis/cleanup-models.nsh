!macro customUnInstall
  StrCpy $0 "$PROFILE\.cache\bilingotype\models"
  IfFileExists "$0\*.*" 0 +3
    RMDir /r "$0"
    DetailPrint "Removed BilingoType cached models"
  StrCpy $1 "$PROFILE\.cache\bilingotype"
  RMDir "$1"
!macroend
