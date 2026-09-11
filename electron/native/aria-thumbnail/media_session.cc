// One app-owned SMTC session, independent of the active audio decoder.
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <systemmediatransportcontrolsinterop.h>
#include <shcore.h>
#include <shlwapi.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Media.h>
#include <winrt/Windows.Storage.Streams.h>
#include <node_api.h>
#include <memory>
#include <string>

using namespace winrt;
using namespace Windows::Media;
using namespace Windows::Storage::Streams;

namespace {
SystemMediaTransportControls controls{nullptr};
event_token buttonToken{};
bool subscribed = false;
std::string lastTitle, lastArtist, lastAlbum;
std::string lastArtwork;

struct Callback {
  napi_threadsafe_function function = nullptr;
  ~Callback() {
    if (function) napi_release_threadsafe_function(function, napi_tsfn_abort);
  }
};

void Dispose(void* = nullptr) {
  if (controls) {
    try {
      if (subscribed) controls.ButtonPressed(buttonToken);
      controls.IsEnabled(false);
      controls.DisplayUpdater().ClearAll();
      controls.DisplayUpdater().Update();
    } catch (...) {}
    subscribed = false;
    controls = nullptr;
  }
  lastTitle.clear(); lastArtist.clear(); lastAlbum.clear(); lastArtwork.clear();
}

napi_value Boolean(napi_env env, bool value) {
  napi_value result;
  napi_get_boolean(env, value, &result);
  return result;
}

std::string String(napi_env env, napi_value object, const char* name) {
  napi_value value;
  size_t size = 0;
  if (napi_get_named_property(env, object, name, &value) != napi_ok ||
      napi_get_value_string_utf8(env, value, nullptr, 0, &size) != napi_ok) return {};
  std::string result(size + 1, '\0');
  napi_get_value_string_utf8(env, value, result.data(), result.size(), &size);
  result.resize(size);
  return result;
}

bool Flag(napi_env env, napi_value object, const char* name) {
  napi_value value;
  bool result = false;
  if (napi_get_named_property(env, object, name, &value) == napi_ok)
    napi_get_value_bool(env, value, &result);
  return result;
}

napi_value Attach(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value args[2];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  void* handle = nullptr;
  size_t size = 0;
  napi_valuetype type;
  if (argc != 2 || napi_get_buffer_info(env, args[0], &handle, &size) != napi_ok ||
      size < sizeof(HWND) || napi_typeof(env, args[1], &type) != napi_ok || type != napi_function)
    return Boolean(env, false);
  Dispose();
  try {
    auto factory = get_activation_factory<SystemMediaTransportControls, ISystemMediaTransportControlsInterop>();
    check_hresult(factory->GetForWindow(*static_cast<HWND*>(handle),
      guid_of<SystemMediaTransportControls>(), put_abi(controls)));
    auto callback = std::make_shared<Callback>();
    napi_value name;
    napi_create_string_utf8(env, "Aria media controls", NAPI_AUTO_LENGTH, &name);
    if (napi_create_threadsafe_function(env, args[1], nullptr, name, 32, 1, nullptr,
        nullptr, nullptr, [](napi_env env, napi_value js, void*, void* data) {
          if (!env || !js) return;
          const char* command = static_cast<const char*>(data);
          napi_value arg, receiver;
          napi_create_string_utf8(env, command, NAPI_AUTO_LENGTH, &arg);
          napi_get_undefined(env, &receiver);
          napi_call_function(env, receiver, js, 1, &arg, nullptr);
        }, &callback->function) != napi_ok) {
      Dispose();
      return Boolean(env, false);
    }
    napi_unref_threadsafe_function(env, callback->function);
    buttonToken = controls.ButtonPressed([callback](auto const&, SystemMediaTransportControlsButtonPressedEventArgs const& args) {
      const char* command = nullptr;
      switch (args.Button()) {
        case SystemMediaTransportControlsButton::Play: command = "play"; break;
        case SystemMediaTransportControlsButton::Pause: command = "pause"; break;
        case SystemMediaTransportControlsButton::Previous: command = "previous"; break;
        case SystemMediaTransportControlsButton::Next: command = "next"; break;
        default: return;
      }
      napi_call_threadsafe_function(callback->function, const_cast<char*>(command), napi_tsfn_nonblocking);
    });
    subscribed = true;
    controls.IsEnabled(false);
    controls.DisplayUpdater().AppMediaId(L"com.yrrlyb.aria");
    return Boolean(env, true);
  } catch (hresult_error const& error) {
    Dispose();
    napi_throw_error(env, nullptr, to_string(error.message()).c_str());
    return nullptr;
  }
}

napi_value Update(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value args[2];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (!controls || argc < 1) return Boolean(env, false);
  try {
    const auto title = String(env, args[0], "title");
    const auto artist = String(env, args[0], "artist");
    const auto album = String(env, args[0], "album");
    const bool active = Flag(env, args[0], "active");
    controls.IsEnabled(active);
    controls.IsPlayEnabled(active);
    controls.IsPauseEnabled(active);
    controls.IsPreviousEnabled(active && Flag(env, args[0], "canPrevious"));
    controls.IsNextEnabled(active && Flag(env, args[0], "canNext"));
    controls.PlaybackStatus(!active ? MediaPlaybackStatus::Stopped :
      Flag(env, args[0], "playing") ? MediaPlaybackStatus::Playing : MediaPlaybackStatus::Paused);
    auto updater = controls.DisplayUpdater();
    if (!active) {
      updater.ClearAll();
      updater.Update();
      lastTitle.clear(); lastArtist.clear(); lastAlbum.clear(); lastArtwork.clear();
      return Boolean(env, true);
    }
    void* data = nullptr;
    size_t size = 0;
    if (argc > 1) napi_get_buffer_info(env, args[1], &data, &size);
    const std::string artwork(data && size <= 1024 * 1024 ? static_cast<char*>(data) : "",
      data && size <= 1024 * 1024 ? size : 0);
    if (title != lastTitle || artist != lastArtist || album != lastAlbum || artwork != lastArtwork) {
      updater.Type(MediaPlaybackType::Music);
      updater.MusicProperties().Title(to_hstring(title));
      updater.MusicProperties().Artist(to_hstring(artist));
      updater.MusicProperties().AlbumTitle(to_hstring(album));
      if (artwork.empty()) {
        updater.Thumbnail(nullptr);
      } else {
        com_ptr<IStream> stream;
        stream.attach(SHCreateMemStream(reinterpret_cast<const BYTE*>(artwork.data()), static_cast<UINT>(artwork.size())));
        if (!stream) throw hresult_error(E_OUTOFMEMORY);
        IRandomAccessStream random{nullptr};
        check_hresult(CreateRandomAccessStreamOverStream(stream.get(), BSOS_DEFAULT,
          guid_of<IRandomAccessStream>(), put_abi(random)));
        updater.Thumbnail(RandomAccessStreamReference::CreateFromStream(random));
      }
      updater.Update();
      lastTitle = title; lastArtist = artist; lastAlbum = album; lastArtwork = artwork;
    }
    return Boolean(env, true);
  } catch (hresult_error const& error) {
    napi_throw_error(env, nullptr, to_string(error.message()).c_str());
    return nullptr;
  }
}

napi_value Detach(napi_env env, napi_callback_info) {
  Dispose();
  return Boolean(env, true);
}
}  // namespace

void RegisterMediaSession(napi_env env, napi_value exports) {
  napi_property_descriptor props[] = {
    {"attachMediaSession", nullptr, Attach, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"updateMediaSession", nullptr, Update, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"detachMediaSession", nullptr, Detach, nullptr, nullptr, nullptr, napi_default, nullptr},
  };
  napi_define_properties(env, exports, sizeof(props) / sizeof(props[0]), props);
  napi_add_env_cleanup_hook(env, Dispose, nullptr);
}
