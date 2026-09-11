{
  "targets": [
    {
      "target_name": "aria_thumbnail",
      "sources": ["aria_thumbnail.cc", "media_session.cc"],
      "libraries": ["dwmapi.lib", "user32.lib", "gdi32.lib", "windowsapp.lib", "shcore.lib", "shlwapi.lib"],
      "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"],
      "msvs_settings": {
        "VCCLCompilerTool": {
          "ExceptionHandling": 1,
          "AdditionalOptions": ["/utf-8"]
        }
      },
      "conditions": [
        ["OS!='win'", { "sources!": ["aria_thumbnail.cc", "media_session.cc"] }]
      ]
    }
  ]
}
