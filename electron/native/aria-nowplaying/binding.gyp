{
  "targets": [
    {
      "target_name": "aria_nowplaying",
      "sources": ["nowplaying.mm"],
      "conditions": [
        ["OS=='mac'", {
          "libraries": [
            "-framework Foundation",
            "-framework MediaPlayer",
            "-framework AppKit"
          ],
          "xcode_settings": {
            "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
            "GCC_ENABLE_CPP_RTTI": "YES",
            "CLANG_CXX_LANGUAGE_STANDARD": "c++17",
            "MACOSX_DEPLOYMENT_TARGET": "10.15",
            "OTHER_LDFLAGS": [
              "-framework Foundation",
              "-framework MediaPlayer",
              "-framework AppKit"
            ]
          }
        }]
      ]
    }
  ]
}
