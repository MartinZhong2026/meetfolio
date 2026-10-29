# X-ASR speech component attribution and redistribution

Inspected 2026-10-24. No VoxMinutes source code was copied. Existing Meetfolio licensing is unchanged.

| Component | Source/version | License | Distribution obligation |
| --- | --- | --- | --- |
| X-ASR model and upstream project | [Gilgamesh-J/X-ASR](https://github.com/Gilgamesh-J/X-ASR), official 480 ms punct INT8 2026-06-05 artifact | Apache-2.0 (upstream LICENSE and README declaration) | Include Apache license, preserve copyright/attribution and any upstream NOTICE accompanying the distributed version |
| sherpa-onnx and Node/platform packages | [k2-fsa/sherpa-onnx v1.13.8](https://github.com/k2-fsa/sherpa-onnx/tree/v1.13.8), npm version 1.13.8 | Apache-2.0 | Include Apache license, preserve notices; do not imply upstream endorsement |
| ONNX Runtime bundled native library | [microsoft/onnxruntime v1.28.2](https://github.com/microsoft/onnxruntime/tree/v1.28.2); version string inspected in Linux platform package | MIT, plus third-party components | Include MIT license and upstream ThirdPartyNotices.txt; inspect the actual Windows binary version/dependency notices before release |
| proper-lockfile | 4.1.2, npm lockfile | MIT | Include installed package LICENSE and attribution |
| tar-stream | 3.1.7, npm lockfile | MIT | Include installed package LICENSE and attribution |
| unbzip2-stream | 1.4.3, npm lockfile | MIT | Include installed package LICENSE and attribution |

The official model archive's README identifies the original X-ASR repository; it does not contain its own LICENSE/NOTICE. This repository therefore includes the original X-ASR Apache license as `X-ASR-LICENSE`, sherpa's license as `sherpa-onnx-LICENSE`, ONNX Runtime's license and full upstream third-party notices. Include this directory in the desktop installer and maintain an inventory of **all** actually shipped transitive npm/native dependencies and their license files. Model installation does not copy these repository documents into each model directory; package them with the application.

The Windows native npm archive contains DLLs and the addon but no standalone LICENSE/NOTICE file. The npm package metadata declares Apache-2.0; the repository license and runtime notices must accompany redistribution. Check Microsoft's runtime redistributable terms if DLL dependency inspection shows a VC++ runtime requirement. This PR does not claim a complete installer-level license/dependency audit because no installer has been assembled.

Source pointers:

- https://github.com/Gilgamesh-J/X-ASR/blob/main/LICENSE
- https://github.com/k2-fsa/sherpa-onnx/blob/v1.13.8/LICENSE
- https://github.com/microsoft/onnxruntime/blob/v1.28.2/LICENSE
- https://github.com/microsoft/onnxruntime/blob/v1.28.2/ThirdPartyNotices.txt
- Exact artifact URL/digest: [local-xasr.md](../local-xasr.md)
