// Root build script. Intentionally tiny: each module declares its own plugins
// (versions come from settings `pluginManagement`), exactly as in the web
// monorepo where every package owns its config. No cross-module config here so an
// SDK-less build (core-only) never touches the Android Gradle Plugin.
