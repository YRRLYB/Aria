// Aria's macOS media session: publishes playback state to
// MPNowPlayingInfoCenter (Control Center / lock screen) and routes
// MPRemoteCommandCenter actions back into the Electron main process, which
// forwards them to the renderer over aria:playback-command. Mirrors the
// Windows aria-thumbnail media_session ownership: the app owns the system
// media controls for both the Chromium and mpv output paths.
#import <Foundation/Foundation.h>
#import <MediaPlayer/MediaPlayer.h>
#import <AppKit/AppKit.h>

#include <node_api.h>
#include <string>

namespace {

napi_threadsafe_function g_commandCallback = nullptr;
BOOL g_attached = NO;

// Targets returned by -addTarget:, kept so detach can remove them.
id g_playTarget = nil;
id g_pauseTarget = nil;
id g_toggleTarget = nil;
id g_nextTarget = nil;
id g_previousTarget = nil;

void SendCommand(const std::string& command) {
  if (!g_commandCallback) return;
  std::string* payload = new std::string(command);
  // Nonblocking: a dropped command during teardown is acceptable; the
  // renderer state stays the source of truth either way.
  napi_call_threadsafe_function(g_commandCallback, payload, napi_tsfn_nonblocking);
}

void DispatchCommandToJs(napi_env env, napi_value jsCallback, void* /*context*/, void* data) {
  std::string* payload = static_cast<std::string*>(data);
  if (env != nullptr && jsCallback != nullptr && payload != nullptr) {
    napi_value value = nullptr;
    if (napi_create_string_utf8(env, payload->c_str(), payload->size(), &value) == napi_ok) {
      napi_call_function(env, jsCallback, jsCallback, 1, &value, nullptr);
    }
  }
  delete payload;
}

id AddCommandHandler(MPRemoteCommand* command, const char* name) {
  std::string commandName(name);
  return [command addTargetWithHandler:^MPRemoteCommandHandlerStatus(MPRemoteCommandEvent *event) {
    (void)event;
    SendCommand(commandName);
    return MPRemoteCommandHandlerStatusSuccess;
  }];
}

napi_value GetUtf8(napi_env env, napi_value object, const char* key, std::string& out) {
  napi_value value = nullptr;
  if (napi_get_named_property(env, object, key, &value) != napi_ok || value == nullptr) return nullptr;
  size_t length = 0;
  if (napi_get_value_string_utf8(env, value, nullptr, 0, &length) != napi_ok) return nullptr;
  out.resize(length);
  if (length > 0) {
    if (napi_get_value_string_utf8(env, value, &out[0], length + 1, &length) != napi_ok) return nullptr;
  }
  return value;
}

BOOL GetBoolean(napi_env env, napi_value object, const char* key, BOOL fallback) {
  napi_value value = nullptr;
  bool result = fallback;
  if (napi_get_named_property(env, object, key, &value) != napi_ok || value == nullptr) return fallback;
  if (napi_get_value_bool(env, value, &result) != napi_ok) return fallback;
  return result ? YES : NO;
}

napi_value Attach(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1] = {nullptr};
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (argc < 1 || args[0] == nullptr) {
    napi_throw_type_error(env, nullptr, "attach requires a command callback");
    return nullptr;
  }

  if (!g_attached) {
    napi_value resourceName = nullptr;
    napi_create_string_utf8(env, "aria-nowplaying", NAPI_AUTO_LENGTH, &resourceName);
    napi_status status = napi_create_threadsafe_function(
        env,
        args[0],
        nullptr,
        resourceName,
        16,
        1,
        nullptr,
        nullptr,
        nullptr,
        DispatchCommandToJs,
        &g_commandCallback);
    if (status != napi_ok) {
      napi_throw_error(env, nullptr, "unable to create the command threadsafe function");
      return nullptr;
    }

    MPRemoteCommandCenter *center = [MPRemoteCommandCenter sharedCommandCenter];
    g_playTarget = AddCommandHandler(center.playCommand, "play");
    g_pauseTarget = AddCommandHandler(center.pauseCommand, "pause");
    g_toggleTarget = AddCommandHandler(center.togglePlayPauseCommand, "toggle");
    g_nextTarget = AddCommandHandler(center.nextTrackCommand, "next");
    g_previousTarget = AddCommandHandler(center.previousTrackCommand, "previous");
    g_attached = YES;
  }

