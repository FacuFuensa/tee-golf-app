Pod::Spec.new do |s|
  s.name           = 'TeeWatchBridge'
  s.version        = '0.1.0'
  s.summary        = 'WatchConnectivity link between the Tee iPhone app and the Tee watch app'
  s.description    = 'Carries the live hole, par, yardage and stroke count to the watch, and stroke edits back.'
  s.author         = 'Tee'
  s.homepage       = 'https://github.com/FacuFuensa/tee-golf-app'

  # 15.1, NOT the 16.4 that `create-expo-module` writes into its template.
  # Every Expo pod this app already depends on (expo-sharing, expo-haptics,
  # expo-file-system, ...) declares 15.1, which is SDK 54's floor. CocoaPods
  # resolves the Pods target to the lowest common platform and then hard-errors
  # on any pod that demands more than the app provides:
  #
  #   The platform of the target `Pods-Tee` (iOS 15.1) is not compatible with
  #   `TeeWatchBridge`, which has a minimum requirement of iOS 16.4.
  #
  # Keeping this in step with the other pods is the whole reason it is written
  # out rather than left at the template default.
  s.platforms      = {
    :ios => '15.1'
  }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/FacuFuensa/tee-golf-app.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES'
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
