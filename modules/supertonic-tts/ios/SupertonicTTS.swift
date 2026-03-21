import Foundation
import AVFoundation
import OnnxRuntimeBindings

// MARK: - React Native Module

@objc(SupertonicTTS)
class SupertonicTTS: RCTEventEmitter {

    private var engine: SupertonicEngine?
    private var audioPlayer: AVAudioPlayer?

    override static func requiresMainQueueSetup() -> Bool { return false }

    override func supportedEvents() -> [String]! {
        return ["SupertonicTTSProgress", "SupertonicTTSComplete"]
    }

    @objc func initialize(
        _ onnxDir: String,
        voiceStylePath: String,
        totalStep: NSNumber,
        speed: NSNumber,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            do {
                let eng = SupertonicEngine()
                try eng.initialize(
                    onnxDir: onnxDir,
                    voiceStylePath: voiceStylePath,
                    totalStep: totalStep.intValue,
                    speed: speed.floatValue
                )
                self?.engine = eng
                resolve(nil)
            } catch {
                reject("INIT_ERROR", error.localizedDescription, error)
            }
        }
    }

    @objc func generateAndPlay(
        _ text: String,
        language: String,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        guard let engine = engine else {
            reject("NOT_INITIALIZED", "TTS engine not initialized", nil)
            return
        }

        stopPlayback()

        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            do {
                let wav = try engine.synthesize(text: text, lang: language)
                let tmpURL = FileManager.default.temporaryDirectory
                    .appendingPathComponent("supertonic_\(UUID().uuidString).wav")
                try engine.writeWavFile(url: tmpURL, audioData: wav)

                DispatchQueue.main.async {
                    do {
                        try AVAudioSession.sharedInstance().setCategory(.playback, mode: .default)
                        try AVAudioSession.sharedInstance().setActive(true)

                        let player = try AVAudioPlayer(contentsOf: tmpURL)
                        player.delegate = self
                        player.prepareToPlay()
                        player.play()
                        self?.audioPlayer = player
                        resolve(nil)
                    } catch {
                        reject("PLAY_ERROR", error.localizedDescription, error)
                    }
                }
            } catch {
                reject("SYNTH_ERROR", error.localizedDescription, error)
            }
        }
    }

    @objc func generateToFile(
        _ text: String,
        language: String,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        guard let engine = engine else {
            reject("NOT_INITIALIZED", "TTS engine not initialized", nil)
            return
        }

        DispatchQueue.global(qos: .userInitiated).async {
            do {
                let wav = try engine.synthesize(text: text, lang: language)
                let tmpURL = FileManager.default.temporaryDirectory
                    .appendingPathComponent("supertonic_\(UUID().uuidString).wav")
                try engine.writeWavFile(url: tmpURL, audioData: wav)
                resolve(tmpURL.path)
            } catch {
                reject("SYNTH_ERROR", error.localizedDescription, error)
            }
        }
    }

    @objc func stop() {
        stopPlayback()
    }

    @objc func deinitialize() {
        stopPlayback()
        engine?.deinitialize()
        engine = nil
    }

    @objc func getSampleRate(
        _ resolve: RCTPromiseResolveBlock,
        rejecter reject: RCTPromiseRejectBlock
    ) {
        guard let engine = engine else {
            reject("NOT_INITIALIZED", "Engine not initialized", nil)
            return
        }
        resolve(engine.sampleRate)
    }

    private func stopPlayback() {
        audioPlayer?.stop()
        audioPlayer = nil
    }
}

// MARK: - AVAudioPlayerDelegate

extension SupertonicTTS: AVAudioPlayerDelegate {
    func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        sendEvent(withName: "SupertonicTTSComplete", body: nil)
    }
}

// MARK: - Supertonic Engine (ONNX Inference Pipeline)

private let AVAILABLE_LANGS = ["en", "ko", "es", "pt", "fr"]

class SupertonicEngine {
    private var env: ORTEnv?
    private var dpSession: ORTSession?
    private var textEncSession: ORTSession?
    private var vectorEstSession: ORTSession?
    private var vocoderSession: ORTSession?

