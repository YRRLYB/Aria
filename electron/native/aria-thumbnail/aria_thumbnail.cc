// Taskbar iconic-thumbnail support for Aria.
//
// Windows asks an app for an iconic thumbnail when it builds the small taskbar
// card. Electron has no built-in hook for that message, so this addon
// subclasses the browser window and supplies the album-art bitmap that the
// renderer paints. ForceIconicRepresentation makes Windows use this compact
// representation for the taskbar flyout instead of rendering the full window.
//
// DWM requests specific dimensions per hover; bitmaps that do not match are
// rejected, so the source artwork is kept as a DIB and stretched into a
// freshly created DIB of the requested size on every request.

#include <windows.h>
#include <dwmapi.h>
#include <node_api.h>
#include <algorithm>
#include <cstring>

namespace {

constexpr UINT kMsgDwmSendIconicThumbnail = 0x0323;
constexpr UINT kMsgDwmSendIconicLivePreviewBitmap = 0x0326;
constexpr DWORD kDwmwaForceIconicRepresentation = 7;
constexpr DWORD kDwmwaHasIconicBitmap = 10;

HWND g_hwnd = nullptr;
HBITMAP g_thumbnailBitmap = nullptr;
int32_t g_thumbnailWidth = 0;
int32_t g_thumbnailHeight = 0;
HBITMAP g_liveBitmap = nullptr;
int32_t g_liveWidth = 0;
int32_t g_liveHeight = 0;
WNDPROC g_origWndProc = nullptr;
bool g_subclassed = false;
UINT g_taskbarButtonCreatedMessage = 0;
bool g_taskbarButtonReady = false;

struct ThumbStats {
  uint32_t thumbRequests = 0;
  uint32_t thumbOk = 0;
  uint32_t liveRequests = 0;
  uint32_t liveOk = 0;
  int32_t lastThumbHr = 0;
  int32_t lastLiveHr = 0;
  int32_t lastThumbW = 0;
  int32_t lastThumbH = 0;
  int32_t lastOkVariant = -1;
  bool taskbarButtonReady = false;
};
ThumbStats g_stats;

HBITMAP CreateDib(int32_t width, int32_t height, bool top_down, void** bits) {
  BITMAPINFO bmi = {};
  bmi.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
  bmi.bmiHeader.biWidth = width;
  bmi.bmiHeader.biHeight = top_down ? -height : height;  // bottom-up is the GDI default
  bmi.bmiHeader.biPlanes = 1;
  bmi.bmiHeader.biBitCount = 32;
  bmi.bmiHeader.biCompression = BI_RGB;
  HDC screen_dc = GetDC(nullptr);
  HBITMAP bitmap = CreateDIBSection(screen_dc, &bmi, DIB_RGB_COLORS, bits, nullptr, 0);
  ReleaseDC(nullptr, screen_dc);
  return bitmap;
}

// Renders the source artwork onto a fresh DIB of the requested size.
HBITMAP StretchedCopy(HBITMAP source_bitmap,
                      int32_t source_width,
                      int32_t source_height,
                      int32_t width,
                      int32_t height,
                      bool top_down) {
  void* bits = nullptr;
  HBITMAP target = CreateDib(width, height, top_down, &bits);
  if (target == nullptr || bits == nullptr || source_bitmap == nullptr || source_width <= 0 || source_height <= 0) {
    if (target != nullptr) DeleteObject(target);
    return nullptr;
  }

  HDC target_dc = CreateCompatibleDC(nullptr);
  HDC source_dc = CreateCompatibleDC(nullptr);
  HGDIOBJ old_target = SelectObject(target_dc, target);
  HGDIOBJ old_source = SelectObject(source_dc, source_bitmap);

  RECT fill = {0, 0, width, height};
  FillRect(target_dc, &fill, static_cast<HBRUSH>(GetStockObject(BLACK_BRUSH)));
  SetStretchBltMode(target_dc, COLORONCOLOR);
  // Keep cover artwork proportional. DWM requests a nearly square thumbnail
  // and a wide live preview, so stretching the source would visibly distort
  // one of the two states. This mirrors CSS object-fit: cover.
  const double target_ratio = static_cast<double>(width) / static_cast<double>(height);
  const double source_ratio = static_cast<double>(source_width) / static_cast<double>(source_height);
  int32_t crop_width = source_width;
  int32_t crop_height = source_height;
  int32_t crop_x = 0;
  int32_t crop_y = 0;
  if (source_ratio > target_ratio) {
    crop_width = static_cast<int32_t>(source_height * target_ratio);
    crop_x = (source_width - crop_width) / 2;
  } else if (source_ratio < target_ratio) {
    crop_height = static_cast<int32_t>(source_width / target_ratio);
    crop_y = (source_height - crop_height) / 2;
  }
  crop_width = std::max(1, std::min(crop_width, source_width));
  crop_height = std::max(1, std::min(crop_height, source_height));
  StretchBlt(target_dc, 0, 0, width, height, source_dc, crop_x, crop_y, crop_width, crop_height, SRCCOPY);

  SelectObject(target_dc, old_target);
  SelectObject(source_dc, old_source);
  DeleteDC(target_dc);
  DeleteDC(source_dc);
  return target;
}

HBITMAP CaptureWindow(HWND hwnd, int32_t* width, int32_t* height) {
  RECT rect = {};
  if (!GetClientRect(hwnd, &rect)) return nullptr;
  const int32_t capture_width = std::max(1L, rect.right - rect.left);
  const int32_t capture_height = std::max(1L, rect.bottom - rect.top);
  void* bits = nullptr;
  HBITMAP bitmap = CreateDib(capture_width, capture_height, false, &bits);
  if (bitmap == nullptr || bits == nullptr) {
    if (bitmap != nullptr) DeleteObject(bitmap);
    return nullptr;
  }

  HDC dc = CreateCompatibleDC(nullptr);
  HGDIOBJ previous = SelectObject(dc, bitmap);
  const BOOL painted = PrintWindow(hwnd, dc, PW_CLIENTONLY | PW_RENDERFULLCONTENT);
  SelectObject(dc, previous);
  DeleteDC(dc);
  if (!painted) {
    DeleteObject(bitmap);
    return nullptr;
  }
  if (width != nullptr) *width = capture_width;
  if (height != nullptr) *height = capture_height;
  return bitmap;
}

LRESULT CALLBACK AriaThumbWndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
  if (g_taskbarButtonCreatedMessage != 0 && msg == g_taskbarButtonCreatedMessage) {
    g_taskbarButtonReady = true;
    g_stats.taskbarButtonReady = true;
    return CallWindowProcW(g_origWndProc, hwnd, msg, wParam, lParam);
  }

