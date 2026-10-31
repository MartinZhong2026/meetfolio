// Meetfolio system-codec bridge. No network, third-party codec downloads or full-file buffers.
import Foundation
import AVFoundation

enum DecodeError: Error { case invalidInput, conversion, duration }
let maxFrames: Int64 = 16_000 * 120 * 60
do {
    let args = CommandLine.arguments
    if args.count == 2 && args[1] == "--version" {
        #if arch(arm64)
        print("meetfolio-avfoundation-v1 arm64")
        #elseif arch(x86_64)
        print("meetfolio-avfoundation-v1 x64")
        #else
        throw DecodeError.invalidInput
        #endif
    } else {
        guard args.count == 3, ["--probe", "--decode"].contains(args[1]),
              ["wav", "mp3", "m4a"].contains(URL(fileURLWithPath: args[2]).pathExtension.lowercased()) else { throw DecodeError.invalidInput }
        let url = URL(fileURLWithPath: args[2])
        let attrs = try FileManager.default.attributesOfItem(atPath: url.path)
        guard attrs[.type] as? FileAttributeType == .typeRegular,
              let bytes = attrs[.size] as? NSNumber, bytes.int64Value > 0, bytes.int64Value <= 2 * 1024 * 1024 * 1024 else { throw DecodeError.invalidInput }
        let file = try AVAudioFile(forReading: url)
        let seconds = Double(file.length) / file.processingFormat.sampleRate
        guard seconds.isFinite, seconds > 0, seconds <= 7200.05 else { throw DecodeError.duration }
        if args[1] == "--probe" {
            print(min(seconds, 7200) * 1000)
        } else {
            guard let format = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16000, channels: 1, interleaved: true),
                  let converter = AVAudioConverter(from: file.processingFormat, to: format),
                  let input = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: 32768),
                  let output = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 8192) else { throw DecodeError.conversion }
            var ended = false
            var inputError: Error?
            var total: Int64 = 0
            while true {
                output.frameLength = 0
                var error: NSError?
                let status = converter.convert(to: output, error: &error) { requested, state in
                    if ended { state.pointee = .endOfStream; return nil }
                    do {
                        let remaining = file.length - file.framePosition
                        if remaining <= 0 { ended = true; state.pointee = .endOfStream; return nil }
                        input.frameLength = 0
                        let count = min(min(AVAudioFrameCount(requested), input.frameCapacity), AVAudioFrameCount(min(remaining, Int64(input.frameCapacity))))
                        try file.read(into: input, frameCount: count)
                        if input.frameLength == 0 { ended = true; state.pointee = .endOfStream; return nil }
                        state.pointee = .haveData; return input
                    } catch { inputError = error; ended = true; state.pointee = .endOfStream; return nil }
                }
                if let inputError = inputError { throw inputError }
                if let error = error { throw error }
                if status == .error { throw DecodeError.conversion }
                if output.frameLength > 0 {
                    total += Int64(output.frameLength)
                    guard total <= maxFrames, let samples = output.int16ChannelData else { throw DecodeError.duration }
                    try FileHandle.standardOutput.write(contentsOf: Data(bytes: samples[0], count: Int(output.frameLength) * 2))
                }
                if status == .endOfStream { break }
                if ended && output.frameLength == 0 { break }
            }
            guard total > 0 else { throw DecodeError.conversion }
        }
    }
} catch {
    // Never echo the source path or recording metadata into diagnostics.
    let failure = error as NSError
    let domain = failure.domain.filter { $0.isLetter || $0.isNumber || $0 == "." || $0 == "_" || $0 == "-" }
    FileHandle.standardError.write(Data("Local audio conversion failed (\(domain):\(failure.code))\n".utf8))
    exit(1)
}
