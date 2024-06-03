# Themes

Themes are really just self-contained webpages that can all have their own behaviors. When you change your theme in the settings, the server will simply make the `/chat` page point to a different theme's folder and refresh the page.

The theme name is taken from its folder name. Normal web rules apply here, so you'll probably want to have your main stuff in `index.html`.

### Why this way?

I was originally planning to just have themes be CSS files that the chat page would swap out dynamically, but it sadly wasn't flexible enough for what I was trying to do.

## Template

Here's a template with the most important components that every theme should have inside its index file. Check the comments for explanations:

<details><summary>Template for index.html</summary>

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <style>

    /* Once the chat messages fill up past the screen,
     * this will hide the scrollbars. Let's also set the
     * font because Firefox defaults to an ugly serif one. */

    body { overflow: hidden; font-family: sans-serif; }

    /* The message contents come pre-formatted as chunks of
     * HTML code, and in every supported platform, emojis/stickers
     * are sent as <img> elements with an `emoji`/`sticker` class.
     * This should make them as tall as the surrounding text. */
     
    .emoji, .sticker { height: 1em; }

  </style>

  <!-- Load the Socket.io library for talking with the server -->
  <script src="/socket.io/socket.io.js"></script>
</head>
<body>

  <!-- Your HTML layouts and containers go here -->

  <script>

    /* This creates the Socket.io client. It's important to
     * include `query: {page: "chat"}` here - that's what
     * tells the server that it's a chat client. Otherwise,
     * no chat messages will be sent over.
     * 
     * You can omit `transports:["websocket"]` here
     * if you're okay with using the older polling method
     * instead of websockets, but it's harder to debug
     * inside your browser inspector than websockets. */
    const socket = io({ transports: ["websocket"], query: {page: "chat"} })

    // Socket.io binds events such as `connect` to functions.

    socket.on("connect", () => {
      console.log("Connected to server")
    })

    /* The server mostly sends `newMessage` events, passing
     * the message data in a predictable structure that's
     * described below.  */

    socket.on("newMessage", (msg) => {

      /* Add your code for displaying messages on the page
       * here! Feel free to use the Plain theme for inspiration.
       * Here's the bare minimum: */

      document.write(msg.contents + "<br>")

      /*
       * Remember to clean out old messages over time, so your
       * browser's performance doesn't get too choppy.
       * The Plain theme also has an implementation of this.
       */

    })

    /* In addition to receiving new chat messages, the server
     * will also send the message history as soon as you connect.
     * The size of this history can be changed in the settings.
     * You can also manually request the history later by
     * emitting `getChatHistory`. */
    socket.on("chatHistory", (data) => {

      // The message history is an array of messages:
      /** @type {ChatMessage[]} */
      const messageHistory = data.history

      // Write past messages to preserve chat between theme switches.
      // The messages are sorted oldest-first!
      messageHistory.forEach(msg => document.write(msg.contents + "<br>"))
    })

    /* Finally, it's important to react to the `themeChange`
     * event by reloading the page, so that it won't be neccessary
     * to refresh the browser source in OBS every time you change
     * the theme in the settings. The server ensures that the new
     * theme is sent after reloading instead of the current one. */
    socket.on("themeChange", () => location.reload())

  </script>
  <!-- Lottie player library solely for supporting a special kind of animated Discord stickers -->
  <script src="https://unpkg.com/@lottiefiles/lottie-player@latest/dist/lottie-player.js"></script>
</body>
</html>
```

</details>

That being said, the [Plain theme](Plain/index.html) provides a much better starting point, as it already handles more advanced situations and comes with a nice starter style.

## Message object structure

> [!NOTE]
> Some items, notably the **avatar URL** in Twitch messages, may be ommited from the message object. Please keep this in mind while developing your theme.

In JSDoc format (`?` marks an optional property):

```js
/**
 * @typedef {{
 *  owner?: boolean,
 *  moderator?: boolean,
 *  member?: boolean,
 *  subscribed?: boolean,
 *  verified?: boolean,
 *  new?: boolean,
 * }} ChatStatus
 * 
 * @typedef {{
 *  nickname: string,
 *  avatarURL?: string,
 *  color?: string,
 *  id?: string,
 *  statusFlags?: ChatStatus
 * }} ChatPerson
 * 
 * @typedef {{
 *  id: string,
 *  platform: Platform,
 *  timestamp: Date | string,
 *  contents: string,
 *  author: ChatPerson,
 * }} ChatMessage
 */
