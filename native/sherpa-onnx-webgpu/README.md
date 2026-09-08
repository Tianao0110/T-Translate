# sherpa-onnx WebGPU 运行时（Windows x64）

`bin/` 里是带 `webgpu` provider 的 `sherpa-onnx-c-api.dll` / `sherpa-onnx-cxx-api.dll`，由 `scripts/overlay-sherpa-runtime.js` 在 `npm install` 后和打包前覆盖进 `node_modules/sherpa-onnx-win-x64/`，连同 onnxruntime-node 自带的 `onnxruntime.dll`（含 WebGPU EP）、`dxcompiler.dll`、`dxil.dll`。听译/朗读 worker 里 `provider: 'webgpu'` 就是靠这一套生效的。

为什么要自己编：官方 sherpa 预编译只有 CPU 与 CUDA；官方 onnxruntime（NuGet / GitHub zip）都不含 WebGPU EP，唯一现成的 WebGPU 版 `onnxruntime.dll` 是 onnxruntime-node 打的。ORT 的 DLL 只导出 `OrtGetApiBase`，所以用同版本 NuGet 的头文件与导入库链接、运行时换成 node 那份 dll 即可（ABI 已实测兼容）。

## 版本钉死

| 组件 | 版本 | 说明 |
| --- | --- | --- |
| sherpa-onnx 源码 | v1.13.7 | 必须与 `sherpa-onnx-node` 同版本，addon 的 `.node` 直接链接本 DLL |
| onnxruntime-node | 1.26.0 | 提供运行时 `onnxruntime.dll`（`--use_webgpu --use_dml` 构建）与 DXC |
| Microsoft.ML.OnnxRuntime（NuGet） | 1.26.0 | 只取 `build/native/include` 与 `runtimes/win-x64/native/onnxruntime.lib` 链接用 |

升级任一项都要重编（年度适配一并做）。`package.json` 里这两个依赖是精确版本，`overlay-sherpa-runtime.js` 会核对。

## 补丁（`patches/`）

- `patch-sherpa-webgpu.js <sherpa-src>`：三个文件——`provider.h` 加 `kWebGPU`，`provider.cc` 认 `"webgpu"`，`session.cc` 在 `available_providers` 含 `WebGpuExecutionProvider` 时 `AppendExecutionProvider("WebGPU")`，否则回退 CPU。幂等、CRLF 感知。
- `cmake/onnxruntime.cmake`：非 GPU 的 Windows 预装分支只设了 `location_onnxruntime_lib`，缺导入库变量。把那行改成两行：

  ```
  set(location_onnxruntime_lib $ENV{SHERPA_ONNXRUNTIME_LIB_DIR}/onnxruntime.dll)
  set(location_onnxruntime_lib2 $ENV{SHERPA_ONNXRUNTIME_LIB_DIR}/onnxruntime.lib)
  ```

## 构建配方（VS 2022 + cmake ≥ 3.27，约 25 分钟）

```
git -c core.longpaths=true clone --depth 1 --branch v1.13.7 https://github.com/k2-fsa/sherpa-onnx.git sherpa-src
node native/sherpa-onnx-webgpu/patches/patch-sherpa-webgpu.js sherpa-src
（按上文改 sherpa-src/cmake/onnxruntime.cmake）

mkdir ort126\include ort126\lib
（NuGet microsoft.ml.onnxruntime.1.26.0.nupkg 是 zip：build/native/include/* → ort126/include，runtimes/win-x64/native/onnxruntime.lib → ort126/lib）
copy node_modules\onnxruntime-node\bin\napi-v6\win32\x64\onnxruntime.dll ort126\lib\

set SHERPA_ONNXRUNTIME_INCLUDE_DIR=<abs>\ort126\include
set SHERPA_ONNXRUNTIME_LIB_DIR=<abs>\ort126\lib
cmake -S sherpa-src -B build -G "Visual Studio 17 2022" -A x64 -DCMAKE_BUILD_TYPE=Release ^
  -DBUILD_SHARED_LIBS=ON -DSHERPA_ONNX_USE_PRE_INSTALLED_ONNXRUNTIME_IF_AVAILABLE=ON ^
  -DSHERPA_ONNX_ENABLE_DIRECTML=OFF -DSHERPA_ONNX_ENABLE_GPU=OFF -DSHERPA_ONNX_ENABLE_PYTHON=OFF ^
  -DSHERPA_ONNX_ENABLE_TESTS=OFF -DSHERPA_ONNX_ENABLE_CHECK=OFF -DSHERPA_ONNX_ENABLE_PORTAUDIO=OFF ^
  -DSHERPA_ONNX_ENABLE_JNI=OFF -DSHERPA_ONNX_ENABLE_C_API=ON -DSHERPA_ONNX_ENABLE_WEBSOCKET=OFF ^
  -DSHERPA_ONNX_ENABLE_BINARY=OFF -DSHERPA_ONNX_ENABLE_TTS=ON -DCMAKE_INSTALL_PREFIX=<abs>\install
cmake --build build --config Release --target install --parallel
```

产物 `install/lib/sherpa-onnx-c-api.dll` 与 `sherpa-onnx-cxx-api.dll` 复制到 `bin/`，更新 `SHA256SUMS`。源码 clone 放短路径（Android 子目录会超 MAX_PATH）。

## 实测（2026-09-07，RTX 4090 Laptop，全文 gstack v049-gpu-research）

Kokoro fp32 中文三句：首块 573 ms → 111 ms，RTF 0.235 → 0.044；冷态首句要编译管线（中文 2.8 s），所以启用时热身一次。SenseVoice / Qwen3 是 int8，WebGPU 上反而慢 3–6 倍，留在 CPU。