    private var unicodeIndexer: [Int64] = []
    private var styleTtl: ORTValue?
    private var styleDp: ORTValue?

    private(set) var sampleRate: Int = 0
    private var baseChunkSize: Int = 0
    private var chunkCompress: Int = 0
    private var latentDim: Int = 0
    private var totalStep: Int = 2
    private var speed: Float = 1.05

    private var initialized = false

    func initialize(onnxDir: String, voiceStylePath: String, totalStep: Int, speed: Float) throws {
        self.totalStep = totalStep
        self.speed = speed

        // Load config
        let cfgData = try Data(contentsOf: URL(fileURLWithPath: "\(onnxDir)/tts.json"))
        let config = try JSONDecoder().decode(Config.self, from: cfgData)
        sampleRate = config.ae.sample_rate
        baseChunkSize = config.ae.base_chunk_size
        chunkCompress = config.ttl.chunk_compress_factor
        latentDim = config.ttl.latent_dim

        // Load unicode indexer
        let indexerData = try Data(contentsOf: URL(fileURLWithPath: "\(onnxDir)/unicode_indexer.json"))
        unicodeIndexer = try JSONDecoder().decode([Int64].self, from: indexerData)

        // Create ONNX env + sessions
        env = try ORTEnv(loggingLevel: .warning)
        let opts = try ORTSessionOptions()

        dpSession = try ORTSession(env: env!, modelPath: "\(onnxDir)/duration_predictor.onnx", sessionOptions: opts)
        textEncSession = try ORTSession(env: env!, modelPath: "\(onnxDir)/text_encoder.onnx", sessionOptions: opts)
        vectorEstSession = try ORTSession(env: env!, modelPath: "\(onnxDir)/vector_estimator.onnx", sessionOptions: opts)
        vocoderSession = try ORTSession(env: env!, modelPath: "\(onnxDir)/vocoder.onnx", sessionOptions: opts)

        // Load voice style
        try loadVoiceStyle(path: voiceStylePath)

        initialized = true
        print("[SupertonicEngine] Initialized: sr=\(sampleRate) step=\(totalStep) speed=\(speed)")
    }

    private func loadVoiceStyle(path: String) throws {
        let data = try Data(contentsOf: URL(fileURLWithPath: path))
        let style = try JSONDecoder().decode(VoiceStyleData.self, from: data)

        let ttlDims = style.style_ttl.dims
        var ttlFlat = style.style_ttl.data.flatMap { $0.flatMap { $0 } }
        let ttlShape: [NSNumber] = ttlDims.map { NSNumber(value: $0) }
        styleTtl = try ORTValue(
            tensorData: NSMutableData(bytes: &ttlFlat, length: ttlFlat.count * MemoryLayout<Float>.size),
            elementType: .float, shape: ttlShape
        )

        let dpDims = style.style_dp.dims
        var dpFlat = style.style_dp.data.flatMap { $0.flatMap { $0 } }
        let dpShape: [NSNumber] = dpDims.map { NSNumber(value: $0) }
        styleDp = try ORTValue(
            tensorData: NSMutableData(bytes: &dpFlat, length: dpFlat.count * MemoryLayout<Float>.size),
            elementType: .float, shape: dpShape
        )
    }

    func synthesize(text: String, lang: String) throws -> [Float] {
        guard initialized else { throw NSError(domain: "TTS", code: 1, userInfo: [NSLocalizedDescriptionKey: "Not initialized"]) }
        guard AVAILABLE_LANGS.contains(lang) else { throw NSError(domain: "TTS", code: 2, userInfo: [NSLocalizedDescriptionKey: "Invalid language: \(lang)"]) }

        let maxLen = lang == "ko" ? 120 : 300
        let chunks = chunkText(text, maxLen: maxLen)

        var wavCat = [Float]()
        for (i, chunk) in chunks.enumerated() {
            let chunkWav = try inferSingle(text: chunk, lang: lang)
            if i > 0 {
                let silenceLen = Int(0.3 * Float(sampleRate))
                wavCat.append(contentsOf: [Float](repeating: 0.0, count: silenceLen))
            }
            wavCat.append(contentsOf: chunkWav)
        }
        return wavCat
    }

