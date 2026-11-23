#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root/mobile"
export NODE_ENV=production CI=1
export GRADLE_USER_HOME="${GRADLE_USER_HOME:-$root/mobile/.gradle-workspace}"
npm ci --include=dev --no-audit --no-fund
npx expo prebuild --platform android --no-install
cd android
./gradlew :app:assembleRelease "-PreactNativeArchitectures=${FAIRBILL_ANDROID_ABIS:-arm64-v8a}" \
  --max-workers=2 -Dorg.gradle.jvmargs='-Xmx2500m -XX:MaxMetaspaceSize=700m' --console=plain
mkdir -p "$root/artifacts"
cp app/build/outputs/apk/release/app-release.apk "$root/artifacts/FairBill-Android.apk"
