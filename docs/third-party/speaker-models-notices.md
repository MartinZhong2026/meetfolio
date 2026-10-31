# Optional local speaker models

Meetfolio uses the already-pinned Sherpa ONNX native runtime. The optional speaker weights are downloaded from the official `k2-fsa/sherpa-onnx` release assets after a user action, or imported locally with SHA-256 verification. They are not shipped in this repository or installer.

- **Pyannote segmentation 3.0 INT8**: converted by Sherpa from `pyannote/segmentation-3.0`. The official `sherpa-onnx-pyannote-segmentation-3-0.tar.bz2` includes an MIT license, Copyright (c) 2022 CNRS. Its exact text is preserved in [pyannote-segmentation-LICENSE](pyannote-segmentation-LICENSE). [Upstream model instructions](https://k2-fsa.github.io/sherpa/onnx/speaker-diarization/models.html).
- **3D-Speaker ERes2Net**: `3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx`, from the official Sherpa `speaker-recongition-models` release. [3D-Speaker project and Apache-2.0 license](https://github.com/modelscope/3D-Speaker). The Apache-2.0 license text is also present in [sherpa-onnx-LICENSE](sherpa-onnx-LICENSE). Preserve upstream notices when distributing model files separately.

No Reverb noncommercial model is used. Public audio fixtures are downloaded into ignored test directories and are not redistributed. These development notes do not establish complete redistribution rights for unrelated historical recovery binaries.