    private func inferSingle(text: String, lang: String) throws -> [Float] {
        let processed = preprocessText(text, lang: lang)
        let codePoints = Array(processed.unicodeScalars.map { Int($0.value) })
        let seqLen = codePoints.count

        // Token IDs
        var textIdsFlat = codePoints.map { cp -> Int64 in
            cp < unicodeIndexer.count ? unicodeIndexer[cp] : 0
        }
        let textIdsShape: [NSNumber] = [1, NSNumber(value: seqLen)]
        let textIdsValue = try ORTValue(
            tensorData: NSMutableData(bytes: &textIdsFlat, length: textIdsFlat.count * MemoryLayout<Int64>.size),
            elementType: .int64, shape: textIdsShape
        )

        // Text mask
        var textMaskFlat = [Float](repeating: 1.0, count: seqLen)
        let textMaskShape: [NSNumber] = [1, 1, NSNumber(value: seqLen)]
        let textMaskValue = try ORTValue(
            tensorData: NSMutableData(bytes: &textMaskFlat, length: textMaskFlat.count * MemoryLayout<Float>.size),
            elementType: .float, shape: textMaskShape
        )

        // 1. Duration prediction
        let dpOutputs = try dpSession!.run(
            withInputs: ["text_ids": textIdsValue, "style_dp": styleDp!, "text_mask": textMaskValue],
            outputNames: ["duration"], runOptions: nil
        )
        let durationData = try dpOutputs["duration"]!.tensorData() as Data
        var duration = durationData.withUnsafeBytes { ptr in
            Array(ptr.bindMemory(to: Float.self))
        }[0] / speed

        // 2. Text encoding
        let textEncOutputs = try textEncSession!.run(
            withInputs: ["text_ids": textIdsValue, "style_ttl": styleTtl!, "text_mask": textMaskValue],
            outputNames: ["text_emb"], runOptions: nil
        )
        let textEmbValue = textEncOutputs["text_emb"]!

        // 3. Sample noisy latent
        let wavLen = Int(duration * Float(sampleRate))
        let chunkSize = baseChunkSize * chunkCompress
        let latentLen = (wavLen + chunkSize - 1) / chunkSize
        let latentDimVal = latentDim * chunkCompress

        var noisyLatent = [Float](repeating: 0.0, count: latentDimVal * latentLen)
        for i in 0..<noisyLatent.count {
            let u1 = max(1e-10, Float.random(in: 0.0...1.0))
            let u2 = Float.random(in: 0.0...1.0)
            noisyLatent[i] = sqrt(-2.0 * log(u1)) * cos(2.0 * .pi * u2)
        }

        var latentMaskFlat = [Float](repeating: 1.0, count: latentLen)

        var totalStepArr: [Float] = [Float(totalStep)]
        let totalStepValue = try ORTValue(
            tensorData: NSMutableData(bytes: &totalStepArr, length: MemoryLayout<Float>.size),
            elementType: .float, shape: [1]
        )

        // 4. Denoising loop
        for step in 0..<totalStep {
            var currentStepArr: [Float] = [Float(step)]
            let currentStepValue = try ORTValue(
                tensorData: NSMutableData(bytes: &currentStepArr, length: MemoryLayout<Float>.size),
                elementType: .float, shape: [1]
            )

            let xtShape: [NSNumber] = [1, NSNumber(value: latentDimVal), NSNumber(value: latentLen)]
            let xtValue = try ORTValue(
                tensorData: NSMutableData(bytes: &noisyLatent, length: noisyLatent.count * MemoryLayout<Float>.size),
                elementType: .float, shape: xtShape
            )

            let latentMaskShape: [NSNumber] = [1, 1, NSNumber(value: latentLen)]
            let latentMaskValue = try ORTValue(
                tensorData: NSMutableData(bytes: &latentMaskFlat, length: latentMaskFlat.count * MemoryLayout<Float>.size),
                elementType: .float, shape: latentMaskShape
            )

            // Re-create text mask for each step (ORTValue may be consumed)
            var textMaskFlat2 = [Float](repeating: 1.0, count: seqLen)
            let textMaskValue2 = try ORTValue(
                tensorData: NSMutableData(bytes: &textMaskFlat2, length: textMaskFlat2.count * MemoryLayout<Float>.size),
                elementType: .float, shape: textMaskShape
            )

            let vecEstOutputs = try vectorEstSession!.run(withInputs: [
                "noisy_latent": xtValue, "text_emb": textEmbValue, "style_ttl": styleTtl!,
                "latent_mask": latentMaskValue, "text_mask": textMaskValue2,
                "current_step": currentStepValue, "total_step": totalStepValue
            ], outputNames: ["denoised_latent"], runOptions: nil)

            let denoisedData = try vecEstOutputs["denoised_latent"]!.tensorData() as Data
            noisyLatent = denoisedData.withUnsafeBytes { ptr in
                Array(ptr.bindMemory(to: Float.self))
            }
        }

        // 5. Vocoder
        let finalXtShape: [NSNumber] = [1, NSNumber(value: latentDimVal), NSNumber(value: latentLen)]
        let finalXtValue = try ORTValue(
            tensorData: NSMutableData(bytes: &noisyLatent, length: noisyLatent.count * MemoryLayout<Float>.size),
            elementType: .float, shape: finalXtShape
        )

        let vocoderOutputs = try vocoderSession!.run(
            withInputs: ["latent": finalXtValue],
            outputNames: ["wav_tts"], runOptions: nil
        )
        let wavData = try vocoderOutputs["wav_tts"]!.tensorData() as Data
        let wav = wavData.withUnsafeBytes { ptr in Array(ptr.bindMemory(to: Float.self)) }

        let actualLen = min(Int(duration * Float(sampleRate)), wav.count)
        return Array(wav.prefix(actualLen))
    }

