!macro preInit
  SetRegView 64
  ReadRegStr $R0 HKCU "${INSTALL_REGISTRY_KEY}" "InstallLocation"
  ${If} $R0 == ""
    ${If} ${FileExists} "D:\*"
      WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" "InstallLocation" "D:\CrawlFlow\App"
    ${EndIf}
  ${EndIf}
!macroend

; Keep Data and any user-created folders during uninstall or upgrade.
!macro customRemoveFiles
  SetOutPath "$TEMP"
  Delete "$INSTDIR\CrawlFlow.exe"
  Delete "$INSTDIR\Uninstall CrawlFlow.exe"
  Delete "$INSTDIR\*.dll"
  Delete "$INSTDIR\*.pak"
  Delete "$INSTDIR\icudtl.dat"
  Delete "$INSTDIR\snapshot_blob.bin"
  Delete "$INSTDIR\v8_context_snapshot.bin"
  Delete "$INSTDIR\vk_swiftshader_icd.json"
  Delete "$INSTDIR\LICENSE.electron.txt"
  Delete "$INSTDIR\LICENSES.chromium.html"
  Delete "$INSTDIR\version"
  RMDir /r "$INSTDIR\locales"
  RMDir /r "$INSTDIR\resources"
  RMDir /r "$INSTDIR\swiftshader"
  RMDir "$INSTDIR"
!macroend
