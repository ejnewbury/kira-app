#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@interface RCT_EXTERN_MODULE(SupertonicTTS, RCTEventEmitter)

RCT_EXTERN_METHOD(initialize:(NSString *)onnxDir
                  voiceStylePath:(NSString *)voiceStylePath
                  totalStep:(nonnull NSNumber *)totalStep
                  speed:(nonnull NSNumber *)speed
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(generateAndPlay:(NSString *)text
                  language:(NSString *)language
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(generateToFile:(NSString *)text
                  language:(NSString *)language
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(stop)

RCT_EXTERN_METHOD(deinitialize)

RCT_EXTERN_METHOD(getSampleRate:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
