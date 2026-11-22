# Compilar el APK de bodega

El APK es una app nativa (Capacitor) que carga https://realzastock.vercel.app. Lo que se publica en Vercel le llega
solo; el APK se vuelve a generar únicamente si cambia algo nativo (ícono, plugins, permisos, appId).

## Requisitos (Windows)
- **JDK 21** (Temurin). Gradle 8.14 no corre con JDK 25: `winget install EclipseAdoptium.Temurin.21.JDK`
  y apuntar `JAVA_HOME` a esa carpeta (o `org.gradle.java.home` en `~/.gradle/gradle.properties`).
- **Android SDK** (plataforma 36 y build-tools 36) en `C:\android-sdk`, con las licencias aceptadas
  (`sdkmanager --licenses`). `android/local.properties` (no se versiona) debe decir `sdk.dir=C\:/android-sdk`.
- **Keystore** en `%USERPROFILE%\keystores\realza-hogar\` (`realza-hogar-release.jks` + `keystore.properties`).
  Nunca va a git ni a OneDrive. Sin él, el release sale sin firmar.

## Pasos
```
npm run build:app          # web (solo para que `cap sync` tenga carpeta dist)
npx cap sync android
cd android
gradlew.bat assembleRelease
```
El APK queda en `android/app/build/outputs/apk/release/app-release.apk`.

## Cómo se comporta
- Detecta el APK con `Capacitor.isNativePlatform()` o el sufijo `RealzaHogarApp` del user agent
  (`src/lib/plataforma.ts`). Ahí solo entra el rol bodega, con el menú Pedidos / Hojas / Despachos.
- El botón atrás de Android navega dentro de la app y, en la primera pantalla, la minimiza (`src/hooks/useAppNativa.ts`).
