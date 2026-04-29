import Foundation
import AVFoundation
import Speech

final class SpeechSession {
    private let recognizer: SFSpeechRecognizer?
    private let engine = AVAudioEngine()
    private let request = SFSpeechAudioBufferRecognitionRequest()
    private var task: SFSpeechRecognitionTask?
    private var latestTranscript = ""
    private var isStopping = false

    init(localeIdentifier: String) {
        recognizer = SFSpeechRecognizer(locale: Locale(identifier: localeIdentifier))
        request.shouldReportPartialResults = true
    }

    func start() {
        guard let recognizer else {
            fail("Speech recognizer is unavailable for this language.")
        }

        SFSpeechRecognizer.requestAuthorization { status in
            DispatchQueue.main.async {
                guard status == .authorized else {
                    self.fail("Speech recognition permission was not granted.")
                }
                self.startEngine(with: recognizer)
            }
        }
    }

    private func startEngine(with recognizer: SFSpeechRecognizer) {
        let inputNode = engine.inputNode
        let format = inputNode.outputFormat(forBus: 0)

        task = recognizer.recognitionTask(with: request) { result, error in
            if let result {
                self.latestTranscript = result.bestTranscription.formattedString
            }

            if let error, !self.isStopping {
                self.fail(error.localizedDescription)
            }
        }

        inputNode.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
            self.request.append(buffer)
        }

        do {
            engine.prepare()
            try engine.start()
            fputs("READY\n", stderr)
            fflush(stderr)
        } catch {
            fail(error.localizedDescription)
        }
    }

    func stop() {
        guard !isStopping else { return }
        isStopping = true
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        request.endAudio()

        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) {
            print(self.latestTranscript)
            fflush(stdout)
            self.task?.cancel()
            exit(0)
        }
    }

    private func fail(_ message: String) -> Never {
        fputs("ERROR: \(message)\n", stderr)
        fflush(stderr)
        exit(2)
    }
}

let language = CommandLine.arguments.dropFirst().first ?? "zh-CN"
let session = SpeechSession(localeIdentifier: language)

signal(SIGTERM) { _ in
    exit(0)
}

DispatchQueue.global(qos: .userInitiated).async {
    while let line = readLine() {
        if line.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == "stop" {
            DispatchQueue.main.async {
                session.stop()
            }
            break
        }
    }
}

session.start()
RunLoop.main.run()
