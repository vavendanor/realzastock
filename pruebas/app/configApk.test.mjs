/* Configuración del APK (archivos nativos y capacitor.config.ts). Correr desde la raíz:
   node pruebas/app/configApk.test.mjs */
import { readFileSync, existsSync } from 'node:fs'
let ok = 0, fallas = 0
const chequeo = (nombre, cond, detalle = '') => { if (cond) ok++; else { fallas++; console.log(`  FALLA ${nombre} ${detalle}`) } }
const leer = (p) => readFileSync(p, 'utf8')
const cfg = leer('capacitor.config.ts'), gradle = leer('android/app/build.gradle'), man = leer('android/app/src/main/AndroidManifest.xml')
const strings = leer('android/app/src/main/res/values/strings.xml'), git = leer('.gitignore')

chequeo('appId cl.realzahogar.stock', cfg.includes("appId: 'cl.realzahogar.stock'"))
chequeo('appName Realza Hogar', cfg.includes("appName: 'Realza Hogar'"))
chequeo('carga https://realzastock.vercel.app', cfg.includes("url: 'https://realzastock.vercel.app'"))
chequeo('sin cleartext', cfg.includes('cleartext: false') && !/cleartext:\s*true/.test(cfg) && !/http:\/\//.test(cfg))
chequeo('applicationId y namespace de Android', gradle.includes('namespace = "cl.realzahogar.stock"') && gradle.includes('applicationId "cl.realzahogar.stock"'))
chequeo('MainActivity en el paquete nuevo', existsSync('android/app/src/main/java/cl/realzahogar/stock/MainActivity.java') && leer('android/app/src/main/java/cl/realzahogar/stock/MainActivity.java').includes('package cl.realzahogar.stock;') && !existsSync('android/app/src/main/java/com'))
chequeo('strings.xml sin el id viejo', !strings.includes('com.realzahogar') && strings.includes('cl.realzahogar.stock'))
chequeo('orientación vertical', man.includes('android:screenOrientation="portrait"'))
chequeo('barra de estado #58402D', cfg.includes("backgroundColor: '#58402D'") && leer('android/app/src/main/res/values/colors.xml').includes('#58402D'))
chequeo('la firma lee las claves de fuera del repo', gradle.includes("'keystores/realza-hogar/keystore.properties'") && !/storePassword\s+['"]/.test(gradle))
chequeo('el .gitignore protege keystore y claves', ['*.jks', '*.keystore', 'keystore.properties'].every((x) => git.includes(x)))
chequeo('hay ícono y splash generados', existsSync('android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png') && existsSync('android/app/src/main/res/drawable-port-xxhdpi/splash.png'))
chequeo('plugins instalados: app, status-bar, splash-screen', ['app', 'status-bar', 'splash-screen'].every((p) => leer('package.json').includes(`"@capacitor/${p}"`)))

console.log(`\n${ok} comprobaciones OK, ${fallas} fallas`)
process.exit(fallas ? 1 : 0)
