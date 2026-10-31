# Optional Windows audio decoder

The Meetfolio installer does **not** include FFmpeg. Windows x64 users can explicitly download or locally import the pinned upstream archive. Processing subsequently runs offline in a separate hidden child process. The original recording is read-only. No automatic decoder download occurs at startup.

This implementation uses the stable [GyanD/codexffmpeg 9.0.2 release](https://github.com/GyanD/codexffmpeg/releases/tag/9.0.2), `ffmpeg-9.0.2-essentials_build.zip`, 114,768,076 bytes. The archive README identifies FFmpeg source commit [946fcce07b](https://github.com/FFmpeg/FFmpeg/commit/946fcce07b). This particular build enables GPL components and is **GPLv3**, as stated in the upstream README and preserved [license](FFmpeg-GPL-LICENSE). It must not be described as an LGPL build.

| File | SHA-256 |
| --- | --- |
| Original upstream ZIP | `60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba` |
| Extracted `bin/ffmpeg.exe` | `3256173f3f8bffd7df12227c68adf68025edb1832273a9530688a7bb1ed8edec` |

The original ZIP is verified before extraction; the executable is rehashed before use. Downloaded archives stay in the private decoder cache. A manually selected archive stays at its original location. Only the verified executable is extracted, to a fixed private path; arbitrary ZIP paths are never materialized. Neither archives nor executable binaries are committed. `yauzl@3.4.0` (MIT) reads this pinned ZIP; its package retains its upstream license.

The ZIP reader and `pend` helper are bundled by esbuild into the main process and test runtime; they are build dependencies rather than loose production Node modules in ASAR. Their MIT notices ship in the installer resources as [yauzl-LICENSE](yauzl-LICENSE) and [pend-LICENSE](pend-LICENSE).

Bundling, redistributing, mirroring or publishing this decoder is outside this development milestone and requires a separate license/source/notice review. The optional-download architecture alone is not a legal determination about any future distribution. Historical compiled reference assets retain their separate provenance limitations.