  if (msg == kMsgDwmSendIconicThumbnail && (g_thumbnailBitmap != nullptr || g_liveBitmap != nullptr)) {
    g_stats.thumbRequests += 1;
    // WM_DWMSENDICONICTHUMBNAIL packs max X/width in HIWORD and max
    // Y/height in LOWORD (the order used by Microsoft's DWM sample).
    int32_t req_w = static_cast<int32_t>(HIWORD(lParam));
    int32_t req_h = static_cast<int32_t>(LOWORD(lParam));
    if (req_w <= 0 || req_h <= 0) {
      req_w = g_thumbnailBitmap != nullptr ? g_thumbnailWidth : g_liveWidth;
      req_h = g_thumbnailBitmap != nullptr ? g_thumbnailHeight : g_liveHeight;
    }
    if (req_w > 1024) req_w = 1024;
    if (req_h > 1024) req_h = 1024;
    g_stats.lastThumbW = req_w;
    g_stats.lastThumbH = req_h;

    HBITMAP source_bitmap = g_thumbnailBitmap != nullptr ? g_thumbnailBitmap : g_liveBitmap;
    const int32_t source_width = g_thumbnailBitmap != nullptr ? g_thumbnailWidth : g_liveWidth;
    const int32_t source_height = g_thumbnailBitmap != nullptr ? g_thumbnailHeight : g_liveHeight;

    // The taskbar card has a wide slot on some Windows configurations, but
    // music players use a square cover. A square no larger than the requested
    // bounds prevents the artwork from being stretched into that slot. Keep
    // exact-size fallbacks for Windows builds that insist on the requested
    // dimensions.
    const int32_t square_side = std::max(1, std::min(req_w, req_h));
    // DWM's validation of the returned bitmap has proved picky (exact size,
    // axis order, row order and the display-frame flag all matter on some
    // builds). Try the documented combinations in one request and remember
    // which one the running Windows accepted.
    struct ThumbAttempt { int32_t w; int32_t h; bool top_down; UINT flags; };
    const ThumbAttempt attempts[] = {
        {square_side, square_side, true, 0},
        {square_side, square_side, false, 0},
        {square_side, square_side, true, DWM_SIT_DISPLAYFRAME},
        {square_side, square_side, false, DWM_SIT_DISPLAYFRAME},
        {req_w, req_h, true, 0},
        {req_w, req_h, false, 0},
        {req_h, req_w, true, 0},
        {req_h, req_w, false, 0},
        {req_w, req_h, true, DWM_SIT_DISPLAYFRAME},
        {req_h, req_w, false, DWM_SIT_DISPLAYFRAME},
        {source_width, source_height, false, 0},
        {source_width, source_height, true, 0},
    };
    for (uint32_t attempt = 0; attempt < sizeof(attempts) / sizeof(attempts[0]); ++attempt) {
      HBITMAP bitmap = StretchedCopy(source_bitmap,
                                     source_width,
                                     source_height,
                                     attempts[attempt].w,
                                     attempts[attempt].h,
                                     attempts[attempt].top_down);
      if (bitmap == nullptr) continue;
      HRESULT hr = DwmSetIconicThumbnail(hwnd, bitmap, attempts[attempt].flags);
      DeleteObject(bitmap);
      g_stats.lastThumbHr = static_cast<int32_t>(hr);
      g_stats.lastOkVariant = SUCCEEDED(hr) ? static_cast<int32_t>(attempt) : -1;
      if (SUCCEEDED(hr)) {
        g_stats.thumbOk += 1;
        return 0;
      }
    }
  }

