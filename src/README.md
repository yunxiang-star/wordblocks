# src — 前端源码与应用图标

这里的 `assets/` 是从发布版 APK（`release/词块WordBlocks-6.2.apk`）里**原样取出**的前端文件，
和手机里跑的代码一致；`res/` 是应用图标切图。原生壳（Java）编译产物只有 `classes.dex`，
反编译出来可读性很差，所以没有放进仓库——它的职责只有下面四件事，重写不难。

## assets/

| 文件 | 说明 |
|---|---|
| `index.html` | 单页骨架：顶栏、视图容器、底部面板、Toast、Loading |
| `app.css` | 6.2 的浅色玻璃设计系统（约 50 KB，无预处理器、无外部依赖） |
| `app.js` | 全部业务逻辑：路由、SRS 记忆曲线、会话、导入导出、PDF 排版（约 99 KB） |
| `glossary.js` | 内置数学英语词库，231 条线代 / 微积分 / 微分方程术语 |

三个脚本都是 ES5+ 的普通 `<script>`，没有构建步骤，改完刷新就生效。

## JS 桥约定

`app.js` 通过 `window.Android` 判断是否在 App 里运行（`IS_APP`）。原生侧需要注入这 7 个方法：

| 方法 | 返回值 | 说明 |
|---|---|---|
| `loadData()` | JSON 字符串 | 启动时同步读出 `wordblocks.json`，没有则返回空串 |
| `saveData(json)` | boolean | 写回 `getFilesDir()/wordblocks.json` |
| `lookup(word)` | JSON 字符串 | 异步查词，回包结构见 `Dict.java`（`ok / defs / ukphone / usphone / examples / source`） |
| `printPdf(html, title)` | void | 把整页 HTML 交给 `PrintManager`，用户在系统界面选「保存为 PDF」 |
| `exportBackup(json)` | void | SAF 建文件写备份 |
| `importBackup()` | JSON 字符串 | SAF 选文件读备份 |
| `info()` | JSON 字符串 | 机型、Android 版本、版本号，关于页用 |

没有 `Android` 时自动降级：`localStorage` 存数据、`window.print()` 导出、`fetch` 直接查在线词典
（浏览器里会被 CORS 拦，所以只能看界面，查词会失败）。

## 重建安装包

不用 Gradle，一条链手动串下来（本机自建 JDK 17 + Android cmdline-tools）：

```bash
aapt2 compile --dir res -o build/res.zip
aapt2 link -o build/base.apk -I $SDK/platforms/android-34/android.jar \
  --manifest AndroidManifest.xml -R build/res.zip -A assets --min-sdk-version 24 --target-sdk-version 34
javac --release 8 -cp $SDK/platforms/android-34/android.jar -d build/classes java/com/wordblocks/app/*.java
d8 --lib $SDK/platforms/android-34/android.jar --output build/ build/classes/**/*.class
# 把 classes.dex 塞进 base.apk → zipalign → apksigner 签名
```

两个必须注意的点：

1. **签名证书要沿用同一个 keystore**（SHA-256 `2d9a5239…e40f`），否则新包无法覆盖安装，只能卸载重装（数据会丢）。
2. **`resources.arsc` 必须保持 STORED（不压缩）**，手写 zip 打包时要显式指定，否则 Android 12+ 装不上。

## 图标

`res/mipmap-*/ic_launcher*.png` 是 6.0 版重做的图标：哑光黑渐变底 + 亮灰词卡 + 系统蓝圆点。
`res/mipmap-anydpi-v26/` 是自适应图标的 XML，背景色 `#17171A` 写在 `res/values/colors.xml` 里。
