You already have a working dev config with llm set up — you just need to add a telegram block. Here's the full setup:

1. Create a bot and get a token
- In Telegram, message @BotFather, send /newbot, follow the prompts (name + unique username ending in bot).
- BotFather replies with an API token like 123456789:AAH....

2. Get your numeric Telegram user ID
- Message @userinfobot (or @RawDataBot) — it replies with your numeric id. That's what goes in allowedUserIds, not your @username.

3. Add the telegram block to your config

That file is at /home/dcr/.config/kaja/config.json (shown above). Add:

"telegram": {
  "botToken": "123456789:AAH...",
  "allowedUserIds": [YOUR_NUMERIC_ID]
}

4. Run it

bun cli.tsx telegram

It preflights with getMe() — if the token's bad you get an immediate one-line error, no stack trace. On success it logs "ready" and starts long-polling.

5. Test in Telegram
- Open a DM with your bot (search its username) and send /start or any message.
- Try something that triggers a shell command (if you have that tool enabled) to exercise the inline-keyboard approve/decline flow.
- If you have a second Telegram account, message from a non-allowlisted user ID — the bot should silently ignore it (per handleMessage's allowedUserIds.has(userId) check).
