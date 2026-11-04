$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$sdkRoot = 'C:/Users/Yoni/AppData/Local/Android/Sdk'
$javaRoot = 'C:/Program Files/Android/Android Studio/jbr/bin'
$buildTools = Join-Path $sdkRoot 'build-tools/36.0.0'
$platform = Join-Path $sdkRoot 'platforms/android-34/android.jar'
$buildRoot = Join-Path $projectRoot '.local/android-companion'
$classes = Join-Path $buildRoot 'classes'
$generated = Join-Path $buildRoot 'generated'
$dex = Join-Path $buildRoot 'dex'
New-Item -ItemType Directory -Force -Path $buildRoot,$classes,$generated,$dex | Out-Null
function Check-Exit { if ($LASTEXITCODE -ne 0) { throw "Build command failed: $LASTEXITCODE" } }
& "$buildTools/aapt2.exe" compile --dir "$PSScriptRoot/res" -o "$buildRoot/resources.zip"
Check-Exit
& "$buildTools/aapt2.exe" link -o "$buildRoot/base.apk" -I $platform --manifest "$PSScriptRoot/AndroidManifest.xml" --java $generated "$buildRoot/resources.zip"
Check-Exit
$sources = @(Get-ChildItem -LiteralPath "$PSScriptRoot/src",$generated -Filter '*.java' -Recurse | ForEach-Object FullName)
& "$javaRoot/javac.exe" -encoding UTF-8 -source 8 -target 8 -bootclasspath "$platform;$buildTools/core-lambda-stubs.jar" -d $classes @sources
Check-Exit
& "$javaRoot/jar.exe" cf "$buildRoot/classes.jar" -C $classes .
Check-Exit
& "$javaRoot/java.exe" -cp "$buildTools/lib/d8.jar" com.android.tools.r8.D8 --min-api 28 --lib $platform --output $dex "$buildRoot/classes.jar"
Check-Exit
Copy-Item -LiteralPath "$buildRoot/base.apk" -Destination "$buildRoot/unsigned.apk" -Force
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::Open("$buildRoot/unsigned.apk", 'Update')
try { [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, "$dex/classes.dex", 'classes.dex') | Out-Null } finally { $archive.Dispose() }
& "$buildTools/zipalign.exe" -f 4 "$buildRoot/unsigned.apk" "$buildRoot/aligned.apk"
Check-Exit
# Local signing key is ignored by git. Keep it to install future updates over this build.
$key = Join-Path $buildRoot 'companion-signing.p12'
if (!(Test-Path -LiteralPath $key)) {
 & "$javaRoot/keytool.exe" -genkeypair -keystore $key -alias companion -storepass android -keypass android -keyalg RSA -keysize 2048 -validity 10000 -dname 'CN=Gremier Personal Health Companion'
 Check-Exit
}
$output = Join-Path $projectRoot 'public/daynote/health-companion.apk'
& "$javaRoot/java.exe" -jar "$buildTools/lib/apksigner.jar" sign --ks $key --ks-pass pass:android --key-pass pass:android --out $output "$buildRoot/aligned.apk"
Check-Exit
& "$javaRoot/java.exe" -jar "$buildTools/lib/apksigner.jar" verify $output
Check-Exit
Write-Output "Built and signature-verified: $output"