  napi_value result = nullptr;
  napi_get_boolean(env, g_attached, &result);
  return result;
}

napi_value UpdateMediaSession(napi_env env, napi_callback_info cbInfo) {
  size_t argc = 2;
  napi_value args[2] = {nullptr, nullptr};
  napi_get_cb_info(env, cbInfo, &argc, args, nullptr, nullptr);
  if (argc < 2 || args[0] == nullptr || args[1] == nullptr) {
    napi_throw_type_error(env, nullptr, "updateMediaSession requires (state, artwork)");
    return nullptr;
  }

  std::string title;
  std::string artist;
  std::string album;
  GetUtf8(env, args[0], "title", title);
  GetUtf8(env, args[0], "artist", artist);
  GetUtf8(env, args[0], "album", album);
  BOOL active = GetBoolean(env, args[0], "active", NO);
  BOOL playing = GetBoolean(env, args[0], "playing", NO);

  MPNowPlayingInfoCenter *center = [MPNowPlayingInfoCenter defaultCenter];
  if (!active) {
    center.nowPlayingInfo = nil;
    napi_value result = nullptr;
    napi_get_boolean(env, YES, &result);
    return result;
  }

  NSMutableDictionary *info = [NSMutableDictionary dictionary];
  if (!title.empty()) info[MPMediaItemPropertyTitle] = [NSString stringWithUTF8String:title.c_str()];
  if (!artist.empty()) info[MPMediaItemPropertyArtist] = [NSString stringWithUTF8String:artist.c_str()];
  if (!album.empty()) info[MPMediaItemPropertyAlbumTitle] = [NSString stringWithUTF8String:album.c_str()];
  info[MPNowPlayingInfoPropertyPlaybackRate] = @(playing ? 1.0 : 0.0);

  void *artworkData = nullptr;
  size_t artworkLength = 0;
  if (napi_get_buffer_info(env, args[1], &artworkData, &artworkLength) == napi_ok && artworkLength > 0) {
    NSData *png = [NSData dataWithBytes:artworkData length:artworkLength];
    NSImage *image = [[NSImage alloc] initWithData:png];
    if (image != nil) {
      NSSize size = image.size;
      MPMediaItemArtwork *artwork = [[MPMediaItemArtwork alloc] initWithBoundsSize:size
                                                                    requestHandler:^NSImage *(CGSize requestedSize) {
        (void)requestedSize;
        return image;
      }];
      info[MPMediaItemPropertyArtwork] = artwork;
    }
  }

  center.nowPlayingInfo = info;

  napi_value result = nullptr;
  napi_get_boolean(env, YES, &result);
  return result;
}

napi_value Detach(napi_env env, napi_callback_info /*info*/) {
  if (g_attached) {
    MPRemoteCommandCenter *center = [MPRemoteCommandCenter sharedCommandCenter];
    if (g_playTarget) [center.playCommand removeTarget:g_playTarget];
    if (g_pauseTarget) [center.pauseCommand removeTarget:g_pauseTarget];
    if (g_toggleTarget) [center.togglePlayPauseCommand removeTarget:g_toggleTarget];
    if (g_nextTarget) [center.nextTrackCommand removeTarget:g_nextTarget];
    if (g_previousTarget) [center.previousTrackCommand removeTarget:g_previousTarget];
    g_playTarget = g_pauseTarget = g_toggleTarget = g_nextTarget = g_previousTarget = nil;
    [MPNowPlayingInfoCenter defaultCenter].nowPlayingInfo = nil;
    g_attached = NO;
    if (g_commandCallback) {
      napi_release_threadsafe_function(g_commandCallback, napi_tsfn_release);
      g_commandCallback = nullptr;
    }
  }
  napi_value result = nullptr;
  napi_get_boolean(env, YES, &result);
  return result;
}

napi_value Init(napi_env env, napi_value exports) {
  napi_value fn = nullptr;
  napi_create_function(env, "attach", NAPI_AUTO_LENGTH, Attach, nullptr, &fn);
  napi_set_named_property(env, exports, "attach", fn);
  napi_create_function(env, "updateMediaSession", NAPI_AUTO_LENGTH, UpdateMediaSession, nullptr, &fn);
  napi_set_named_property(env, exports, "updateMediaSession", fn);
  napi_create_function(env, "detach", NAPI_AUTO_LENGTH, Detach, nullptr, &fn);
  napi_set_named_property(env, exports, "detach", fn);
  return exports;
}

}  // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
