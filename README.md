# New-Member-Badge

A [Discord Revenge](https://github.com/revenge-mod) plugin that shows a small badge next to the name of anyone who recently joined the server, so you can spot new members in chat at a glance.

## Install

In Revenge, go to Plugins → Install and paste:

```
https://dxckie-cell.github.io/New-Member-Badge/
```

## Settings

- **Days a member counts as new** – default 7
- **Mode** – `tag` (icon chip next to the name) or `text` (emoji after the name)
- **Icon style** – `centered` (smaller, centred) or `big` (larger, slightly left)
- **Replace members' own server tag** – `yes` / `no`
- **Label** – up to 4 letters next to the icon (empty = icon only)
- **Badge text** – emoji used in text mode

## Limitations

- Only members whose join date Discord has already loaded get a badge.
- Works on Revenge Classic (Vendetta/Bunny plugin spec); not tested on Revenge Next.

## Credits

This is a port of the **NewMemberBadge** plugin for Aliucord by [Ushie](https://github.com/Ushie):
https://github.com/Ushie/Aliucord-Plugins/tree/main/plugins/NewMemberBadge

Ported to Revenge by dxckie cell.
