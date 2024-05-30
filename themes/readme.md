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
     * HTML code, and in every supported platform, emojis
     * are sent as <img> elements with an `emoji` class.
     * This should make them as tall as the surrounding text. */
     
    .emoji { height: 1em; } 

  </style>

  <!-- Load the Socket.io library for talking with the server -->
  <script src="/socket.io/socket.io.js"></script>
</head>
<body>

  <!-- Your HTML layouts and containers go here -->

  <script>

    /* You can omit `{transports:["websocket"]}` here
     * if you're okay with using the older polling method
     * instead of websockets, but it's harder to debug than
     * websockets inside your browser inspector. */

    const socket = io({ transports: ["websocket"] })

    // Socket.io binds events such as `connect` to functions.

    socket.on("connect", () => {
      console.log("Connected to server")

      /* You can ask the server to send you the latest bunch
       * of messages, so that you don't have to start from a
       * blank screen every time you switch the theme. WIP!
       */
    })

    /* The server mostly sends `newMessage` events, passing
     * the message data in a predictable structure that's
     * described below.  */

    socket.on("newMessage", (msg) => {

      /* Add your code for displaying messages on the page
       * here! Feel free to use the Plain theme for inspiration.
       * Here's the bare minimum: */

      document.write(msg.contents)

      /*
       * Remember to clean out old messages over time, so your
       * browser's performance doesn't get too choppy.
       * The Plain theme also has an implementation of this.
       */

    })

    socket.on("themeChange")
  </script>
</body>
</html>
```

</details>

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
 *  timestamp: Date,
 *  contents: string,
 *  author: ChatPerson,
 * }} ChatMessage
 */
```

Here are a few example messages:

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

## Communicating with the server

The server uses a Socket.io server for communicating with web clients, both for Settings and Chat display. Data is sent through either Websockets or polling (as a fallback for older browsers).

For code examples in this section, the guide assumes that your `io()` client is assigned to the `socket` variable, just like in the template code above.

You can change any variable and parameter names to your own liking. The only important thing is to keep the event name strings the same.

### Server events

You can receive server events by listening to them like this:

```js
socket.on("eventName", eventData => { /* Handler function */ } )

// Or, without arrow functions:
socket.on("eventName", function (eventData) { /* Handler function */ } )
```

> [!TIP]
> If you wish to have the handler written separately, for example if you want to reuse the same code both for adding new messages and loading messages from history, then you can 

Here's a list of websocket events you can expect to receive and how to respond to them:

#### connect

#### newMessage

#### themeChange

#### settingschange idk

### Client events

And here are the events that you can emit to the server:

#### getChatHistory