  // Capture the actual Chromium client surface for the large Aero Peek frame.
  // This keeps the preview identical to Aria while the compact thumbnail can
  // remain a dedicated square cover bitmap.
  if (msg == kMsgDwmSendIconicLivePreviewBitmap) {
    g_stats.liveRequests += 1;
    int32_t capture_width = 0;
    int32_t capture_height = 0;
    HBITMAP bitmap = CaptureWindow(hwnd, &capture_width, &capture_height);
    if (bitmap != nullptr) {
      HRESULT hr = DwmSetIconicLivePreviewBitmap(hwnd, bitmap, nullptr, DWM_SIT_DISPLAYFRAME);
      DeleteObject(bitmap);
      g_stats.lastLiveHr = static_cast<int32_t>(hr);
      if (SUCCEEDED(hr)) {
        g_stats.liveOk += 1;
        return 0;
      }
    }
  }

  return CallWindowProcW(g_origWndProc, hwnd, msg, wParam, lParam);
}

void ReplaceSource(HBITMAP& target,
                   int32_t& target_width,
                   int32_t& target_height,
                   HBITMAP next,
                   int32_t width,
                   int32_t height) {
  HBITMAP old = target;
  target = next;
  target_width = width;
  target_height = height;
  if (old != nullptr) DeleteObject(old);
  if (g_hwnd != nullptr) DwmInvalidateIconicBitmaps(g_hwnd);
}