    func writeWavFile(url: URL, audioData: [Float]) throws {
        let int16Data = audioData.map { sample -> Int16 in
            Int16(max(-1.0, min(1.0, sample)) * 32767.0)
        }

        let numChannels: UInt16 = 1
        let bitsPerSample: UInt16 = 16
        let byteRate = UInt32(sampleRate) * UInt32(numChannels) * UInt32(bitsPerSample) / 8
        let blockAlign = numChannels * bitsPerSample / 8
        let dataSize = UInt32(int16Data.count * 2)

        var data = Data()
        data.append("RIFF".data(using: .ascii)!)
        withUnsafeBytes(of: UInt32(36 + dataSize).littleEndian) { data.append(contentsOf: $0) }
        data.append("WAVE".data(using: .ascii)!)
        data.append("fmt ".data(using: .ascii)!)
        withUnsafeBytes(of: UInt32(16).littleEndian) { data.append(contentsOf: $0) }
        withUnsafeBytes(of: UInt16(1).littleEndian) { data.append(contentsOf: $0) }
        withUnsafeBytes(of: numChannels.littleEndian) { data.append(contentsOf: $0) }
        withUnsafeBytes(of: UInt32(sampleRate).littleEndian) { data.append(contentsOf: $0) }
        withUnsafeBytes(of: byteRate.littleEndian) { data.append(contentsOf: $0) }
        withUnsafeBytes(of: blockAlign.littleEndian) { data.append(contentsOf: $0) }
        withUnsafeBytes(of: bitsPerSample.littleEndian) { data.append(contentsOf: $0) }
        data.append("data".data(using: .ascii)!)
        withUnsafeBytes(of: dataSize.littleEndian) { data.append(contentsOf: $0) }
        int16Data.withUnsafeBytes { data.append(contentsOf: $0) }

        try data.write(to: url)
    }

    func deinitialize() {
        initialized = false
        dpSession = nil
        textEncSession = nil
        vectorEstSession = nil
        vocoderSession = nil
        styleTtl = nil
        styleDp = nil
        env = nil
        print("[SupertonicEngine] Deinitialized")
    }

