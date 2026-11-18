; Runs during uninstall. Deletes all Living World data only if the user turned on
; "Wipe all my data when Living World is uninstalled" in Settings (that creates the flag file).
; Skipped during upgrades, so installing a newer version never erases anything.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    ${If} ${FileExists} "$APPDATA\Living World\wipe-on-uninstall"
      RMDir /r "$APPDATA\Living World"
    ${EndIf}
  ${endIf}
!macroend