napi_value Attach(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  if (argc < 1) {
    napi_throw_error(env, nullptr, "attach expects a native window handle buffer");
    return nullptr;
  }
  void* data = nullptr;
  size_t length = 0;
  if (napi_get_buffer_info(env, argv[0], &data, &length) != napi_ok || length < sizeof(HWND)) {
    napi_throw_error(env, nullptr, "invalid window handle buffer");
    return nullptr;
  }
  std::memcpy(&g_hwnd, data, sizeof(HWND));
  g_taskbarButtonCreatedMessage = RegisterWindowMessageW(L"TaskbarButtonCreated");
  g_taskbarButtonReady = false;
  g_stats.taskbarButtonReady = false;

  // Opt into app-provided taskbar thumbnails. ForceIconicRepresentation is
  // required together with HasIconicBitmap for a static media-player card;
  // otherwise DWM keeps using a live capture of the complete Electron window.
  BOOL has_iconic_bitmap = TRUE;
  // Ask DWM to use our cover bitmap for the compact thumbnail. The live
  // preview handler below captures the real Electron window separately.
  BOOL force_iconic_representation = TRUE;
  DwmSetWindowAttribute(g_hwnd, kDwmwaForceIconicRepresentation, &force_iconic_representation, sizeof(force_iconic_representation));
  DwmSetWindowAttribute(g_hwnd, kDwmwaHasIconicBitmap, &has_iconic_bitmap, sizeof(has_iconic_bitmap));

  if (!g_subclassed && g_hwnd != nullptr) {
    g_origWndProc = reinterpret_cast<WNDPROC>(
        SetWindowLongPtrW(g_hwnd, GWLP_WNDPROC, reinterpret_cast<LONG_PTR>(AriaThumbWndProc)));
    g_subclassed = g_origWndProc != nullptr;
  }
  napi_value result;
  napi_get_boolean(env, g_subclassed, &result);
  return result;
}

napi_value SetBitmapForSlot(napi_env env, napi_callback_info info, bool live) {
  size_t argc = 3;
  napi_value argv[3];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  if (argc < 3) {
    napi_throw_error(env, nullptr, "setBitmap expects (buffer, width, height)");
    return nullptr;
  }

  bool is_buffer = false;
  if (napi_is_buffer(env, argv[0], &is_buffer) != napi_ok || !is_buffer) {
    napi_throw_error(env, nullptr, "first argument must be a Buffer");
    return nullptr;
  }
  void* data = nullptr;
  size_t length = 0;
  if (napi_get_buffer_info(env, argv[0], &data, &length) != napi_ok) {
    napi_throw_error(env, nullptr, "invalid pixel buffer");
    return nullptr;
  }
  int32_t width = 0;
  int32_t height = 0;
  napi_get_value_int32(env, argv[1], &width);
  napi_get_value_int32(env, argv[2], &height);
  if (width <= 0 || height <= 0 || width > 4096 || height > 4096) {
    napi_throw_error(env, nullptr, "bitmap size out of range");
    return nullptr;
  }
  const size_t needed = static_cast<size_t>(width) * static_cast<size_t>(height) * 4;
  if (length < needed || data == nullptr) {
    napi_throw_error(env, nullptr, "pixel buffer too small");
    return nullptr;
  }

  void* bits = nullptr;
  HBITMAP bitmap = CreateDib(width, height, false, &bits);
  if (bitmap == nullptr || bits == nullptr) {
    napi_throw_error(env, nullptr, "CreateDIBSection failed");
    return nullptr;
  }

  // Renderer sends RGBA top-down; DIB expects BGRA bottom-up.
  const uint8_t* src = static_cast<const uint8_t*>(data);
  uint8_t* dst = static_cast<uint8_t*>(bits);
  for (int32_t row = 0; row < height; ++row) {
    const int32_t dst_row = height - 1 - row;
    for (int32_t col = 0; col < width; ++col) {
      const size_t si = (static_cast<size_t>(row) * width + col) * 4;
      const size_t di = (static_cast<size_t>(dst_row) * width + col) * 4;
      dst[di + 0] = src[si + 2];
      dst[di + 1] = src[si + 1];
      dst[di + 2] = src[si + 0];
      dst[di + 3] = src[si + 3];
    }
  }

  if (live) {
    ReplaceSource(g_liveBitmap, g_liveWidth, g_liveHeight, bitmap, width, height);
  } else {
    ReplaceSource(g_thumbnailBitmap, g_thumbnailWidth, g_thumbnailHeight, bitmap, width, height);
  }
  napi_value result;
  napi_get_boolean(env, true, &result);
  return result;
}

