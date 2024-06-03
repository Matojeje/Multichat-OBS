**OBS Multichat** gathers chat messages from multiple streaming platforms at once,
and shows them in its own themable chat window!

### Currently supported platforms and features

> [!NOTE]
> <small>System messages, including subscriptions, donations, polls, highlighting and deleting messages, banning users and other non-text events that happen in the chat, are not supported for now.</small>

| Name    | Chat messages | System messages | Colors | Emoji | Stickers | Formatting | Token required? |
|:--------|:-------------:|:---------------:|:------:|:-----:|:--------:|:----------:|----------------:|
| YouTube | ✓ | ⨉ | ✓ | ✓ | ⨉ | ⨉ | No      |
| Twitch  | ✓ | ⨉ | ✓ | ✓ | ⨉ | ⨉ | No[^1]  |
| Picarto | ✓ | ⨉ | ✓ | ⨉ | ⨉ | ⨉ | Yes[^2] |
| Discord | ✓ | ⨉ | ✓ | ✓ | ✓ | ✓ | Yes     |

[^1]: This project's method of accessing Twitch chat doesn't require a Twitch API key, but it unfortunately doesn't support retrieving user avatars.
[^2]: Your Picarto token only works for accessing your own channel's chat.

# Quick guide

> [!IMPORTANT]
> Make sure you have [Node.js](https://nodejs.org/) v20 (or higher) installed first.

1. Check out the **[.env.example](./.env.example)** file if you're planning to use Picarto or Discord

2. Open up a terminal in this project's root folder [(how?)](https://superuser.com/a/340051/26294)

3. Install the required libraries with <kbd>npm ci</kbd>

4. Start the program with <kbd>node .</kbd>

5. Open the displayed server URL in your browser, or scan the QR code

6. Go to the **Settings** page and set up your channel sources

7. Click the buttons to connect to your livestream chats

8. Add a browser source to OBS pointing to the **Chat** page – [localhost:1151/chat](http://127.0.0.1:1151/chat) by default

9. (Optional) If you have a dark background behind your browser source, add the following custom CSS: `:root { color-scheme: dark; }`

# Themes

Themes can have their own style and behaviour. For info on making a theme, please check out the [Themes folder](./themes/readme.md)!
