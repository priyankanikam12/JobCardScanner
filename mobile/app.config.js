// mobile\app.config.js
// 2026-10-23 (VAPT DMS-16: tokens must not be readable / extractable from the phone): app.json now says usesCleartextTraffic false (the app talks to https://dms.bgauss.com only) and android.allowBackup false
// (the app's data - including the SecureStore session - is not copied by Android backup / adb backup). A build that must reach a LOCAL http:// API (npx expo start against http://192.168.x.x:5262, or a debug APK) turns
// cleartext traffic back on explicitly:   set ALLOW_CLEARTEXT=1   (PowerShell: $env:ALLOW_CLEARTEXT = "1")   before running expo / the build. Never for a build that goes to staff.
module.exports = ({ config }) => {
  const allowCleartext = process.env.ALLOW_CLEARTEXT === '1'
  return {
    ...config,
    plugins: (config.plugins ?? []).map((plugin) =>
      Array.isArray(plugin) && plugin[0] === 'expo-build-properties'
        ? [plugin[0], { ...plugin[1], android: { ...plugin[1].android, usesCleartextTraffic: allowCleartext } }]
        : plugin,
    ),
  }
}
