#!/bin/bash
set -euo pipefail

app=${1:?Pass the path to the locally built Codex Usage Desktop.app}
identity="${WIDGET_SIGN_IDENTITY:--}"
sources="$(cd "$(dirname "$0")/../src-tauri/macos-widget" && pwd)"
info="$app/Contents/Info.plist"
identifier=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$info")
if [[ "$identifier" != com.ccusage.codex.desktop ]]; then
    printf '%s\n' 'Expected the Codex Usage Desktop application bundle.' >&2
    exit 1
fi
if [[ "$identity" == "-" ]] && /usr/bin/codesign -dv "$app" 2>&1 | /usr/bin/grep -q '^Authority='; then
    printf '%s\n' 'Set WIDGET_SIGN_IDENTITY when bundling into a certificate-signed app.' >&2
    exit 1
fi

arch=$(/usr/bin/lipo -archs "$app/Contents/MacOS/codex-usage-desktop")
if [[ "$arch" != arm64 && "$arch" != x86_64 ]]; then
    printf 'Expected a single Mac architecture, got %s\n' "$arch" >&2
    exit 1
fi

staging=$(/usr/bin/mktemp -d)
trap 'rm -rf "$staging"' EXIT
extension="$staging/CodexUsageWidget.appex"
mkdir -p "$extension/Contents/MacOS"
cp "$sources/Info.plist" "$extension/Contents/Info.plist"
for key in CFBundleShortVersionString CFBundleVersion; do
    value=$(/usr/libexec/PlistBuddy -c "Print :$key" "$info")
    /usr/libexec/PlistBuddy -c "Set :$key $value" "$extension/Contents/Info.plist"
done

swift_args=(-parse-as-library -application-extension -explicit-module-build)
if [[ -n "${WIDGET_SWIFT_VFS_OVERLAY:-}" ]]; then
    swift_args+=(-Xcc -ivfsoverlay -Xcc "$WIDGET_SWIFT_VFS_OVERLAY")
fi
if [[ -n "${WIDGET_SWIFT_MODULE_CACHE:-}" ]]; then
    swift_args+=(-module-cache-path "$WIDGET_SWIFT_MODULE_CACHE")
fi
target="$arch-apple-macosx14.0"
binary="$extension/Contents/MacOS/CodexUsageWidget"
resources="$extension/Contents/Resources"
/usr/bin/xcrun swiftc -O "${swift_args[@]}" \
    -target "$target" -module-name CodexUsageWidget "$sources/UsageWidget.swift" \
    -Xlinker -e -Xlinker _NSExtensionMain \
    -o "$binary"

mkdir -p "$resources"
if [[ -n "${WIDGET_APP_INTENTS_METADATA:-}" ]]; then
    /usr/bin/ditto "$WIDGET_APP_INTENTS_METADATA" "$resources/Metadata.appintents"
else
    processor=$(/usr/bin/xcrun --find appintentsmetadataprocessor 2>/dev/null) || {
        printf '%s\n' 'Use Xcode or set WIDGET_APP_INTENTS_METADATA to the generated Metadata.appintents directory.' >&2
        exit 1
    }
    toolchain="$(cd "$(dirname "$(/usr/bin/xcrun --find swiftc)")/../.." && pwd)"
    sdk=$(/usr/bin/xcrun --sdk macosx --show-sdk-path)
    xcode_version=$(/usr/bin/xcodebuild -version | /usr/bin/awk '/Build version/ {print $3}')
    cp "$sources/UsageWidget.swift" "$staging/"
    printf '%s\n' '["AppIntent"]' > "$staging/protocols.json"
    printf '{"%s":{"const-values":"Widget.swiftconstvalues","object":"Widget.o"}}\n' "$staging/UsageWidget.swift" > "$staging/outputs.json"
    (
        cd "$staging"
        /usr/bin/xcrun swiftc -c "${swift_args[@]}" \
            -target "$target" -module-name CodexUsageWidget -emit-const-values \
            -Xfrontend -const-gather-protocols-file -Xfrontend protocols.json \
            -output-file-map outputs.json "$staging/UsageWidget.swift"
    )
    printf '%s\n' "$staging/Widget.swiftconstvalues" > "$staging/metadata-inputs"
    printf '%s\n' "$staging/UsageWidget.swift" > "$staging/source-inputs"
    "$processor" --compile-time-extraction --force --toolchain-dir "$toolchain" \
        --sdk-root "$sdk" --xcode-version "$xcode_version" --platform-family macOS \
        --target-triple "$target" --deployment-target 14.0 --module-name CodexUsageWidget \
        --bundle-identifier com.ccusage.codex.desktop.widget --binary-file "$binary" \
        --source-file-list "$staging/source-inputs" --swift-const-vals-list "$staging/metadata-inputs" \
        --output "$resources"
fi
test -s "$resources/Metadata.appintents/extract.actionsdata"
/usr/bin/codesign --force --sign "$identity" --options runtime --entitlements "$sources/Entitlements.plist" "$extension"

plugins="$app/Contents/PlugIns"
mkdir -p "$plugins"
if [[ -e "$plugins/CodexUsageWidget.appex" ]]; then
    mv "$plugins/CodexUsageWidget.appex" "$staging/previous.appex"
fi
/usr/bin/ditto "$extension" "$plugins/CodexUsageWidget.appex"
/usr/bin/codesign --force --sign "$identity" --options runtime --preserve-metadata=entitlements "$app"
/usr/bin/codesign --verify --deep --strict "$app"