napi_value SetBitmap(napi_env env, napi_callback_info info) {
  return SetBitmapForSlot(env, info, false);
}

napi_value SetLiveBitmap(napi_env env, napi_callback_info info) {
  return SetBitmapForSlot(env, info, true);
}

napi_value ClearBitmap(napi_env env, napi_callback_info) {
  ReplaceSource(g_thumbnailBitmap, g_thumbnailWidth, g_thumbnailHeight, nullptr, 0, 0);
  ReplaceSource(g_liveBitmap, g_liveWidth, g_liveHeight, nullptr, 0, 0);
  napi_value result;
  napi_get_boolean(env, true, &result);
  return result;
}

napi_value Detach(napi_env env, napi_callback_info) {
  if (g_hwnd != nullptr && g_subclassed && g_origWndProc != nullptr) {
    SetWindowLongPtrW(g_hwnd, GWLP_WNDPROC, reinterpret_cast<LONG_PTR>(g_origWndProc));
  }
  g_subclassed = false;
  g_origWndProc = nullptr;
  g_hwnd = nullptr;
  if (g_thumbnailBitmap != nullptr) {
    DeleteObject(g_thumbnailBitmap);
    g_thumbnailBitmap = nullptr;
  }
  if (g_liveBitmap != nullptr) {
    DeleteObject(g_liveBitmap);
    g_liveBitmap = nullptr;
  }
  g_thumbnailWidth = 0;
  g_thumbnailHeight = 0;
  g_liveWidth = 0;
  g_liveHeight = 0;
  napi_value result;
  napi_get_boolean(env, true, &result);
  return result;
}

napi_value GetStats(napi_env env, napi_callback_info) {
  napi_value result;
  if (napi_create_object(env, &result) != napi_ok) return nullptr;
  napi_value value;
  napi_create_uint32(env, g_stats.thumbRequests, &value);
  napi_set_named_property(env, result, "thumbRequests", value);
  napi_create_uint32(env, g_stats.thumbOk, &value);
  napi_set_named_property(env, result, "thumbOk", value);
  napi_create_uint32(env, g_stats.liveRequests, &value);
  napi_set_named_property(env, result, "liveRequests", value);
  napi_create_uint32(env, g_stats.liveOk, &value);
  napi_set_named_property(env, result, "liveOk", value);
  napi_create_int32(env, g_stats.lastThumbHr, &value);
  napi_set_named_property(env, result, "lastThumbHr", value);
  napi_create_int32(env, g_stats.lastLiveHr, &value);
  napi_set_named_property(env, result, "lastLiveHr", value);
  napi_create_int32(env, g_stats.lastThumbW, &value);
  napi_set_named_property(env, result, "lastThumbW", value);
  napi_create_int32(env, g_stats.lastThumbH, &value);
  napi_set_named_property(env, result, "lastThumbH", value);
  napi_create_int32(env, g_stats.lastOkVariant, &value);
  napi_set_named_property(env, result, "lastOkVariant", value);
  napi_get_boolean(env, g_taskbarButtonReady, &value);
  napi_set_named_property(env, result, "taskbarButtonReady", value);
  napi_get_boolean(env, g_subclassed, &value);
  napi_set_named_property(env, result, "subclassed", value);
  napi_get_boolean(env, g_thumbnailBitmap != nullptr || g_liveBitmap != nullptr, &value);
  napi_set_named_property(env, result, "hasSource", value);
  napi_get_boolean(env, g_liveBitmap != nullptr, &value);
  napi_set_named_property(env, result, "hasLive", value);
  return result;
}

napi_value Init(napi_env env, napi_value exports) {
  napi_property_descriptor props[] = {
      {"attach", nullptr, Attach, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"setBitmap", nullptr, SetBitmap, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"setLiveBitmap", nullptr, SetLiveBitmap, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"clearBitmap", nullptr, ClearBitmap, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"detach", nullptr, Detach, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"getStats", nullptr, GetStats, nullptr, nullptr, nullptr, napi_default, nullptr},
  };
  napi_define_properties(env, exports, sizeof(props) / sizeof(props[0]), props);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)

}  // namespace
