// NewMemberBadge for Revenge (Vendetta/Bunny plugin spec)
// Port of Ushie's Aliucord plugin: flags chat authors who joined the current
// server less than N days ago.
(function (exports) {
  "use strict";

  const { before } = vendetta.patcher;
  const { findByStoreName } = vendetta.metro;
  const { React, ReactNative } = vendetta.metro.common;
  const { storage } = vendetta.plugin;
  const { useProxy } = vendetta.storage;
  const { Forms } = vendetta.ui.components;

  const DAY_MS = 24 * 60 * 60 * 1000;

  const GuildMemberStore = findByStoreName("GuildMemberStore");
  const SelectedGuildStore = findByStoreName("SelectedGuildStore");
  const ChatManager = ReactNative.NativeModules.DCDChatManager;

  let unpatch;

  function isNewMember(guildId, userId) {
    if (!guildId || !userId) return false;
    const member = GuildMemberStore.getMember(guildId, userId);
    const joinedAt = member && member.joinedAt;
    if (!joinedAt) return false;
    const joined = Date.parse(joinedAt);
    if (Number.isNaN(joined)) return false;
    return Date.now() - joined < Number(storage.days) * DAY_MS;
  }

  function Settings() {
    useProxy(storage);
    return React.createElement(
      ReactNative.ScrollView,
      null,
      React.createElement(Forms.FormInput, {
        title: "Days a member counts as new",
        value: String(storage.days),
        keyboardType: "numeric",
        onChange: (v) => {
          const n = parseInt(v, 10);
          if (!Number.isNaN(n) && n > 0) storage.days = n;
        },
      }),
      React.createElement(Forms.FormInput, {
        title: "Badge text",
        value: storage.badge,
        onChange: (v) => {
          storage.badge = v;
        },
      })
    );
  }

  exports.default = {
    onLoad() {
      storage.days ??= 7;
      storage.badge ??= "\uD83C\uDF31"; // seedling

      // Chat rows are handed to the native renderer as a JSON string.
      unpatch = before("updateRows", ChatManager, (args) => {
        try {
          const guildId = SelectedGuildStore.getGuildId();
          if (!guildId) return; // DMs have no join date

          const rows = JSON.parse(args[1]);
          for (const row of rows) {
            const msg = row && row.message;
            if (!msg || typeof msg.username !== "string") continue;
            if (msg.username.endsWith(" " + storage.badge)) continue;

            const userId = msg.authorId ?? msg.userId ?? (msg.author && msg.author.id);
            if (isNewMember(guildId, userId)) {
              msg.username = msg.username + " " + storage.badge;
            }
          }
          args[1] = JSON.stringify(rows);
        } catch (e) {
          // Never break chat rendering because of this plugin.
          console.error("[NewMemberBadge]", e);
        }
      });
    },

    onUnload() {
      if (unpatch) unpatch();
    },

    settings: Settings,
  };

  return exports;
})({});