```

### Examples

Here are a few example messages:

<details><summary>Twitch message</summary>

```json
{
  "platform": "twitch",
  "id": "3cab514b-a8f7-4b38-83cd-23dae85dd78d",
  "contents": "Bwah",
  "timestamp": "2024-05-29T03:23:37.756Z",
  "author": {
    "nickname": "Matojeje",
    "id": "56252792",
    "color": "#00FF7F",
    "statusFlags": { "moderator": false, "owner": false, "subscribed": false, "verified": false }
  }
}
```

</details><details><summary>YouTube message</summary>

```json
{
  "platform": "youtube",
  "id": "ChwKGkNNM2s5Nkxic0lZREZickF3Z1FkbDVFRHFn",
  "contents": "いいねえ",
  "timestamp": "2024-05-28T15:58:27.746Z",
  "author": {
    "nickname": "やんc",
    "avatarURL": "https://yt4.ggpht.com/ytc/AIdro_n3VKYfnkTWmXKkrGsae3RNP9mojh5o0GfVv1zMl6upPzU=s64-c-k-c0x00ffffff-no-rj",
    "id": "UCxPXedo0R2YJGs1zJZiu60w",
    "color": "#0bb819",
    "statusFlags": { "moderator": false, "owner": false, "subscribed": false, "verified": false }
  }
}
```

</details><details><summary>Discord message</summary>

```json
{
  "platform": "discord",
  "id": "1246989660090007593",
  "contents": "Meowdy! This is a <strong>Discord</strong> message test. <img class=\"emoji\" alt=\"MatoHeart\" src=\"https://cdn.discordapp.com/emojis/911648272454672384.webp?size=128&quality=lossless\"> <span class=\"spoiler\" style=\"background: currentColor\"><span style=\"opacity: 0%\">Read if cute</span></span>",
  "timestamp": "2024-06-03T00:51:42.913Z",
  "author": {
    "nickname": "mato-bot",
    "id": "342273963734466561",
    "color": "#3498db",
    "avatarURL": "https://cdn.discordapp.com/avatars/342273963734466561/3a4963b8268d6ccc486df18242c65e78.webp?size=128",
    "statusFlags": { "owner": false, "subscribed": false, "new": false, "verified": true, "moderator": false }
  }
}
```

</details>

### Implementation details

The `timestamp` property is a ISO 8601 string, which can be easily turned back into a JS date by doing `new Date(msg.timestamp)`.

The `contents` may contain HTML elements such as emoji images, while the actual message text is pre-escaped from any HTML entities. I recommend using `element.innerHTML` instead of `element.innerText` for displaying message text. See [Discord text formatting](#discord-text-formatting) for more info.

The `author` object can have most of its properties missing, so please keep that in mind if you're adding any badges to usernames.

The `color` is formatted as a hex color string starting with `#`, and doesn't account for any text contrast issues. For example, having a white-colored username on a white OBS background will result in effectively invisible text.

