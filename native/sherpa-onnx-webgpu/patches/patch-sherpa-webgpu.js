// Adds a `webgpu` provider to sherpa-onnx v1.13.7 (provider.h / provider.cc /
// session.cc). Idempotent: skips a file that already carries the patch.
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const csrc = path.join(root, 'sherpa-onnx', 'csrc');

function patch(file, find, insert, marker) {
  const p = path.join(csrc, file);
  let s = fs.readFileSync(p, 'utf8');
  if (s.includes(marker)) { console.log(`${file}: already patched`); return; }
  // The checkout may carry CRLF; anchors are written with LF.
  const eol = s.includes('\r\n') ? '\r\n' : '\n';
  find = find.split('\n').join(eol);
  insert = insert.split('\n').join(eol);
  if (!s.includes(find)) throw new Error(`${file}: anchor not found`);
  s = s.replace(find, find + insert);
  fs.writeFileSync(p, s);
  console.log(`${file}: patched`);
}

patch('provider.h', '  kSpacemiT = 7,  // SpacemiTExecutionProvider\n', '  kWebGPU = 8,    // WebGpuExecutionProvider\n', 'kWebGPU');

patch('provider.cc', '  } else if (s == "spacemit") {\n    return Provider::kSpacemiT;\n', '  } else if (s == "webgpu") {\n    return Provider::kWebGPU;\n', '"webgpu"');

patch('session.cc', '    case Provider::kCPU:\n      break;  // nothing to do for the CPU provider\n',
`    case Provider::kWebGPU: {
      // WebGPU EP (Dawn on D3D12 for Windows). Only present in onnxruntime
      // builds made with --use_webgpu; otherwise fall back to the CPU.
      if (std::find(available_providers.begin(), available_providers.end(),
                    "WebGpuExecutionProvider") != available_providers.end()) {
        try {
          sess_opts.AppendExecutionProvider("WebGPU");
        } catch (const Ort::Exception &ex) {
          SHERPA_ONNX_LOGE("Failed to enable WebGPU: %s. Fallback to cpu",
                           ex.what());
        }
      } else {
        SHERPA_ONNX_LOGE("WebGPU not in this onnxruntime build. Available: %s. Fallback to cpu!",
                         os.str().c_str());
      }
      break;
    }
`, 'Provider::kWebGPU');
