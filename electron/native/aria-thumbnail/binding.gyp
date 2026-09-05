{
  "targets": [
    {
      "target_name": "aria_thumbnail",
      "sources": ["aria_thumbnail.cc"],
      "libraries": ["dwmapi.lib", "user32.lib", "gdi32.lib"],
      "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"],
      "msvs_settings": {
        "VCCLCompilerTool": {
          "ExceptionHandling": 1
        }
      },
      "conditions": [
        ["OS!='win'", { "sources!": ["aria_thumbnail.cc"] }]
      ]
    }
  ]
}
