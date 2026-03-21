Pod::Spec.new do |s|
  s.name         = "SupertonicTTS"
  s.version      = "1.0.0"
  s.summary      = "React Native bridge for Supertonic 2 TTS (ONNX-based multilingual)"
  s.homepage     = "https://github.com/supertone-inc/supertonic"
  s.license      = "MIT"
  s.author       = "Polyglot AI"
  s.platform     = :ios, "15.0"
  s.source       = { :path => "." }
  s.source_files = "*.{swift,m,h}"
  s.dependency "React-Core"
  s.dependency "onnxruntime-objc", "~> 1.20"
  s.swift_version = "5.9"
end