You can improve username readibility by either adding a contrast-lowering filter to your username CSS class, adding a text shadow, or maybe using [chroma.js](https://gka.github.io/chroma.js/) to darken or brighten the color until an acceptable color contrast is achieved.

#### CSS classes

You can except these classes to show up in `contents` from time to time:

- `.emoji`: Emoji images, recommended `height` of `1em`
- `.sticker`: Discord stickers
- `.spoiler`: Discord spoilered text (already comes [pre-styled](#examples))
- `.language-`*: Discord codeblocks with a specific language (ready to be used with [Prism](https://prismjs.com/) or [Highlight.js](https://highlightjs.org/))

#### YouTube specific

| Author flag | Condition |
|:-----------:|:----------|
|owner        | Sender has the owner badge |
|moderator    | Sender is added as moderator in the channel's live chat settings |
|member       | `false` |
|subscribed   | Sender is subscribed to the streaming channel |
|verified     | Sender is [verified](https://support.google.com/youtube/answer/3046484) on YouTube |
|new          | `false` |

Regular YouTube users chatting on the channel won't usually have any color, so they will show up as whatever your theme considers the default color.

Getting a username color involves supporting the channel, being a chat moderator or getting verified.

#### Twitch specific

| Author flag | Condition |
|:-----------:|:----------|
|owner        | Sender has the broadcaster badge or their username matches the IRC channel name |
|moderator    | Sender is a channel moderator, global moderator or admin |
|member       | `false` |
|subscribed   | Sender is *subscribed* to the streaming channel (not to be confused with *following*) |
|verified     | Sender is a [Twitch Partner](https://www.twitch.tv/p/partners/) |
|new          | `false` |

Currently, Twitch messages won't have **avatar URLs** filled in. If your theme's design relies on showing profile pictures, please account for this, either with a dummy/placeholder image for Twitch chatters (perhaps [colorized](https://codepen.io/sosuke/pen/Pjoqqp) to the username color), or by having a different design for messages from Twitch.

#### Picarto specific

| Author flag | Condition |
|:-----------:|:----------|
|owner        | Sender's user ID matches the streamer's user ID |
|moderator    | `false` |
|member       | `false` |
|subscribed   | Sender is self messaging or subscribed (needs further testing) |
|verified     | Sender is using a PMI bot token (needs further testing) |
|new          | `false` |

Picarto's message interface is rather limited and cryptic, and from my testing so far, there's no clear way to tell most of the author flags.

#### Discord specific

| Author flag | Condition |
|:-----------:|:----------|
|owner        | Sender's user ID matches the guild owner's user ID |
|moderator    | Sender has one of the following permissions: Kick members, Ban members, Administrator |
|member       | `false` |
|subscribed   | Sender has an active [server boost](https://support.discord.com/hc/en-us/articles/360028038352-Server-Boosting-FAQ) |
|verified     | Sender's account is a bot account |
|new          | Sender has joined the guild within the last 7 days |

The author's color should correspond to their highest server role with an assigned color.

The precedence for determining the saved username is as follows:

1. Guild nickname
2. Display name
3. Username

##### Discord text formatting

In case of Discord, extra message formatting (such as Markdown, mentions and timestamps) may be preserved and sent over inside `contents` as ready-to-use HTML tags.

Some **mentions** (of users, channels or roles) might reach outside your bot's context, and will fallback to showing up as `@user`, `#channel` and `@role` links inside `<a>` tags respectively. Your bot can only fetch info about the servers and users it has access to.

Newer features from Discord's flavor of Markdown, such as **headings and lists**, are not supported, and in some cases, stripped of their formatting to look like regular normal text.

**Default emoji** will be rendered as Twemoji using `<img>` tags. **Custom emoji**, both static and animated, are fully supported.

**Stickers** are supported and sent as `<img>` images, except for Lottie-type stickers: These will send a `<lottie-player>` element instead, using a CORS proxy to download the JSON data from Discord.

Sending an *image link* of a Discord emoji or sticker, also known as **FakeNitro**, will result in an `<img>` tag looking just a regular emoji or sticker. Lottie sticker links are not supported.

**Timestamps** are rendered using the operating system's locale, and relative timestamps will not be updated over time.

See the [source code](../discordParser.js) for full details.

## Communicating with the server

The server uses a Socket.io server for communicating with web clients, both for Settings and Chat display. Data is sent through either Websockets or polling (as a fallback for older browsers).

> [!NOTE]
> For code examples in this section, the guide assumes that your `io()` client is assigned to the `socket` variable, just like in the template code above.
> 
> You can change any variable and parameter names to your own liking. The only important thing is to keep the **event names** the same.

### Server events

You can receive server events by listening to them like this:

```js
socket.on("eventName", (eventData) => { /* Handler function */ } )

// Or, without arrow functions:
socket.on("eventName", function (eventData) { /* Handler function */ } )
```

> [!TIP]
> If you wish to have the handler written separately, for example if you want to reuse the same code for multiple events, then you can prepare your code in a different function, and then just pass the function name:
> ```js
> socket.on("event1", commonFunction)
> socket.on("event2", commonFunction)
> function commonFunction(eventData) { /* ... */ }
> ```
> The `eventData` gets passed automatically where applicable.

Here's a list of websocket events you can expect to receive and how to respond to them:

#### connect

This event fires once a connection between the chat page and the server is established and ready. It doesn't send any data.

```js
socket.on("connect", () => console.debug("Connected to server"))
```

#### serverShutdown

This is like the opposite of [`connect`](#connect), but it only fires if the server was closed **manually** and about to exit. For example, this event won't fire during a crash.

```js
socket.on("serverShutdown", () => console.debug("Server shutdown announced"))
```

> [!TIP]
> If you want a more fool-proof way to know when you're disconnected, I recommend checking for `socket.connected` to be `false`. See the [Plain theme](Plain/index.html) for an example implementation!

#### newMessage

This event happens for every new message that the server receives. You can refer to the [Message object structure](#message-object-structure) for more info about the data this event sends!

The object will provide you with as much info as possible regarding the chat message, all that's left for you to do is to display this info on the page in any way you'd like.

```js
socket.on("newMessage", (msg) => console.debug("New message received:", msg))
```

#### themeChange

> [!IMPORTANT]
> When you receive this event, you should reload the page.
> 
> ```js
> socket.on("themeChange", (eventData) => window.location.reload())
> ```

This event is fired when you change the theme in the settings.

It also sends the folder names of the previous and new theme, in case you need it for anything:

```js
eventData = {
  newTheme: string,
  oldTheme: string
}
```

It's first emitted to the server from the Settings page, the server then echoes it back to all connected clients.

#### connectChange

This event fires when a platform's connection state changes. That usually happens either due to clicking buttons in Settings, or by enabling Autoconnect.

```js
eventData = {
  youtube: number | ConnState,
  twitch:  number | ConnState,
  picarto: number | ConnState,
  discord: number | ConnState
}

/** @enum {number} ConnState */
const ConnStates = {
  disconnected:   0,
  connecting:     1,
  connected:      2,
  disconnecting:  3,
}
```

#### chatHistory

This event fires as a result of the [`getChatHistory`](#getchathistory) client event, and contains an array of messages sorted by their timestamp, oldest first.

#### historyCleared

> [!IMPORTANT]
> When you receive this event, you should delete all chat messages from the page.

This event is a response to the [`clearHistory`](#clearhistory) client event sent from Settings.

#### saveSuccessful

This event fires after the **Save settings** button is clicked on the settings page. It doesn't send any data.

If you'd like to know what the settings are, you can retrieve them by sending a [`getSettings`](#getsettings)event.

#### settings

This event fires as a result of the [`getSettings`](#getsettings) client event, and contains the current state of the settings.

```js
eventData = {
  version: 1,
  chat: {
    historySize: number, // Positive integer
    theme: string // Corresponds to theme folder names
  },
  platforms: {
    youtube: { channel: string },
    twitch: { channel: string },
    picarto: { channel: string },
    discord: { channel: string } // Format: GuildID_ChannelID
  },
  server: {
    port: number, // Positive integer
    autoconnect: boolean
  }
}
```

#### themeList

This event is a response to the [`getThemes`](#getthemes) client event, and responds with a string array of folder names in the `themes` folder that have a `index.html` file inside.

### Client events

And here are the events that you can emit to the server:

#### getChatHistory

Asks the server to send the newest $n$ messages. Expect [`chatHistory`](#chathistory) as a response, see the server event for more info.

```js
const requestedCount = 50
socket.emit("getChatHistory", requestedCount)
```

#### getThemes

Asks the server for a list of themes. Expect [`themeList`](#themelist) as a response, see the server event for more info.

#### getSettings

Same as above, but for settings. The server response is [`settings`](#settings).

#### clearHistory

While this should normally only be sent from the Settings page, you can still emit this event to clear the server-side chat history. Expect [`historyCleared`](#historycleared) as a response.