    // MARK: - Text Processing

    private func preprocessText(_ text: String, lang: String) -> String {
        var t = text.decomposedStringWithCompatibilityMapping

        // Remove emojis
        t = String(t.unicodeScalars.filter { s in
            let v = s.value
            return !((v >= 0x1F600 && v <= 0x1F64F) || (v >= 0x1F300 && v <= 0x1F5FF) ||
                     (v >= 0x1F680 && v <= 0x1F6FF) || (v >= 0x1F700 && v <= 0x1FAFF) ||
                     (v >= 0x2600 && v <= 0x27BF) || (v >= 0x1F1E6 && v <= 0x1F1FF))
        })

        let replacements: [String: String] = [
            "\u{2013}": "-", "\u{2011}": "-", "\u{2014}": "-", "_": " ",
            "\u{201C}": "\"", "\u{201D}": "\"", "\u{2018}": "'", "\u{2019}": "'",
            "\u{00B4}": "'", "`": "'", "[": " ", "]": " ", "|": " ", "/": " ",
            "#": " ", "\u{2192}": " ", "\u{2190}": " ",
        ]
        for (old, new) in replacements { t = t.replacingOccurrences(of: old, with: new) }

        for sym in ["\u{2665}", "\u{2606}", "\u{2661}", "\u{00A9}", "\\"] {
            t = t.replacingOccurrences(of: sym, with: "")
        }

        t = t.replacingOccurrences(of: "@", with: " at ")
        t = t.replacingOccurrences(of: "e.g.,", with: "for example, ")
        t = t.replacingOccurrences(of: "i.e.,", with: "that is, ")

        for (p, r) in [(" ,", ","), (" .", "."), (" !", "!"), (" ?", "?"), (" ;", ";"), (" :", ":"), (" '", "'")] {
            t = t.replacingOccurrences(of: p, with: r)
        }

        while t.contains("\"\"") { t = t.replacingOccurrences(of: "\"\"", with: "\"") }
        while t.contains("''") { t = t.replacingOccurrences(of: "''", with: "'") }

        let ws = try! NSRegularExpression(pattern: "\\s+")
        t = ws.stringByReplacingMatches(in: t, range: NSRange(t.startIndex..., in: t), withTemplate: " ")
        t = t.trimmingCharacters(in: .whitespacesAndNewlines)

        if !t.isEmpty {
            let punc = try! NSRegularExpression(pattern: "[.!?;:,'\"]$")
            if punc.firstMatch(in: t, range: NSRange(t.startIndex..., in: t)) == nil { t += "." }
        }

        return "<\(lang)>\(t)</\(lang)>"
    }

    private func chunkText(_ text: String, maxLen: Int) -> [String] {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if t.isEmpty { return [""] }
        if t.count <= maxLen { return [t] }

        // Simple sentence splitting
        let parts = t.components(separatedBy: ". ")
        var chunks = [String]()
        var current = ""

        for part in parts {
            let sentence = part.hasSuffix(".") ? part : part + "."
            if current.count + sentence.count + 1 > maxLen && !current.isEmpty {
                chunks.append(current.trimmingCharacters(in: .whitespacesAndNewlines))
                current = ""
            }
            if !current.isEmpty { current += " " }
            current += sentence
        }
        if !current.isEmpty { chunks.append(current.trimmingCharacters(in: .whitespacesAndNewlines)) }
        return chunks.isEmpty ? [""] : chunks
    }
}

// MARK: - Data Structures

private struct Config: Codable {
    struct AEConfig: Codable {
        let sample_rate: Int
        let base_chunk_size: Int
    }
    struct TTLConfig: Codable {
        let chunk_compress_factor: Int
        let latent_dim: Int
    }
    let ae: AEConfig
    let ttl: TTLConfig
}

private struct VoiceStyleData: Codable {
    struct StyleComponent: Codable {
        let data: [[[Float]]]
        let dims: [Int]
        let type: String
    }
    let style_ttl: StyleComponent
    let style_dp: StyleComponent
}
